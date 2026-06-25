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
