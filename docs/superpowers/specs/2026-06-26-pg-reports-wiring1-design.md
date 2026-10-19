# Chunk 4D-wiring-1 — server.js hot-path async wiring → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-wiring-1` (off `main`)
**Depends on:** Chunks 4A–4D-2d — all merged. The reports.db DB layer is 100% forked behind
`REPORTS_BACKEND=postgres` (default sqlite, synchronous). This chunk wires the server.js **HTTP-handler
layer** that consumes those forked functions so the hot dashboard path works in postgres mode.

---

## Goal

Make the **hot dashboard read path** of `server.js` `await` the now-async forked reports.db functions,
and fix the in-memory raw-request cache so it sources rows through the forked reader (not the raw
sqlite handle). After this, the Helpdesk/Analytics dashboard + the `/api/metrics`, `/api/data`,
`/api/sync/status`, and raw-data routes work when `REPORTS_BACKEND=postgres`.

**Why this is safe in sqlite mode:** every forked fn returns synchronously on sqlite; `await` on a
non-Promise is a no-op that yields the value unchanged. So adding `await` (and making handlers
`async`) is behaviour-preserving for the default backend — only the pg path changes.

4D-wiring is **split in two** (user decision): **4D-wiring-1 (this)** = the hot dashboard path;
**4D-wiring-2** = the PPTX/report routes + `/api/reports/*` config routes. After both + **4B-RR** +
a KPI reconciliation, the `REPORTS_BACKEND=postgres` prod flip is unblocked.

## Scope

### 1. THREE new forked readers + raw-handle rewires (the FUNCTIONAL changes)

Three hot-path code paths read the **raw sqlite handle** (`require('./reports-db').db.prepare(...)`)
directly. In pg mode `db` is the (empty) sqlite handle → these serve empty/wrong data. Each gets a
new forked reader in `reports-db.js` (standard `if (REPORTS_BACKEND==='postgres') return _fnPg(...)`
dispatch; pg fork queries `pgHandle()`); the server route/path then `await`s it.

**1a. `getRequestRecordsSince(cutoffISO)` — the `_rawCache` rebuild.**
`_rebuildCacheFromSQLite()` (server.js ~3177, already `async`) rebuilds the in-memory `_rawCache`
(feeds `/api/data/requests-raw` → main Helpdesk dashboard) via
`rdb.prepare('SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC').all(cutoffISO)`.
- New reader: `SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC`.
  Raw-ISO cutoff on TEXT `created_time` → UNCHANGED (lexical, same rule as `getMajorIncidentsHistory`).
  Returns raw rows (same `request_id`/`display_id`/… column names the existing row-map reads → map
  UNCHANGED). Unpaginated + ASC — distinct from the existing paginated `getRequestRecords({limit,
  offset,…})` (DESC + LIMIT/OFFSET).
- Rewire: replace the inline `rdb.prepare(...).all(...)` with
  `await require('./reports-db').getRequestRecordsSince(cutoff.toISOString())`.

**1b. `getSurveyKpisDB({yr, mo, groups})` — `/api/survey/kpis` (server.js ~1469, NOT async).**
Runs two raw-handle queries: (q1) KPI totals `SELECT sr.overall_score FROM survey_results sr LEFT JOIN
request_records rr ON sr.request_id = rr.request_id WHERE sr.overall_score IS NOT NULL [AND
strftime('%Y-%m'|'%Y', COALESCE(sr.survey_responded_on, sr.survey_sent_on)) = ?] [AND rr.tech_group
IN (…)]`; (q2) 12-mo trend `… WHERE sr.overall_score IS NOT NULL AND COALESCE(sr.survey_responded_on,
sr.survey_sent_on) >= ? [AND rr.tech_group IN (…)]`.
- Dialect: **strftime → to_char** — `strftime('%Y-%m', COALESCE(...)) = ?` →
  `to_char(COALESCE(...)::timestamptz,'YYYY-MM') = ?`, `strftime('%Y', ...) = ?` →
  `to_char(...::timestamptz,'YYYY') = ?`. The q2 `COALESCE(...) >= ?` cutoff is a lexical TEXT compare
  → UNCHANGED. (q1's COALESCE inside `to_char` is guarded by the `WHERE sr.overall_score IS NOT NULL`
  + the equality — but to be safe against an all-NULL coalesce that wouldn't match a real
  'YYYY-MM' anyway, a direct `::timestamptz` cast is acceptable; the equality filter never matches a
  NULL. Use NULLIF only if the reviewer flags malformed-date risk.) LEFT JOIN valid. The reader
  returns the two row-sets (q1 scores, q2 score+responded_on); the route's JS assembly
  (`scoreSum`/`promoters`/byMonth via `.substring(0,7)` + `getSyncStatus`) stays in the handler, OR
  fold the whole assembly into the reader returning the final object — **prefer the reader returns
  the two raw row arrays** so the handler keeps its existing JS (minimizes churn). The `as_of` line
  (`getSyncStatus()`) is awaited separately in the handler.
- Rewire: make the handler `async`; `const { rows1, rows2 } = await rdb.getSurveyKpisDB({yr, mo,
  groups: groupList})`; reuse the existing JS reductions.

**1c. `getSubmissionChannelsDB({yr, mo, site, groups})` — `/api/data/submission-channels` (~3347, NOT async).**
One raw-handle query: `SELECT CASE WHEN mode IS NULL OR mode='' OR lower(mode)='unknown' THEN NULL
ELSE mode END AS channel, COUNT(*) AS cnt FROM request_records WHERE 1=1 [AND strftime('%Y-%m'|'%Y',
created_time)=?] [AND site=?] [AND tech_group IN (…)] GROUP BY channel ORDER BY cnt DESC`.
- Dialect: **strftime → to_char** (`created_time::timestamptz`). `GROUP BY channel` — alias `channel`
  ≠ the `mode` column it transforms → **no shadowing**, safe in pg (unlike 4D-2a's `category AS
  category`). `ORDER BY cnt DESC` bare alias — fine. `lower(mode)` unchanged.
- Rewire: make the handler `async`; `const rows = await rdb.getSubmissionChannelsDB({yr, mo, site,
  groups: groupList})`; the JS `total`/`knownRows` assembly stays in the handler.

### 2. Boot-time await

Two fire-and-forget pre-warm calls invoke `_rebuildCacheFromSQLite()` without awaiting (server.js
~6418 in the `app.listen` callback, and ~627 in a startup `setTimeout`). Make their callbacks
`async` and `await _rebuildCacheFromSQLite()` (keeping the existing `.catch`/try). Low-risk: in
sqlite mode the rebuild is effectively synchronous; in pg mode the await ensures the cache is built
(and errors surface) before dependent work. The cron-scheduled refreshes that call the **Zoho** path
(`_backgroundRefreshRawCache`) are out of scope (not a forked-fn call).

### 3. Hot-path route awaits

Add `await` to every forked-fn call in these routes; make the handler `async` where it isn't already.
(All are behaviour-identical in sqlite mode.)

> **Placement note:** every `/api/data/*` handler wraps the forked call in an INNER
> `try{…}catch(e){console.warn(...)}` that falls back to the Zoho path. The `await` MUST go INSIDE
> that inner try (`dbRows = await rdb2.fn()`); without `await`, the Promise silently fails the
> `.length>0` check and routes to the (now usually empty) fallback instead of throwing. Same care for
> the survey routes.

- **`/api/survey/summary` + `/api/survey/by-dimension` — handlers ALREADY async, just add `await`**
  (2 routes, browser Customer-Voice cards): `summary` (~1398, `getCustomerVoiceDB(12)`),
  `by-dimension` (~1649, `getCustomerVoiceByDimensionDB()`). Currently unawaited → in pg mode the
  Promise fails the `>0` truthiness check and silently serves the empty/Zoho-fallback path.
- **`/api/data/*` — handlers ALREADY async, just add `await`** (14 routes): `major-incidents`
  (`getMajorIncidentsHistory`), `change-table` (`getChangeRecordsHistory`), `first-response`
  (`getFirstResponseTrendDB`), `sla-trend` (`getSlaTrendDB`), `sla-by-category` (`getSlaByCategoryDB`),
  `group-requests` (`getGroupRequestsDB`), `emergency-changes` (`getEmergencyChangesDB`), `ageing`
  (`getAgeingSummaryDB`), `incident-vs-sr` (`getIncidentVsSrDB`), `cab-approvals` (`getCabApprovalsDB`),
  `cab-recommendations` (`getCabRecommendationsDB`), `monthly-summary` (`getMonthlyHelpdeskHistory`),
  `ageing-by-site` (`getAgeingBySiteDB`), `ageing-by-group` (`getAgeingByGroupDB`). (`requests-raw`
  already awaits `getRawRequestRows` → fixed transitively by §1.)
- **`/api/metrics/*` — make async + await** (5 routes): `change` (`getChangeMetrics` + `getSyncStatus`),
  `cab` (`getCABMetrics` + `getSyncStatus`), `survey` (`getSurveyMetrics` + `getSyncStatus`), `requests`
  (`getRequestMetrics` + `getSyncStatus`), `request-filter-options` (`getRequestFilterOptions`).
- **`/api/sync/status` — make async + await** `getSyncStatus`.
- **Raw-data routes — make async + await** (5): `/api/change` (`getChangeRecords` + `getSyncStatus`),
  `/api/cab` (`getCABApprovals` + `getSyncStatus`), `/api/survey` (`getSurveyResults` + `getSyncStatus`),
  `/api/survey/:response_id/answers` (`getSurveyAnswers` + `getSyncStatus`), `/api/requests`
  (`getRequestRecords` + `getSyncStatus`).

### 4. Test enabler (export app + guard start)

`server.js` calls `start()` unconditionally at the bottom (~6425), so `require('../server')` would
bind a port + run boot pre-warm. To allow an in-process route smoke:
- Add `module.exports = { app };` (after `app` is fully configured — i.e. near the bottom, after all
  routes are registered).
- Guard the bottom call: `if (require.main === module) start();` (prod/pm2 run server.js as the main
  module → unchanged; a test `require`ing it skips `start()`).

**Out of scope:** the PPTX/report routes (`/api/reports/monthly|weekly|yearly…`), the `/api/reports/*`
config routes (sites/departments/groupPresets), `/api/sync/trigger/:job` (already chains via the
`sync.*` module, not a direct forked-fn call) → all 4D-wiring-2. The `_backgroundRefreshRawCache`
Zoho path. Any writer/reconciler route (those live under the sync module).

## Dialect / correctness rules

- The only SQL is `getRequestRecordsSince` — a raw-ISO cutoff on a TEXT column → **UNCHANGED** (no
  cast), same as the established raw-ISO-cutoff rule. `SELECT *` returns all columns; the pg fork
  queries `pgHandle()`, the sqlite body uses `db`.
- `await` additions are purely mechanical and behaviour-preserving on sqlite. No KPI math changes.
- `getSyncStatus` is already forked (4D-1); these routes just need to await it.

## Sync-dispatch invariant

`getRequestRecordsSince` returns synchronously on sqlite, a Promise on pg (first-line dispatch).
Server handlers become `async` and `await`; in sqlite mode the awaited value is the sync result.

## Testing (TDD)

1. **Reader TDD (pg harness):** add tests for the THREE new forked readers to
   `tests/pg-reports-aggregates.test.js` (shares `boot()` + `_req()` + `_sres()` + the writers):
   - `getRequestRecordsSince(cutoffISO)` — seed `request_records` across the cutoff boundary; assert
     the pg fork returns the in-window rows in ASC `created_time` order with raw column names.
   - `getSurveyKpisDB({yr, mo, groups})` — seed survey_results (+ a joined request for the group
     filter); assert the period (`to_char`) + group filters + the two row-sets (scores, trend
     score+responded_on).
   - `getSubmissionChannelsDB({yr, mo, site, groups})` — seed request_records with varied `mode`;
     assert the `to_char` period filter + `GROUP BY channel` collapse (NULL/''/'unknown' → the NULL
     channel) + counts.
   Plus sqlite synchronous-return assertions (each reader not `instanceof Promise` on sqlite).
2. **sqlite route smoke (NEW harness `tests/server-routes-smoke.test.js`):** **auth is two-layered** —
   the global `/api/` gate (server.js ~957) accepts an `X-Dash-Key` header matching the
   **`DASHBOARD_API_KEY`** env var (server.js:43, read at module-eval), BUT every hot-path route also
   has `requireReportSession`, which ignores the dash-key and needs a valid `x-report-token` resolving
   via `rdb.validateSession`. So the harness MUST: (a) set `process.env.DASHBOARD_API_KEY` +
   `SDP_DATA_DIR`=temp + `DASH_USER`/`DASH_PASS` **before** `require('../server')` (no `REPORTS_BACKEND`
   → sqlite default); (b) `require('../server')` (start() now guarded → no port bind, no boot pre-warm);
   (c) `const token = (await rdb.login(DASH_USER, DASH_PASS)).token` (the default admin is seeded at
   reports-db init from DASH_USER/PASS); (d) `http.createServer(app).listen(0)`; (e) fire requests with
   BOTH headers `{'X-Dash-Key': DASHBOARD_API_KEY, 'x-report-token': token}` against ~6 representative
   hot-path routes — a `/api/data/*` (e.g. `sla-trend`), a `/api/metrics/*` (e.g. `requests`),
   `/api/sync/status`, `/api/requests`, `/api/data/requests-raw`, `/api/data/submission-channels` —
   assert HTTP 200 + a sane JSON shape (array / object with expected keys). Proves the async conversion
   didn't break the live sqlite path. Run with `--test-force-exit` (cron/interval timers keep the loop
   alive). Skip nothing — sqlite mode always available. (Confirm the exact header name `requireReportSession`
   reads — `x-report-token` — and `rdb.login`'s return shape during implementation.)
3. **sqlite regression:** existing reports.db pg + DB-layer suites stay green; `node --check server.js`
   + `node --check reports-db.js` clean.

A full **pg-mode** server boot is deferred to the final KPI-reconciliation step (per the test-strategy
decision).

## Success criteria

- 3 new forked readers (`getRequestRecordsSince`, `getSurveyKpisDB`, `getSubmissionChannelsDB`) pg
  tests green; sqlite synchronous-return holds for each.
- New `tests/server-routes-smoke.test.js` green (≥6 hot-path routes 200 in sqlite mode, with proper
  `X-Dash-Key` + `x-report-token` auth).
- `_rebuildCacheFromSQLite` + `/api/survey/kpis` + `/api/data/submission-channels` source rows via the
  forked readers (work in pg mode); boot pre-warm awaits.
- All hot-path routes (14 `/api/data/*` + 5 `/api/metrics/*` + `/api/sync/status` + 5 raw-data + 2
  survey + the 2 rewired raw-handle routes) await their forked calls; handlers async; `node --check`
  clean; modules load.
- sqlite default-backend behaviour unchanged (the dashboard renders identically). Nothing deployed;
  `REPORTS_BACKEND` defaults to `sqlite`.
