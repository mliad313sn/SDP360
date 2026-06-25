# Chunk 4D-1 — reports.db hot-path load layer → PostgreSQL (design spec)

**Date:** 2026-06-25
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-hot` (off `main`)
**Depends on:** Chunks 4A (auth) + 4B (config/sites) + 4C (report-CRUD) — all merged to `main`
(`db/postgres/reports/001_auth.sql` + `002_config.sql` + `003_reports.sql`, `REPORTS_BACKEND`,
`initPgReports`, `pgHandle`, `services/pgDb.js`).

---

## Goal

Fork the **sync/load half** of reports.db's hot path (Zoho-synced tables) to PostgreSQL behind
`REPORTS_BACKEND=postgres`: the schema for the 5 Zoho tables + `sync_metadata`, the 6 batch
upsert writers, the 4 reconcilers, the 4 sync-metadata helpers, and the 5 raw row readers.
Default backend stays `sqlite`; no-op dispatch so prod is unchanged.

This is the first of two 4D sub-chunks. **4D-2** (the ~35 KPI aggregate readers, where the
denominator-doctrine reconciliation lives) is a separate spec→plan→TDD cycle that builds on
4D-1's writers to seed test data. The all-or-nothing prod flip to `REPORTS_BACKEND=postgres`
needs BOTH 4D-1 and 4D-2 done + a full KPI reconciliation.

## Scope — functions forked

| Group | Functions |
|---|---|
| Writers (6) | `upsertRequestBatch`, `upsertRequestUdfBatch`, `upsertChangeBatch`, `upsertCABBatch`, `upsertSurveyResultBatch`, `upsertSurveyAnswerBatch` |
| Reconcilers (4) | `reconcileRequestRecords`, `reconcileChangeRecords`, `reconcileCABApprovals`, `reconcileSurveyResults` |
| Sync metadata (4) | `getSyncStatus`, `getLastSyncAt`, `markSyncSuccess`, `markSyncError` |
| Raw readers (5) | `getRequestRecords`, `getChangeRecords`, `getCABApprovals`, `getSurveyResults`, `getSurveyAnswers` |

**Out of scope (Chunk 4D-2):** `getMonthlyData` (assembler) + every `getCalendarMonthly*` /
`getCalendarMonthlyTop10` / `getHelpdesk6MonthHistory` / `_aggregateHelpdesk6MoFromRaw` /
`getMonthlyHelpdeskHistory` / `getRequestMetrics` / `getCABMetrics` / `getChangeMetrics` /
`getSurveyMetrics` / `getRequestFilterOptions` / `getMajorIncidentsHistory` /
`getActiveMajorIncidentsForSite` / `getOpenChangesForSite` / `getChangeRecordsHistory` / all
`*DB` aggregates (`getAgeing*DB`, `getSlaTrendDB`, `getSlaByCategoryDB`, `getFirstResponseTrendDB`,
`getCustomerVoice*DB`, `getEmergencyChangesDB`, `getGroupRequestsDB`, `getIncidentVsSrDB`,
`getCabRecommendationsDB`, `getCabApprovalsDB`).

**Out of scope (coordinated wiring pass):** the server.js warm `_rawCache` (lives in server.js,
rebuilt from `getRequestRecords` via `_rebuildCacheFromSQLite`) + the `/api/sync/*` + `/api/data/*`
route handlers. They flip to `await` when reports.db cuts over.

## Schema

New migration `db/postgres/reports/004_hot.sql` (idempotent), applied by `initPgReports()` after
`003_reports.sql`. Six tables, mirroring the sqlite CREATEs + their ALTER-added columns:

- **`request_records`** (`reports-db.js:260` + ALTERs) — INTEGER IDENTITY id; `request_id` TEXT
  UNIQUE NOT NULL; `display_id`/`subject`/`request_status`/`request_type`/`mode`/`impact`/
  `udf_json`/`first_response_overdue`/`technician`/`requester`/`category`/`sub_category`/`site`/
  `tech_group` + all the ISO-datetime cols (`due_by_time`/`created_time`/`resolved_time`/
  `completed_time`/`responded_time`/`assigned_time`/`last_updated_time`/`fetched_at`) → TEXT;
  INTEGER flags (`pending_status`/`overdue_status`/`is_escalated`/`service_request`/`reopen_count`);
  `time_elapsed_ms` → BIGINT. Indices: created_time, request_status, site, pending_status, overdue_status.
- **`change_records`** (`:166`) — IDENTITY id, `change_id` TEXT UNIQUE NOT NULL, `emergency` INTEGER,
  rest TEXT (incl. `udf_json`). Indices: created_time, status, site_id.
- **`cab_approvals`** (`:198`) — IDENTITY id, `approval_id` TEXT UNIQUE NOT NULL, `change_id` TEXT
  NOT NULL, `turnaround_minutes` INTEGER (sqlite INTEGER — keep INTEGER), rest TEXT. Indices: change_id, approval_status.
- **`survey_results`** (`:220`) — IDENTITY id, `result_id` TEXT UNIQUE NOT NULL, `overall_score`
  → `double precision`, rest TEXT. Indices: request_display_id, change_id, survey_sent_on.
- **`survey_answers`** (`:241`) — IDENTITY id, `response_id`/`result_id` TEXT NOT NULL, `score`
  INTEGER, `skipped` INTEGER, rest TEXT. Indices: response_id, result_id.
- **`sync_metadata`** (`:155` + ALTERs) — `job_name` TEXT PRIMARY KEY, `last_sync_at`/`last_error`/
  `last_error_at`/`last_full_sync_at`/`schema_snapshot` TEXT, `last_sync_rows`/`sync_count`/
  `deleted_count` INTEGER.

Type recipe (matches 4A/4B/4C): AUTOINCREMENT→INTEGER IDENTITY; `REAL`→`double precision`;
app dates + JSON blobs→TEXT; flags/counts→INTEGER; `time_elapsed_ms`→BIGINT (raw ms can exceed
INT4). No FKs between hot tables (mirrors sqlite — they're soft-linked by Zoho ids; sync order
isn't guaranteed).

### Seeding

`initPgReports` seeds the 4 default `sync_metadata` job rows (`helpdesk`, `change_cab`, `survey`,
`requests`) via `INSERT … ON CONFLICT (job_name) DO NOTHING` — mirrors the sqlite `_seedJob` gate.

## Writer conversion (the structural work)

The 6 writers are module-level `const upsertXBatch = db.transaction(rows => {…})` over
module-level prepared statements (`_upsertRequest`, `_upsertChange`, … with `@named` params and
`ON CONFLICT(zoho_id) DO UPDATE SET col = excluded.col …, fetched_at = datetime('now')`). Each
converts to:

```js
function upsertRequestBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertRequestBatchPg(rows);
  return _upsertRequestBatchSqlite(rows);   // existing const db.transaction, renamed
}
```

The pg branch runs `await H.runTransaction(async () => { for (const r of rows) { n += (await
H.prepare(SQL).run(r)).changes ? 1 : 0; } })` using the SAME named-object binding (`pgDb._bind`
maps a single object → named `@param`→`$N`). Dialect: `datetime('now')`→`now()`,
`excluded.col`→`EXCLUDED.col`. Returns the same row count.

`upsertRequestUdfBatch` keeps its two-step logic: UPDATE `udf_json` WHERE `request_id=?`; on
`changes===0`, fallback UPDATE WHERE `display_id=?` (both positional `?`).

> Writers return a **count** (not lastID), so no `RETURNING` needed; `ON CONFLICT` statements
> don't get auto-`RETURNING` from the adapter anyway.

## Reconcilers

Each `reconcile*(liveIds)` reads all local Zoho-ids, computes `toDelete = local − liveIds`, and
batch-deletes. pg fork: `await H.prepare('SELECT <id> FROM <table>').all()` → diff in JS →
`await runTransaction` looping `await H.prepare('DELETE … WHERE <id>=?').run(id)`. Returns the
delete count. (Same early-return on empty `liveIds`.)

## Raw readers

`getRequestRecords`/`getChangeRecords`/`getCABApprovals`/`getSurveyResults`/`getSurveyAnswers`
return raw rows (with optional filters/limits). pg fork: `getDB()`→`pgHandle()`, `.all()`→`await`,
preserve the exact WHERE/ORDER/LIMIT. (These feed the warm cache + browser raw endpoints.)

## Sync-dispatch invariant

Every forked fn returns synchronously on sqlite (value/count, not a Promise); only the pg branch
is async. Verified with a sqlite smoke (`getSyncStatus()`/`getRequestRecords()` not instanceof
Promise) — keeps the not-yet-awaited server.js callers working on the default backend.

## Copy script

`tools/pg/copy-reports-hot.js` — one-shot idempotent sqlite→pg copy of the 6 tables, **batched**
(request_records can be 25k+ rows; insert in chunks of ~500 via multi-row VALUES or a prepared
loop to keep statements bounded and memory flat). Upsert on the Zoho-id PK; advance the 5 IDENTITY
sequences (all but sync_metadata, whose PK is `job_name`) via
`GREATEST((SELECT COALESCE(MAX(id),0) FROM t), 1)`. Skips cleanly when PG unreachable. The test
uses a tiny fixture; batching matters for the real cutover copy.

## Testing (TDD)

`tests/pg-reports-hot.test.js` — pg backend against a throwaway DB via `tests/pg-helpers.js`;
skips when PG down. Header sets `REPORTS_BACKEND=postgres` + `SDP_DATA_DIR` + dummy
`DASH_USER`/`DASH_PASS`. Increments:

1. **schema + sync_metadata seed** — `004_hot.sql` idempotent re-apply; 4 seeded job rows.
2. **request write/read + UDF** — `upsertRequestBatch` insert + update (ON CONFLICT replace);
   `getRequestRecords` reads them; `upsertRequestUdfBatch` long-id path + display-id fallback
   (assert `udf_json` lands on the right row).
3. **change/CAB/survey write+read** — each `upsert*Batch` + matching raw reader round-trip.
4. **sync metadata** — `markSyncSuccess` (rows/deleted/full-sync) → `getLastSyncAt` (cursor) +
   `getSyncStatus`; `markSyncError` records error fields without clobbering last_sync_at.
5. **reconcile** — seed 3 rows, `reconcileRequestRecords(new Set([id1]))` deletes the other 2;
   empty liveIds → no-op (returns 0).
6. **copy parity** — sqlite fixture (a few rows per table) → `copyReportsHot` → counts + value
   parity + IDENTITY seq advance.

sqlite path regression: existing sqlite hot-path behaviour stays green (no-op dispatch) + a
synchronous-return smoke.

## Non-goals / deferred

- 4D-2: all KPI aggregate readers (`getMonthlyData`, `getRequestMetrics`, `*DB`, etc.).
- server.js: `_rawCache` rebuild + `/api/sync/*` + `/api/data/*` route `await` wiring → coordinated pass.
- Merging `feat/pg-reports-hot` to main — after the chunk completes (user choice).
- The actual `REPORTS_BACKEND=postgres` prod flip — needs 4D-2 + KPI reconciliation first.

## Success criteria

- `tests/pg-reports-hot.test.js` green against local PG.
- `node --check` clean; modules load.
- sqlite default-backend behaviour unaffected (synchronous returns; existing tests green).
- Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
