# F1 — Meridian ⇄ SDP Integration (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire SDP and the boss's Meridian PMO together so (1) SDP's sites + IT staff appear as Meridian resources, (2) SDP's unified open actions are consumable by Meridian, (3) a PMO can attach an SDP action to a project activity, and (4) SDP shows a "▸ Projet: X" badge back on the Site Actions hub — all additive, all best-effort, nothing blocks either app if the other is down.

**Architecture:** Two HTTP boundaries, no shared database. **SDP → Meridian** (outbound): a nightly/on-demand resource sync `POST`s a sites+people payload to a Meridian **ingest API**; a thin read-back client `GET`s the project links. **Meridian → SDP** (inbound): Meridian's server reads SDP's open-actions via a key-guarded read API. Meridian owns the link storage (a new `pmo.external_action_link` table under its RLS), the ingest endpoint, the link endpoints, and the picker UI. SDP owns the sync job, the read API, the read-back client, and the hub badge. The two sides agree on three JSON contracts (documented in `docs/MERIDIAN_INTEGRATION_CONTRACT.md`).

**Tech Stack:** SDP side — Node/Express, `node --test`, `axios` (outbound), dual sqlite/postgres readers already in place, `services/reportConfig.js` for settings, the `routes/fourmypeople.js` DI-router + `services/fmpClient.js` as the exact inbound/outbound blueprints. Meridian side — Fastify 5, raw `pg` + numbered SQL migrations under RLS `FORCE`, Vitest.

---

## Decisions locked (read before starting)

| Decision | Choice | Why |
|---|---|---|
| **Sync write mechanism** | **Meridian ingest API** (`POST /v1/resources/sync`). SDP never touches Meridian's DB. | Meridian has RLS `FORCE` on every table + tenant scoping via an in-transaction `set_context` GUC; a direct write would need owner creds to the boss's DB + replication of `app.set_context`. Keeping the write behind Meridian's API keeps all tenant/RLS logic where it belongs and shares no DB creds. |
| **Person source** | The dashboard **user directory** (`inspection-db.js listPeople({})` → `{id, full_name, role, site_name, site_code}`). | It is the only STABLE, id-bearing roster of assignable IT staff. Ticket "technicians" are just names on `request_records` with **no stable id** — they cannot be a `pmo.person` primary key. (Limitation: staff who never became dashboard users won't sync. Acceptable for MVP; revisit in Tranche 2.) |
| **Site id namespace** | The **meetings/inspection module code** (HGO, MGO, SMI, SGO, SML, KGO…), from `listSiteModuleCodes('meetings')`. | `pmo.site.id` has a CHECK `^[A-Z0-9_-]{2,16}$`; the module codes satisfy it, are the canonical cross-module code, and match what the Site Actions hub already resolves (`getSiteIdByModuleCode('meetings', code)`). `listPeople().site_code` is in the same namespace, so people FK cleanly to synced sites. |
| **Stable action id** | `"{source}:{action_id ?? uid}"` (e.g. `meetings:1234`, `report:9f3a…`). | `buildSiteActions` items carry `action_id` for meetings/inspection and `uid` for report rows (the other is null). One id, unique across the three sources, that Meridian caches in the link row. |
| **Auth: two keys** | **Inbound key** (`meridian_in_key`): SDP requires it on `GET /api/actions/open` (Meridian presents it). **Outbound key** (`meridian_out_key`): SDP presents it to Meridian on the sync POST + link GET (Meridian validates). | Never share SDP's global `X-Dash-Key` with Meridian. Mirrors the `routes/fourmypeople.js` inbound pattern + `services/fmpClient.js` outbound pattern already in the repo. |
| **Failure posture** | Every cross-system call is best-effort, config-gated, and degrades: sync logs + continues per-entity; the hub badge renders nothing on any Meridian error; the read API is inert until its key is configured. | A Meridian outage must never touch SDP data or block the hub. |

## Ownership split

- **Part A (SDP — this repo, buildable now, TDD):** Tasks A1–A7. No Meridian code required to build/test A (the outbound calls are tested against stubs; they degrade gracefully in prod until Part B ships).
- **Part B (Meridian — the boss's repo `Meridian/`, coordinate first):** Tasks B1–B4. Specified precisely (exact migration SQL, route skeletons, Vitest guidance) so the boss can implement them or approve us doing so in a `Meridian/` branch for his review. **Do not push changes into `Meridian/` without his sign-off.**

**Build order:** A1 → A2 → A3 → A4 (SDP read API + config, independently shippable) → A5 → A6 (read-back client + badge, degrade until B ships) → A7 (sync, needs B2's contract) → docs. Part B can proceed in parallel once the contract doc (A7's `docs/MERIDIAN_INTEGRATION_CONTRACT.md`, write it first if convenient) is agreed.

---

## The three JSON contracts (the SDP↔Meridian interface)

These are the whole integration surface. Write them into `docs/MERIDIAN_INTEGRATION_CONTRACT.md` (Task A7) and hand to the boss.

**C1 — Resource sync (SDP → Meridian):** `POST {base}/v1/resources/sync` — header `X-API-Key: <meridian_out_key>`
```json
{
  "sites":  [ { "id": "HGO", "name": "Houndé", "country": null, "region": null } ],
  "people": [ { "id": "SDP-U42", "name": "A. Samandoulgou", "role": "coordinator", "site_id": "HGO", "active": true } ]
}
```
Meridian derives the tenant from the API key, upserts `pmo.site` then `pmo.person` (sites first — person FKs site) under a superadmin context, `ON CONFLICT (tenant_id, id) DO UPDATE`. Response `{ "sites": {upserted:N}, "people": {upserted:M, skipped_unknown_site:K} }`.

**C2 — Open actions (Meridian → SDP):** `GET {sdp}/api/actions/open?site=HGO` — header `X-API-Key: <meridian_in_key>`
```json
{ "site": "HGO", "as_of": "2026-08-11",
  "actions": [ { "id": "meetings:1234", "source": "meetings", "title": "…", "owner": "…",
                 "status": "open", "due_date": "2026-08-20", "age_days": 12, "overdue": true,
                 "origin_label": "HGO_Maintenance_PV_2026-05" } ] }
```
Re-serves `buildSiteActions` (flattened across the 3 groups), PII-safe (owner name only; no requester/technician names).

**C3 — Link read-back (SDP → Meridian):** `GET {base}/v1/links?site=HGO` — header `X-API-Key: <meridian_out_key>`
```json
{ "links": [ { "ext_source": "meetings", "ext_id": "meetings:1234", "activity_id": "AC-7",
               "project_id": "PR-3", "project_name": "WAN upgrade Houndé", "title_cache": "…" } ] }
```
SDP keys these by `ext_id` and renders the badge on the matching hub row.

---

# PART A — SDP side (this repo)

## Task A1: Config keys + admin card for Meridian

**Files:**
- Modify: `services/reportConfig.js:5-54` (DEFAULTS) — add 3 keys
- Modify: `public/reports.html` — a small "🔗 Meridian (PMO)" admin card (mirror the `#ap-sso` card + wiring you built in F2a)
- Modify: `server.js:5107-5124` — redact `meridian_out_key`+`meridian_in_key` on config GET; keep them blank-kept + super_admin-gated on PUT (extend the existing SSO_KEYS-style guard)
- Test: `tests/report-config-meridian.test.js`

- [ ] **Step 1: Write the failing test**
```js
'use strict';
const os=require('os'),fs=require('fs'),path=require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'rcfg-mer-'));
process.env.REPORTS_BACKEND='sqlite';
process.env.DASH_USER=process.env.DASH_USER||'rcfg-admin';
process.env.DASH_PASS=process.env.DASH_PASS||'rcfg-pass-0000';
const {test}=require('node:test'); const assert=require('node:assert');
const Database=require('better-sqlite3'); const cfg=require('../services/reportConfig');
const KEYS=['meridian_base_url','meridian_out_key','meridian_in_key'];
test('Meridian keys in DEFAULTS + KEYS', () => {
  for (const k of KEYS){ assert.ok(k in cfg.DEFAULTS, `${k} missing DEFAULTS`); assert.ok(cfg.KEYS.includes(k)); }
});
test('outbound/inbound keys blank-kept like a secret', () => {
  const db=new Database(':memory:');
  cfg.setConfig(db,{meridian_out_key:'OUT-1',meridian_in_key:'IN-1',meridian_base_url:'https://m'},'u');
  cfg.setConfig(db,{meridian_out_key:'',meridian_in_key:'',meridian_base_url:'https://m2'},'u'); // blank=keep
  const c=cfg.getConfig(db);
  assert.equal(c.meridian_out_key,'OUT-1'); assert.equal(c.meridian_in_key,'IN-1');
  assert.equal(c.meridian_base_url,'https://m2');
});
```

- [ ] **Step 2: Run it — expect FAIL** (`meridian_* missing DEFAULTS`)
Run: `node --test --test-force-exit tests/report-config-meridian.test.js`

- [ ] **Step 3: Add the keys.** In `services/reportConfig.js` DEFAULTS, after the SSO block:
```js
  // ── F1: Meridian PMO federation. base_url + two API keys (out = SDP→Meridian,
  //    in = SDP requires it inbound). The two keys are secrets: redacted on GET,
  //    blank-kept on save (extend the smtp_pass/entra_client_secret filter).
  meridian_base_url: '', meridian_out_key: '', meridian_in_key: '',
```
Extend the blank-keep filter (currently `k === 'smtp_pass' || k === 'entra_client_secret'`) to also cover `'meridian_out_key'` and `'meridian_in_key'`.

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: server.js GET redaction + PUT guard.** In the config GET (`~5107`), after the `entra_client_secret` blanking add `if (c && c.meridian_out_key) c.meridian_out_key=''; if (c && c.meridian_in_key) c.meridian_in_key='';`. In the config PUT SSO_KEYS guard (`~5119`), either add the two keys to a `MERIDIAN_KEYS` array under the same super_admin gate, or extend the existing gated array — a secret must be super_admin-only.

- [ ] **Step 6: Admin card.** Copy the `#ap-sso` card pattern from F2a: card markup (base_url text + out_key/in_key password fields, blank-keep hint), `sso:'ap-sso'`-style entry in `_ADMIN_PANEL_IDS` (`meridian:'ap-meridian'`), the super-gate line, the rail role-gate, the rail button, and `loadMeridianConfig`/`saveMeridianConfig` (mirror `loadSsoConfig`/`saveSsoConfig`, password fields blanked on load, omitted-when-blank on save).

- [ ] **Step 7: Commit** — `git add services/reportConfig.js public/reports.html server.js tests/report-config-meridian.test.js && git commit`.

## Task A2: Stable action id + flat open-actions serializer (pure)

**Files:**
- Create: `services/meridianActions.js` (pure — no DB, no `Date.now`)
- Test: `tests/meridian-actions.test.js`

- [ ] **Step 1: Failing test** — feed a `buildSiteActions` result, assert the flat shape + ids.
```js
const {test}=require('node:test'); const assert=require('node:assert');
const {flattenOpenActions}=require('../services/meridianActions');
const sa={ groups:{
  meetings:{items:[{source:'meetings',action_id:1234,uid:undefined,title:'Fix radio',owner:'Koffi',status:'open',due_date:'2026-08-20',age_days:12,overdue:true,origin_label:'HGO_Maint_PV_2026-05'}],count:1,oldest_days:12},
  inspection:{items:[],count:0,oldest_days:null},
  report:{items:[{source:'report',action_id:null,uid:'9f3a',title:'Patch server',owner:'Ada',status:'in_progress',due_date:null,age_days:5,overdue:false,origin_label:'W33'}],count:1,oldest_days:5},
}, totals:{open:2} };
test('flatten → C2 shape with stable ids', () => {
  const out=flattenOpenActions('HGO', sa, '2026-08-11');
  assert.equal(out.site,'HGO'); assert.equal(out.as_of,'2026-08-11'); assert.equal(out.actions.length,2);
  const m=out.actions.find(a=>a.source==='meetings'); assert.equal(m.id,'meetings:1234');
  const r=out.actions.find(a=>a.source==='report'); assert.equal(r.id,'report:9f3a');
  // PII-safe: only whitelisted keys
  assert.deepEqual(Object.keys(m).sort(), ['age_days','due_date','id','origin_label','overdue','owner','source','status','title'].sort());
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement** `services/meridianActions.js`:
```js
'use strict';
// Pure: flatten a buildSiteActions() result into the C2 open-actions API shape.
// Stable id = "<source>:<action_id ?? uid>". Whitelist keys (PII-safe: owner name only).
function actionId(it){ const key = (it.action_id != null) ? it.action_id : it.uid; return `${it.source}:${key}`; }
function flattenOpenActions(site, sa, asOf){
  const groups = (sa && sa.groups) || {};
  const actions = [];
  for (const g of ['meetings','inspection','report']){
    for (const it of ((groups[g] && groups[g].items) || [])){
      actions.push({
        id: actionId(it), source: it.source, title: it.title || '', owner: it.owner || null,
        status: it.status || null, due_date: it.due_date || null,
        age_days: (it.age_days == null ? null : it.age_days), overdue: !!it.overdue,
        origin_label: it.origin_label || null,
      });
    }
  }
  return { site, as_of: asOf, actions };
}
module.exports = { flattenOpenActions, actionId };
```

- [ ] **Step 4: Run — expect PASS.**  **Step 5: Commit.**

## Task A3: Inbound read API — `GET /api/actions/open` (DI-router, key-guarded)

**Files:**
- Create: `routes/meridian.js` (factory `module.exports = (deps) => router`, mirrors `routes/fourmypeople.js`)
- Modify: `server.js:~7429` — mount it env/config-gated (only when `meridian_in_key` is set), **before** the `/api/reports/:id` route is irrelevant (different prefix), but register alongside the other DI routers
- Test: `tests/meridian-route.smoke.test.js`

- [ ] **Step 1: Failing smoke test** (mirror `tests/site-actions-routes.smoke.test.js`): boot the app in-process, seed a site + one meetings action, then:
  - no `X-API-Key` → **401**
  - wrong key → **401**
  - correct key + `?site=HGO` → **200**, body `{site:'HGO', actions:[…]}`, at least one action, and **no** `requester`/`technician` key on any action.
  - unknown site → **200** with `actions:[]` (never 500).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `routes/meridian.js`.** The factory receives `{ express, buildSiteActions, meetingsDb, inspectionDb, rdb, getConfig, flattenOpenActions, resolveSite }`. Handler for `GET /api/actions/open`:
  1. Read `X-API-Key`; compare to `getConfig().meridian_in_key`; missing/mismatch → `401`.
  2. `const code = String(req.query.site||'').trim()`; resolve to `site_id` via `rdb.getSiteIdByModuleCode('meetings', code)` (use `.site_id`, **not** `.id` — documented pitfall). Unknown → return `{site:code, as_of, actions:[]}`.
  3. Compose exactly like the hub route (`server.js:5226`): `meetingsDb.listActions({site})`, `inspectionDb.listActions({site})`, `rdb.getSiteOpenReportActions(site_id)`, then `buildSiteActions({asOf, meetings, inspection, report})`.
  4. `return res.json(flattenOpenActions(code, sa, asOf))`.
  Wrap in try/catch → `res.status(500)` only on a real internal error (never on unknown site).

- [ ] **Step 4: Mount it in `server.js`** next to the fourmypeople router:
```js
// Meridian inbound read API — only mounted when an inbound key is configured.
if ((await rdb_getConfig()).meridian_in_key) {
  app.use(require('./routes/meridian')({ express, buildSiteActions, meetingsDb, inspectionDb, rdb, getConfig: /* sync/async accessor */, flattenOpenActions: require('./services/meridianActions').flattenOpenActions }));
}
```
(Match the actual config accessor already used in that region; the fourmypeople mount at `:7431` shows the idiom.)

- [ ] **Step 5: Run — expect PASS.**  **Step 6: Commit.**

## Task A4: Read-back client `services/meridianLinks.js` (pure, injectable)

**Files:**
- Create: `services/meridianLinks.js` (blueprint: `services/fmpClient.js`)
- Test: `tests/meridian-links.test.js`

- [ ] **Step 1: Failing test** (mirror `tests/fmp-client.test.js`): inject a mock `httpGet`, assert URL + `X-API-Key` header + envelope-unwrap + graceful degrade.
```js
const {test}=require('node:test'); const assert=require('node:assert');
const { getLinksForSite } = require('../services/meridianLinks');
test('calls {base}/v1/links?site= with X-API-Key, returns map keyed by ext_id', async () => {
  let seen;
  const httpGet=async(url,opts)=>{ seen={url,opts}; return { data:{ links:[
    {ext_source:'meetings',ext_id:'meetings:1234',activity_id:'AC-7',project_id:'PR-3',project_name:'WAN',title_cache:'x'} ]}}; };
  const cfg={ meridian_base_url:'https://m.example', meridian_out_key:'OUT' };
  const map=await getLinksForSite('HGO',{httpGet,config:cfg});
  assert.match(seen.url,/\/v1\/links\?site=HGO$/); assert.equal(seen.opts.headers['X-API-Key'],'OUT');
  assert.equal(map['meetings:1234'].project_name,'WAN'); assert.equal(map['meetings:1234'].project_id,'PR-3');
});
test('degrades to {} on error, and when unconfigured', async () => {
  const boom=async()=>{ throw new Error('down'); };
  assert.deepEqual(await getLinksForSite('HGO',{httpGet:boom,config:{meridian_base_url:'https://m',meridian_out_key:'k'}}),{});
  assert.deepEqual(await getLinksForSite('HGO',{httpGet:boom,config:{}}),{}); // no base_url → inert
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `services/meridianLinks.js`:**
```js
'use strict';
// Thin, best-effort read-back of Meridian project links for a site. Config-gated,
// injectable httpGet (default axios), NEVER throws — degrades to {} so the hub is
// never blocked by a Meridian outage. Returns a map keyed by ext_id → link.
const DEFAULT_TIMEOUT = 4000;
function _axiosGet(){ return require('axios').get; }
async function getLinksForSite(site, { httpGet, config, timeout = DEFAULT_TIMEOUT } = {}){
  const base = config && config.meridian_base_url, key = config && config.meridian_out_key;
  if (!base || !key || !site) return {};
  const get = httpGet || _axiosGet();
  try {
    const url = `${String(base).replace(/\/$/,'')}/v1/links?site=${encodeURIComponent(site)}`;
    const r = await get(url, { headers: { 'X-API-Key': key }, timeout });
    const links = (r && r.data && r.data.links) || [];
    const map = {};
    for (const l of links) if (l && l.ext_id) map[l.ext_id] = l;
    return map;
  } catch (e) { console.warn('[meridian-links] read-back failed (best-effort):', e.message); return {}; }
}
module.exports = { getLinksForSite };
```

- [ ] **Step 4: Run — expect PASS.**  **Step 5: Commit.**

## Task A5: Hub badge — enrich the site-actions route + render on the page

**Files:**
- Modify: `server.js:5226` (the `GET /api/reports/site-actions` handler) — after building `sa`, best-effort fold in Meridian links and attach `it.project` per matching row
- Modify: `public/site-actions.html:209` (`rowHtml`, the title/subtitle cell) — render `▸ Projet: X` badge + deep-link when `it.project` present
- Test: extend `tests/site-actions-routes.smoke.test.js` (or a new smoke) — with meridianLinks stubbed, the enriched route attaches `project` to the matching action and leaves others untouched; with the stub throwing, the route still returns 200 and every `project` is null.

- [ ] **Step 1: Failing test** — inject/stub the links map so `meetings:1234` → `{project_id:'PR-3',project_name:'WAN',activity_id:'AC-7'}`; assert the response's matching item has `project.name==='WAN'` and a `project.url`, and a non-matching item has `project == null`. Second case: links source throws → 200, all `project == null`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Enrich the route.** After `const sa = buildSiteActions(...)` in the site-actions handler:
```js
// Best-effort: fold Meridian project links onto matching rows (never blocks the hub).
let links = {};
try {
  const cfg = await getConfigAsync();               // the config accessor already in scope
  links = await require('./services/meridianLinks').getLinksForSite(code, { config: cfg });
} catch (_) { links = {}; }
const { actionId } = require('./services/meridianActions');
for (const g of ['meetings','inspection','report']) {
  for (const it of (sa.groups[g] && sa.groups[g].items) || []) {
    const l = links[actionId(it)];
    it.project = l ? { id: l.project_id, name: l.project_name, activity_id: l.activity_id,
                       url: `${(cfg.meridian_base_url||'').replace(/\/$/,'')}/projects/${encodeURIComponent(l.project_id)}` } : null;
  }
}
```
Keep the whole block inside the existing handler try; a throw anywhere here must fall through to `project:null`, never 500 the hub.

- [ ] **Step 4: Render the badge.** In `public/site-actions.html` `rowHtml` (line ~209), after the title span, add:
```js
${it.project ? `<a class="sa-badge sa-badge--pmo" href="${esc(it.project.url)}" target="_blank" rel="noopener" title="Meridian project">▸ Projet: ${esc(it.project.name || it.project.id)}</a>` : ''}
```
Add a `.sa-badge--pmo` colour rule near the existing `.sa-badge` CSS (line ~43). Null `project` → no badge (never fabricated).

- [ ] **Step 5: Run — expect PASS.** Browser-verify the hub still renders with Meridian **unconfigured** (no badges, no errors) — the degrade path is the common case until Part B ships.

- [ ] **Step 6: Commit.**

## Task A6: Resource sync `tools/meridian/sync-resources.js` (CLI + scheduled)

**Files:**
- Create: `services/meridianResources.js` (pure payload builder — reads nothing, takes sites+people arrays)
- Create: `tools/meridian/sync-resources.js` (the CLI: reads SDP, builds payload, POSTs; `require.main` guarded; exports `{ buildPayload, main }`)
- Test: `tests/meridian-resources.test.js` (pure builder) + `tests/meridian-sync.test.js` (main with injected reader + injected httpPost)

- [ ] **Step 1: Failing test for the pure builder.**
```js
const {test}=require('node:test'); const assert=require('node:assert');
const { buildResourcePayload } = require('../services/meridianResources');
test('maps SDP sites+people to C1 payload; drops person with unknown site', () => {
  const sites=[{site_id:1,code:'HGO',name:'Houndé'},{site_id:2,code:'MGO',name:'Mana'}];
  const people=[{id:42,full_name:'A. S',role:'coordinator',site_code:'HGO'},
                {id:7,full_name:'Ghost',role:'editor',site_code:'ZZZ'}]; // ZZZ not a site → dropped
  const p=buildResourcePayload({sites,people});
  assert.deepEqual(p.sites.map(s=>s.id).sort(),['HGO','MGO']);
  assert.equal(p.people.length,1); assert.equal(p.people[0].id,'SDP-U42'); assert.equal(p.people[0].site_id,'HGO');
  assert.equal(p._skipped_unknown_site,1);
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement the builder** `services/meridianResources.js`:
```js
'use strict';
// Pure: SDP sites (listSiteModuleCodes('meetings') rows) + people (listPeople rows)
// → the C1 resource-sync payload. Person id = "SDP-U<userId>". Sites first; a person
// whose site_code isn't in the site set is dropped (Meridian FK RESTRICT would reject).
function buildResourcePayload({ sites = [], people = [] }){
  const siteRows = sites.map(s => ({ id: s.code, name: s.name || s.code, country: null, region: null }));
  const known = new Set(siteRows.map(s => s.id));
  let skipped = 0; const peopleRows = [];
  for (const u of people){
    if (!known.has(u.site_code)) { skipped++; continue; }
    peopleRows.push({ id: `SDP-U${u.id}`, name: u.full_name || String(u.id), role: u.role || 'staff',
                      site_id: u.site_code, active: u.active !== false });
  }
  return { sites: siteRows, people: peopleRows, _skipped_unknown_site: skipped };
}
module.exports = { buildResourcePayload };
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Failing test for the CLI `main`** (injected deps): stub `readSites`/`readPeople` + a capturing `httpPost`; assert it POSTs `{base}/v1/resources/sync` with `X-API-Key: <out_key>` and the C1 body (sans the `_skipped_unknown_site` field), and that it no-ops (does NOT POST) when `meridian_base_url`/`meridian_out_key` is unconfigured.

- [ ] **Step 6: Run — expect FAIL.**

- [ ] **Step 7: Implement `tools/meridian/sync-resources.js`:**
```js
'use strict';
const { buildResourcePayload } = require('../../services/meridianResources');
function _axiosPost(){ return require('axios').post; }
// deps injectable for tests: { readSites, readPeople, getConfig, httpPost, log }
async function main(deps = {}){
  const getConfig = deps.getConfig || (async () => require('../../services/reportConfig').getConfig(require('../../reports-db').db));
  const cfg = await getConfig();
  const base = cfg.meridian_base_url, key = cfg.meridian_out_key;
  const log = deps.log || console.log;
  if (!base || !key){ log('[meridian-sync] not configured (meridian_base_url/out_key) — skipping'); return { skipped:true }; }
  const readSites = deps.readSites || (async () => require('../../reports-db').listSiteModuleCodes('meetings'));
  const readPeople = deps.readPeople || (async () => require('../../inspection-db').listPeople({}));
  const post = deps.httpPost || _axiosPost();
  const [sites, people] = [await readSites(), await readPeople()];
  const payload = buildResourcePayload({ sites, people });
  const { _skipped_unknown_site, ...body } = payload;
  try {
    const r = await post(`${String(base).replace(/\/$/,'')}/v1/resources/sync`, body,
      { headers: { 'X-API-Key': key }, timeout: 20000 });
    log(`[meridian-sync] pushed sites=${body.sites.length} people=${body.people.length} (skipped_unknown_site=${_skipped_unknown_site}) → ${JSON.stringify(r && r.data || {})}`);
    return { ok:true, sites: body.sites.length, people: body.people.length };
  } catch (e){ console.warn('[meridian-sync] push failed (non-blocking):', e.message); return { ok:false, error: e.message }; }
}
if (require.main === module) { main().then(r => process.exit(r && r.ok !== false ? 0 : 1)); }
module.exports = { main, buildResourcePayload };
```
Note: `listPeople` needs the user id + active flag — confirm `inspection-db.js listPeople` returns `id` (it does: `{id, full_name, role, site_name, site_code}`); if `active` isn't present, default true (the reader already filters to active users).

- [ ] **Step 8: Run — expect PASS.**

- [ ] **Step 9: Schedule it.** Add a nightly `cron.schedule` in `server.js` next to the assets/sync crons (e.g. `05:00`), calling `require('./tools/meridian/sync-resources').main().catch(()=>{})` — non-blocking, config-gated (it self-skips when unconfigured). Optionally an admin "Sync now" button on the Meridian card → a `POST /api/meridian/sync` (admin+) that calls `main()`.

- [ ] **Step 10: Commit.**

## Task A7: Contract doc + regression + CLAUDE.md + finish

**Files:**
- Create: `docs/MERIDIAN_INTEGRATION_CONTRACT.md` (the three contracts C1/C2/C3 above + the two-key auth + the Part B checklist for the boss)
- Modify: `CLAUDE.md` — a Current-State F1 block + Known-Pitfalls rows (best-effort badge degrade; two-key auth; person source = users not ticket-techs; site-id namespace = meetings code; `getSiteIdByModuleCode` returns `.site_id` not `.id`)
- Modify: `docs/superpowers/specs/2026-08-10-meridian-sdp-federation-design.md` — note the sync mechanism decision changed to the ingest API (was direct-DB), with the RLS rationale

- [ ] **Step 1: Write `docs/MERIDIAN_INTEGRATION_CONTRACT.md`** — the three JSON contracts verbatim, the two-key model, error posture, and a "Part B — what Meridian must implement" checklist (Tasks B1–B4 summarised) so the boss has a single self-contained brief.
- [ ] **Step 2: Regression** — run the new suites + neighbours:
```
node --test --test-force-exit tests/meridian-actions.test.js tests/meridian-links.test.js tests/meridian-resources.test.js tests/meridian-sync.test.js tests/report-config-meridian.test.js
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/meridian-route.smoke.test.js tests/site-actions-routes.smoke.test.js tests/site-actions-register.test.js
node --test --test-force-exit tests/await-precedence.test.js
```
Expected: all green; the existing `site-actions-register` + hub smokes unchanged (the read API re-serves `buildSiteActions`; no behaviour change).
- [ ] **Step 3: Browser-verify** the hub with Meridian unconfigured (no badges, no console errors) — the degrade path. (Full badge E2E needs Part B live — user's step.)
- [ ] **Step 4: Update CLAUDE.md + spec.** Commit.
- [ ] **Step 5: Finish** — build the deploy ZIP is the USER's step (don't advance `.git/last-deployed`); state which files are server-code/`_htmlCache` (server.js + routes/meridian.js + reports.html + site-actions.html → `pm2 stop`→wait→`start`; the `tools/` + `services/` are server-required too).

---

# PART B — Meridian side (the boss's repo — coordinate first, do NOT push without sign-off)

> Specified precisely so the boss can implement, or approve us implementing in a `Meridian/` branch for his review. Meridian uses raw `pg` + numbered SQL migrations under RLS `FORCE`, Fastify 5 routes scoped by JWT tenant via `req.db(fn)`, Vitest. **A new `pmo` table needs: `tenant_id` + tenant-carrying FKs, `ENABLE`+`FORCE` RLS with `app.current_tenant()` policies, an explicit `GRANT … TO meridian_app`, and (if it should sync/audit) its own `audit.record()` trigger.**

## Task B1: Migration `0015_external_action_link.sql`

**Files:** Create `packages/db/migrations/0015_external_action_link.sql` (next unused number — verify the highest existing). **Never edit an applied migration.**

- [ ] The table + RLS + grant + audit trigger:
```sql
CREATE TABLE pmo.external_action_link (
  tenant_id    uuid NOT NULL REFERENCES app.tenant(id) ON DELETE CASCADE,
  id           text NOT NULL,                      -- pmo.next_business_id('EAL') or a uuid
  activity_id  text NOT NULL,
  project_id   text NOT NULL,
  ext_system   text NOT NULL DEFAULT 'sdp',
  ext_source   text NOT NULL,                      -- 'meetings' | 'inspection' | 'report'
  ext_id       text NOT NULL,                      -- SDP stable id "<source>:<action_id|uid>"
  title_cache  text,
  linked_by    text,
  linked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, ext_system, ext_id),          -- one link per external action
  FOREIGN KEY (tenant_id, activity_id) REFERENCES pmo.activity(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, project_id)  REFERENCES pmo.project(tenant_id, id)  ON DELETE CASCADE
);
CREATE INDEX eal_by_project ON pmo.external_action_link (tenant_id, project_id);
CREATE INDEX eal_by_activity ON pmo.external_action_link (tenant_id, activity_id);

ALTER TABLE pmo.external_action_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmo.external_action_link FORCE  ROW LEVEL SECURITY;
CREATE POLICY eal_read  ON pmo.external_action_link FOR SELECT
  USING (tenant_id = app.current_tenant());
CREATE POLICY eal_write ON pmo.external_action_link FOR ALL
  USING (tenant_id = app.current_tenant() AND app.at_least('site_responsible'))
  WITH CHECK (tenant_id = app.current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON pmo.external_action_link TO meridian_app;

CREATE TRIGGER audit_external_action_link
  AFTER INSERT OR UPDATE OR DELETE ON pmo.external_action_link
  FOR EACH ROW EXECUTE FUNCTION audit.record();
```
(Confirm the write-permission role — `site_responsible` mirrors `activity_write`; the boss picks the right grade. Confirm `pmo.next_business_id` prefix registration if human ids are wanted, per `seed.ts` `syncIdSequences`.)
- [ ] Run `npm run migrate`; add a `packages/db` Vitest asserting the table exists + RLS blocks a cross-tenant read.

## Task B2: Ingest endpoint `POST /v1/resources/sync` (C1)

**Files:** a route in `apps/api/src/routes/resources.ts` (or a new `routes/sync-resources.ts` registered under `/v1/resources`).

- [ ] Auth: a **service API key** (header `X-API-Key`) → resolves to the Endeavour tenant + a superadmin principal for `req.db`/context. (Meridian decides: a dedicated service-token table, or a config-mapped key → tenant. This is the `meridian_out_key` SDP presents.)
- [ ] Zod-validate the C1 body (`sites[]`, `people[]`). In one `req.db` txn: upsert sites (`INSERT … ON CONFLICT (tenant_id,id) DO UPDATE SET name=…, country=…, region=…`), then people (`… site_id …`, `active`). Sites first (person FKs site). Count upserts; count `skipped_unknown_site` where a person's `site_id` isn't present. Respond `{sites:{upserted},people:{upserted,skipped_unknown_site}}`.
- [ ] Idempotent (re-POST → same result). Vitest: POST twice → second is a no-op-equivalent; a person with an unknown site is skipped, not a 500.

## Task B3: Link endpoints `POST /v1/activities/:id/attach` + `GET /v1/links?site=` (C3)

**Files:** a new `apps/api/src/routes/links.ts` registered under `/v1` (mirror `projects.ts:199-272` for the POST; `resources.ts:14-32` for the query GET).

- [ ] `POST /v1/activities/:id/attach` — `onRequest:[app.authenticate]`, `req.require('activity:write',{projectId})`. Body (zod): `{ ext_source, ext_id, title_cache }`. Resolve the activity's `project_id`. `INSERT INTO pmo.external_action_link (tenant_id, id, activity_id, project_id, ext_system, ext_source, ext_id, title_cache, linked_by) VALUES (app.current_tenant(), …) ON CONFLICT (tenant_id, ext_system, ext_id) DO UPDATE SET activity_id=…, project_id=…, title_cache=…, linked_by=…, linked_at=now()`. Return `201`.
- [ ] `GET /v1/links?site=CODE` — **the C3 read-back SDP consumes.** This one must be reachable by SDP's `meridian_out_key` service token (same auth as B2), not only interactive JWT users. Join `external_action_link` → `pmo.activity` → `pmo.project` filtered to `project.site_id = :site`. Return `{links:[{ext_source,ext_id,activity_id,project_id,project_name,title_cache}]}`.
- [ ] Vitest: attach then GET returns the link; cross-tenant GET returns none (RLS); an out-of-scope contributor JWT gets 403 on attach.

## Task B4: Meridian web — action picker + link display

**Files:** `apps/web` (Next.js). Out of the API critical path; can follow B1–B3.

- [ ] On an activity/project view, a "Attach SDP action" picker: `GET {sdp}/api/actions/open?site=<project.site_id>` (server-side fetch with `X-API-Key: <meridian_in_key>`), list the actions, on select → `POST /v1/activities/:id/attach` with `{ext_source, ext_id, title_cache}`.
- [ ] Show attached SDP actions on the activity (from `external_action_link`). No SDP write-back needed — SDP reads links via C3.

---

## Risks / open items

1. **Boss coordination (Part B).** B1–B4 are his codebase. Nothing in Part A depends on B to *build/test*; it degrades until B ships. Agree the three contracts (the doc from A7) first.
2. **Service-token model on Meridian (B2/B3 auth).** SDP presents one `meridian_out_key`; Meridian must map it → the Endeavour tenant + a write-capable context. The boss owns that design.
3. **Tenant provisioning.** The single Endeavour tenant + a first `npm run seed` (or an empty tenant) must exist before the first sync POST, or C1 has nowhere to upsert.
4. **Person source is the user directory, not every technician** (decision above) — staff who never became dashboard users won't appear as Meridian resources. Revisit in Tranche 2 if the PMO needs the full ticket-technician roster.
5. **Reverse-proxy path vs subdomain** for Meridian (spec §10.2) — affects the `meridian_base_url` value only; no code impact.
6. **Deploy:** Part A touches `server.js` + `_htmlCache` HTML → `pm2 stop`→wait→`start`. Build the ZIP is the user's step (marker discipline).
