# Site Awareness — Foundation (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only, gated `Site Awareness` page where a `site-business` user sees ONLY their site's Helpdesk snapshot + key lists, proving the two access roles, server-enforced site scoping, and the cross-module site-resolution layer end-to-end.

**Architecture:** A standalone page (`exec-view`/`site-report` precedent: session cookie, `injectApiKey=false`, no `window.__ak`) served from `_htmlCache`, driven by read-only `/api/site-awareness/*` routes in a new factory module (`routes/siteAwareness.js`, mounted like `routes/opmanager.js`). A pure `services/siteResolve.js` maps a canonical `site_id` → each module's code and lists the sites a user may view. Two feature roles (`site-business`, `group-business`) join `FEATURE_ROLES_KNOWN`. No writes, no new schema.

**Tech Stack:** Node.js + Express, better-sqlite3 / postgres dual-backend (`REPORTS_BACKEND`), `node --test`. Follows CLAUDE.md: null≠0, await-precedence, PII-whitelist (exec-view `pick`), per-site helpdesk scoping via `zoho_group`.

**Spec:** `docs/superpowers/specs/2026-08-25-site-awareness-foundation-design.md`

**Reference reads (before starting):**
- `services/siteReportDeps.js` — `_lastIsoWeeks(asOfIso, n)` (exported) for the 6 ISO weeks.
- `reports-db.js` — `getSiteHelpdeskWindow(site_id, from, to)` (:2143, INCLUSIVE 'YYYY-MM-DD', returns `_computeSiteHelpdesk` = `{created, resolved, backlog, sla_overdue, major_incidents, top_categories[], recurring[]}`), `getActiveMajorIncidentsForSite(groups)` (:7680), `listSites` (:1912), `listSiteModuleCodes(module)` (:1961), `userHasRole` (:1279), `FEATURE_ROLES_KNOWN` (:1230, allowlist enforced by `setUserRoles` :1257/:1840).
- `routes/opmanager.js` — the DI route-factory pattern; mount at `server.js:7607`.
- `public/exec-view.html` + `server.js:1263-1276` — standalone read-only page + `sendHtmlPage(..., false, ...)` serve pattern; `_htmlCache` list at `server.js:1232`.
- `public/assets.html` — in-page hash-synced tab bar pattern (Site Awareness tabs are in-page sections, NOT cross-page `module-tabs`).

---

## Task 1: `services/siteResolve.js` — pure cross-module resolution (the crux)

**Files:**
- Create: `services/siteResolve.js`
- Test: `tests/site-resolve.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveSite, listAuthorizedSites } = require('../services/siteResolve');

// Injected readers mimicking reports-db shapes.
const SITES = [
  { id: 1, name: 'Hounde', zoho_group: 'Hounde IT Agents' },
  { id: 2, name: 'Mana', zoho_group: 'Mana IT Agent' },
  { id: 3, name: 'Exploration', zoho_group: 'Exploration BF Support,Exploration CI Support' },
];
const MEETINGS_CODES = [{ site_id: 1, code: 'HGO' }, { site_id: 2, code: 'MGO' }]; // NB: Exploration has none
const deps = {
  listSites: () => SITES,
  listSiteModuleCodes: (m) => (m === 'meetings' ? MEETINGS_CODES : []),
  userHasRole: (u, r) => (u.roles || []).includes(r),
  inspectionSiteCode: (name) => ({ Hounde: 'HGO', Mana: 'MGO' }[name] || null),
  trackerSiteCode: (name) => ({ Hounde: 'HGO', Mana: 'MGO' }[name] || null),
};

test('resolveSite maps a canonical site_id to every module code', () => {
  const r = resolveSite(deps, 1);
  assert.equal(r.site_id, 1);
  assert.equal(r.site_name, 'Hounde');
  assert.equal(r.helpdesk_group, 'Hounde IT Agents');
  assert.equal(r.meetings_code, 'HGO');
  assert.equal(r.inspection_code, 'HGO');
  assert.equal(r.tracker_code, 'HGO');
});

test('a missing module code stays null — never guessed (Exploration has no meetings code)', () => {
  const r = resolveSite(deps, 3);
  assert.equal(r.helpdesk_group, 'Exploration BF Support,Exploration CI Support');
  assert.strictEqual(r.meetings_code, null, 'no meetings code → null, not borrowed');
});

test('resolveSite returns null for an unknown site_id', () => {
  assert.strictEqual(resolveSite(deps, 999), null);
});

test('listAuthorizedSites: site-business sees only their site_id', () => {
  const got = listAuthorizedSites(deps, { roles: ['site-business'], site_id: 2 });
  assert.deepEqual(got, [{ site_id: 2, site_name: 'Mana' }]);
});

test('listAuthorizedSites: group-business (and executive) see all sites', () => {
  const all = listAuthorizedSites(deps, { roles: ['group-business'] });
  assert.equal(all.length, 3);
  assert.deepEqual(listAuthorizedSites(deps, { roles: ['executive'] }).map(s => s.site_id), [1, 2, 3]);
});

test('listAuthorizedSites: site-business with no site_id sees nothing (fails safe)', () => {
  assert.deepEqual(listAuthorizedSites(deps, { roles: ['site-business'] }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-force-exit tests/site-resolve.test.js`
Expected: FAIL — `Cannot find module '../services/siteResolve'`.

- [ ] **Step 3: Write the minimal implementation**

```js
'use strict';
// Site Awareness — resolve a canonical site_id to each module's own code, and list the sites a
// business user may view. PURE: readers injected, no DB. A missing code stays NULL (never guessed
// — a wrong code false-greens a site; the tab reads "non applicable"). CLAUDE.md null≠0 rule.
// site_module_codes only carries 'meetings' (+ meraki/opmanager); inspection/tracker codes come
// from those modules' own name→code maps, injected as inspectionSiteCode/trackerSiteCode.

function resolveSite(deps, site_id) {
  const sid = Number(site_id);
  const sites = (deps.listSites && deps.listSites({ includeInactive: true })) || [];
  const site = sites.find((s) => Number(s.id) === sid) || null;
  if (!site) return null;
  const codeIn = (module) => {
    const rows = (deps.listSiteModuleCodes && deps.listSiteModuleCodes(module)) || [];
    const hit = rows.find((r) => Number(r.site_id) === sid);
    return hit ? hit.code : null;
  };
  return {
    site_id: sid,
    site_name: site.name || null,
    helpdesk_group: (String(site.zoho_group || '').trim() || null),
    meetings_code: codeIn('meetings'),
    inspection_code: codeIn('inspection') || (deps.inspectionSiteCode ? deps.inspectionSiteCode(site.name) : null) || null,
    tracker_code: codeIn('tracker') || (deps.trackerSiteCode ? deps.trackerSiteCode(site.name) : null) || null,
  };
}

// The sites a user may view: group-business / executive → all active; site-business → their own.
function listAuthorizedSites(deps, user) {
  const all = ((deps.listSites && deps.listSites({ includeInactive: false })) || [])
    .map((s) => ({ site_id: Number(s.id), site_name: s.name || null }));
  const has = (r) => deps.userHasRole && deps.userHasRole(user, r);
  if (has('group-business') || has('executive') || has('super_admin')) return all;
  const sid = user && user.site_id != null ? Number(user.site_id) : null;
  return sid == null ? [] : all.filter((s) => s.site_id === sid);
}

module.exports = { resolveSite, listAuthorizedSites };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-force-exit tests/site-resolve.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/siteResolve.js tests/site-resolve.test.js
git commit -m "feat(site-awareness): pure cross-module site resolution (siteResolve.js)"
```

---

## Task 2: Register the two feature roles

**Files:**
- Modify: `reports-db.js:1230` (`FEATURE_ROLES_KNOWN`)
- Modify: `public/reports.html` (Users role checkboxes — so an admin can assign them)
- Test: `tests/site-awareness-roles.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('site-business / group-business are known feature roles', () => {
  assert.ok(rdb.FEATURE_ROLES_KNOWN.includes('site-business'));
  assert.ok(rdb.FEATURE_ROLES_KNOWN.includes('group-business'));
});

test('userHasRole recognises the new feature roles by exact match', () => {
  const u = { roles: ['site-business'], site_id: 1 };
  assert.equal(rdb.userHasRole(u, 'site-business'), true);
  assert.equal(rdb.userHasRole(u, 'group-business'), false);
  assert.equal(rdb.userHasRole(u, 'admin'), false, 'a feature role must NOT imply hierarchy roles');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-force-exit tests/site-awareness-roles.test.js`
Expected: FAIL — `FEATURE_ROLES_KNOWN` lacks the two strings.

- [ ] **Step 3: Implement**

In `reports-db.js:1230`, extend the array:
```js
const FEATURE_ROLES_KNOWN = ['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'site-business', 'group-business'];
```
(This is the single allowlist `setUserRoles` filters against at :1257 and :1840, so the roles become assignable AND recognised by `userHasRole` — no hierarchy entry needed for feature roles.)

In `public/reports.html`, find the Users modal role checkboxes (grep `scorecard-viewer`) and add two options with short labels: `site-business` ("Business — son site (GM/FM)") and `group-business` ("Business — tous les sites (CIO/CFO)").

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-force-exit tests/site-awareness-roles.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reports-db.js public/reports.html tests/site-awareness-roles.test.js
git commit -m "feat(site-awareness): register site-business / group-business feature roles"
```

---

## Task 3: `routes/siteAwareness.js` — scoped read-only endpoints

**Files:**
- Create: `routes/siteAwareness.js`
- Test: `tests/site-awareness-routes.smoke.test.js`

The factory receives `{ express, requireReportSession, rdb }` and mounts:
- `GET /api/site-awareness/summary?site=` → `{ site_id, site_name, is_group_view, authorized_sites:[{site_id,site_name}], tabs:{helpdesk:true, inspections:false, meetings:false, actions:false, tracker:false} }`.
- `GET /api/site-awareness/helpdesk?site=` → whitelisted snapshot + 6-week series + active-MI list.

**The scoping gate `resolveAuthorizedSiteId(user, requestedSite)`** (module-local helper):
- Build `authorized = listAuthorizedSites({listSites: rdb.listSites, userHasRole: rdb.userHasRole}, user)`.
- No authorized sites → `{ status: 403 }`.
- Group/exec/super: honour `?site` (parsed int) if it's in `authorized`, else default to `authorized[0]`.
- Otherwise (site-business): if `?site` is present AND ≠ their site_id → `{ status: 403 }` (explicit reject); else force `authorized[0].site_id`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

// Inject a fake rdb so the smoke needs no live DB. Mirrors the real reader shapes.
function makeApp(sessionUser) {
  const rdb = {
    listSites: () => [
      { id: 1, name: 'Hounde', zoho_group: 'Hounde IT Agents' },
      { id: 2, name: 'Mana', zoho_group: 'Mana IT Agent' },
    ],
    userHasRole: (u, r) => (u.roles || []).includes(r),
    getSiteHelpdeskWindow: () => ({ created: 10, resolved: 8, backlog: 2, sla_overdue: 1, major_incidents: 0, top_categories: [], recurring: [] }),
    getActiveMajorIncidentsForSite: () => [{ id: 42, subject: 'X', requester: 'SECRET PERSON', technician: 'SECRET TECH', status: 'Open', created_time: '2026-08-01' }],
  };
  const requireReportSession = (req, _res, next) => { req.reportUser = sessionUser; next(); };
  const app = express();
  app.use(require('../routes/siteAwareness')({ express, requireReportSession, rdb }));
  return app;
}
async function call(app, path) {
  const srv = app.listen(0); const port = srv.address().port;
  try { const r = await fetch(`http://127.0.0.1:${port}${path}`); return { status: r.status, body: await r.json().catch(() => ({})) }; }
  finally { srv.close(); }
}

test('site-business summary is scoped to the user site; selector lists only that site', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status, body } = await call(app, '/api/site-awareness/summary');
  assert.equal(status, 200);
  assert.equal(body.site_id, 1);
  assert.deepEqual(body.authorized_sites.map(s => s.site_id), [1]);
  assert.equal(body.tabs.helpdesk, true);
  assert.equal(body.tabs.inspections, false);
});

test('site-business requesting a FOREIGN ?site is refused (403)', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { status } = await call(app, '/api/site-awareness/helpdesk?site=2');
  assert.equal(status, 403);
});

test('group-business may pass ?site and select any site', async () => {
  const app = makeApp({ id: 9, roles: ['group-business'] });
  const { status, body } = await call(app, '/api/site-awareness/helpdesk?site=2');
  assert.equal(status, 200);
  assert.equal(body.site_id, 2);
});

test('helpdesk payload carries NO PII (no requester/technician/subject leakage)', async () => {
  const app = makeApp({ id: 5, roles: ['site-business'], site_id: 1 });
  const { body } = await call(app, '/api/site-awareness/helpdesk');
  const json = JSON.stringify(body);
  assert.ok(!/SECRET PERSON|SECRET TECH/.test(json), 'requester/technician names must be stripped');
  assert.ok(body.snapshot && body.snapshot.created === 10);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-force-exit tests/site-awareness-routes.smoke.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `routes/siteAwareness.js`**

```js
'use strict';
// Site Awareness — read-only, per-site business view. Scoping is server-enforced: a site-business
// user's site comes from the SESSION, never the request. PII-safe: every field is whitelisted
// (the exec-view pattern) — no requester/technician/subject names leave the server.
const { resolveSite, listAuthorizedSites } = require('../services/siteResolve');

module.exports = function siteAwarenessRoutes({ express, requireReportSession, rdb }) {
  const router = express.Router();
  const deps = { listSites: rdb.listSites, listSiteModuleCodes: rdb.listSiteModuleCodes, userHasRole: rdb.userHasRole,
                 inspectionSiteCode: rdb.inspectionSiteCode, trackerSiteCode: rdb.trackerSiteCode };

  function authorizedSiteId(user, requestedRaw) {
    const authorized = listAuthorizedSites(deps, user);
    if (!authorized.length) return { status: 403 };
    const ids = new Set(authorized.map((s) => s.site_id));
    const isGroup = rdb.userHasRole(user, 'group-business') || rdb.userHasRole(user, 'executive') || rdb.userHasRole(user, 'super_admin');
    const requested = requestedRaw != null && requestedRaw !== '' ? Number(requestedRaw) : null;
    if (isGroup) return { site_id: (requested != null && ids.has(requested)) ? requested : authorized[0].site_id, authorized };
    // site-business: an explicit foreign site is a hard refusal; otherwise their own.
    if (requested != null && requested !== authorized[0].site_id) return { status: 403 };
    return { site_id: authorized[0].site_id, authorized };
  }

  router.get('/api/site-awareness/summary', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      const isGroup = rdb.userHasRole(req.reportUser, 'group-business') || rdb.userHasRole(req.reportUser, 'executive') || rdb.userHasRole(req.reportUser, 'super_admin');
      res.json({
        site_id: gate.site_id, site_name: rs.site_name || null, is_group_view: !!isGroup,
        authorized_sites: gate.authorized,
        // tabs.x=false means "bientôt" (SP2), DISTINCT from a per-tab {applicable:false} (non applicable pour ce site).
        tabs: { helpdesk: true, inspections: false, meetings: false, actions: false, tracker: false },
      });
    } catch (_) { res.json({ site_id: null, authorized_sites: [], tabs: { helpdesk: true } }); }
  });

  router.get('/api/site-awareness/helpdesk', requireReportSession, async (req, res) => {
    try {
      const gate = authorizedSiteId(req.reportUser, req.query.site);
      if (gate.status) return res.status(gate.status).json({ error: 'forbidden' });
      const rs = resolveSite(deps, gate.site_id) || {};
      // Snapshot window = last full month ending today (a business monthly view). Reuse the
      // window reader (scopes by zoho_group internally from site_id — pass the SITE_ID, not the group).
      const now = new Date();
      const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const snap = await rdb.getSiteHelpdeskWindow(gate.site_id, mStart, mEnd);

      // 6 ISO weeks (volume + missed-SLA), like siteReportDeps.helpdeskWeekly.
      const { _lastIsoWeeks } = require('../services/siteReportDeps');
      const weekly = [];
      // _lastIsoWeeks expects a BARE 'YYYY-MM-DD' (it does new Date(asOf + 'T00:00:00Z') internally);
      // a full ISO timestamp → Invalid Date → throw. Use .slice(0,10).
      for (const w of _lastIsoWeeks(now.toISOString().slice(0, 10), 6)) {
        const h = await rdb.getSiteHelpdeskWindow(gate.site_id, w.from, w.to); // w.{from,to,label} — confirm field names in _lastIsoWeeks
        weekly.push({ label: w.label, inbound: h.created, closed: h.resolved,
          missed_pct: h.created ? Math.round((h.sla_overdue / h.created) * 1000) / 10 : null }); // null when inbound 0 (never a false 0)
      }

      // Active MI — WHITELIST identity-only fields (NO requester/technician/subject).
      const groups = String(rs.helpdesk_group || '').split(',').map((g) => g.trim()).filter(Boolean);
      const miRaw = (groups.length ? await rdb.getActiveMajorIncidentsForSite(groups) : []) || [];
      const major_incidents = miRaw.map((m) => ({ id: m.id, status: m.status || null, created_time: m.created_time || null, p_label: m['P-Label'] || null }));

      res.json({
        applicable: true, site_id: gate.site_id, site_name: rs.site_name || null,
        snapshot: { created: snap.created, resolved: snap.resolved, backlog: snap.backlog,
          sla_overdue: snap.sla_overdue, major_incidents: snap.major_incidents,
          top_categories: snap.top_categories || [] },   // category/count only — no free text beyond category label
        weekly, major_incidents,
      });
    } catch (_) { res.json({ applicable: true, snapshot: null, weekly: [], major_incidents: [] }); }
  });

  return router;
};
```

> **NB for the implementer:** (1) `_lastIsoWeeks` takes a **bare `YYYY-MM-DD`** (already handled above via `.slice(0,10)`) — a full ISO timestamp throws Invalid Date. (2) Confirm its element field names (week descriptors — likely `{year, week, from, to, label}` or `{start_date,...}`); adapt `w.from`/`w.to`/`w.label` to the real shape (read `services/siteReportDeps.js:269`). If it returns `{year, week}` only, derive the range with the same `getWeekRange` the deps use.
>
> **NB (SP2 forward-note):** `inspectionSiteCode` / `trackerSiteCode` are injected into `deps` here from `rdb.*`, but they **do not exist on `reports-db.js`** — the real name→code maps live in `inspection-db.js` / `tracker-db.js` as `siteNameToCode`. Harmless in SP1 (the Helpdesk tab uses only `helpdesk_group`, and `siteResolve`'s test injects them directly), but **SP2 must inject those two resolvers from their own module DBs**, not from `rdb`, or inspection/tracker codes silently resolve to `null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --test-force-exit tests/site-awareness-routes.smoke.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add routes/siteAwareness.js tests/site-awareness-routes.smoke.test.js
git commit -m "feat(site-awareness): scoped read-only summary + helpdesk endpoints (server-enforced, PII-safe)"
```

---

## Task 4: `public/site-awareness.html` + serve route + mount

**Files:**
- Create: `public/site-awareness.html`
- Modify: `server.js:1232` (add `'site-awareness.html'` to the `_htmlCache` load list)
- Modify: `server.js` (~:1276, near the site-report serve) — add the serve route
- Modify: `server.js:7607` (mount the route factory)

- [ ] **Step 1: Add the page (no automated test — browser QA is a user step behind login)**

`public/site-awareness.html` — standalone page:
- `<script src="auth.js" data-require="site-business|group-business|executive">` (super_admin passes via hierarchy).
- Loads `_shell.js` (nav banner) + `_tokens.css`; a CSP nonce on inline scripts.
- Header: "Ma Vue Site — <site_name>" + a "lecture seule" badge.
- A **site `<select>`** populated from `/summary`'s `authorized_sites`; when `authorized_sites.length === 1` it is disabled (locked). Changing it reloads the active tab for that site_id.
- An **in-page tab bar** (assets.html pattern): buttons Helpdesk (active) · Inspections/Réunions/Site Actions/Activity Tracker (rendered from `tabs`, greyed with a "bientôt" chip when `false`). Hash-synced (`#helpdesk`).
- **Helpdesk pane:** fetch `/api/site-awareness/helpdesk?site=<id>` → snapshot tiles (Inbound/Closed/Backlog/SLA overdue/MI), a 6-week table (label · inbound · closed · missed %; blank when `missed_pct===null`), an active-MI list (id · P-label · status · created), a top-categories list. Empty/soft-error states.
- All read-only; no write controls anywhere.

- [ ] **Step 2: Wire the server**

At `server.js:1232`, add `'site-awareness.html'` to the `.forEach(loadHtml)` list.

Near `server.js:1276` (after the site-report serve), add:
```js
// ── Serve site-awareness.html — read-only per-site business view (session cookie, no api-key) ──
app.get('/site-awareness.html', (req, res) => {
  sendHtmlPage(res, 'site-awareness.html', false, 'Site Awareness unavailable');
});
```

At `server.js:7607` (beside the opmanager mount), add:
```js
app.use(require('./routes/siteAwareness')({ express, requireReportSession, rdb }));
```

- [ ] **Step 3: Verify the app boots + the page is served**

Run: `node --test --test-force-exit tests/site-awareness-routes.smoke.test.js` (still green).
Run (boot smoke): `node -e "process.env.REPORTS_BACKEND='sqlite'; require('./server.js'); setTimeout(()=>process.exit(0), 1500)"` — expect no throw, and a log line for the mount. (A route boot-smoke like `tests/wan-sla-routes.smoke` may be added if desired.)

- [ ] **Step 4: Commit**

```bash
git add public/site-awareness.html server.js
git commit -m "feat(site-awareness): standalone read-only page + serve route + mount"
```

---

## Task 5: Add the nav entry + regression sweep

**Files:**
- Modify: `public/_shell.js` (Insights nav — add "Site Awareness", role-gated to `site-business|group-business|executive|super_admin`; icon from `ICON_LIB` — reuse an existing key, e.g. `building` or `layout-dashboard`; add to `ICON_LIB` if missing)
- No test file (nav render verified by the existing `_shell` harness pattern if present)

- [ ] **Step 1:** Add the nav child under Insights, gated to the business roles (mirror how `scorecard-viewer` gates Executive Scorecard). If the icon key isn't in `_shell.js` `ICON_LIB`, add it (copying the SVG from `brand/icons.js`).

- [ ] **Step 2: Run the regression sweep**

Run:
```
node --test --test-force-exit tests/site-resolve.test.js tests/site-awareness-roles.test.js tests/site-awareness-routes.smoke.test.js tests/await-precedence.test.js
```
Expected: all PASS. `await-precedence` must stay green (it auto-covers any new dual-backend dispatcher; this plan adds none in reports-db, but confirms the sweep).

- [ ] **Step 3: Commit**

```bash
git add public/_shell.js
git commit -m "feat(site-awareness): Insights nav entry (business-role gated)"
```

---

## Manual QA (user step — behind login, per CLAUDE.md)

After deploy + Ctrl+F5, with a test user `roles:['site-business'], site_id=<HGO>`:
1. `/site-awareness.html` opens; header shows the site; the site selector is **locked** to that site.
2. Helpdesk tab renders real snapshot + 6-week table + active-MI list; the other four tabs show "bientôt".
3. In the console, `fetch('/api/site-awareness/helpdesk?site=<other-site-id>', {headers:{'x-report-token':token}})` returns **403**.
4. A `group-business` (or executive) user sees the site selector **unlocked** and can switch sites.
5. Confirm the response JSON carries **no** requester/technician names (DevTools → Network).

## Non-goals (SP1) — do NOT build here
The four other tabs (SP2); the Vue Groupe fleet table (SP3); editing; PII; a Finance/Assets tab; export; any pg migration.
