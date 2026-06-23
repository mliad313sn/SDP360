# Design — PostgreSQL migration, Chunk 1: tracker.db (+ reusable pg adapter)

**Date**: 2026-06-23
**Status**: Approved (Approach A + Chunk 1 scope, 2026-06-23). Ready for implementation plan.
**Branch**: `feat/pg-migration-chunk1-tracker`
**Audience**: Implementer (this repo) + reviewers.

---

## 1. Context & goal

`endeavour-dashboard` (Node/Express, PM2 `endeavour-dashboard`, port 3456) persists data in
**four SQLite files** via `better-sqlite3` (synchronous API):

| DB | Module | Notes |
|---|---|---|
| `reports.db` | Helpdesk/Exec/Analytics | hot path; `request_records` cached in Node `_rawCache` (OOM risk) |
| `tracker.db` | Activity Tracker | small (3 base tables + per-year v2 tables) |
| `inspection.db` | Inspections | photos already externalised to FS blobs |
| `meetings.db` | Meetings | medium |

A **sibling app, `4MyPeople`** (`C:\Users\Admin\Documents\4MyPeople\app`), is deployed on the
**same server** and already runs **PostgreSQL** (`pg` v8, `connect-pg-simple` sessions, 21 SQL
migrations, REST `/api/v1`, SSO/MFA). Crucially it ships
`src/database/PostgresDatabase.js` — a **drop-in SQLite-shaped adapter** that translates `?`→`$1..$N`
and maps camelCase↔snake_case.

**Goal of the overall effort** (out of scope here, roadmap only): migrate the dashboard to the
**same PostgreSQL instance** (separate database `sdp_dashboard`, schema-per-module), and integrate
the two apps (shared SSO/session, consume `/api/v1` employees/readiness, shared email).

**Goal of THIS spec (Chunk 1)**: build the **reusable async pg adapter** for the dashboard and
**cut `tracker.db` over to PostgreSQL** behind a reversible flag, **test-first (TDD)**, entirely on a
branch. tracker.db is chosen first because it is the smallest module (3 base tables) — it serves as
the **proven template** the later parallel-agent chunks copy.

---

## 2. Decomposition (the whole effort)

Each sub-project gets its own spec → plan → implementation cycle.

1. **CHUNK 1 (this spec)** — pg adapter + `tracker.db` cutover, solo TDD.
2. Chunk 2 — `meetings.db`  ·  3 — `inspection.db`  ·  4 — `reports.db` (hot path, hardest).
3. Integration — shared SSO/session · consume `/api/v1` (employees/readiness) · email.

**Multi-agent execution (approved)**: Chunk 1 is **single-agent / sequential** (a TDD loop does not
parallelise — one test drives the next implementation step). After Chunk 1 proves the recipe, Chunks
2–4 + integration **fan out to parallel agents, each in its own git worktree** (independent modules,
no shared-file collisions), each replicating the validated tracker recipe, followed by an
adversarial reviewer pass per module before merge.

---

## 3. Chunk 1 scope

**In scope**
- Dev/test PostgreSQL via a **Docker `postgres:16` container** (Docker daemon is up on the dev box).
- A dashboard **`pgDb` adapter** (ported pattern from 4MyPeople's `PostgresDatabase.js`): same
  `.prepare(sql).get/all/run` surface but **async** (returns promises); `?`→`$1..$N` translation;
  a single `pg.Pool`.
- A **versioned Postgres schema** for the tracker module (legacy `tracker_config` / `tracker_targets`
  / `tracker_inputs` **and** the per-year v2 tables `tracker_pillars` / `tracker_activities` /
  `tracker_targets_v2` / `tracker_inputs_v2`), in `db/postgres/tracker/`.
- A **one-shot data-copy script** `tracker.db` → Postgres.
- A reversible backend flag **`TRACKER_BACKEND=sqlite|postgres`** (default `sqlite`); `tracker-db.js`
  selects the backend. The `/api/tracker/*` HTTP contract is unchanged.
- **TDD parity tests** proving SQLite↔Postgres equivalence on load/save/scoring + RBAC + migration
  idempotence.

**Out of scope (Chunk 1)**
- Other modules (reports/meetings/inspection), sessions migration, SSO, `/api/v1` consumption, email.
- Provisioning the **server** Postgres / production cutover (the flag stays `sqlite` in prod until a
  later, separate deploy decision).

---

## 4. Approach (A — chosen) and rejected alternatives

**A — Async pg adapter + `tracker.db` cutover behind a flag** *(CHOSEN)*.
Reuses 4MyPeople's proven adapter pattern; gives real Postgres concurrency; reversible via the env
flag; surface is contained (tracker = 3 base tables). Cost: `tracker-db.js` and its route handlers
become `async` (small surface — acceptable, and the natural Postgres model).

**B — SQLite stays source of truth, Postgres mirror (dual-write)** — *rejected*: doesn't actually
migrate, doubles the write code, no real benefit for a cutover goal.

**C — DB-agnostic repository interface (ports & adapters)** — *deferred*: cleanest long-term but
over-engineered for the first chunk. The `pgDb` adapter naturally becomes the shared layer as later
modules adopt it; we evolve toward C without paying its full cost upfront (YAGNI).

---

## 5. Architecture & components

### 5.1 Dev/test PostgreSQL (Docker)
- Container `postgres:16`, e.g. host port **5433** (avoid clashing with any native 5432 expectation),
  POSTGRES_DB `sdp_dashboard`, throwaway credentials for dev/test only.
- A helper script (`tools/pg/dev-up.sh` / `.cmd`) starts/stops it; tests start it if absent and
  create an isolated test database.
- **Nothing in this chunk touches `fmp_v2` or any production DB.**

### 5.2 `pgDb` adapter — `services/pgDb.js`
- Wraps a single `pg.Pool` (connection from `PG_URL` / `DATABASE_URL`).
- Exposes a SQLite-shaped, **async** API so existing query strings barely change:
  - `prepare(sql)` → `{ get(...params), all(...params), run(...params) }`, each returning a Promise.
  - `?`→`$1..$N` placeholder translation (ported from 4MyPeople).
  - `exec(sql)` for DDL/migrations; `tx(fn)` for transactions.
- SQL-dialect helpers used by the tracker port: `json_extract` → `->>`, `strftime('%Y-%m', x)` →
  `to_char(x,'YYYY-MM')`, `INSERT OR REPLACE`/`ON CONFLICT`. (Tracker uses few of these; full coverage
  is iterated as later modules need it.)

### 5.3 Tracker schema migration — `db/postgres/tracker/001_init.sql`
- Postgres DDL mirroring `tracker-db.js`'s SQLite schema, keyed identically
  (`tracker_inputs` PK `(year, site, activity_ix)`; v2 `*_v2` keyed `year+site+activity_id`).
- Idempotent (`CREATE TABLE IF NOT EXISTS`, additive `ALTER`s), run by `pgDb.exec` at boot when
  `TRACKER_BACKEND=postgres` — mirrors the existing SQLite first-run seed/migrate behaviour.

### 5.4 Data-copy script — `tools/pg/copy-tracker.js`
- Reads `tracker.db` with `better-sqlite3`, writes rows into Postgres via `pgDb` in a transaction.
- Idempotent (upsert on PK); preserves `tracker_config` JSON (activities/pillarWeights/years).
- One-shot, runnable on dev (and later on the server during cutover).

### 5.5 Backend selector — `tracker-db.js`
- At module load, branch on `TRACKER_BACKEND`:
  - `sqlite` (default) → today's better-sqlite3 path, **unchanged**.
  - `postgres` → the `pgDb`-backed path; all public functions (`loadTracker`, `saveTracker`,
    `resetTracker`, year add/delete, etc.) become `async`.
- The route handlers (`/api/tracker/load|save|export|reset`) `await` the now-async calls. The HTTP
  request/response shape is **identical** so `activity-tracker.html` is untouched.

---

## 6. Data flow (postgres mode)

```
Browser /api/tracker/load
  → route handler (await loadTracker(user))
    → tracker-db.js (postgres branch)
      → pgDb.prepare(sql).all(...)   // ? → $N, pool query
        → PostgreSQL (sdp_dashboard, schema tracker)
  ← same D object shape as the SQLite path  → identical JSON to the browser
```

Save mirrors this: RBAC scope is enforced in `tracker-db.js` exactly as today (admin → own-site
inputs only; executive/super_admin → all), before the parameterised upserts.

---

## 7. Error handling & rollback

- **Adapter errors** surface as rejected promises; route handlers keep the existing try/catch →
  JSON error contract.
- **Migration idempotence**: re-running `001_init.sql` is a no-op; re-running the copy upserts.
- **Rollback**: set `TRACKER_BACKEND=sqlite` and restart — instant revert to the untouched SQLite
  path. The SQLite file is never deleted by this chunk.
- **Connection loss**: pool errors are logged; tracker is not on the hot path, so a brief failure
  degrades only the Tracker page, not the whole dashboard.

---

## 8. Testing strategy (TDD — red→green→refactor)

`tests/pg-tracker.test.js` (node:test), gated to run only when a test Postgres is reachable:

1. **Adapter unit** — `?`→`$N` translation; `get/all/run` semantics vs known rows.
2. **Migration idempotence** — apply `001_init.sql` twice → no error, stable schema.
3. **Copy parity** — seed a fixture `tracker.db`, run `copy-tracker.js`, assert Postgres row counts
   and key JSON match the source.
4. **Load/Save parity** — for the same seed, `loadTracker` (postgres) deep-equals `loadTracker`
   (sqlite); `saveTracker` then `loadTracker` round-trips; scoring (`ss`/`ps2` via engine) yields
   identical RAG/score numbers on both backends.
5. **RBAC** — admin save touches only own-site inputs on the postgres path (same guard as sqlite).

Loop: write a failing test → implement the minimal adapter/migration/branch to pass → refactor →
repeat until all green. A throwaway Docker `postgres:16` provides the test DB; the suite creates and
drops an isolated database per run so it never touches dev/prod data.

---

## 9. Success criteria (definition of done, Chunk 1)

- `TRACKER_BACKEND=postgres` → the Activity Tracker page loads, scores, saves, adds/deletes years,
  and exports PPTX **identically** to `sqlite` mode (verified by parity tests + a manual smoke).
- All `tests/pg-tracker.test.js` cases green against Docker Postgres.
- `TRACKER_BACKEND=sqlite` (default) → **zero behavioural change**; existing tracker tests still pass.
- Reusable `services/pgDb.js` adapter + `db/postgres/` layout + `tools/pg/*` scripts in place,
  documented, ready for Chunks 2–4 to copy.
- Everything on `feat/pg-migration-chunk1-tracker`; **prod stays on SQLite** (no deploy flips the flag
  in this chunk).

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| sync→async cascade beyond tracker | Tracker has a small, self-contained call surface; flag-gated so the sqlite path is untouched. |
| SQL dialect gaps (json/strftime/upsert) | Port only what tracker needs now; grow `pgDb` helpers as later modules require — covered by tests. |
| Dev-box Postgres availability | Docker daemon confirmed up; tests self-provision a container/db and skip cleanly if unreachable. |
| Divergence between parallel module agents later | tracker is the **reference recipe**; each later agent copies it in an isolated worktree + adversarial review before merge. |
| Accidental prod/`fmp_v2` writes | Tests/scripts use a dedicated `sdp_dashboard`/test DB + throwaway creds; never the 4MyPeople DB. |
