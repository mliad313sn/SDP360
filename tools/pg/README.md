# PostgreSQL migration — Chunk 1 (tracker.db) — dev/test harness

This folder holds the dev-only tooling for migrating the **Activity Tracker**
module (`tracker.db`) onto PostgreSQL behind a reversible flag. **Prod stays on
SQLite** (`TRACKER_BACKEND=sqlite`, the default) for this chunk — nothing here
is deployed by `_deploy.cmd`.

The reusable async adapter is `services/pgDb.js` (better-sqlite3-shaped:
`prepare(sql).get/all/run`, `exec`, `runTransaction`). Later chunks
(meetings / inspection / reports.db) copy this same adapter + recipe.

## Dev Postgres (Docker)

```cmd
tools\pg\dev-up.cmd          :: starts container `sdp-pg` (postgres:16) on localhost:5433
docker exec sdp-pg pg_isready -U postgres
```

Container creds (dev/test ONLY — never prod, never `fmp_v2`):
`db=sdp_dashboard user=postgres pass=devpass port=5433`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `TRACKER_BACKEND` | `sqlite` | `sqlite` (today's better-sqlite3 path, unchanged) or `postgres` (the `pgDb` path). |
| `PG_URL` / `DATABASE_URL` | — | Postgres connection string used when `TRACKER_BACKEND=postgres`. |
| `PG_POOL_MAX` | `10` | `pg.Pool` max connections. |
| `PG_ADMIN_URL` | `postgres://postgres:devpass@localhost:5433/postgres` | **Tests only** — maintenance DB used to CREATE/DROP a throwaway per-run test database. |

## Running the tests

```bash
# Foundation only (no DB needed — DB-backed tests skip cleanly):
node --test tests/pg-tracker.test.js

# Full parity suite (needs the dev container up):
tools/pg/dev-up.cmd
node --test --test-force-exit tests/pg-tracker.test.js
```

Tests provision an isolated `sdp_tracker_test_<rand>` database per run via
`PG_ADMIN_URL` and drop it afterwards — they never touch a shared DB.

## Data copy (one-shot)

```bash
node tools/pg/copy-tracker.js     # tracker.db -> Postgres (idempotent upsert, applies 001_init.sql first)
```

Schema: `db/postgres/tracker/001_init.sql` (legacy + per-year v2 tables;
type-preserving — `*_json` TEXT, `active` INTEGER, `target` TEXT; FK ON DELETE
CASCADE for `deleteTrackerYear`).

---

## reports.db — Sub-chunk A (auth/sessions) — `agent/pg-reports-auth` / `feat/pg-reports-auth`

DB layer DONE + green (`tests/pg-reports-auth.test.js`, 8 tests). Behind
`REPORTS_BACKEND=sqlite|postgres` (default `sqlite`; **prod stays sqlite** until the
whole reports.db (A+B+C+D) is cut over + KPI-reconciled — all-or-nothing flip).

- Schema: `db/postgres/reports/001_auth.sql` (sites→users→user_roles→sessions, real FKs
  incl. `sessions.user_id`/`user_roles.user_id` ON DELETE CASCADE, `users.site_id`→sites).
- Forked (async) in `reports-db.js`: `login`, `validateSession` (60s `last_seen` throttle,
  preloads `.roles`), `getUserRoles`, `logout`, `listActiveSessions`, `forceLogoutByToken`,
  `listUsers`, `createUser`, `changePassword`, `updateUser`, `deleteUser`, `setUserRoles`.
  `initPgReports()`/`pgHandle()` + `REPORTS_BACKEND` exported. **NOT forked** (stay sqlite):
  `userHasRole` (reads preloaded `.roles`), `listSites`/`createSite`/`updateSite` (sub-chunk B).
- Copy: `tools/pg/copy-reports-auth.js` (sites→users→user_roles→sessions, FK order, seq advance).
- Env: `REPORTS_BACKEND`, `PG_URL`/`DATABASE_URL`.

**Test gotcha:** `reports-db.js` opens its sqlite DB + seeds a default admin at module-load,
FATALing without `DASH_USER`/`DASH_PASS`. The test header sets `SDP_DATA_DIR` (throwaway
sqlite) **and** dummy `DASH_USER`/`DASH_PASS` before requiring it. Run:
`PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-auth.test.js`.

**DEFERRED — Task 7 (server.js wiring), done in the coordinated merge pass:** make the 2 auth
middlewares + ~9 `/api/reports/*` route handlers + `/api/health/views` `async`+`await`; adapt
the UNIQUE-violation matcher (`server.js:4112`) for pg (`e.code==='23505'`/`duplicate key`);
convert the cross-module `listUsers→listPeople` path (`inspection-db.js:listPeople` +
`/api/inspection/people` + `/api/meetings/people`); add the boot hook + the route-level
pg-mode test #10. Deferred because it edits `server.js`/`routes/inspection.js` — the same
files Chunks 2/3 touch — so all chunks' wiring is merged together to avoid 3-way conflicts.

> _Status update_: sub-chunk A's server.js wiring (auth middleware + routes + boot hook +
> listPeople ripple + 23505 matcher) **landed** in the coordinated merge pass on `main`
> (commit `a1caa1f`), alongside Chunks 2/3. The reports.db flip is still all-or-nothing
> (prod stays sqlite until B+C+D land + KPI-reconcile).

---

## reports.db — Sub-chunk B (config/sites) — `feat/pg-reports-config`

DB layer DONE + green (`tests/pg-reports-config.test.js`, 6 tests). Same
`REPORTS_BACKEND=sqlite|postgres` flag (default `sqlite`).

- Schema: `db/postgres/reports/002_config.sql` — `action_departments`, `audit_log`,
  `dashboard_preset_groups` (INTEGER IDENTITY to match 001; `lower(name)` unique index =
  sqlite `UNIQUE COLLATE NOCASE`; `details`/JSON kept TEXT). **`sites` is NOT here** — it
  already exists in `001_auth.sql` (users.site_id FK) and is copied by `copy-reports-auth`;
  4B's sites functions operate on that same table, closing the auth-vs-sites split-brain.
- Forked in `reports-db.js`: `listSites`, `updateSiteGroup`, `createSite`, `updateSite`,
  `setSiteActive`, `listDepartments`, `createDepartment`, `updateDepartment`,
  `setDepartmentActive`, `logAudit`, `getReportAuditLog`. `initPgReports` now also applies
  `002_config.sql` + seeds depts + preset-groups (`_seedConfigPg`).
- Forked in `services/groupPresets.js`: `getPresets`, `setPresets`, `getDiscovered`,
  `getPresetsWithDiscovered`, `_initSchema` — via `_h(db)` which lazily `require('../reports-db')`
  and uses `pgHandle()` when `REPORTS_BACKEND==='postgres'` (no cycle; reports-db doesn't
  require groupPresets). **Sync dispatch:** the sqlite path returns synchronously (default
  callers unchanged), only the pg branch returns a Promise.
- **`getDiscovered` degrades to `[]`** in pg mode until the hot tables
  (`request_records`/`change_records`) land in Chunk 4D — its try/catch swallows the
  missing-relation error. Explicitly-classified presets are unaffected.
- Copy: `tools/pg/copy-reports-config.js` (action_departments + audit_log +
  dashboard_preset_groups; idempotent upsert; seq advance via `COALESCE(MAX(id),0)`).
- **`rr_site_aliases` is NOT in 4B** — it's owned by `risk-register-export.js` (its own
  reports.db handle); deferred to its own "4B-RR" mini-chunk.

**DEFERRED (coordinated wiring pass):** the `/api/reports/sites`, `/api/reports/departments`,
and group-preset route handlers in server.js need `async`+`await` once the branch merges;
+ merge `feat/pg-reports-config` to main. Sites/dept routes currently call these sync (fine
on sqlite default).

---

## reports.db — Sub-chunk C (report-CRUD + KPI storage) — `feat/pg-reports-reports`

DB layer DONE + green (`tests/pg-reports-reports.test.js`, 6 tests). Same
`REPORTS_BACKEND=sqlite|postgres` flag (default `sqlite`).

- Schema: `db/postgres/reports/003_reports.sql` — 10 tables (`weeks`, `weekly_reports`,
  `infra_kpis`, `helpdesk_data`, `lights`, `action_items`, `monthly_reports`,
  `annual_objectives`, `site_module_codes`, `infra_kpi_catalog`). INTEGER IDENTITY;
  `REAL`→`double precision`; JSON blobs→TEXT; includes ALTER-added cols
  (`weekly_reports.created_by`, `action_items.department`/`comment`). `sites` reused from 001.
- Forked in `reports-db.js` (~22 fns): `ensureWeek`, `ensureReport`, `getReport`,
  `listReports`, `updateReportStatus`, `touchReport`, `getWeekSummaryData`, `saveInfraKpis`,
  `saveHelpdeskData`, `saveLights`, `saveActionItems`, `getActionsForReport`,
  `getLightsForReport`, `getPreviousWeekOpenActions`, `getPreviousWeekInfraKpis`,
  `listAllWeeksWithActions`, `listAllWeeksWithLights`, `deleteReport`, `getMonthlyReport`,
  `getMonthlyEdits`, `saveMonthlyEdits`, `getAnnualObjectives`, `saveAnnualObjectives`.
  `initPgReports` now also applies `003_reports.sql` + runs `_seedReportsCatalogsPg`
  (site_module_codes + infra_kpi_catalog backfills — data-dependent, no-op on a fresh DB).
- **tx-convert:** the module-level `const x = db.transaction(...)` helpers (saveInfraKpis,
  saveLights, saveActionItems, saveAnnualObjectives, deleteReport) became dispatching
  `function x()` + a renamed `const _xSqlite = db.transaction(...)` (sqlite tx preserved) +
  an async `_xPg` using `runTransaction`.
- **PURE (not forked):** `getISOWeek`, `getWeekRange`, `getPreviousWeek` (date math, no DB) —
  called by the pg branches synchronously.
- `saveHelpdeskData`'s `ON CONFLICT(report_id) DO UPDATE` is a FULL-column replace (no
  COALESCE) — identical to sqlite; partial saves NULL unset columns (tested).
- Copy: `tools/pg/copy-reports-reports.js` (10 tables, FK order, 9 IDENTITY seqs advanced;
  `sites` pre-seeded by copy-reports-auth in a real cutover).

**DEFERRED (coordinated wiring pass):** `/api/reports/:id`, the report save endpoints, and
the weekly/monthly PPTX routes in server.js need `async`+`await`; + merge to main.
`getMonthlyData` + all hot-path aggregates + Zoho sync stay in **Chunk 4D** (the last one).

---

## reports.db — Sub-chunk 4D-1 (hot-path LOAD layer) — `feat/pg-reports-hot`

DB layer DONE + green (`tests/pg-reports-hot.test.js`, 4 tests). Same `REPORTS_BACKEND` flag.
**4D is split:** 4D-1 = load path (this); **4D-2 = the ~35 KPI aggregate readers** (still TODO).

- Schema: `db/postgres/reports/004_hot.sql` — 6 tables (`request_records`, `change_records`,
  `cab_approvals`, `survey_results`, `survey_answers`, `sync_metadata`). INTEGER IDENTITY;
  `time_elapsed_ms` BIGINT; `overall_score` double precision; UNIQUE on Zoho-id cols; no FKs
  between hot tables. Includes ALTER cols `change_records.{group_name,stage_status}`,
  `request_records.{request_type,mode,impact,udf_json}`, `sync_metadata.{last_full_sync_at,
  schema_snapshot,deleted_count}`.
- Forked in `reports-db.js`: 6 writers (`upsertRequestBatch`/`upsertRequestUdfBatch`/
  `upsertChangeBatch`/`upsertCABBatch`/`upsertSurveyResultBatch`/`upsertSurveyAnswerBatch`),
  4 reconcilers, 4 sync-meta (`getSyncStatus`/`getLastSyncAt`/`markSyncSuccess`/`markSyncError`),
  5 raw readers (`getRequestRecords`/`getChangeRecords`/`getCABApprovals`/`getSurveyResults`/
  `getSurveyAnswers`). `initPgReports` applies `004_hot.sql` + seeds the 4 sync-job rows.
- **tx-convert** for the writers (`const x = db.transaction(...)` → dispatching `function x()`
  + `_xSqlite` + async `_xPg` with inline pg SQL). Gotchas captured: `survey_answers` is
  append-only (bare `ON CONFLICT DO NOTHING`, no unique target); `upsertRequestBatch` does NOT
  write `udf_json` (only `upsertRequestUdfBatch` does, via 2-step UPDATE by request_id then
  display_id); `markSyncSuccess` qualifies every DO-UPDATE existing-row ref with the table name
  (`sync_metadata.sync_count + 1`, …) — pg requires it; `reconcileSurveyResults` cascades to
  `survey_answers`. The auto-appended `RETURNING *` on `ON CONFLICT` inserts is harmless (count via `.changes`).
- Copy: `tools/pg/copy-reports-hot.js` (6 tables, paged SELECT @5000 rows for big tables, 5
  IDENTITY seqs advanced; survey_answers/sync_metadata copied by their own PK).

## reports.db — Sub-chunk 4D-2a (request monthly KPIs + assembler) — `feat/pg-reports-agg-request`

First of four 4D-2 sub-chunks (the KPI-aggregate / denominator-doctrine half of the hot path).
DB layer DONE + green (`tests/pg-reports-aggregates.test.js`, 6 tests — the shared 4D-2 suite,
accretes across 4D-2a–d). Same `REPORTS_BACKEND` flag. **No schema, no copy script** — 4D-1 owns
the tables; 4D-2a is pure read-fork + tests.

- **11 read fns forked** in `reports-db.js`: `getCalendarMonthlyHelpdesk`, `getCalendarMonthlyTop10`,
  `getHelpdesk6MonthHistory`, `_aggregateHelpdesk6MoFromRaw`, `getMonthlyHelpdeskHistory`,
  `getMonthlyData` (assembler), `getYearlySummary` (12-mo assembler — calls getCalendarMonthlyHelpdesk,
  so it MUST be forked here), `getRequestMetrics`, `getRequestFilterOptions`,
  `getMajorIncidentsHistory`, `getActiveMajorIncidentsForSite`.
- **Dialect reconciliation contract** (preserves KPI math byte-for-byte): `date(x) >= ?` →
  `x::date >= ?::date`; `(julianday(a)-julianday(b))*24` (HOURS) → `EXTRACT(EPOCH FROM (a::timestamptz
  - b::timestamptz))/3600` (DAYS → `/86400`); `strftime('%Y-%m',x)` → `to_char(x::timestamptz,'YYYY-MM')`
  (both as GROUP BY bucket AND equality filter); `datetime(x)` in ORDER BY → `x::timestamptz`;
  `GROUP BY <output-alias>` → `GROUP BY 1` (pg can't GROUP BY a `COALESCE(NULLIF(...),'Uncategorised')`
  output alias — must repeat the expr or use the ordinal); `is_escalated` (INTEGER col) string
  filter → `is_escalated::text IN ('1','true')`; `ROUND(expr,n)` kept (in-scope cases resolve to
  numeric natively). **Raw ISO-string TEXT compares left UNCHANGED** — `getMajorIncidentsHistory`'s
  `created_time >= cutoff.toISOString()` is a lexical string compare on a TEXT col in BOTH engines;
  adding a `::date`/`::timestamptz` cast would change semantics.
- **Denominator doctrine preserved** (must NOT regress to `/total`): Resolution SLA % =
  closed-and-not-overdue / closed (`pending_status=0`); FRT % = responded-and-not-violated /
  responded (`responded_time` set); close % = closed / total.
- **Pure-JS row mappers extracted** so both engines share one transform (DRY, no divergence):
  `_mapMajorIncidentRows` (UDF unpack + priority-fallback chain + canonical P-Label + downtime),
  `_mapActiveMajorIncidentRows` (curated UDF subset + completeness/PIR heuristics). pg forks
  `await pgHandle().prepare(...).all(...)` then call the shared mapper.
- **pg forks use `pgHandle()`, never `db`** — `db` is always the sqlite Database; the live pg
  connection is `pgHandle()`. (A fork that queried `db.prepare` silently hit the empty sqlite file.)
- Tests exercise the denominators + duration math with hand-computed assertions (closed-only
  `sla_res_pct=round(2/3*100)=67`, responded-only `sla_reply_pct=round(3/4*100)=75`, EXTRACT-EPOCH
  `avg_tta_h=2`/`avg_resolution_d=1`, GROUP BY 1 NULL+'' category collapse to one Uncategorised,
  P-Label resolution). sqlite synchronous-return smoke confirms the default path stays sync.

## reports.db — Sub-chunk 4D-2b (request SLA / ageing / trend) — `feat/pg-reports-agg-sla`

Second of four 4D-2 sub-chunks. DB layer DONE + green (`tests/pg-reports-aggregates.test.js`, now 9
tests — the shared 4D-2 suite; 4D-2b added 3). Same `REPORTS_BACKEND` flag. **No schema, no copy
script** — 4D-1 owns the tables. All 8 fns read ONLY `request_records`.

- **8 read fns forked** in `reports-db.js`: `getAgeingBySiteDB`, `getAgeingByGroupDB`,
  `getAgeingSummaryDB`, `getSlaTrendDB`, `getSlaByCategoryDB`, `getFirstResponseTrendDB`,
  `getGroupRequestsDB`, `getIncidentVsSrDB`. Each reuses the 4D-2a dialect contract; pure-JS
  `.map`/pivot transforms extracted to shared helpers (`_mapAgeing{Site,Group,Summary}`,
  `_mapSlaTrend`, `_mapSlaByCategory`, `_mapFrtTrend`, `_mapIncidentVsSr`).
- **Two NEW divergences beyond 4D-2a's contract:**
  - **`HAVING` on an output alias** — sqlite allows `HAVING total > 0` / `>= 5`; **Postgres does
    NOT allow output aliases in HAVING** → repeat the aggregate: `HAVING COUNT(*) > 0` / `>= 5`
    (getAgeingBySiteDB / getAgeingByGroupDB / getSlaByCategoryDB).
  - **`ORDER BY` on an alias EXPRESSION** — sqlite allows `ORDER BY (d0_30 + d31_45 + d46_60 +
    d_over_60) DESC`; **Postgres allows a *bare* output alias in ORDER BY but NOT an expression
    built from aliases** → repeat the four `SUM(CASE …)` expressions (getAgeingSummaryDB only).
    Bare-alias ORDER BY (`total`, `yyyymm`, `cnt`, `violated_closed`) is fine as-is.
- **`CAST(... AS INTEGER)` rounds in PG, truncates in sqlite** — ageing buckets use
  `CAST((julianday('now') - julianday(created_time)) AS INTEGER)` (= days). sqlite truncates toward
  zero; pg `CAST(double AS integer)` ROUNDS half-to-even → a ticket on a bucket boundary shifts.
  Reproduce sqlite truncation with `TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) /
  86400)::integer` (TRUNC, not CAST).
- **`datetime('now','-12 months')`** (getSlaByCategoryDB) → typed `created_time::timestamptz >=
  now() - interval '12 months'`.
- **`GROUP BY` on a simple alias is SAFE in pg** — `yyyymm`/`grp`/`cat`/`site` don't shadow a
  transformed input column (unlike 4D-2a's `COALESCE(NULLIF(category,'')) AS category` → `GROUP BY 1`).
  Kept readable.
- **Mixed-case alias must be quoted in pg** — `SUM(...) AS tOver60` folds to `tover60` unquoted, so
  the shared mapper's `r.tOver60` reads undefined. Quote it: `AS "tOver60"` (getAgeingByGroupDB).
- **Denominator doctrine preserved** — getSlaTrendDB / getSlaByCategoryDB keep closed-only
  (`pending_status=0`) + responded-only (`responded_time` set) denominators verbatim.
- **`getSlaByCategoryDB` shape quirk preserved** — `'% of SLA Violated'` is a STRING `pct+'%'`
  (consumer calls `.replace('%','')`), NOT a number.
- **raw ISO cutoff** (the 4 trend fns bind `cutoff.toISOString()` against `created_time >= ?`) left
  UNCHANGED (lexical TEXT compare, same as 4D-2a). pg forks query `pgHandle()`, never `db`.
- Tests exercise mid-bucket ageing seeds (robust to wall-clock skew), the ORDER-BY repeated-SUM
  sort, closed-only/responded-only SLA% (whole-month aggregate → 71.4 / 25), the `>= 5` HAVING drop,
  and the EXTRACT-EPOCH FRT/RT trend. sqlite synchronous-return smoke covers all 8.

## reports.db — Sub-chunk 4D-2c (change / CAB) — `feat/pg-reports-agg-change`

Third of four 4D-2 sub-chunks — first to read the non-request hot tables (`change_records`,
`cab_approvals`). DB layer DONE + green (`tests/pg-reports-aggregates.test.js`, now 11; 4D-2c added 2).
Same `REPORTS_BACKEND` flag. **No schema, no copy script** — 4D-1 owns the tables.

- **7 read fns forked** in `reports-db.js`: `getEmergencyChangesDB`, `getCabApprovalsDB`,
  `getCabRecommendationsDB`, `getChangeRecordsHistory`, `getChangeMetrics`, `getCABMetrics`,
  `getOpenChangesForSite`. Multi-query metric bundles use shared `_assemble{Change,CAB}Metrics`
  helpers; list/history maps extracted to `_map{EmergencyChanges,CabApprovals,CabRecommendations,
  ChangeRecordsHistory}`.
- **THREE new dialect hazards beyond 4D-2a/b:**
  - **INTEGER column vs TEXT literal** — `change_records.emergency` is `INTEGER`; sqlite's
    `emergency=1 OR emergency='true' OR emergency='1'` errors in PG → `emergency::text IN ('1','true')`
    (the `is_escalated::text` pattern from 4D-2a).
  - **`ROUND(AVG(<double>), 1)` needs `::numeric`** — PG has no `round(double precision, integer)`.
    The julianday-day-diff path `ROUND(AVG(JULIANDAY(a)-JULIANDAY(b)),1)` →
    `ROUND(AVG(EXTRACT(EPOCH FROM (NULLIF(a,'')::timestamptz - NULLIF(b,'')::timestamptz))/86400)::numeric, 1)`.
    But `ROUND(AVG(turnaround_minutes),1)` stays as-is (INTEGER → AVG = numeric).
  - **TEXT temporal column vs `datetime('now')`** — `scheduled_start <= datetime('now')` →
    `NULLIF(scheduled_start,'')::timestamptz <= now()` (NULLIF guards the `''::timestamptz` cast error).
- **getChangeRecordsHistory awaits TWO queries** (the `sites` group→site lookup + the `change_records`
  scan). `||` concat, `LEFT JOIN`, `NULLS LAST`, `IN(…)`, `GROUP BY <real col>`, bare-alias
  `ORDER BY count DESC`, dynamic `${where}` with `?`→`$N` per-statement — all unchanged. raw-ISO
  cutoff bounds (`created_time >= ?`, `recommendation_requested >= ?`) UNCHANGED.
- **Bundled crash-fix:** `getCabApprovalsDB` / `getCabRecommendationsDB` `SELECT c.site` — a
  **non-existent column** (`change_records` has `site_id`, not `site`), so both threw
  `no such column: c.site` on EVERY call (broken in prod). Dropped `c.site` in BOTH the sqlite body
  AND the pg fork → `'Site'` maps to `''`. Strictly corrective (a guaranteed crash → a working call),
  sqlite≡pg. (Separately, `getEmergencyChangesDB`'s `r.change_status`/`r.planned_start_time`/`r.site`
  non-existent-column *reads* under `SELECT *` are harmless `undefined`/`null` — left untouched; a
  separate task fixes the `change_status` one.)
- Tests: getChangeMetrics (emergency=1 / Failed+Backout / Close-Completed-excluded in-progress /
  2-and-4-day avg → 3.0), getCABMetrics (DISTINCT compliance 1/2 → 50, AVG(30,50)=40 no-cast), and
  the list/history/join/open-changes filters incl. group→site derivation + udf_json unpack. sqlite
  synchronous-return smoke covers all 7.

## reports.db — Sub-chunk 4D-2d (survey / Customer-Voice) — `feat/pg-reports-agg-survey`

**Fourth and FINAL 4D-2 sub-chunk** — completes the entire KPI-aggregate half of the hot path.
DB layer DONE + green (`tests/pg-reports-aggregates.test.js`, now 13; 4D-2d added 2). Same
`REPORTS_BACKEND` flag. **No schema, no copy script** — 4D-1 owns the tables.

- **3 read fns forked** in `reports-db.js`: `getSurveyMetrics`, `getCustomerVoiceDB`,
  `getCustomerVoiceByDimensionDB`. All read `survey_results`; the last also LEFT JOINs
  `request_records` for tech/site/group dimensions. Multi-query bodies use shared assemblers
  `_assembleSurveyMetrics` / `_assembleCustomerVoice` / `_assembleCustomerVoiceByDimension`.
- **`to_char` direct-vs-NULLIF asymmetry** (the key reconciliation): `strftime('%Y-%m', x)` →
  `to_char(x::timestamptz,'YYYY-MM')`, BUT the cast guard differs by the query's own WHERE:
  - `getCustomerVoiceDB` monthlyRows buckets `COALESCE(survey_sent_on,survey_responded_on)` under
    `WHERE COALESCE(...) >= ?` → the WHERE self-guarantees a valid non-null timestamp in grouped
    rows → **direct `::timestamptz` cast, no NULLIF** (matches how 4D-2a/b cast `created_time` in
    `to_char`).
  - `getSurveyMetrics` monthly buckets `survey_sent_on` under `WHERE 1=1 [AND survey_sent_on>=?]` →
    when `since` is absent, NULL/'' rows survive → **`NULLIF(survey_sent_on,'')::timestamptz`**
    (sqlite `strftime('%Y-%m','')`→NULL; pg `''::timestamptz` errors).
- **`ROUND(AVG(<double>),1)` → `::numeric`** — `survey_results.overall_score` is `double precision`;
  PG has no `round(double,int)`. TWO such in `getSurveyMetrics` (top `avgScore` + monthly
  `avg_score`). **`getCustomerVoiceDB` has NONE** — every average is JS `Math.round` over a raw
  `AVG(overall_score)` (which flows back as a JS number via the adapter's float parser), so no cast.
- **raw ISO cutoff bounds UNCHANGED** (`COALESCE(...) >= ?`, `survey_sent_on >= ?`); `LEFT JOIN`,
  `COALESCE`, `SUM(CASE…)`, `GROUP BY <alias>`, bare-alias `ORDER BY month DESC`, dynamic `${where}`
  all unchanged. `getCustomerVoiceByDimensionDB` has NO SQL dialect rewrite (no strftime/julianday/
  datetime/ROUND) — all CSAT/NPS/dimension aggregation is engine-agnostic JS (`_acc`/`toArr`/
  `monthLbl` via `new Date()`), reused verbatim.
- Tests: getSurveyMetrics buckets + `ROUND(AVG::numeric)` + monthly to_char; getCustomerVoiceDB
  cross-month CSAT/NPS (the `tot` query has NO cutoff → 8 scored rows across 2 months → nps=13,
  csat=50, totalSent=10); the LEFT-JOIN dimension rollup (join 1/2, csatPct=100, closedCount).
  sqlite synchronous-return smoke covers all 3.

**4D-2 KPI-aggregate half COMPLETE** (4D-2a request KPIs · 4D-2b SLA/ageing/trend · 4D-2c change/CAB ·
4D-2d survey — 13 shared-suite tests; 37/37 reports.db pg).

## reports.db — Sub-chunk 4D-wiring-1 (server.js hot dashboard path) — `feat/pg-reports-wiring-1`

First of two wiring passes — the **HTTP-handler layer** that consumes the forked DB fns so the
Helpdesk/Analytics dashboard works in pg mode. (4D-wiring-2 = PPTX/report + `/api/reports/*` config
routes.) Behaviour-preserving in sqlite mode (`await` on a sync value is a no-op). Same `REPORTS_BACKEND`
flag.

- **3 new forked readers** in `reports-db.js` (replace raw-sqlite-handle reads that broke in pg mode):
  - `getRequestRecordsSince(cutoffISO)` — `SELECT * … WHERE created_time >= ? ORDER BY created_time ASC`
    (unpaginated; feeds `_rebuildCacheFromSQLite` → the `_rawCache` → `/api/data/requests-raw`). Raw-ISO
    cutoff UNCHANGED.
  - `getSurveyKpisDB({yr,mo,groups})` — `/api/survey/kpis`; two queries (period+group-filtered scores;
    12-mo trend) with `strftime → to_char`, the LEFT JOIN `sr.request_id=rr.request_id`, lexical q2
    cutoff UNCHANGED. Returns `{rows1, rows2}`; the route keeps its JS reductions.
  - `getSubmissionChannelsDB({yr,mo,site,groups})` — `/api/data/submission-channels`; `strftime → to_char`,
    `GROUP BY channel` (CASE-alias, no shadowing). **Also fixes a latent positional-param bug** in the
    route it replaces (WHERE order date/site/groups vs param order date/group/site) via a
    consistent-order shared WHERE builder.
- **~26 route awaits** (hot dashboard path): 14 `/api/data/*` (await INSIDE the inner `try`, `||[]`
  fallback preserved) + `/api/survey/summary` + `/api/survey/by-dimension` (already-async, +await);
  5 `/api/metrics/*` + `/api/sync/status` + 5 raw-data (`/api/change|cab|survey|survey-answers|requests`)
  made `async` + `await` (the `getSyncStatus().find(...)` precedence wrapped as
  `(await getSyncStatus()).find(...)`).
- **`_rebuildCacheFromSQLite` rewired** to `await getRequestRecordsSince(...)` (works in pg mode) +
  the two boot pre-warm `setTimeout` callbacks made `async`+`await`.
- **Test enabler:** `server.js` now exports `{ app }` and guards `start()` with
  `if (require.main === module)` so the new **`tests/server-routes-smoke.test.js`** mounts the app
  in-process (`http.createServer(app)`), authenticates (`X-Dash-Key` + `x-report-token` from
  `rdb.login`, seeded admin), and asserts 6 hot-path routes return 200 in sqlite mode. Run with
  `--test-force-exit`; harness sets dummy `ZOHO_*` (top-level REQUIRED_ENV presence check) + seeds a
  few `request_records` rows so DB routes don't hit the Zoho fallback. `tests/pg-reports-aggregates.test.js`
  +1 (the 3 readers). 38/38 reports.db pg green; sqlite sync smoke for all 3 readers.

**DEFERRED:** **4D-wiring-2** — the PPTX/report routes (`/api/reports/monthly|weekly|yearly…/pptx`,
`getMonthlyData`/`getWeekSummaryData`/`getOpenChangesForSite`/`getActiveMajorIncidentsForSite`) + the
`/api/reports/*` config routes (sites/departments/groupPresets — `listSites`/`updateSite`/etc.) + the
admin/sync raw-`db` handles (`/api/admin/refresh-major-incident-udfs`, the `rr.*(rdb.db)` /
`groupPresets.*(rdb.db)` passthroughs). **4B-RR** — `rr_site_aliases`. The
`REPORTS_BACKEND=postgres` prod flip needs 4D-wiring-2 + 4B-RR + a full KPI reconciliation.

## reports.db — Sub-chunk 4D-wiring-2 (server.js cold path) — `feat/pg-reports-wiring-2`

Second/final server.js wiring pass — the cold path (report builder, PPTX, config CRUD, presets).
Behaviour-preserving in sqlite (await-on-sync = no-op; `node --check` gates the one real risk).
Same `REPORTS_BACKEND` flag.

- **2 new forked helpers** (replace the report-path raw-`db`-handle sites):
  - `reassignReportWeek({reportId, siteId, newWeekId})` — `/api/reports/:id/reassign-week`; tx
    conflict-check + UPDATE, returns `{duplicateReportId}` (occupying report id, or null). `updated_at`
    is TIMESTAMPTZ → **`now()`** (matching `touchReport`/`updateReportStatus`), `datetime('now')` sqlite.
  - `requestRecordExists(requestId)` — `/api/admin/refresh-major-incident-udfs` diagnostic existence
    check (`SELECT 1 … LIMIT 1`, boolean).
- **~36 cold-path handlers** made `async` + **all forked `rdb.*` / `groupPresets.*` calls awaited**
  file-wide (report builder + PPTX + sites/departments CRUD + `/api/dashboard/presets`). Done with a
  per-fn sed sweep guarded by `node --check` + `grep "await await"` (0) + a "0 un-awaited remaining"
  grep. **Pure fns** (`getWeekRange`/`getISOWeek`/`getPreviousWeek`) intentionally NOT awaited.
- **2 helper ripples** made `async` + awaited at their callers: `validateActionItems` (calls
  `listDepartments`; awaited at `PUT /api/reports/:id/actions` + `POST .../edits`), `_userMeetingsSite`
  (calls `listSites`; awaited at 3 meetings routes — breaks under `REPORTS_BACKEND=postgres` regardless
  of `MEETINGS_BACKEND`). Also fixed `upsertRequestUdfBatch` (un-awaited → `dbUnmatched=NaN` under pg).
- **Tests:** `reassignReportWeek` in `tests/pg-reports-reports.test.js` (conflict→no-change /
  free-week→reassigned), `requestRecordExists` in `tests/pg-reports-aggregates.test.js`. Extended
  `tests/server-routes-smoke.test.js` with 4 cold-path routes (`/api/reports`, `/api/reports/sites`,
  `/api/reports/departments`, `/api/dashboard/presets`) → 10/10 in sqlite. golden-pptx green (shape
  unchanged). 40/40 reports.db pg; both helpers sync on sqlite.
- **Out of scope (flagged):** risk-register (`rr.*`, 4B-RR) + `/api/survey/voice` raw-`db` reads
  (~1874/1895 — Voice-of-Customer path, separate follow-up).

**4D-wiring COMPLETE** (hot path 4D-wiring-1 + cold path 4D-wiring-2). **The entire reports.db DB
layer + server.js consumer layer are now PostgreSQL-ready behind `REPORTS_BACKEND`.** Remaining before
the prod flip: **4B-RR** (`rr_site_aliases`) + the `/api/survey/voice` follow-up + a full **KPI
reconciliation** (sqlite-vs-pg numeric diff on real data) — no further DB/route forking.
