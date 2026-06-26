# Chunk 4D-wiring-1 — server.js hot-path async wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the hot dashboard read path of `server.js` to `await` the now-async forked reports.db functions, fix the 3 raw-sqlite-handle code paths via new forked readers, and add a sqlite route-smoke harness — so the Helpdesk/Analytics dashboard works when `REPORTS_BACKEND=postgres`. Behaviour-preserving in sqlite mode (await on a sync value is a no-op).

**Architecture:** 3 new forked readers in `reports-db.js` (sqlite/pg dispatch, `pgHandle()` for pg); rewire `_rebuildCacheFromSQLite` + `/api/survey/kpis` + `/api/data/submission-channels` to use them; add `await` to ~26 hot-path route call sites (making handlers `async` where needed); export `app` + guard `start()` so an in-process smoke harness can mount the routes.

**Tech Stack:** Node.js, `services/pgDb.js`, local PostgreSQL 17 (`PG_ADMIN_URL`), `node:test` + global `fetch`, better-sqlite3 (sqlite default), express.

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-wiring1-design.md` (reviewed ✅).

**Verified facts:** `login(u,p)` → `{token, user}` (sync sqlite / Promise pg); `requireReportSession` reads `req.headers['x-report-token']`; global `/api/` gate (server.js ~957) accepts `X-Dash-Key` === `DASHBOARD_API_KEY` (env, server.js:43); `app` = `const app = express()` (server.js:88); `start()` called unconditionally (server.js ~6425); no existing `module.exports` in server.js. `_rebuildCacheFromSQLite` (~3177) already async; boot pre-warm at ~6420 + ~629.

**Dialect cheat-sheet:** `strftime('%Y-%m', x)` → `to_char(x::timestamptz,'YYYY-MM')`; `strftime('%Y', x)` → `to_char(x::timestamptz,'YYYY')`; raw-ISO/`COALESCE(...) >= ?` cutoffs UNCHANGED (lexical TEXT); `GROUP BY channel`/`GROUP BY <alias>` safe when the alias doesn't shadow a transformed column; pg forks query `pgHandle()`, never `db`.

---

### Task 0: Test enabler — export `app` + guard `start()`

**Files:** Modify `server.js` (~88 export region + ~6425 bottom).

- [ ] **Step 1:** At the very bottom of `server.js`, change the unconditional `start();` to:
```js
if (require.main === module) start();
module.exports = { app };
```
(Place `module.exports` AFTER all routes are registered — i.e. at the bottom, which it is.)

- [ ] **Step 2:** `node --check server.js` → clean.

- [ ] **Step 3:** Verify a require doesn't boot: `SDP_DATA_DIR=$(mktemp -d) DASH_USER=x DASH_PASS=pgtest-pass-0000 DASHBOARD_API_KEY=k node -e "const {app}=require('./server'); console.log('app?', typeof app)"` → prints `app? function` and the process exits (no port-bind hang; use a short timeout to confirm it doesn't listen). If it hangs on cron/intervals, that's expected to be handled by `--test-force-exit` in tests — but the require itself must not throw or call `app.listen`.

- [ ] **Step 4: Commit** — `chore(pg-reports-wiring1): export app + guard start() with require.main for in-process route tests`

---

### Task 1: sqlite route-smoke harness (regression baseline — green BEFORE the wiring changes)

**Files:** Create `tests/server-routes-smoke.test.js`.

- [ ] **Step 1: Write the smoke harness** — establishes the green baseline that Tasks 3-4 must preserve:
```js
'use strict';
// sqlite-mode route smoke — boots the express app IN-PROCESS (no port bind via start()),
// authenticates a session, and asserts the hot-path routes return 200 + sane JSON. Proves the
// 4D-wiring-1 async conversion doesn't break the live sqlite path. Run with --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'smoke-key';
// REPORTS_BACKEND unset → sqlite default.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, headers, rdb;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  headers = { 'X-Dash-Key': process.env.DASHBOARD_API_KEY, 'x-report-token': sess.token };
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const ROUTES = [
  '/api/sync/status',
  '/api/metrics/requests',
  '/api/data/sla-trend',
  '/api/requests?limit=5',
  '/api/data/submission-channels',
  '/api/data/requests-raw',
];
for (const path of ROUTES) {
  test(`smoke 200: ${path}`, async () => {
    const res = await fetch(base + path, { headers });
    assert.equal(res.status, 200, `${path} → ${res.status}`);
    const body = await res.json();
    assert.ok(body && (Array.isArray(body) || typeof body === 'object'), `${path} JSON shape`);
  });
}
```

- [ ] **Step 2: Run green (baseline)** — `node --test --test-force-exit tests/server-routes-smoke.test.js` → all 6 PASS against the CURRENT (pre-wiring) sqlite code. If `/api/data/requests-raw` is slow (cache cold), allow it; if a route 500s on the CURRENT code that's a pre-existing issue — note it, and either swap that route for another hot-path one or investigate. The point: a stable green baseline before changing routes.

- [ ] **Step 3: Commit** — `test(pg-reports-wiring1): sqlite route-smoke harness (6 hot-path routes, in-process app + session auth)`

---

### Task 2: Three forked readers (TDD in the pg aggregates suite)

**Files:** Modify `reports-db.js` (new readers near the other hot readers) + `tests/pg-reports-aggregates.test.js` (one test).

- [ ] **Step 1: Write the failing test** — append:
```js
test('agg pg: getRequestRecordsSince + getSurveyKpisDB + getSubmissionChannelsDB (wiring-1 readers)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    // getRequestRecordsSince — ASC, in-window only
    await rdb.upsertRequestBatch([
      _req({request_id:'RA',display_id:'#A',created_time:'2026-05-01 09:00:00',mode:'Email',tech_group:'G'}),
      _req({request_id:'RB',display_id:'#B',created_time:'2026-06-01 09:00:00',mode:'Web',tech_group:'G'}),
      _req({request_id:'ROLD',display_id:'#O',created_time:'2025-01-01 09:00:00',mode:'Email',tech_group:'G'}),
      _req({request_id:'RC',display_id:'#C',created_time:'2026-05-10 09:00:00',mode:'',tech_group:'G'}),
    ]);
    const since = await rdb.getRequestRecordsSince('2026-04-01T00:00:00.000Z');
    const ids = since.map(r => r.request_id);
    assert.ok(!ids.includes('ROLD'), 'old row excluded');
    assert.deepEqual(ids.filter(x => ['RA','RB'].includes(x)), ['RA','RB'], 'ASC order RA before RB');
    assert.ok(since[0].display_id, 'raw column names present');

    // getSubmissionChannelsDB — to_char period filter + GROUP BY channel collapse
    const ch = await rdb.getSubmissionChannelsDB({ yr:'2026', mo:'5' });
    const byCh = Object.fromEntries(ch.map(r => [r.channel === null ? '_null' : r.channel, r.cnt]));
    assert.equal(byCh['Email'], 1, 'May Email (RA); RB is June, ROLD is 2025');
    assert.equal(byCh['_null'], 1, "empty mode (RC) → NULL channel");
    assert.ok(!('Web' in byCh), 'RB (Web) is June, excluded by 2026-05 filter');
    // site+groups together — locks the corrected positional-param ordering (the route it
    // replaces had a latent WHERE/param misalignment when both were passed).
    const chSG = await rdb.getSubmissionChannelsDB({ yr:'2026', mo:'5', site:'Hounde', groups:['G'] });
    // RA: Email, May, site? (RA has no site set → site filter 'Hounde' excludes it). Seed a sited row:
    await rdb.upsertRequestBatch([_req({request_id:'RS',created_time:'2026-05-12 09:00:00',mode:'Phone',site:'Hounde',tech_group:'G'})]);
    const chSG2 = await rdb.getSubmissionChannelsDB({ yr:'2026', mo:'5', site:'Hounde', groups:['G'] });
    assert.equal(Object.fromEntries(chSG2.map(r=>[r.channel,r.cnt]))['Phone'], 1, 'site=Hounde + group=G → only RS');

    // getSurveyKpisDB — to_char period filter + group filter via LEFT JOIN on request_id
    await rdb.upsertSurveyResultBatch([
      _sres({result_id:'SK1',request_id:'RA',overall_score:90,survey_responded_on:'2026-05-10 10:00:00'}),
      _sres({result_id:'SK2',request_id:'RUNMATCHED',overall_score:50,survey_responded_on:'2026-05-11 10:00:00'}),
    ]);
    const k = await rdb.getSurveyKpisDB({ yr:'2026', mo:'5', groups:[] });
    assert.equal(k.rows1.length, 2, 'both surveys in 2026-05, no group filter');
    const kg = await rdb.getSurveyKpisDB({ yr:'2026', mo:'5', groups:['G'] });
    assert.equal(kg.rows1.length, 1, 'only SK1 (joins RA, tech_group=G)');
    assert.equal(kg.rows1[0].overall_score, 90);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit --test-name-pattern="wiring-1 readers" tests/pg-reports-aggregates.test.js` → FAILS.

- [ ] **Step 3: Implement the 3 readers** in `reports-db.js`:
```js
function getRequestRecordsSince(cutoffISO) {
  if (REPORTS_BACKEND === 'postgres') return _getRequestRecordsSincePg(cutoffISO);
  return db.prepare(`SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC`).all(cutoffISO);
}
async function _getRequestRecordsSincePg(cutoffISO) {
  return await pgHandle().prepare(`SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC`).all(cutoffISO);
}

function getSubmissionChannelsDB({ yr, mo, site, groups } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSubmissionChannelsDBPg({ yr, mo, site, groups });
  const { where, p } = _submChWhere({ yr, mo, site, groups }, 'sqlite');
  return db.prepare(`SELECT CASE WHEN mode IS NULL OR mode='' OR lower(mode)='unknown' THEN NULL ELSE mode END AS channel, COUNT(*) AS cnt FROM request_records WHERE 1=1 ${where} GROUP BY channel ORDER BY cnt DESC`).all(...p);
}
async function _getSubmissionChannelsDBPg({ yr, mo, site, groups } = {}) {
  const { where, p } = _submChWhere({ yr, mo, site, groups }, 'pg');
  return await pgHandle().prepare(`SELECT CASE WHEN mode IS NULL OR mode='' OR lower(mode)='unknown' THEN NULL ELSE mode END AS channel, COUNT(*) AS cnt FROM request_records WHERE 1=1 ${where} GROUP BY channel ORDER BY cnt DESC`).all(...p);
}
// Shared WHERE builder — only the strftime→to_char differs by dialect.
function _submChWhere({ yr, mo, site, groups }, dialect) {
  const p = []; let where = '';
  const ym = dialect === 'pg'
    ? { m: `to_char(created_time::timestamptz,'YYYY-MM')`, y: `to_char(created_time::timestamptz,'YYYY')` }
    : { m: `strftime('%Y-%m', created_time)`, y: `strftime('%Y', created_time)` };
  if (yr && mo) { where += ` AND ${ym.m} = ?`; p.push(`${yr}-${String(mo).padStart(2,'0')}`); }
  else if (yr)  { where += ` AND ${ym.y} = ?`; p.push(String(yr)); }
  if (site && site !== 'all') { where += ` AND site = ?`; p.push(site); }
  const gl = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (gl.length) { where += ` AND tech_group IN (${gl.map(()=>'?').join(',')})`; p.push(...gl); }
  return { where, p };
}

function getSurveyKpisDB({ yr, mo, groups } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSurveyKpisDBPg({ yr, mo, groups });
  const r1 = _surveyKpiQueries({ yr, mo, groups }, 'sqlite');
  return { rows1: db.prepare(r1.q1).all(...r1.p1), rows2: db.prepare(r1.q2).all(...r1.p2) };
}
async function _getSurveyKpisDBPg({ yr, mo, groups } = {}) {
  const H = pgHandle();
  const r1 = _surveyKpiQueries({ yr, mo, groups }, 'pg');
  return { rows1: await H.prepare(r1.q1).all(...r1.p1), rows2: await H.prepare(r1.q2).all(...r1.p2) };
}
// Builds the two queries; q1 = period+group-filtered scores; q2 = 12-mo trend (lexical cutoff).
function _surveyKpiQueries({ yr, mo, groups }, dialect) {
  const gl = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const ym = dialect === 'pg'
    ? { m: `to_char(COALESCE(sr.survey_responded_on, sr.survey_sent_on)::timestamptz,'YYYY-MM')`,
        y: `to_char(COALESCE(sr.survey_responded_on, sr.survey_sent_on)::timestamptz,'YYYY')` }
    : { m: `strftime('%Y-%m', COALESCE(sr.survey_responded_on, sr.survey_sent_on))`,
        y: `strftime('%Y', COALESCE(sr.survey_responded_on, sr.survey_sent_on))` };
  // q1
  let dWhere = '', p1 = [];
  if (yr && mo) { dWhere = ` AND ${ym.m} = ?`; p1.push(`${yr}-${String(mo).padStart(2,'0')}`); }
  else if (yr)  { dWhere = ` AND ${ym.y} = ?`; p1.push(String(yr)); }
  let gWhere = '';
  if (gl.length) { gWhere = ` AND rr.tech_group IN (${gl.map(()=>'?').join(',')})`; p1.push(...gl); }
  const q1 = `SELECT sr.overall_score FROM survey_results sr LEFT JOIN request_records rr ON sr.request_id = rr.request_id WHERE sr.overall_score IS NOT NULL ${dWhere} ${gWhere}`;
  // q2 — trend cutoff computed in the CALLER (route) historically; reader takes it via groups only,
  // so compute the same 12-mo cutoff here from yr/mo (mirrors server.js:1518-1529).
  let cut;
  if (yr && mo) { const d = new Date(parseInt(yr), parseInt(mo)-1, 1); d.setMonth(d.getMonth()-11); cut = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
  else { const d = new Date(); d.setMonth(d.getMonth()-11); d.setDate(1); cut = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
  const p2 = [cut]; let g2 = '';
  if (gl.length) { g2 = ` AND rr.tech_group IN (${gl.map(()=>'?').join(',')})`; p2.push(...gl); }
  const q2 = `SELECT sr.overall_score, COALESCE(sr.survey_responded_on, sr.survey_sent_on) as responded_on FROM survey_results sr LEFT JOIN request_records rr ON sr.request_id = rr.request_id WHERE sr.overall_score IS NOT NULL AND COALESCE(sr.survey_responded_on, sr.survey_sent_on) >= ? ${g2}`;
  return { q1, p1, q2, p2 };
}
```
Export all three from `module.exports`. **Note:** `new Date()`-based cutoff uses wall-clock — fine here (the trend window is relative-to-now by design; the test's q2 isn't asserted on exact membership, only q1).

- [ ] **Step 4: Run green** — PASSES.

- [ ] **Step 5: Commit** — `feat(pg-reports-wiring1): getRequestRecordsSince + getSurveyKpisDB + getSubmissionChannelsDB forks (TDD; to_char dialect, lexical cutoffs, shared WHERE builders)`

---

### Task 3: Rewire the 3 raw-handle paths + boot-await

**Files:** Modify `server.js` (~3177 `_rebuildCacheFromSQLite`, ~6420 + ~629 boot, ~1469 `/api/survey/kpis`, ~3347 `/api/data/submission-channels`).

- [ ] **Step 1: `_rebuildCacheFromSQLite`** — replace the inline sqlite read with the forked reader:
```js
// was: const { db: rdb } = require('./reports-db'); const dbRows = rdb.prepare(`SELECT * ... ASC`).all(cutoff.toISOString());
const dbRows = await require('./reports-db').getRequestRecordsSince(cutoff.toISOString());
```
(The fn is already `async`; the row-map + `_rawCache.data` + `_saveRawCacheToDisk()` are unchanged.)

- [ ] **Step 2: Boot pre-warm await** — make the two pre-warm callbacks async + await:
```js
// ~6420 (app.listen callback):  setTimeout(async () => { ... await _rebuildCacheFromSQLite(); }, 3000);
// ~629  (startup setTimeout):   setTimeout(async () => { ... await _rebuildCacheFromSQLite().catch(...) ; ... }, 30000);
```
Keep the existing `.catch`/try and the nested schema-check setTimeout.

- [ ] **Step 3: `/api/survey/kpis`** — make the handler `async`; replace the two raw `db.prepare(...).all(...)` with `const { rows1, rows2 } = await rdb.getSurveyKpisDB({ yr, mo, groups: groupList })`; keep ALL the JS reductions (`rows1.forEach` for scoreSum/promoters; `rows2.forEach` for byMonth via `r.responded_on.substring(0,7)`). `await` the `getSyncStatus()` for `as_of`. **DELETE the now-dead code the reader absorbed:** the `const db = require('./reports-db').db;` (~1473), the `dateWhere`/`groupWhere`/`params` builders (~1476-1492), the `kpiSql`/`db.prepare(kpiSql)` (~1494-1503), the trend-cutoff block (~1515-1529), `trendParams` + `trendSql` + `db.prepare(trendSql)` (~1531-1543). The handler keeps ONLY: `groupList` parse, the two `.forEach` reductions, `byMonth` assembly, `npsBase`, the `as_of` await, and `res.json(...)`. (`groupFiltered: groupList.length > 0` stays.)

- [ ] **Step 4: `/api/data/submission-channels`** — make the handler `async`; replace the raw `db.prepare(...).all(...)` with `const rows = await rdb.getSubmissionChannelsDB({ yr, mo, site, groups: groupList })`; keep the `total`/`knownRows` JS. Remove the unused raw-`db` require.

- [ ] **Step 5: Verify** — `node --check server.js`; re-run the smoke harness (`node --test --test-force-exit tests/server-routes-smoke.test.js`) → still 6 green (sqlite behaviour preserved, incl. `/api/data/submission-channels`).

- [ ] **Step 6: Commit** — `feat(pg-reports-wiring1): rewire _rawCache + survey/kpis + submission-channels to forked readers + boot-await`

---

### Task 4: Mechanical route awaits (the bulk pass)

**Files:** Modify `server.js` — the route handlers below. Pattern: add `await` to the forked call (INSIDE the inner try for `/api/data/*`); add `async` to the handler arrow where it isn't already.

- [ ] **Step 1: `/api/data/*` (14 — handlers already async, add `await` inside the inner try):**
  major-incidents (`getMajorIncidentsHistory`), change-table (`getChangeRecordsHistory`), first-response (`getFirstResponseTrendDB`), sla-trend (`getSlaTrendDB`), sla-by-category (`getSlaByCategoryDB`), group-requests (`getGroupRequestsDB`), emergency-changes (`getEmergencyChangesDB`), ageing (`getAgeingSummaryDB`), incident-vs-sr (`getIncidentVsSrDB`), cab-approvals (`getCabApprovalsDB`), cab-recommendations (`getCabRecommendationsDB`), monthly-summary (`getMonthlyHelpdeskHistory`), ageing-by-site (`getAgeingBySiteDB`), ageing-by-group (`getAgeingByGroupDB`). Example:
```js
// /api/data/sla-trend — the existing line is `dbRows = rdb2.getSlaTrendDB(12) || [];`
// inside the inner try. PRESERVE the `|| []` fallback (await binds tighter than ||):
dbRows = await rdb2.getSlaTrendDB(12) || [];
```

- [ ] **Step 2: `/api/survey/summary` + `/api/survey/by-dimension` (already async, add `await`):**
```js
const dbVoice = await rdb2.getCustomerVoiceDB(12);            // ~1398
const dbDim   = await rdb2.getCustomerVoiceByDimensionDB();   // ~1649
```

- [ ] **Step 3: `/api/metrics/*` (5 — make handler `async` + await both calls):** change (`getChangeMetrics`+`getSyncStatus`), cab (`getCABMetrics`+`getSyncStatus`), survey (`getSurveyMetrics`+`getSyncStatus`), requests (`getRequestMetrics`+`getSyncStatus`), request-filter-options (`getRequestFilterOptions`). Example:
```js
app.get('/api/metrics/requests', requireReportSession, async (req, res) => {   // + async
  try {
    const m = await getRequestMetrics({...});
    const sync = (await getSyncStatus()).find(...);   // getSyncStatus now awaited
    ...
```

- [ ] **Step 4: `/api/sync/status` (make async + await):** `res.json((await getSyncStatus()).map(...))`.

- [ ] **Step 5: Raw-data routes (5 — make async + await):** `/api/change` (`getChangeRecords`+`getSyncStatus`), `/api/cab` (`getCABApprovals`+`getSyncStatus`), `/api/survey` (`getSurveyResults`+`getSyncStatus`), `/api/survey/:response_id/answers` (`getSurveyAnswers`+`getSyncStatus`), `/api/requests` (`getRequestRecords`+`getSyncStatus`).

- [ ] **Step 6: Verify** — `node --check server.js`; re-run smoke (`node --test --test-force-exit tests/server-routes-smoke.test.js`) → 6 green. Grep guard: every forked-fn call in these routes is now `await`ed (`grep -nE "rdb2?\.(getSlaTrendDB|getChangeMetrics|getSyncStatus|...)" server.js` and eyeball that each is preceded by `await`).

- [ ] **Step 7: Commit** — `feat(pg-reports-wiring1): await all hot-path /api/data + /api/metrics + /api/sync + raw-data + survey route calls`

---

### Task 5: Regression + README + finish-branch

**Files:** Modify `tools/pg/README.md`.

- [ ] **Step 1: Full reports.db pg regression** — auth/config/reports/hot/aggregates suites green (aggregates now +1 wiring-1-readers test). + `tests/pg-reports-aggregates.test.js` green against PG.
- [ ] **Step 2: sqlite smoke** — `node --test --test-force-exit tests/server-routes-smoke.test.js` → 6 green.
- [ ] **Step 3: sqlite synchronous-return smoke** — extend the throwaway smoke to assert `getRequestRecordsSince('2020-01-01')`, `getSurveyKpisDB({})`, `getSubmissionChannelsDB({})` are NOT `instanceof Promise` on sqlite.
- [ ] **Step 4:** `node --check server.js && node --check reports-db.js` clean.
- [ ] **Step 5: README** — add `## reports.db — Sub-chunk 4D-wiring-1` to `tools/pg/README.md`: the 3 new readers + the raw-handle rewires, the ~26 route awaits (hot dashboard path), the export-app/guard-start test enabler + the new smoke harness, and that 4D-wiring-2 (PPTX/report + config routes) + 4B-RR remain before the prod flip.
- [ ] **Step 6: Commit + finish-branch:**
```bash
git add tools/pg/README.md && git commit -m "feat(pg-reports-wiring1): regression + README 4D-wiring-1 section"
git checkout main && git merge --no-ff feat/pg-reports-wiring-1 -m "merge: server.js hot-path async wiring (Chunk 4D-wiring-1) behind REPORTS_BACKEND"
```
- [ ] **Step 7: Post-merge sanity** — on main, `node --check server.js` + smoke green + aggregates green. Update migration memory (`project_pg_migration_chunk1_done.md` + index): 4D-wiring-1 merged; remaining = 4D-wiring-2 + 4B-RR + KPI reconciliation.

---

## Remember
- pg forks query `pgHandle()`, NEVER `db`. The sqlite body stays synchronous; only the pg branch is async.
- `await` MUST go INSIDE the `/api/data/*` inner `try{}` (else the Promise silently routes to the empty Zoho fallback).
- Don't touch the PPTX/report routes or `/api/reports/*` config routes (4D-wiring-2).
- The smoke harness must send BOTH `X-Dash-Key` (global gate) AND `x-report-token` (requireReportSession).
- DRY, YAGNI, TDD, frequent commits.
