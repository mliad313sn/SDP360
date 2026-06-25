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
