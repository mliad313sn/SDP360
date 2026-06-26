# Chunk 4D-2c — change / CAB breakdowns → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-agg-change` (off `main`)
**Depends on:** Chunks 4A/4B/4C/4D-1/4D-2a/4D-2b — all merged. 4D-1 landed `change_records` +
`cab_approvals` + the `upsert{Change,CAB}Batch` writers; 4D-2a/2b established the dialect-reconciliation
contract this chunk reuses. Reuse `services/pgDb.js`.

---

## Goal

Fork the **change-records + CAB aggregate/list readers** of reports.db to PostgreSQL behind
`REPORTS_BACKEND=postgres`. Third of four 4D-2 sub-chunks — the first to read the non-request hot
tables (`change_records`, `cab_approvals`). Default backend stays `sqlite`; no-op dispatch so prod
is unchanged.

4D-2 split: 4D-2a request monthly KPIs (DONE); 4D-2b request SLA/ageing/trend (DONE); **4D-2c (this)**
change/CAB; 4D-2d survey. The `REPORTS_BACKEND=postgres` prod flip needs ALL of 4A–4D-2d + a full KPI
reconciliation.

## Scope — 7 functions forked (all read-only)

`getEmergencyChangesDB`, `getCabApprovalsDB`, `getCabRecommendationsDB`, `getChangeRecordsHistory`,
`getChangeMetrics`, `getCABMetrics`, `getOpenChangesForSite`.

Source tables: `change_records` (5 fns) + `cab_approvals` (3 fns: cab-approvals/recommendations read
cab + LEFT JOIN change; CABMetrics reads cab only). **No schema, no copy script** — 4D-1 owns the
tables. 4D-2c is pure read-fork + tests.

**Out of scope:** 4D-2d (survey: `getSurveyMetrics`, `getCustomerVoiceDB`,
`getCustomerVoiceByDimensionDB`). server.js `/api/data/*` + `_rawCache` route `await` wiring →
coordinated pass.

## Dialect rules (reuse the 4D-2a/2b contract) + THREE new hazards

Same canonical rewrites as before (raw-ISO cutoff bounds UNCHANGED; `||` concat unchanged; `IN(…)`,
`COALESCE`, `LOWER`, `LIKE`, `NULLS LAST`, `LEFT JOIN`, bare-alias `ORDER BY count DESC`, `GROUP BY`
on a real column all work as-is in pg). New for 4D-2c:

- **INTEGER column compared to a TEXT literal** — `change_records.emergency` is `INTEGER DEFAULT 0`.
  sqlite's loose typing lets `emergency='true'` / `emergency='1'` compare; **Postgres errors**
  (`operator does not exist: integer = text` / `invalid input syntax for integer: "true"`). Rewrite
  the disjunction `emergency=1 OR emergency='true' OR emergency='1'` → `emergency::text IN ('1','true')`
  (the exact `is_escalated::text` pattern from 4D-2a). (getChangeMetrics emergency count.)
- **`ROUND(AVG(<double>), 1)` needs a `::numeric` cast** — sqlite `ROUND(real, 1)` is fine, but
  Postgres has no `round(double precision, integer)` — only `round(numeric, integer)`. Where the
  averaged expression is double-precision (the `EXTRACT(EPOCH …)/86400` julianday replacement), cast:
  `ROUND(AVG(EXTRACT(EPOCH FROM (a::timestamptz - b::timestamptz)) / 86400)::numeric, 1)`. **NOT
  needed** where the arg is already numeric: `ROUND(AVG(turnaround_minutes), 1)` — `turnaround_minutes`
  is `INTEGER`, `AVG(integer)` is `numeric`, so it stays as-is (getCABMetrics).
- **TEXT temporal column compared to `datetime('now')`** — `change_records.scheduled_start` is `TEXT`.
  sqlite `scheduled_start <= datetime('now')` is a value compare; in pg the column is TEXT and the
  intent is "scheduled start is in the past". Rewrite to a typed compare guarded against empty
  strings: `NULLIF(scheduled_start,'')::timestamptz <= now()`. The `NULLIF(x,'')` avoids the
  `''::timestamptz` cast error on blank rows (sqlite's `datetime('')`/comparison just yields no match;
  `NULLIF→NULL` makes `NULL <= now()` → NULL → row excluded, same effect). (getChangeMetrics inProgress.)
- **julianday day-diff (no CAST)** — `JULIANDAY(completed_time) - JULIANDAY(scheduled_start)` (DAYS)
  → `EXTRACT(EPOCH FROM (NULLIF(completed_time,'')::timestamptz - NULLIF(scheduled_start,'')::timestamptz)) / 86400`
  (feeds `AVG` then `ROUND(...::numeric,1)` per the rule above). The `NULLIF(x,'')` guards blank
  rows; the WHERE already filters `IS NOT NULL` + `status='Completed'`. (getChangeMetrics avg_completion_days.)

## Pre-existing crash bug bundled (getCabApprovalsDB / getCabRecommendationsDB)

Both CAB-join functions `SELECT … c.site AS site …` from `change_records c`, but **`change_records`
has no `site` column — only `site_id`** (verified against the live `data/reports.db`, the sqlite
test schema, and `004_hot.sql`). So **both functions throw `no such column: c.site` on EVERY call
today** — they have never returned a row; there is no output to "preserve". A PG fork that copied the
SQL verbatim would error identically (`column c.site does not exist`) and be untestable.

**Decision (bundled corrective fix):** drop `c.site AS site` from the SELECT in BOTH the sqlite body
AND the pg fork of BOTH functions. The JS map already does `'Site': r.site || ''`, so `'Site'`
becomes `''` — which matches the documented reality that the Zoho change view "ships Site as an empty
string" (see `getChangeRecordsHistory`'s comment). This is strictly corrective (a guaranteed crash →
a working call), keeps sqlite≡pg, and is the minimum change. It is NOT a behavioural regression
because the prior "behaviour" was an unconditional exception. Flagged in the commit message + README.
(This is a DIFFERENT bug from getEmergencyChangesDB's `r.change_status`/`r.planned_start_time`
non-existent-column *reads*, which are harmless under `SELECT *` and stay untouched.)

## Per-function notes

- **`getEmergencyChangesDB(monthsBack=12)`** — `SELECT * FROM change_records WHERE
  LOWER(COALESCE(change_type,'')) LIKE '%emergency%' AND created_time >= ? ORDER BY created_time DESC`.
  Raw ISO cutoff bound UNCHANGED. The JS map reads `r.planned_start_time` AND `r.change_status` —
  **both non-existent columns** (`change_records` has `scheduled_start`/`scheduled_end` not
  `planned_start_time`, and `status` not `change_status`), so `'Planned Start Time'` is `null` and
  `'Status'` is `undefined` in BOTH engines today. Pre-existing latent bug, faithfully preserved by
  `SELECT *` + reusing the JS map — **do NOT "fix" it in the fork** (would change output) and **do
  NOT assert on `'Status'`** in the test. pg fork awaits the query, reuses the JS map.
- **`getCabApprovalsDB(monthsBack=12)`** — `cab_approvals a LEFT JOIN change_records c ON
  c.change_id=a.change_id`, `WHERE a.recommendation_requested >= ? OR a.recommendation_requested IS
  NULL`, `ORDER BY a.recommendation_requested DESC NULLS LAST LIMIT 500`. Raw ISO bound UNCHANGED;
  `NULLS LAST` + `LEFT JOIN` valid in pg. **Drop the `c.site AS site` column from BOTH branches**
  (see "Pre-existing crash bug" above) → `'Site'` maps to `''`. pg fork awaits, reuses the JS map.
- **`getCabRecommendationsDB(monthsBack=12)`** — same join, `WHERE a.turnaround_minutes IS NOT NULL
  AND a.recommendation_requested >= ? ORDER BY a.recommendation_requested DESC LIMIT 500`. Raw ISO
  bound UNCHANGED. **Same `c.site` drop in BOTH branches.** pg fork awaits, reuses the JS map.
- **`getChangeRecordsHistory(monthsBack=12)`** — TWO queries: (1) `SELECT name, zoho_group FROM sites
  WHERE active = 1` (builds the group→site name map), (2) `SELECT * FROM change_records WHERE
  created_time >= ? ORDER BY created_time DESC` (raw ISO bound UNCHANGED). pg fork MUST `await` BOTH;
  the JS map (build `groupToSite`, derive `Site`, unpack `udf_json`) is reused via an extracted
  shared helper `_mapChangeRecordsHistory(rows, groupToSite)`. `cutoffISO` here is
  `new Date(yr, mo-12+1, 1).toISOString()` (same raw-TEXT pattern).
- **`getChangeMetrics({site_id, since})`** — the big multi-query bundle (~9 queries on `change_records`
  with a dynamic `WHERE 1=1 [AND site_id=?][AND created_time>=?]`). Rewrites: `since` bound UNCHANGED;
  **emergency** `emergency=1 OR emergency='true' OR emergency='1'` → `emergency::text IN ('1','true')`;
  **inProgress** `scheduled_start <= datetime('now')` → `NULLIF(scheduled_start,'')::timestamptz <=
  now()` (the `(stage || ' - ' || status) NOT IN (…)` concat is UNCHANGED — `||` works in pg);
  **avg_completion_days** `ROUND(AVG(JULIANDAY(completed_time)-JULIANDAY(scheduled_start)),1)` →
  `ROUND(AVG(EXTRACT(EPOCH FROM (NULLIF(completed_time,'')::timestamptz - NULLIF(scheduled_start,'')::timestamptz))/86400)::numeric, 1)`.
  `failedCount` (`status='Failed' OR (stage='Close' AND status='Backout')`), the `GROUP BY
  status/risk/change_type/site_id ORDER BY count DESC` breakdowns, and the assembled return object
  (ITSM `change_success_rate = completed/executed`, executed = completed+failed) are all preserved;
  the pg branch awaits each `.get`/`.all`. The percentage `.toFixed(1)` math stays pure JS.
- **`getCABMetrics({since})`** — dynamic `WHERE 1=1 [AND recommendation_requested>=?]` on
  `cab_approvals`. `since` bound UNCHANGED; `COUNT(DISTINCT change_id)`, `ROUND(AVG(turnaround_minutes),1)`
  (numeric arg — NO cast), `turnaround_minutes > 0`, `GROUP BY approval_status/rule_type/approval_stage
  ORDER BY count DESC` all unchanged; pg branch awaits each query. CAB-compliance % `.toFixed(1)` stays JS.
- **`getOpenChangesForSite(groups)`** — `SELECT … FROM change_records WHERE stage != 'Close' AND
  group_name IN (?,…) ORDER BY scheduled_end ASC, created_time DESC LIMIT 25`. No julianday/strftime/
  datetime/emergency-compare. Pure fork — pg branch awaits the single query; the empty-`groups` guard
  (`return []`) stays before the query in both branches. Returns raw rows (no JS map).

## Sync-dispatch invariant

Every forked fn returns synchronously on sqlite; only the pg branch is async. First statement
`if (REPORTS_BACKEND === 'postgres') return _fnPg(...)`. The two object-arg fns (`getChangeMetrics`,
`getCABMetrics`) destructure the same way in both branches. Verified with a sqlite synchronous-return
smoke (each of the 7 not `instanceof Promise`). Non-trivial `.map`s extracted to shared helpers where
they'd otherwise duplicate (`_mapChangeRecordsHistory`, `_mapCabApprovals`, `_mapCabRecommendations`,
`_mapEmergencyChanges`); short ones inline in both branches.

## Testing (TDD)

Extend `tests/pg-reports-aggregates.test.js`. Reuse `boot()` + `_req()`; add `_chg()` (a
change_records null-template) and `_cab()` (a cab_approvals null-template) builders, seeding via the
merged `upsertChangeBatch` / `upsertCABBatch` writers (4D-1). **Hand-computed assertions that exercise
the new hazards:**

1. **getChangeMetrics denominators + emergency::text + inProgress + avg** — seed change_records with
   known statuses (Completed ×N, Cancelled, Rejected, Failed, a `stage='Close' status='Backout'`),
   an `emergency=1` row, an in-progress row (`scheduled_start` in the past, stage/status not Close-
   Completed), and a Completed row with `scheduled_start`→`completed_time` a known number of days
   apart. Assert `total`, `completed_count`, `executed_count` (=completed+failed), `change_success_rate`
   (= round(completed/executed*100,1)), `emergency_count` (locks `emergency::text IN ('1','true')`),
   `in_progress_count` (locks the `NULLIF(scheduled_start,'')::timestamptz <= now()` rewrite),
   `avg_completion_days` (locks the EXTRACT-EPOCH/86400 + `::numeric` ROUND).
2. **getCABMetrics compliance + avg turnaround** — seed cab_approvals: 2 distinct change_ids, one
   fully Approved, one not; turnaround_minutes set on some. Assert `distinct_changes`,
   `changes_with_approval`, `cab_compliance_pct` (= round(approved/distinct*100,1)),
   `avg_turnaround_minutes` (numeric AVG, no cast).
3. **CAB approvals/recommendations join + emergency changes + open changes + change history** —
   seed a change + its cab rows; assert `getCabApprovalsDB` returns the joined `Subject`/`Site`,
   `getCabRecommendationsDB` only returns rows with `turnaround_minutes` set, `getEmergencyChangesDB`
   filters `LIKE '%emergency%'`, `getOpenChangesForSite([grp])` returns only `stage != 'Close'`
   rows for the group, and `getChangeRecordsHistory` derives the human `Site` from the group→site map
   (seed a `sites` row whose `zoho_group` matches the change's `group_name`) and unpacks a `udf_json` key.

sqlite path regression: existing sqlite + pg aggregate tests stay green; extend the synchronous-return
smoke to the 7 new fns.

## Success criteria

- `tests/pg-reports-aggregates.test.js` (4D-2c increments) green against local PG.
- `node --check` clean; modules load.
- sqlite default-backend behaviour unaffected (synchronous returns; existing decks/pages unchanged).
- Full reports.db pg regression stays green (4A 8 · 4B 6 · 4C 6 · 4D-1 4 · 4D-2a/b/c aggregates suite).
- Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
