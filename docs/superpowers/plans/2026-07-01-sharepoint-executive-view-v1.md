# SharePoint IT Ops Executive View v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, read-only, employee-facing IT Operations "Executive View" as one page in the existing Node/Express dashboard (`public/exec-view.html`), fed by one new aggregator endpoint `GET /api/exec/summary`, surfaced on SharePoint via a Quick Link.

**Architecture:** A new server module `services/execSummary.js` assembles an aggregates-only, PII-free JSON summary by reusing existing `reports-db.js` helpers, `tracker-db.loadTracker()` + faithful tracker scorers (exported from `tracker-pptx.js`), a pure site-status deriver, and a new per-month editorial store. A public route serves the JSON (bypassing the `X-Dash-Key` gate, 60 s server cache) and the static page. A small admin card writes the editorial content (behind the normal auth gate).

**Tech Stack:** Node.js + Express, better-sqlite3 (`reports.db`), vanilla JS + `_tokens.css` for the page, `node:test` for tests, `xlsx`/pptx unaffected.

**Spec:** `docs/superpowers/specs/2026-07-01-sharepoint-executive-view-v1-design.md`

---

## File structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `services/execSummary.js` | Create | Assemble the aggregates-only summary object (KPIs, status, sites, maintenance, strategic progress, editorial). Pure-ish: takes injected data-access deps, returns the JSON. Holds `deriveSiteStatus()`. |
| `reports-db.js` | Modify | Add editorial store: `initExecEditorialSchema()`, `getExecEditorial(period)`, `setExecEditorial(period, {highlights, focus}, user)`. Add `getUpcomingChanges(days)` reader if not already present. Export them. |
| `tracker-pptx.js` | Modify | Export the faithful scorers `fleetStats`, `ps2`, `ss`, `score` (add to `module.exports`) so `execSummary` can reuse them. No logic change. |
| `server.js` | Modify | (a) Register `GET /api/exec/summary` + `GET /exec-view.html` **before** the `/api/` auth gate (public); (b) 60 s server cache; (c) `PUT /api/exec/editorial` (admin+, behind gate); (d) add `exec-view.html` to `_htmlCache` boot list; (e) public page handler. |
| `public/exec-view.html` | Create | The read-only page. Fetches `/api/exec/summary`, renders all blocks, auto-refresh 5 min, per-block "Data unavailable", "Last updated". |
| `public/reports.html` | Modify | New admin card "Exec View editorial" (highlights textarea + focus repeater) → `PUT /api/exec/editorial`. |
| `tests/exec-summary.test.js` | Create | Unit tests for `deriveSiteStatus()` + integration test of the assembler over an in-memory `reports.db` (shape, anti-PII, exception-only cap, empty-editorial omitted). |
| `tests/exec-editorial.test.js` | Create | Round-trip test for `getExecEditorial`/`setExecEditorial`. |
| `CLAUDE.md` | Modify | Short section documenting the public endpoint + editorial store + PII boundary. |

**Cross-cutting rules to honor (from CLAUDE.md):**
- `reports.db` lives at `data/reports.db`. Schema changes use idempotent `CREATE TABLE IF NOT EXISTS` / `try{ALTER}catch`.
- `reports-db.js` has a `REPORTS_BACKEND` sqlite/postgres switch. **The editorial store is v1-sqlite-only**: guard the pg path with a clear "not forked yet" fallback to sqlite handle, matching the module's existing `_h`/`pgHandle` pattern — but since prod is sqlite, implement sqlite first; add a `// TODO(pg)` note. (Keep it simple; do not build the pg fork now.)
- Public HTML served via `sendHtmlPage` + boot `_htmlCache` (see the caching section of CLAUDE.md). The page must NOT get `injectApiKey`.
- Tests run with `node --test --test-force-exit` (cron/interval timers keep the process alive).
- Never expose PII. The assembler whitelists fields.

---

## Task 1: Export faithful tracker scorers from tracker-pptx.js

**Files:**
- Modify: `tracker-pptx.js` (module.exports around line 760)
- Test: `tests/exec-summary.test.js` (created in Task 4; this task is a trivial export)

- [ ] **Step 1: Add the scorers to exports**

In `tracker-pptx.js`, change:
```js
module.exports = { generateTrackerPptx, addTrackerSlidesTo };
```
to:
```js
module.exports = { generateTrackerPptx, addTrackerSlidesTo, fleetStats, ps2, ss, score };
```

- [ ] **Step 2: Verify no behavior change**

Run: `node -e "const t=require('./tracker-pptx.js'); console.log(typeof t.fleetStats, typeof t.ps2, typeof t.ss, typeof t.score)"`
Expected: `function function function function`

- [ ] **Step 3: Commit**

```bash
git add tracker-pptx.js
git commit -m "refactor(tracker-pptx): export faithful scorers (fleetStats/ps2/ss/score) for reuse"
```

---

## Task 2: Editorial store in reports.db (schema + get/set)

**Files:**
- Modify: `reports-db.js` (schema block near the other `CREATE TABLE IF NOT EXISTS`; helpers near other readers; exports)
- Test: `tests/exec-editorial.test.js`

- [ ] **Step 1: Write the failing test**

`tests/exec-editorial.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');

test('exec editorial: set then get round-trips per period', () => {
  rdb.setExecEditorial('2026-06',
    { highlights: ['2 major projects completed', 'SLA +2%'],
      focus: [{ title: 'UPS Upgrade – Lafigué', subtitle: 'Power reliability' }] },
    'tester');
  const got = rdb.getExecEditorial('2026-06');
  assert.deepEqual(got.highlights, ['2 major projects completed', 'SLA +2%']);
  assert.equal(got.focus[0].title, 'UPS Upgrade – Lafigué');
});

test('exec editorial: missing period → empty arrays', () => {
  const got = rdb.getExecEditorial('1999-01');
  assert.deepEqual(got, { highlights: [], focus: [] });
});

test('exec editorial: caps enforced (max 4 highlights, 3 focus)', () => {
  rdb.setExecEditorial('2026-07',
    { highlights: ['a','b','c','d','e','f'],
      focus: [{title:'1'},{title:'2'},{title:'3'},{title:'4'}] }, 'tester');
  const got = rdb.getExecEditorial('2026-07');
  assert.equal(got.highlights.length, 4);
  assert.equal(got.focus.length, 3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit tests/exec-editorial.test.js`
Expected: FAIL — `rdb.setExecEditorial is not a function`.

- [ ] **Step 3: Implement schema + helpers in reports-db.js**

Add near the other `CREATE TABLE IF NOT EXISTS` statements:
```js
// Exec View editorial (SharePoint executive page) — per-month highlights/focus.
// v1: sqlite only. TODO(pg): fork under REPORTS_BACKEND=postgres when needed.
db.exec(`
  CREATE TABLE IF NOT EXISTS exec_view_editorial (
    period          TEXT PRIMARY KEY,       -- 'YYYY-MM'
    highlights_json TEXT,
    focus_json      TEXT,
    updated_at      TEXT,
    updated_by      TEXT
  );
`);
```
Add helpers (sqlite handle `db`):
```js
function getExecEditorial(period) {
  try {
    const row = db.prepare('SELECT highlights_json, focus_json FROM exec_view_editorial WHERE period=?').get(period);
    if (!row) return { highlights: [], focus: [] };
    const parse = (s, d) => { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v : d; } catch { return d; } };
    return { highlights: parse(row.highlights_json, []), focus: parse(row.focus_json, []) };
  } catch { return { highlights: [], focus: [] }; }
}

function setExecEditorial(period, { highlights, focus }, user) {
  const H = Array.isArray(highlights) ? highlights.filter(x => String(x || '').trim()).slice(0, 4) : [];
  const F = Array.isArray(focus) ? focus.filter(x => x && String(x.title || '').trim()).slice(0, 3) : [];
  db.prepare(`
    INSERT INTO exec_view_editorial (period, highlights_json, focus_json, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(period) DO UPDATE SET
      highlights_json = excluded.highlights_json,
      focus_json      = excluded.focus_json,
      updated_at      = excluded.updated_at,
      updated_by      = excluded.updated_by
  `).run(period, JSON.stringify(H), JSON.stringify(F), user || 'unknown');
  return { highlights: H, focus: F };
}
```
Add both to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit tests/exec-editorial.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add reports-db.js tests/exec-editorial.test.js
git commit -m "feat(reports-db): exec_view_editorial store (per-month highlights/focus)"
```

---

## Task 3: `deriveSiteStatus()` pure function

**Files:**
- Create: `services/execSummary.js` (start the file with just this function + exports)
- Test: `tests/exec-summary.test.js`

- [ ] **Step 1: Write the failing test**

`tests/exec-summary.test.js` (site-status section):
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deriveSiteStatus } = require('../services/execSummary');

// input: array of { site, open_incidents, has_active_mi, overdue_open }
test('deriveSiteStatus: active MI → major (highest)', () => {
  const out = deriveSiteStatus([{ site: 'LAFIGUE', open_incidents: 3, has_active_mi: true, overdue_open: 1 }]);
  assert.equal(out[0].status, 'major');
});
test('deriveSiteStatus: overdue open, no MI → degraded', () => {
  const out = deriveSiteStatus([{ site: 'SABODALA', open_incidents: 2, has_active_mi: false, overdue_open: 1 }]);
  assert.equal(out[0].status, 'degraded');
});
test('deriveSiteStatus: clean → operational and EXCLUDED (exception-only)', () => {
  const out = deriveSiteStatus([{ site: 'MANA', open_incidents: 1, has_active_mi: false, overdue_open: 0 }]);
  assert.equal(out.length, 0);
});
test('deriveSiteStatus: major before degraded, cap 4', () => {
  const rows = [
    { site: 'A', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'B', open_incidents: 1, has_active_mi: true,  overdue_open: 0 }, // major
    { site: 'C', open_incidents: 1, has_active_mi: false, overdue_open: 2 }, // degraded
    { site: 'D', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'E', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded (5th → dropped)
  ];
  const out = deriveSiteStatus(rows);
  assert.equal(out.length, 4);
  assert.equal(out[0].status, 'major');       // B first
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit tests/exec-summary.test.js`
Expected: FAIL — cannot find `../services/execSummary`.

- [ ] **Step 3: Implement `deriveSiteStatus` in `services/execSummary.js`**

```js
'use strict';

// Pure: rows = [{ site, open_incidents, has_active_mi, overdue_open }] →
// exception-only list [{ code, name, status, open_incidents }], major first,
// max 4. Only major/degraded are emitted (operational sites are omitted).
function deriveSiteStatus(rows, opts = {}) {
  const cap = opts.cap || 4;
  const out = [];
  for (const r of rows || []) {
    let status = 'operational';
    if (r.has_active_mi) status = 'major';
    else if ((r.overdue_open || 0) >= 1) status = 'degraded';
    if (status === 'operational') continue;
    out.push({ code: r.code || r.site, name: r.name || r.site, status, open_incidents: r.open_incidents || 0 });
  }
  const rank = { major: 0, degraded: 1 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || b.open_incidents - a.open_incidents);
  return out.slice(0, cap);
}

module.exports = { deriveSiteStatus };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit tests/exec-summary.test.js`
Expected: PASS (4 site-status tests).

- [ ] **Step 5: Commit**

```bash
git add services/execSummary.js tests/exec-summary.test.js
git commit -m "feat(exec-summary): deriveSiteStatus pure function (exception-only, capped)"
```

---

## Task 4: Summary assembler `buildExecSummary(deps)`

**Files:**
- Modify: `services/execSummary.js` (add the assembler + PII whitelist)
- Test: `tests/exec-summary.test.js` (add assembler section)

Design the assembler to take **injected data-access deps** so it is testable without a live DB:
```
buildExecSummary({
  period,                 // 'YYYY-MM'
  dataAsOf,               // ISO from sync_metadata
  helpdesk,              // { requests_resolved{value,delta_pct}, sla_compliance{value_pct,delta_pp}, avg_resolution_h{value,delta_h}, csat{value_pct,delta_pp}, change_success{value_pct,delta_pp} }
  spark,                 // { sla:[], csat:[] }
  siteRows,              // rows for deriveSiteStatus
  activeMajorIncidents,  // number
  upcomingMaintenance,   // [{ date, title, window, impact, scope }] (already sanitized upstream)
  strategic,             // { overall_pct, pillars:[{name,pct}] }
  editorial,             // { highlights:[], focus:[] }
})  → the summary JSON (whitelisted)
```

- [ ] **Step 1: Write the failing test** (append to `tests/exec-summary.test.js`)

```js
const { buildExecSummary } = require('../services/execSummary');

const DEPS = {
  period: '2026-06',
  dataAsOf: '2026-06-25T08:00:00Z',
  helpdesk: {
    requests_resolved: { value: 1236, delta_pct: 8 },
    sla_compliance: { value_pct: 91, delta_pp: 2 },
    avg_resolution_h: { value: 14, delta_h: -3 },
    csat: { value_pct: 88, delta_pp: 4 },
    change_success: { value_pct: 96, delta_pp: 1 },
  },
  spark: { sla: [88,89,91], csat: [84,86,88] },
  siteRows: [
    { site: 'SABODALA', code: 'SGO', name: 'Sabodala', open_incidents: 2, has_active_mi: false, overdue_open: 1 },
    { site: 'MANA', code: 'MGO', name: 'Mana', open_incidents: 1, has_active_mi: false, overdue_open: 0 },
  ],
  activeMajorIncidents: 0,
  upcomingMaintenance: [{ date: '2026-06-26', title: 'SAP Upgrade', window: '22:00–04:00', impact: 'High', scope: 'ITY, Houndé' }],
  strategic: { overall_pct: 72, pillars: [{ name: 'Network & Infrastructure', pct: 82 }] },
  editorial: { highlights: ['2 major projects completed'], focus: [{ title: 'UPS Upgrade – Lafigué', subtitle: 'Power reliability' }] },
};

test('buildExecSummary: status level operational when no MI and no degraded... wait, SGO is degraded', () => {
  const s = buildExecSummary(DEPS);
  assert.equal(s.status.level, 'degraded');            // SGO degraded → overall degraded
  assert.equal(s.status.active_major_incidents, 0);
});
test('buildExecSummary: KPIs + strategic passthrough', () => {
  const s = buildExecSummary(DEPS);
  assert.equal(s.kpis.sla_compliance.value_pct, 91);
  assert.equal(s.strategic_progress.overall_pct, 72);
  assert.equal(s.sites_attention.length, 1);           // only SGO (MANA operational, omitted)
  assert.equal(s.all_sites_ok, false);
});
test('buildExecSummary: empty editorial → blocks omitted (null)', () => {
  const s = buildExecSummary({ ...DEPS, editorial: { highlights: [], focus: [] } });
  assert.equal(s.highlights, null);
  assert.equal(s.focus_areas, null);
});
test('buildExecSummary: ANTI-PII — no forbidden keys anywhere in the JSON', () => {
  const s = buildExecSummary(DEPS);
  const blob = JSON.stringify(s).toLowerCase();
  for (const bad of ['subject', 'requester', 'technician', 'request_id', 'udf', 'verbatim', 'email']) {
    assert.ok(!blob.includes(bad), `must not contain "${bad}"`);
  }
});
test('buildExecSummary: all_sites_ok true when no exceptions', () => {
  const s = buildExecSummary({ ...DEPS, siteRows: [{ site:'MANA', open_incidents:1, has_active_mi:false, overdue_open:0 }] });
  assert.equal(s.sites_attention.length, 0);
  assert.equal(s.all_sites_ok, true);
  assert.equal(s.status.level, 'operational');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit tests/exec-summary.test.js`
Expected: FAIL — `buildExecSummary is not a function`.

- [ ] **Step 3: Implement `buildExecSummary`**

```js
function buildExecSummary(d) {
  const sites = deriveSiteStatus(d.siteRows || []);
  const level = d.activeMajorIncidents > 0 || sites.some(s => s.status === 'major')
    ? 'major'
    : (sites.some(s => s.status === 'degraded') ? 'degraded' : 'operational');
  const hl = (d.editorial && d.editorial.highlights) || [];
  const fc = (d.editorial && d.editorial.focus) || [];
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] != null) r[k] = o[k]; return r; };
  return {
    data_as_of: d.dataAsOf || null,
    period: d.period,
    status: { level, active_major_incidents: d.activeMajorIncidents || 0 },
    kpis: {
      requests_resolved: pick(d.helpdesk.requests_resolved, ['value','delta_pct']),
      sla_compliance:    pick(d.helpdesk.sla_compliance,    ['value_pct','delta_pp']),
      avg_resolution_h:  pick(d.helpdesk.avg_resolution_h,  ['value','delta_h']),
      csat:              pick(d.helpdesk.csat,              ['value_pct','delta_pp']),
      change_success:    pick(d.helpdesk.change_success,    ['value_pct','delta_pp']),
      spark: { sla: (d.spark && d.spark.sla) || [], csat: (d.spark && d.spark.csat) || [] },
    },
    sites_attention: sites,
    all_sites_ok: sites.length === 0,
    planned_maintenance: (d.upcomingMaintenance || []).slice(0, 3).map(m =>
      pick(m, ['date','title','window','impact','scope'])),
    strategic_progress: d.strategic || { overall_pct: 0, pillars: [] },
    highlights: hl.length ? hl : null,
    focus_areas: fc.length ? fc : null,
  };
}
```
Update exports: `module.exports = { deriveSiteStatus, buildExecSummary };`

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit tests/exec-summary.test.js`
Expected: PASS (all site-status + assembler tests, incl. anti-PII).

- [ ] **Step 5: Commit**

```bash
git add services/execSummary.js tests/exec-summary.test.js
git commit -m "feat(exec-summary): buildExecSummary assembler (whitelisted, anti-PII, empty-omit)"
```

---

## Task 5: Data-access adapter (bind the assembler to real DB helpers)

**Files:**
- Modify: `services/execSummary.js` (add `loadExecSummary()` that gathers real data + calls `buildExecSummary`)
- Modify: `reports-db.js` (add `getUpcomingChanges(days)` if absent) + `tracker-pptx.js` scorers already exported (Task 1)
- Test: manual smoke (documented) — DB-bound gathering is thin glue; the logic is already unit-tested in Task 4.

- [ ] **Step 1: Confirm the real readers to reuse**

Grep to confirm exact names before wiring (do not guess):
```bash
grep -nE "getCalendarMonthlyHelpdesk|getMonthlyHelpdeskHistory|getSlaTrendDB|getMajorIncidentsHistory|getActiveMajorIncidentsForSite|getChangeMetrics|getOpenChangesForSite|getLastSyncAt|getSurvey" reports-db.js | head -40
```
Expected: names exist (per CLAUDE.md they do). Note the current-month + default-group args each needs.

- [ ] **Step 2: Add `getUpcomingChanges(days)` to reports-db.js if not present**

Reader for approved changes with `scheduled_start` within the next `days`, returning only `{ date, title, window, impact, scope }` (title = change subject — operational, not personal; still, select ONLY those 5 fields). If an equivalent already exists (e.g. via change history), reuse it and map fields. Add a tiny round-trip check in `tests/exec-editorial.test.js` or a new `tests/exec-changes.test.js` (in-memory rows → returns sanitized shape).

- [ ] **Step 3: Implement `loadExecSummary()` glue in `services/execSummary.js`**

```js
function loadExecSummary(deps) {
  // deps injects the modules so this stays testable: { rdb, trackerDb, trackerScore, now }
  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const dataAsOf = deps.rdb.getLastSyncAt('requests');
  // helpdesk KPIs (current vs prev month) — reuse the SAME helpers build() uses:
  const helpdesk = mapHelpdeskKpis(deps.rdb, now);      // small mapper, see Step 4
  const spark = mapSpark(deps.rdb, now);
  const siteRows = mapSiteRows(deps.rdb, now);
  const activeMajorIncidents = deps.rdb.getActiveMajorIncidentCount ? deps.rdb.getActiveMajorIncidentCount() : mapActiveMi(deps.rdb);
  const upcomingMaintenance = deps.rdb.getUpcomingChanges(7);
  const strategic = mapStrategic(deps.trackerDb, deps.trackerScore, now);   // loadTracker + fleetStats/ps2
  const editorial = deps.rdb.getExecEditorial(period);
  return buildExecSummary({ period, dataAsOf, helpdesk, spark, siteRows, activeMajorIncidents, upcomingMaintenance, strategic, editorial });
}
```
Implement the small `mapHelpdeskKpis/mapSpark/mapSiteRows/mapStrategic` helpers in the same file, each calling the confirmed reporters from Step 1 and shaping to the assembler's input. `mapStrategic` = `trackerDb.loadTracker()` → `trackerScore.fleetStats(...)` for overall + `trackerScore.ps2(...)` per pillar → `{ overall_pct, pillars:[{name,pct}] }`.

- [ ] **Step 3b: Add a mapper integration test (real field-shaping risk)**

`tests/exec-summary-load.test.js` — inject **stub** deps (no real DB) so the
mappers are exercised directly. The stub `rdb`/`trackerDb`/`trackerScore` return
known raw shapes (e.g. `getCalendarMonthlyHelpdesk` → `{ inbound, closed,
sla_res_pct, avg_tta_h, … }`, tracker `loadTracker` → a small `D`), and the test
asserts `loadExecSummary` remaps them correctly into the assembler's expected
keys (`kpis.csat.value_pct`, `kpis.avg_resolution_h.value`, MoM deltas from
current-vs-prev month, `strategic_progress.overall_pct`). This is where the real
work is — the mappers must translate the readers' native keys, and the deltas
must be derived (current − previous). Red → implement mappers → green.

- [ ] **Step 4: Smoke against the local (stub) DB**

Run:
```bash
node -e "const e=require('./services/execSummary'); const rdb=require('./reports-db'); const td=require('./tracker-db'); const ts=require('./tracker-pptx'); console.log(JSON.stringify(e.loadExecSummary({rdb, trackerDb:td, trackerScore:ts}), null, 2))"
```
Expected: a JSON summary prints (values may be zero on the dev stub DB — that's fine; shape must be correct and contain **no PII keys**).

- [ ] **Step 5: Commit**

```bash
git add services/execSummary.js reports-db.js tests/
git commit -m "feat(exec-summary): loadExecSummary glue over reports-db + tracker scorers"
```

---

## Task 6: Public endpoint + page route + admin editorial route (server.js)

**Files:**
- Modify: `server.js` (routes + `_htmlCache` list)
- Test: `tests/exec-routes.smoke.test.js` (mounts the app in-process; see the existing `tests/server-routes-smoke.test.js` for the pattern — dummy `ZOHO_*`/`DASH_*` env, `X-Dash-Key`, login for the admin route)

- [ ] **Step 1: Write the failing smoke test**

`tests/exec-routes.smoke.test.js` — asserts:
- `GET /api/exec/summary` returns 200 **without** `X-Dash-Key` (public), JSON has `status`/`kpis`, and JSON string contains **no** `subject`/`requester`/`technician`.
- `PUT /api/exec/editorial?period=2026-06` **without** auth → 401/403; **with** admin `x-report-token` → 200 and persists (GET summary reflects it when period = current month).
Follow the harness in `tests/server-routes-smoke.test.js` (set dummy env before `require`, seed a couple `request_records` rows so no Zoho fallback path triggers).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test --test-force-exit tests/exec-routes.smoke.test.js`
Expected: FAIL — routes not found (404) / summary undefined.

- [ ] **Step 3: Implement routes in server.js**

- Register the PUBLIC summary route + page **before** `app.use('/api/', <gate>)` (grep for that line; place the two public routes above it), OR add both paths to the gate's allowlist. Public summary handler:
```js
let _execCache = { at: 0, body: null };
app.get('/api/exec/summary', async (req, res) => {
  try {
    if (Date.now() - _execCache.at < 60_000 && _execCache.body) return res.json(_execCache.body);
    const body = execSummary.loadExecSummary({ rdb, trackerDb, trackerScore: trackerPptx });
    _execCache = { at: Date.now(), body };
    res.json(body);
  } catch (e) { res.status(200).json({ error: 'unavailable' }); }  // page degrades gracefully
});
```
> Contract note: this whole-response fallback (`{ error: 'unavailable' }`) is the
> coarse safety net. **Task 7's page MUST treat a body containing `error` (or a
> failed fetch) as the full-page "Status temporarily unavailable" fallback**, and
> handle per-block `null` fields as "Data unavailable" — the two degradation
> levels are complementary.
- Serve the page publicly (no `injectApiKey`, no session): add `'exec-view.html'` to the `_htmlCache` boot list, add a route `app.get('/exec-view.html', (req,res)=>sendHtmlPage(res,'exec-view.html', false, 'Executive view unavailable'))` placed so it is NOT behind an auth wall.
- Admin write route (behind the gate + `requireReportSession` + `requireAdmin`):
```js
app.put('/api/exec/editorial', requireReportSession, requireAdmin, express.json(), (req, res) => {
  const period = String(req.query.period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period YYYY-MM required' });
  const saved = rdb.setExecEditorial(period, { highlights: req.body.highlights, focus: req.body.focus },
    (req.reportUser && req.reportUser.username) || 'unknown');
  res.json(saved);
});
```
Wire the `require`s at the top: `const execSummary = require('./services/execSummary'); const trackerDb = require('./tracker-db'); const trackerPptx = require('./tracker-pptx');` (reuse existing requires if already present).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test --test-force-exit tests/exec-routes.smoke.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/exec-routes.smoke.test.js
git commit -m "feat(server): public GET /api/exec/summary + exec-view page + admin PUT /api/exec/editorial"
```

---

## Task 7: The page `public/exec-view.html`

**Files:**
- Create: `public/exec-view.html`
- Verify: browser preview (static server) — this is browser-observable, follow the verification workflow.

- [ ] **Step 1: Build the page**

- Reuse `_tokens.css` + brand header (logo + title "IT Operations – Executive View" + "Last updated"). Single page, **no multi-tab nav** (v1).
- Vanilla JS: `fetch('/api/exec/summary')` on load + `setInterval(..., 300000)`. Render blocks in the variant-3 order: quick actions (4 deep links to SDP — use placeholder URLs `TODO_SDP_*` constants at the top, to be confirmed by the user), status band, 5 KPI cards (+ tiny inline sparkline from `spark`), Sites requiring attention (or "All monitored sites operating normally"), Planned maintenance (max 3), Strategic progress (overall ring + 4 pillar bars), Highlights (omit block if null), Focus areas (omit if null).
- Per-block "Data unavailable" when a field is null; "data may be delayed" note if `data_as_of` > 3 h old; friendly full-page fallback if fetch fails.

- [ ] **Step 2: Verify in a browser preview**

Start a static server for `public/`, seed a fake summary via `preview_eval` (stub `fetch` to return a sample payload) OR point at a locally-running dashboard. Confirm: layout renders on desktop + at 1366×768, blocks omit when null, no console errors, sparkline draws. Screenshot for the user.

- [ ] **Step 3: Commit**

```bash
git add public/exec-view.html
git commit -m "feat(exec-view): read-only employee Executive View page (variant-3 layout)"
```

---

## Task 8: Admin editorial card in reports.html

**Files:**
- Modify: `public/reports.html` (new admin card following the existing card pattern from the recent left-rail work)
- Verify: browser preview (the admin left-rail — reuse the seeded-super_admin preview trick).

- [ ] **Step 1: Add the card**

A new `.admin-panel` (rail item "Exec View") with: month picker (defaults to current), a highlights `<textarea>` (one per line, max 4), a small focus repeater (title + subtitle, max 3), Save → `PUT /api/exec/editorial?period=...`. Load current values via a GET (add `GET /api/exec/editorial?period=...` admin reader in Task 6 if the card needs pre-fill, or reuse the summary for current month). Follow the left-rail panel wiring added in `feat/admin-left-rail`.

- [ ] **Step 2: Verify in preview**

Seed super_admin session, open `#admin/exec-view`, confirm the card renders + Save posts (network 200). Screenshot.

- [ ] **Step 3: Commit**

```bash
git add public/reports.html
git commit -m "feat(admin): Exec View editorial card (highlights/focus) → PUT /api/exec/editorial"
```

---

## Task 9: Docs + full-suite regression + finish branch

**Files:**
- Modify: `CLAUDE.md` (short "SharePoint Executive View (v1)" section: public endpoint, PII boundary, editorial store, deploy note, SharePoint Quick Link)

- [ ] **Step 1: Update CLAUDE.md** with the module summary + the deploy note (server-side files → `_deploy.cmd` + `pm2 stop`→`timeout`→`pm2 start` because `server.js` + `_htmlCache` change) + the SharePoint Quick Link target URL to `https://itops-dashboard.edv-ops.com/exec-view.html`.

- [ ] **Step 2: Run the full relevant test set**

```bash
node --test --test-force-exit tests/exec-summary.test.js tests/exec-editorial.test.js tests/exec-routes.smoke.test.js
node --test --test-force-exit tests/pptx-monthly-golden.test.js   # tracker-pptx export change must not disturb decks
```
Expected: all PASS (golden unchanged — we only added exports).

- [ ] **Step 3: Commit + finish branch**

```bash
git add CLAUDE.md
git commit -m "docs(claude): SharePoint Executive View v1 (public endpoint + editorial store)"
```
Then use **superpowers:finishing-a-development-branch** to merge `feat/sharepoint-exec-view-v1` → `main` (no-ff), and hand the deploy steps to the user (they run `_deploy.cmd` + pm2 restart; then add the SharePoint Quick Link).

---

## Open items for the user (non-blocking, surface during Task 7/9)

- **Quick-action deep-link URLs** to ServiceDesk Plus (Report issue / Request service / Planned maintenance / Major incident) — confirm the exact SDP URLs; placeholders used until then.
- **Page access at IIS** — optionally restrict `/exec-view.html` + `/api/exec/summary` to the internal network at the IIS layer (non-blocking).
- **SharePoint side** — the user adds a Quick Link tile pointing at the page URL (zero dev on our side).
