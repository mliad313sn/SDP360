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
