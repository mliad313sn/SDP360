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
