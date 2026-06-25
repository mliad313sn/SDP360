# Chunk 4B — reports.db config/sites → PostgreSQL (design spec)

**Date:** 2026-06-25
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-config` (off `main`)
**Depends on:** Chunk 4A (auth/sessions, merged to `main` — `db/postgres/reports/001_auth.sql`, `REPORTS_BACKEND` selector, `initPgReports`, `pgHandle` in `reports-db.js`)

---

## Goal

Fork the **configuration + sites** layer of `reports.db` to PostgreSQL behind the
existing `REPORTS_BACKEND=postgres` flag, reusing the `services/pgDb.js` adapter and
the per-module recipe proven in Chunks 1–4A. Default backend stays `sqlite`; the fork
is no-op-dispatched so prod behaviour is unchanged until an operator flips the flag.

This is the 🟢 mechanical sub-chunk of Chunk 4. It deliberately excludes the hot read
path, Zoho sync, weekly/monthly report CRUD, and KPI storage (Chunks 4C/4D).

## Scope — functions forked

All behind `REPORTS_BACKEND === 'postgres'` dispatch (sqlite path untouched):

| Module | Functions |
|---|---|
| `reports-db.js` — sites | `listSites`, `updateSiteGroup`, `createSite`, `updateSite`, `setSiteActive` |
| `reports-db.js` — departments | `listDepartments`, `createDepartment`, `updateDepartment`, `setDepartmentActive` |
| `reports-db.js` — audit | `logAudit` (writer) **and `getReportAuditLog(report_id, limit)` (reader, `reports-db.js:3762`)** — both forked since `audit_log` moves to pg |
| `services/groupPresets.js` | `getPresets`, `setPresets`, `getDiscovered`, `getPresetsWithDiscovered`, `_initSchema` |

**Out of scope (later chunks):** `weekly_reports` / `monthly_*` CRUD + KPI storage (4C);
`request_records` / `change_records` / `survey_*` hot tables + Zoho sync + `_rawCache` +
`getMonthlyData` + denominator-doctrine aggregates (4D); `sync_metadata`.

**`rr_site_aliases` — explicitly deferred (not 4B).** The 4A design doc tentatively
grouped `rr_site_aliases` into "sub-chunk B". It is reassigned OUT of 4B here: the table
is owned by `risk-register-export.js`, which opens **its own** `reports.db` connection
(not `reports-db.js`'s `getDB()`/`pgHandle()`). Forking it requires refactoring that
module's DB-handle plumbing — a self-contained unit better done as its own small chunk
("4B-RR") alongside the risk-register module, exactly as `groupPresets.js` was treated as
a distinct decision. Until then it stays sqlite; risk-register export is admin-only and
low-churn, so the temporary split is harmless (and prod is sqlite regardless).

## Schema

New migration `db/postgres/reports/002_config.sql` (idempotent, `IF NOT EXISTS`),
applied by `initPgReports()` right after `001_auth.sql`. Adds three tables:

- **`action_departments`** — `id` IDENTITY PK, `name` TEXT UNIQUE (case-insensitive
  uniqueness enforced in code via `lower()=lower()`, matching the sqlite `COLLATE NOCASE`
  PK behaviour — no functional unique index needed for parity), `sort_order` INT,
  `active` INT, `created_at` TIMESTAMPTZ now(), `updated_at` TIMESTAMPTZ NULL.
- **`audit_log`** — `id` IDENTITY PK, `report_id` INT, `site_id` INT, `user_id` INT,
  `username` TEXT, `action` TEXT NOT NULL, `details` TEXT (JSON string — kept TEXT, not
  JSONB, to match the sqlite round-trip byte-for-byte), `created_at` TIMESTAMPTZ now().
  Indices on `report_id`, `site_id`, `created_at`. No FKs (mirrors sqlite — audit rows
  outlive their referents).
- **`dashboard_preset_groups`** — composite PK `(scope, preset_name, group_name)` (no
  IDENTITY), `display_order` INT, `updated_at` TIMESTAMPTZ now(), `updated_by` TEXT.
  Indices on `scope` and `(scope, group_name)`.

**`sites` already exists** from `001_auth.sql` (the `users.site_id` FK requires it) and
is already populated by `copy-reports-auth.js`. 4B's sites functions operate on that
existing table — **this resolves the split-brain**: after 4B, `listSites` and the
`users.site_id` FK reference one and the same pg `sites` row set, instead of
sqlite-`sites` diverging from the pg-`sites` the FK points at.

### Seeding

`initPgReports` (extended in 4B) seeds on first run, only into empty tables (mirrors the
sqlite seed-gate, so a boot against a populated DB is a no-op):
- `action_departments` — the same default list `reports-db.js` seeds.
- `dashboard_preset_groups` — the `tickets`/`changes` seeds from `groupPresets.js`
  (`TICKETS_SEED` / `CHANGES_SEED`).
- `sites` — NOT reseeded here (owned by 4A's copy/seed path).

## groupPresets.js — dependency-injection handling

`groupPresets.js` already takes `db` as the first arg of every function (DI). In pg mode
the functions become async and **resolve the pg handle internally** rather than using the
injected `db`, so **callers don't change which handle they pass** (server.js still passes
`rdb.db`).

**Mechanism (the one non-trivial design point in 4B):** at the top of each forked
function, a lazy `const rdb = require('../reports-db')` (require-inside-function, not
top-of-module — avoids any load-order cycle; `reports-db.js` does not require
`groupPresets.js` today, but the lazy require is defensive and matches how other modules
reach reports-db). When `rdb.REPORTS_BACKEND === 'postgres'`, use `rdb.pgHandle()` and
`await`; otherwise use the injected sqlite `db` exactly as today. A small helper
(`_h(db)` returning `{ handle, isPg }`) centralises this so each function isn't repeating
the branch. `_initSchema(db)` becomes a no-op when `isPg` (schema applied by
`initPgReports` / `002_config.sql`); the `_schemaReady` guard is preserved for the sqlite
path. The implementation plan will verify `require('../reports-db')` resolves cleanly from
`services/groupPresets.js` and that `pgHandle()` is reachable post-`initPgReports`.

### `getDiscovered` graceful-degrade (documented, intentional)

`getDiscovered` queries `request_records` / `change_records` — **Chunk 4D hot tables**
not present in pg until 4D. Its existing `try/catch` returns `[]` on a missing relation,
so in 4B-only pg mode **no auto-discovered groups surface** until 4D lands; explicitly
classified presets are unaffected. On sqlite, behaviour is unchanged. This is acceptable
because auto-discovery is an additive admin convenience, not a correctness requirement.

## Dialect rewrites (canonical recipe)

- `datetime('now')` → `now()` (TIMESTAMPTZ columns)
- `COLLATE NOCASE` (dept name uniqueness + lookup) → `lower(name) = lower(?)`
- `AUTOINCREMENT` → `GENERATED BY DEFAULT AS IDENTITY`
- new-row id: the sqlite bodies read `result.lastInsertRowid` (e.g. `createSite`
  `reports-db.js:1106`, `createDepartment`); the pg forks read **`.lastID`** (the adapter
  surfaces `{changes, lastID}` from its auto-`RETURNING *` on bare INSERTs — already in
  `pgDb.js`). This is an explicit per-fork rename, not automatic.
- reactivation-on-duplicate (createSite/createDepartment re-activating an inactive
  same-name row) is implemented as **read-then-`UPDATE`** in the sqlite source
  (`reports-db.js:1097`, `:1306`) — **no `INSERT OR REPLACE`/`ON CONFLICT` involved**; the
  pg fork ports that read-then-UPDATE branch verbatim (with `lower(name)=lower(?)` for the
  case-insensitive match). (No in-scope 4B function uses `INSERT OR REPLACE`.)
- `date('now','-12 months')` → `current_date - interval '12 months'`; `date(created_time)`
  comparison → `created_time::date` (only in `getDiscovered`, which degrades to `[]`
  in 4B anyway)
- `db.transaction(() => {…})()` → `await H.runTransaction(async () => {…})` (used by
  `setPresets`'s atomic DELETE+INSERT replace)
- COUNT/SUM scalars return JS numbers via the adapter's NUMERIC/BIGINT type-parsers

## Copy script

`tools/pg/copy-reports-config.js` — one-shot idempotent sqlite→pg copy of
`action_departments`, `audit_log`, `dashboard_preset_groups` (sites already handled by
`copy-reports-auth.js`). Advances each IDENTITY sequence past `MAX(id)` after copy. Skips
cleanly when PG is unreachable. Same structure as `copy-reports-auth.js` / `copy-tracker.js`.

## Testing (TDD)

`tests/pg-reports-config.test.js` — runs the pg backend against a throwaway DB via
`tests/pg-helpers.js`; skips cleanly when PG is down. Header sets `REPORTS_BACKEND=postgres`
+ `SDP_DATA_DIR` + dummy `DASH_USER`/`DASH_PASS` (same as `pg-reports-auth.test.js`).
Increments:

1. **schema + seed** — `002_config.sql` idempotent re-apply; `action_departments` +
   `dashboard_preset_groups` seeded; numbers are JS `number`.
2. **sites CRUD** — `createSite` → `listSites` round-trip; `updateSite`
   (zoho_group/sort_order/active); `setSiteActive`; `updateSiteGroup`; reactivate path
   if the sqlite version reactivates an inactive same-name site (parity check).
3. **departments CRUD** — `createDepartment` (case-insensitive dedup via `lower()`),
   `updateDepartment`, `setDepartmentActive`, `listDepartments` include-inactive.
4. **audit** — `logAudit` writes a row; `getReportAuditLog(report_id)` reads it back
   newest-first with `details` JSON intact and `limit` respected.
5. **group presets** — `getPresets` returns the 5 canonical buckets; `setPresets` atomic
   replace + re-read; `getDiscovered` returns `[]` when the hot tables are absent
   (4B-only pg state); `getPresetsWithDiscovered` merges without throwing.

sqlite path regression: existing `reports-db` sqlite behaviour stays green (no-op dispatch
proven by the unchanged default-backend tests).

## Non-goals / deferred

- Server.js route wiring for the config/sites endpoints to `await` these now-async
  functions: deferred to a coordinated wiring pass (same pattern as the Chunk 2/3/4A
  merge pass — sites/departments/presets routes flip to `async`+`await`). Listed here so
  it isn't forgotten; not part of the 4B TDD deliverable.
- `userHasRole`, weekly/monthly report functions, Zoho sync, hot read path — 4C/4D.

## Success criteria

- `tests/pg-reports-config.test.js` green against local PG.
- `node --check` clean; all modules load.
- sqlite default-backend tests unaffected.
- Nothing deployed; `REPORTS_BACKEND` defaults to `sqlite`.
