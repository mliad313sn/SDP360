# OPManager Infra Availability — V1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read OPManager device-availability from ManageEngine Analytics Plus, classify + aggregate it in OPS into per-site × KPI-family × period (week + month) availability **snapshots**, with read APIs and a coverage/governance view — **without touching the weekly report or `infra_kpis`** (that is V1b).

**Architecture:** Analytics exposes ONE joined **daily per-device** view (`OPS_OPM_Device_Availability_Daily`). OPS owns classification + aggregation in **pure JS** (unit-tested against the real CSVs now), writes idempotent rows into a new dual-backend `infra_metric_snapshots` table, and serves `GET /api/analytics/opmanager/{availability,coverage}` + a sync (nightly cron + `POST …/sync`). Everything best-effort: Analytics down ⇒ no write, existing snapshots kept, **absence = `none`/"No data", never `0%`**.

**Tech Stack:** Node/Express, `node --test`, dual sqlite/postgres via `REPORTS_BACKEND` (snapshots live in reports.db), `fetchView` reuse (server.js), the Assets/Meridian sync + `tools/pg/copy-*` patterns.

**Spec:** `docs/superpowers/specs/2026-08-13-opmanager-infra-v1a-design.md` (read it — decisions, the Analytics contract, the classification table, the null-not-zero rule).

---

## Decisions locked (from the spec + user)
- **OPS classifies + aggregates**; Analytics does only the join → the daily per-device view.
- **Site identity = `site_id`** everywhere (snapshots key on it; the API `site=` param is the **meetings module code** resolved to `site_id`). `sites` has no short-code column.
- **`unmonitored` counts as unavailable** (denominator); `maintenance` + `on_hold` excluded. CONFIRMED.
- **Probe→site** via `site_module_codes` `module='opmanager'`; **Tanda → the `TDA` site**. CONFIRMED.
- **Classification precedence = family order, first-match** (excluded → wan → wifi → lan → servers).
- Snapshot PK = composite `(site_id, period_type, period_start, kpi_family, metric_name)`, **no surrogate id**.
- Freshness derived by OPS: `collected_at` (sync time) + `data_through` (MAX Day in data).
- Status `green|orange|red|none` (store `orange`, never `amber`).

## File structure
- Create `services/opmClassify.js` (pure), `services/opmAvailability.js` (pure), `services/opmAnalytics.js` (adapter), `tools/opmanager/sync-availability.js` (CLI), `routes/opmanager.js` (DI router).
- Modify `services/reportConfig.js` (3 config keys), `services/siteReportDeps.js` (export `weekOf`), `reports-db.js` (snapshot table + reader/upsert + opmanager seed + coverage reader helpers + `initPgReports`), `db/postgres/reports/007_infra_snapshots.sql` (new), `tools/pg/copy-reports-infra.js` (new), `server.js` (mount router + cron), `CLAUDE.md`.
- Create `tests/fixtures/opmanager/{OPM_Inventory.csv, Availability_History_of_Devices.csv, OPS_OPM_Device_Availability_Daily.csv}` + `tests/opm-*.test.js`.

---

## Task 1: Config keys

**Files:** Modify `services/reportConfig.js` (DEFAULTS). Test: `tests/report-config-opm.test.js`.

- [ ] **Step 1: failing test** — `opm_availability_view_id`, `opm_targets`, `opm_stale_days` in DEFAULTS + KEYS.
```js
const cfg = require('../services/reportConfig');
for (const k of ['opm_availability_view_id','opm_targets','opm_stale_days']) {
  assert.ok(k in cfg.DEFAULTS && cfg.KEYS.includes(k), `${k} missing`);
}
assert.doesNotThrow(() => JSON.parse(cfg.DEFAULTS.opm_targets));  // valid JSON
```
- [ ] **Step 2: run → FAIL.** `node --test --test-force-exit tests/report-config-opm.test.js`
- [ ] **Step 3: add keys** to DEFAULTS (after the meridian block):
```js
  // ── OPManager infra availability (V1a). Analytics view id OPS reads via fetchView;
  //    per-family targets (JSON); staleness threshold in days. Non-secret.
  opm_availability_view_id: '',
  opm_targets: JSON.stringify({ lan: 99, wifi: 98, wan: 98, servers: 99 }),
  opm_stale_days: '9',
```
- [ ] **Step 4: run → PASS. Step 5: commit.**

## Task 2: `services/opmClassify.js` — pure classification

**Files:** Create `services/opmClassify.js`. Fixture `tests/fixtures/opmanager/OPM_Inventory.csv` (copy from `C:\Users\Admin\Downloads\OPM_Inventory.csv`). Test `tests/opm-classify.test.js`.

- [ ] **Step 1: copy the fixture** (BOM-stripping is the reader's job): `OPM_Inventory.csv` → `tests/fixtures/opmanager/`.
- [ ] **Step 2: failing test** — drive real Type/Category pairs:
```js
const { classifyKpiFamily } = require('../services/opmClassify');
const F = (t,c) => classifyKpiFamily(t,c).family;
assert.equal(F('Windows 2022','Server'),'servers');
assert.equal(F('Windows 2022','DomainController'),'servers');
assert.equal(F('Linux','Server'),'servers');
assert.equal(F('ESXServer','Server'),'servers');
assert.equal(F('Meraki MS Series','Meraki Switch'),'lan');
assert.equal(F('Meraki MR Series','Meraki Radio'),'wifi');
assert.equal(F('Meraki MX Series','Meraki Security'),'wan');
assert.equal(F('Meraki Z Series','Meraki Security'),'wan');
assert.equal(F('Unknown','Unknown'),'excluded');
assert.equal(F('Cyber Power System Device_1','Unknown'),'excluded');  // UPS
assert.equal(F('Linux','Wireless'),'wifi');   // precedence: family order → wifi before servers
assert.match(classifyKpiFamily('Unknown','Unknown').reason, /unknown/i);
```
- [ ] **Step 3: run → FAIL.**
- [ ] **Step 4: implement.** A declared ordered rule table (data, not branches); first family whose `catIn` OR `typeContains` matches wins:
```js
'use strict';
// Pure OPManager device → KPI family classifier. Family ORDER is authoritative
// (first match wins): excluded → wan → wifi → lan → servers. Case-insensitive.
const RULES = [
  { family:'excluded', cat:['unknown','meraki controller'], typeEq:['unknown'] },
  { family:'wan',      cat:['meraki security'], typeHas:['meraki mx','meraki z','firewall','wan'] },
  { family:'wifi',     cat:['meraki radio','wireless'], typeHas:['meraki mr','access point','ap','wireless access point'] },
  { family:'lan',      cat:['meraki switch'], typeHas:['meraki ms','switch'] },
  { family:'servers',  cat:['server','domaincontroller'], typeHas:['windows','linux','esxserver'] },
];
const _n = v => String(v == null ? '' : v).trim().toLowerCase();
function classifyKpiFamily(type, category) {
  const t = _n(type), c = _n(category);
  for (const r of RULES) {
    const catHit = (r.cat || []).includes(c);
    const typeEqHit = (r.typeEq || []).includes(t);
    const typeHasHit = (r.typeHas || []).some(s => t.includes(s));
    if (catHit || typeEqHit || typeHasHit) {
      return { family: r.family, reason: `${catHit?'category='+c : (typeEqHit||typeHasHit)?'type='+t : ''}` };
    }
  }
  return { family: 'excluded', reason: 'unclassified (unknown type/category)' };
}
module.exports = { classifyKpiFamily, RULES };
```
Note: the `excluded` rule with `typeEq:['unknown']` sits FIRST so a `Type=Unknown` device never falls through to a broader `typeHas`. The `AP` token is matched as a substring; if it over-matches in real data, tighten to `\bap\b` in V2 (flagged, not needed now).
- [ ] **Step 5: run → PASS. Step 6: commit.**

## Task 3: export `weekOf(date)` from `siteReportDeps.js`

**Files:** Modify `services/siteReportDeps.js`. Test `tests/opm-weekof.test.js`.

- [ ] **Step 1: failing test** — Monday-anchored bucketing of an arbitrary date:
```js
const { weekOf } = require('../services/siteReportDeps');
const w = weekOf('2026-07-22');   // a Wednesday
assert.equal(w.period_start, '2026-07-20');  // Monday
assert.equal(w.period_end,   '2026-07-26');  // Sunday
assert.equal(weekOf('2026-07-20').period_start, '2026-07-20'); // Monday maps to itself
```
- [ ] **Step 2: run → FAIL** (not exported).
- [ ] **Step 3: extract** the inline Monday logic (currently at `siteReportDeps.js:271-272` over `_isoWeek:256`) into a pure exported `weekOf(dateIso) → { period_start, period_end }` (UTC, Monday start, Sunday end, `YYYY-MM-DD` strings). Have `_lastIsoWeeks` reuse it internally (keep its existing `{from,to}` external shape to not disturb callers, or map — do NOT change `_lastIsoWeeks`'s return shape). Add `weekOf` to `module.exports`.
- [ ] **Step 4: run → PASS**, and confirm the site-report suite still green: `node --test --test-force-exit tests/site-report-helpdesk-weekly.test.js`. **Step 5: commit.**

## Task 4: `services/opmAvailability.js` — pure parse + aggregate

**Files:** Create `services/opmAvailability.js`. Fixtures: copy `Availability_History_of_Devices.csv` → `tests/fixtures/opmanager/`; author a small `OPS_OPM_Device_Availability_Daily.csv` (contract shape: multi-site, multi-family, a down week, an Unknown device, an unmapped probe). Test `tests/opm-availability.test.js`.

- [ ] **Step 1: failing tests** — parsers + aggregate:
```js
const { parsePercent, parseDuration, aggregate } = require('../services/opmAvailability');
assert.equal(parsePercent('95.8%'), 95.8);
assert.equal(parsePercent(''), null);
assert.equal(parseDuration('0 days 22 hrs 59 mins 34 secs'), 22*3600+59*60+34);
assert.equal(parseDuration('1 days 00 hrs 00 mins 00 secs'), 86400);
// aggregate: 1 server device, 7 daily rows, 6×100% + 1×0%(downtime) → 6/7 days up
const rows = /* 7 daily contract rows for one Windows/Server device, probe 'Mana', week of 2026-07-20 */;
const out = aggregate(rows, { probeToSite: p => p==='Mana'?42:null, classify, targets:{servers:99}, periodType:'week', asOf:'2026-07-27' });
const g = out.find(r => r.kpi_family==='servers');
assert.equal(g.site_id, 42); assert.equal(g.period_start, '2026-07-20');
assert.ok(Math.abs(g.metric_value - (6*86400)/(7*86400)*100) < 0.01);  // ~85.71
assert.equal(g.status_color, 'red');   // <99-2
// null-not-zero: a family with no rows is simply ABSENT from output (route fills 'none')
// excluded + unmapped are NOT in output
```
Add: `parseDuration` tolerant (garbage→null); `aggregate` month path; AVG-fallback when durations unparseable; `data_through` = max Day; `device_count`/`included_device_count`.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** `services/opmAvailability.js`:
  - `parsePercent(s)` → strip `%`/spaces, `parseFloat`, NaN→null.
  - `parseDuration(s)` → regex `(\d+)\s*days?.*?(\d+)\s*hrs?.*?(\d+)\s*mins?.*?(\d+)\s*secs?` → seconds; null on no match.
  - `aggregate(dailyRows, { probeToSite, classify, targets, periodType, asOf })`:
    1. per row: `family = classify(type,category).family`; skip `excluded`.
    2. `site_id = probeToSite(probe)`; skip null.
    3. `bucket = periodType==='week' ? weekOf(day) : monthBounds(day)` (import `weekOf` from siteReportDeps; month bounds inline `YYYY-MM-01`..end).
    4. group `(site_id, family, bucket.period_start)`; per group sum `uptime/downtime/dependent/unmonitored` secs and collect uptime%.
    5. `avail = sumDenoms>0 ? 100*upSec/(up+down+dep+unmon) : (validPcts.length ? mean(validPcts) : null)`.
    6. `status_color` via §4.5 (target = `targets[family]`); `trend` left `null` (computed by the reader/route vs prior snapshot — Task 5/8); `device_count`, `included_device_count`, `data_through=max(day)`, `raw_json` = the sums.
  - All pure, `asOf` injected, no `Date.now`.
- [ ] **Step 4: run → PASS. Step 5: commit.**

## Task 5: `infra_metric_snapshots` table + upsert/read (dual backend)

**Files:** Modify `reports-db.js` (sqlite schema + `upsertInfraSnapshots` + `getInfraSnapshots` + pg forks + `initPgReports`), create `db/postgres/reports/007_infra_snapshots.sql`, create `tools/pg/copy-reports-infra.js`. Test `tests/opm-snapshots.test.js` (+ extend `tests/pg-reports-*` if a pg harness runs).

- [ ] **Step 1: failing test (sqlite)** — round-trip + idempotency + trend:
```js
process.env.REPORTS_BACKEND='sqlite'; /* SDP_DATA_DIR tmp + DASH_USER/PASS */
const rdb = require('../reports-db');
await rdb.upsertInfraSnapshots([{ site_id:42, period_type:'week', period_start:'2026-07-20', period_end:'2026-07-26',
  kpi_family:'lan', metric_name:'availability', metric_value:99.7, target_value:99, status_color:'green',
  trend:null, source:'analytics_opmanager', source_view:'V', data_through:'2026-07-26',
  device_count:5, included_device_count:5, collected_at:'2026-07-27T00:00:00Z', raw_json:'{}' }]);
let rows = await rdb.getInfraSnapshots({ site_id:42, period_type:'week' });
assert.equal(rows.length, 1); assert.equal(rows[0].metric_value, 99.7);
// idempotent: re-upsert same key updates, no dup
await rdb.upsertInfraSnapshots([{ ...same, metric_value:98.0 }]);
rows = await rdb.getInfraSnapshots({ site_id:42, period_type:'week' });
assert.equal(rows.length, 1); assert.equal(rows[0].metric_value, 98.0);
```
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement.**
  - sqlite `CREATE TABLE IF NOT EXISTS infra_metric_snapshots (…, PRIMARY KEY (site_id, period_type, period_start, kpi_family, metric_name))` per spec §4.4 (in `reports-db.js` schema init).
  - `db/postgres/reports/007_infra_snapshots.sql` — same columns, `site_id` typed to match the pg `sites.id`, composite PK. Apply it in `initPgReports` (mirror how 003/004 are applied).
  - `upsertInfraSnapshots(rows)` dual: sqlite `INSERT … ON CONFLICT(<pk>) DO UPDATE SET …` in a tx; pg the same via `pgDb.runTransaction`. **Bare dispatcher** `upsertInfraSnapshots`/`getInfraSnapshots` (async) so `await-precedence` covers them.
  - `getInfraSnapshots({ site_id, period_type, kpi_family?, period_start? })` dual reader.
  - `tools/pg/copy-reports-infra.js` — mirror `copy-reports-config.js`: `TABLES=[['infra_metric_snapshots', <cols>, <pkCols>]]`, entrypoint-guarded, require-safe.
- [ ] **Step 4: run → PASS.** Run `node --test --test-force-exit tests/await-precedence.test.js` (auto-covers the new dispatchers). **Step 5: commit.**

## Task 6: Probe → site seed (`site_module_codes` module='opmanager')

**Files:** Modify `reports-db.js` `_SITE_MODULE_CODES_SEED`. Test `tests/opm-probe-map.test.js`.

- [ ] **Step 1: failing test** — probes resolve to the SAME site_id as the meetings code:
```js
const rdb = require('../reports-db');  // sqlite tmp, seeded
const same = (probe, meetingsCode) =>
  assert.equal(rdb.getSiteIdByModuleCode('opmanager', probe)?.site_id,
               rdb.getSiteIdByModuleCode('meetings', meetingsCode)?.site_id, `${probe}→${meetingsCode}`);
same('Sabodala','SGO'); same('LAFIGUE','SML'); same('HOUNDE','HGO'); same('Mana','MGO');
same('Ity','SMI'); same('Ouagadougou','EDV'); same('Tanda','TDA');
assert.equal(rdb.getSiteIdByModuleCode('opmanager','NoSuchProbe'), null); // unmapped → null (coverage)
// ABJ → the Abidjan site (confirm its meetings code exists; else map by site name)
```
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: seed.** For each `(probe → meetings code)` pair below, add a row `{ site_id: <same site_id the meetings row uses>, module:'opmanager', code:<probe> }` to `_SITE_MODULE_CODES_SEED` (read the existing meetings rows to reuse each site_id — do NOT invent ids): `Sabodala→SGO · LAFIGUE→SML · HOUNDE→HGO · Mana→MGO · Ity→SMI · Ouagadougou→EDV · Tanda→TDA · ABJ→(Abidjan's site)`. Case-insensitive resolution is already provided by `getSiteIdByModuleCode`. (Confirm the pg seed path seeds the same rows — mirror wherever the sqlite seed is mirrored for pg.)
- [ ] **Step 4: run → PASS. Step 5: commit.**

## Task 7: Analytics adapter + sync CLI

**Files:** Create `services/opmAnalytics.js` (adapter: `readDailyRows` + pure `coverageSummary`), `tools/opmanager/sync-availability.js` (CLI `main`). Tests `tests/opm-analytics.test.js`, `tests/opm-sync.test.js`.

- [ ] **Step 1: failing tests.**
  - `readDailyRows({ fetchView, viewId })`: inject a `fetchView` returning `{ rows:[{'Device Name':…, 'Probe Name':'Mana', 'Type':'Windows 2022','Category':'Server','Day':'2026-07-22','Uptime Percentage':'100%', …}] }`; assert it maps CSV headers → contract keys (probe, type, category, day, uptime%+durations). Config-gated: no `viewId` → `[]` (no fetch).
  - `coverageSummary(rows, { classify, probeToSite })` (pure): `{ total, included, by_family:{lan,wifi,wan,servers}, excluded, unclassified, unmapped_probes:[…] }`.
  - `main(deps)` (sync): injected `getConfig` (armed with a `opm_availability_view_id`), injected `readDailyRows`, injected `upsertInfraSnapshots` (capture). Assert it composes week + month snapshots and upserts both; **config-gated no-op** when view id unset (no upsert); **fetch failure → no upsert, returns `{ok:false}` non-throwing**; `trend` filled vs the previous period's snapshot (read prior via injected `getInfraSnapshots`).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement.**
  - `opmAnalytics.js`: `readDailyRows` maps `fetchView(viewId)` rows (header→contract). `coverageSummary` pure. Header names per §3 (`Probe Name`, `Type`, `Category`, `Day`/`Time Period`, `Uptime Percentage`, `Uptime Duration`, …) — tolerant to `Day` vs `Time Period`.
  - `tools/opmanager/sync-availability.js` `main(deps)`: gate on `opm_availability_view_id`; `rows = readDailyRows(...)`; build `probeToSite` from `getSiteIdByModuleCode('opmanager', …)`; `classify` from opmClassify; `targets` from `JSON.parse(cfg.opm_targets)`; `wk = aggregate(rows, {…, periodType:'week'})`, `mo = aggregate(rows, {…, periodType:'month'})`; fill `trend` per group vs `getInfraSnapshots` prior period; `collected_at=now` (injectable), `source='analytics_opmanager'`, `source_view=viewId`; `upsertInfraSnapshots([...wk, ...mo])`. Best-effort try/catch → `{ok:false,error}`. `require.main` guard; deps injectable (mirror `tools/meridian/sync-resources.js` + `tools/reports/send-*`).
- [ ] **Step 4: run → PASS. Step 5: commit.**

## Task 8: Read API + coverage + cron + mount

**Files:** Create `routes/opmanager.js` (DI router). Modify `server.js` (mount + cron). Test `tests/opm-routes.smoke.test.js`.

- [ ] **Step 1: failing smoke** (mirror `tests/site-actions-routes.smoke.test.js`, sqlite, in-process app): seed a snapshot for site `MGO`, then:
  - `GET /api/analytics/opmanager/availability?site=MGO&period=week` (with `x-report-token`+`x-dash-key`) → 200, rows for the seeded family; a family with no snapshot is returned as `{metric_value:null, status_color:'none'}` (route fills the 4 families) — **assert never `0`**.
  - unknown site → 200 empty/`none`, not 500.
  - `GET …/coverage` → 200 with `{included, excluded, unclassified, unmapped_probes}` shape (Analytics stubbed/unconfigured → degrades to a well-formed empty summary, not 500).
  - auth gate: no token → 401.
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement `routes/opmanager.js`** (factory `{ express }`, `requireReportSession` from deps):
  - `GET /api/analytics/opmanager/availability` — resolve `site=` (meetings code) → `site_id` via `getSiteIdByModuleCode('meetings', code)`; `getInfraSnapshots({site_id, period_type})`; **fill the 4 families** (`lan/wifi/wan/servers`) — present → the snapshot row; absent → `{kpi_family, metric_value:null, status_color:'none'}`; compute `stale` from `data_through`/`collected_at` vs `opm_targets`… vs `opm_stale_days`. No `site` → all sites. Await config (pg Promise).
  - `GET /api/analytics/opmanager/coverage` — best-effort: `readDailyRows` (config-gated) → `coverageSummary` → JSON; Analytics unconfigured/down → `{ available:false, … }` (never 500).
  - `POST /api/analytics/opmanager/sync` — `requireAdmin`; runs `sync-availability.main()`; returns its result.
- [ ] **Step 4: mount in `server.js`** next to the meridian router: `app.use(require('./routes/opmanager')({ express, requireReportSession, requireAdmin }))`. **These `/api/analytics/*` routes are NOT under `/api/reports/:id`** so no shadowing; the global `/api/` gate applies (session/dash-key) — availability + coverage are session-guarded (NOT exempted), sync is admin. Add nightly cron after the assets window: `cron.schedule('0 5 * * *' or '30 4', () => require('./tools/opmanager/sync-availability').main({ fetchView }).catch(e=>console.error('[Cron:opm]', e&&e.message)))` — pass the boot `fetchView`.
- [ ] **Step 5: run → PASS** (`REPORTS_BACKEND=sqlite`). **Step 6: commit.**

## Task 9: Regression + docs + finish

- [ ] **Step 1: fixtures present** — `tests/fixtures/opmanager/{OPM_Inventory.csv, Availability_History_of_Devices.csv, OPS_OPM_Device_Availability_Daily.csv}` committed (the two real exports + the synthesized daily contract fixture).
- [ ] **Step 2: full regression:**
```
node --test --test-force-exit tests/opm-classify.test.js tests/opm-weekof.test.js tests/opm-availability.test.js tests/opm-snapshots.test.js tests/opm-probe-map.test.js tests/opm-analytics.test.js tests/opm-sync.test.js tests/report-config-opm.test.js
REPORTS_BACKEND=sqlite node --test --test-force-exit tests/opm-routes.smoke.test.js tests/site-actions-routes.smoke.test.js
node --test --test-force-exit tests/await-precedence.test.js tests/report-template-weekly.test.js tests/site-report-helpdesk-weekly.test.js
```
Expected all green; the weekly-report/`infra_kpis` goldens **unchanged** (V1a touches none of that).
- [ ] **Step 3: CLAUDE.md** — a Current-State V1a block + Known-Pitfalls rows: (a) OPManager availability comes via Analytics Plus `fetchView`, OPS classifies/aggregates, snapshots ≠ `infra_kpis`; (b) `unmonitored` counts as unavailable; (c) site key = `site_id`, API `site=` is the meetings code; (d) absence = `none`, never `0`; (e) `weekOf` extracted/exported from `siteReportDeps`.
- [ ] **Step 4: browser sanity** (optional/limited) — boot postgres, confirm `GET /api/analytics/opmanager/availability` 401-gates without a token and the app boots clean with the router mounted + cron registered. (Full live numbers need the Analytics view — user's Phase 1.)
- [ ] **Step 5: finish** — build the deploy ZIP is the USER's step. Note server-code/`_htmlCache` surfaces: `server.js` + `routes/opmanager.js` + `reports-db.js` + the `services/*`/`tools/*` are server-required → `pm2 stop`→wait→`start`. `initPgReports` auto-creates `infra_metric_snapshots` on boot; the copy script is for a fresh pg mirror.

---

## Risks / open items
1. **Analytics Phase 1 (blocking for LIVE data only):** the `OPS_OPM_Device_Availability_Daily` view + a shared `Device Key` on both source tables must exist for real numbers; OPS is fully built/tested on fixtures before that. Set `opm_availability_view_id` once the view exists.
2. **`ABJ` probe → the Abidjan site:** confirm Abidjan has a meetings code (else seed by site name). Others confirmed.
3. **`AP` substring match** in classification may over-match — tighten to a word boundary in V2 if real data shows false positives (not needed for V1a).
4. **Deploy** = user's ZIP step; needs `pm2 stop→start` (server code).
