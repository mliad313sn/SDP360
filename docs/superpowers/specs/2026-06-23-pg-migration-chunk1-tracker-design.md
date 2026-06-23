# Design — PostgreSQL migration, Chunk 1: tracker.db (+ reusable pg adapter)

**Date**: 2026-06-23
**Status**: Approved (Approach A + Chunk 1 scope, 2026-06-23). Revised after spec review (rev 2).
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

A **sibling app, `4MyPeople`** (`C:\Users\Admin\Documents\4MyPeople\app`), runs on the **same server**
and is already on **PostgreSQL** (`pg` v8, `connect-pg-simple` sessions, 21 migrations, REST `/api/v1`,
SSO/MFA). Its `src/database/PostgresDatabase.js` + `sql-compat.js` give a SQLite-compatible **async**
data layer.

> **Source-pattern reality (corrected after review)**: 4MyPeople's adapter exposes **flat async
> methods** `get(sql, paramsArray)` / `all(...)` / `run(...)` — it has **no `prepare()`**; the
> `?`→`$1..$N` translation lives in a separate `sql-compat.js`; it registers a NUMERIC type parser
> (`setTypeParser(1700, parseFloat)`) and maintains a boolean-column rewrite list. We reuse the
> *concepts*, but build a `prepare()` wrapper (see §5.2) so the dashboard's call sites barely change.

**Overall goal (roadmap, out of scope here)**: migrate the dashboard onto the **same PostgreSQL
instance** (separate DB `sdp_dashboard`, schema-per-module) and integrate the two apps (shared
SSO/session, consume `/api/v1` employees/readiness, shared email).

**Goal of THIS spec (Chunk 1)**: build the **reusable async `pgDb` adapter** and **cut `tracker.db`
over to PostgreSQL** behind a reversible flag, **test-first (TDD)**, on a branch. tracker.db is first
because it is the smallest module — it becomes the **reference recipe** the later parallel-agent
chunks copy.

---

## 2. Decomposition (whole effort)

1. **CHUNK 1 (this spec)** — `pgDb` adapter + `tracker.db` cutover, solo TDD.
2. Chunk 2 — `meetings.db` · 3 — `inspection.db` · 4 — `reports.db` (hot path, hardest).
3. Integration — shared SSO/session · consume `/api/v1` · email.

**Multi-agent execution (approved)**: Chunk 1 is **single-agent/sequential** (a TDD loop doesn't
parallelise). After it proves the recipe, Chunks 2–4 + integration **fan out to parallel agents, each
in its own git worktree** (independent modules), each copying the validated tracker recipe, then an
adversarial reviewer pass per module before merge.

---

## 3. Chunk 1 scope

**In scope**
- Dev/test PostgreSQL via a **Docker `postgres:16` container** (Docker daemon confirmed up).
- A reusable **`pgDb` adapter** (`services/pgDb.js`) — see §5.2.
- A **versioned Postgres schema** for tracker (`tracker_config`/`tracker_targets`/`tracker_inputs`
  **and** the per-year v2 tables `tracker_pillars`/`tracker_activities`/`tracker_targets_v2`/
  `tracker_inputs_v2`), in `db/postgres/tracker/`.
- A **one-shot data-copy script** `tracker.db` → Postgres.
- A reversible backend flag **`TRACKER_BACKEND=sqlite|postgres`** (default `sqlite`).
- **TDD parity tests** proving SQLite↔Postgres equivalence on the **per-year (v2) path** — which is
  what prod runs (`TRACKER_PER_YEAR_EDITS=1`, ADR-001) — plus migration idempotence, FK-cascade
  year-delete, and RBAC.

**Out of scope (Chunk 1)**
- Other modules, sessions migration, SSO, `/api/v1` consumption, email.
- Server Postgres provisioning / production cutover. **Prod stays on `TRACKER_BACKEND=sqlite`** this
  chunk; no deploy flips the flag.

---

## 4. Approach (A — chosen) & rejected alternatives

**A — Async `pgDb` adapter + `tracker.db` cutover behind a flag** *(CHOSEN)*. Reuses 4MyPeople's
proven concepts; real Postgres concurrency; reversible via the flag; contained surface (tracker = a
handful of tables). Cost: the tracker module + its 6 route call sites become `async` (§5.5) — a small,
honest surface, and the natural Postgres model.

**B — SQLite source of truth, Postgres mirror (dual-write)** — *rejected*: doesn't migrate, doubles
write code.

**C — DB-agnostic repository interface** — *deferred*: cleanest long-term but over-engineered now;
`pgDb` becomes the shared layer as later modules adopt it (evolve toward C without paying it upfront).

---

## 5. Architecture & components

### 5.1 Dev/test PostgreSQL (Docker)
- Container `postgres:16`, host port **5433**, throwaway dev/test creds; never touches `fmp_v2`/prod.
- Helper `tools/pg/dev-up.cmd`/`.sh` to start/stop. Tests create an **isolated database per run** by
  connecting to the maintenance `postgres` DB and issuing `CREATE DATABASE sdp_dashboard_test_<rand>`
  / `DROP DATABASE` (these can't run inside a transaction — done on a separate connection), then run
  migrations into it.

### 5.2 `pgDb` adapter — `services/pgDb.js`
- Wraps a single `pg.Pool` (`PG_URL`/`DATABASE_URL`), connected once at boot (`await pgDb.connect()`,
  §5.6). Registers `pg.types.setTypeParser(1700, parseFloat)` (node-pg returns NUMERIC as a string).
- Adds a **`prepare()` wrapper** (not present in 4MyPeople) over a flat `query(sql, paramsArray)`, so
  tracker's `db.prepare(sql).get/run/all(...args)` shape stays — only `await` is added:
  - `prepare(sql)` → `{ get(...args), all(...args), run(...args) }`, each **async**, spreading varargs
    into the params array.
  - `translatePlaceholders(sql)` (`?`→`$1..$N`), ported in concept from `sql-compat.js`, inlined.
  - `exec(sql)` for DDL; `runTransaction(async fn)` for transactions.
- **SQL rewrites tracker needs NOW (in-scope this chunk, not deferred)**:
  - `INSERT OR REPLACE INTO t (...) VALUES (...)` → `INSERT ... ON CONFLICT (<pk>) DO UPDATE SET ...`
    (used by `tracker_targets_v2`/`tracker_inputs_v2` upserts).
  - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`.
  - `FOREIGN KEY ... ON DELETE CASCADE` preserved in the DDL (year-delete relies on it).

### 5.3 Tracker schema migration — `db/postgres/tracker/001_init.sql`
- Postgres DDL mirroring `tracker-db.js`'s schema, keyed identically: `tracker_inputs`
  PK `(year, site, activity_ix)`; v2 `*_v2` keyed `(year, site, activity_id)`; v2 child tables keep
  `FOREIGN KEY ... ON DELETE CASCADE` so `deleteTrackerYear` cascades.
- **Type-preservation decisions (prevent silent breaks — call sites unchanged)**:
  - `*_json` (`activities_json`, `pillar_weights_json`, `years_json`, `months_json`) → **`TEXT`**, NOT
    `JSONB`. Code does `JSON.parse(row.x_json)`; JSONB would auto-parse to an object and break it.
    *(Highest-risk silent break — pinned.)*
  - `active` → **`INTEGER`** (code reads `row.active === 1`, writes `? 1 : 0`; native BOOLEAN would
    make `=== 1` always false).
  - `target` → **`TEXT`** (stores `'TRUE'/'FALSE'` and numeric strings).
- Idempotent (`CREATE TABLE IF NOT EXISTS`, additive `ALTER`s).

### 5.4 Data-copy script — `tools/pg/copy-tracker.js`
- Reads `tracker.db` (better-sqlite3) → writes via `pgDb` in a transaction; idempotent (upsert on PK);
  preserves the `*_json` TEXT verbatim. Covers BOTH the legacy singleton and the v2 per-year tables.

### 5.5 Backend selector + async cascade — `tracker-db.js`
- Module-load branch on `TRACKER_BACKEND`: `sqlite` (default) → today's better-sqlite3 path,
  **unchanged**; `postgres` → the `pgDb` path.
- **The async cascade is larger than "4 public functions" (corrected)**:
  - In postgres mode **every** DB-touching tracker-db.js function becomes `async`, including the
    per-year internals `_loadFromNewSchema`, `_saveV2`, `_syncYearStructure`, and the legacy/dual-write
    helpers — not just `loadTracker/saveTracker/resetTracker/deleteTrackerYear`.
  - `saveTracker`'s synchronous `db.transaction(() => {...})` becomes
    `await pgDb.runTransaction(async (tx) => { await tx.prepare(...).run(...); ... })`.
  - **server.js sites to convert** (verified): `loadTracker()` at ~5273, 5341, 5602, 5663
    (export/reset/delete-year chain a second `loadTracker`); handlers `/api/tracker/load` (~5270) and
    `/api/tracker/reset` (~5598) are currently **synchronous** and become `async`; `save`/`export`
    must `await` the new async calls.
- HTTP request/response shape is **identical** → `activity-tracker.html` untouched.

### 5.6 Boot wiring (no lazy sync init in postgres mode)
- tracker-db.js's `getDB()` returns a *synchronous* lazily-initialised better-sqlite3 handle; the
  postgres branch can't use lazy-first-call init. At server startup, when `TRACKER_BACKEND=postgres`:
  `await pgDb.connect()` then `await pgDb.exec(db/postgres/tracker/001_init.sql)` **before** tracker
  routes serve (mirrors 4MyPeople's awaited `connect()`/`migrate()`).

---

## 6. Data flow (postgres mode)

Prod runs `TRACKER_PER_YEAR_EDITS=1` (ADR-001), so the meaningful path is the **v2 per-year** one:

```
Browser /api/tracker/load
  → async route handler (await loadTracker(user))
    → tracker-db.js postgres branch → _loadFromNewSchema (await pgDb.prepare(sql).all(...))
      → PostgreSQL (sdp_dashboard, schema tracker, *_v2 tables)
  ← same D object shape as SQLite → identical JSON to the browser
```
Save mirrors this through `_saveV2`/`_syncYearStructure` inside `runTransaction`. RBAC (admin →
own-site inputs only; exec/super_admin → all) is enforced in tracker-db.js exactly as today, before
the parameterised upserts.

---

## 7. Error handling & rollback

- Adapter errors → rejected promises; route try/catch keeps the existing JSON error contract.
- Migration idempotent; copy is upsert-idempotent.
- **Rollback**: `TRACKER_BACKEND=sqlite` + restart → instant revert to the untouched SQLite path; the
  SQLite file is never deleted by this chunk.
- Pool/connection loss degrades only the Tracker page (not hot-path), and is logged.

---

## 8. Testing strategy (TDD — red→green→refactor)

`tests/pg-tracker.test.js` (node:test), **run with `TRACKER_PER_YEAR_EDITS=1`** (the prod-live path):

0. **Harness** — preflight connect to the maintenance `postgres` DB on `PG_URL`; if unreachable
   (Docker down), `test.skip` the suite cleanly. Otherwise `CREATE DATABASE` a fresh per-run db, run
   `001_init.sql`, and `DROP DATABASE` on teardown.
1. **Adapter unit** — `prepare().get/all/run` translate `?`→`$N` and return the right rows; varargs
   spread correctly; `runTransaction` commits/rolls back.
2. **Migration idempotence** — apply `001_init.sql` twice → no error, stable schema.
3. **Copy parity** — seed a fixture `tracker.db` (with v2 rows), run `copy-tracker.js`, assert
   Postgres v2 row counts + `*_json` text match the source.
4. **Load/Save parity (v2 path)** — same seed: `_loadFromNewSchema`/`loadTracker` (postgres)
   deep-equals (sqlite); `_saveV2`/`saveTracker` then reload round-trips. Scoring is a **pure function
   of the returned `D`** (engine operates on `D` only), so "identical scores" reduces to the existing
   deep-equal — a thin sanity assertion, not the core proof.
5. **Year-delete FK-cascade** — `deleteTrackerYear(N)` removes year N's v2 rows via
   `ON DELETE CASCADE` and leaves year M intact (the ADR-001 invariant).
6. **RBAC** — admin save touches only own-site inputs on the postgres path (same guard as sqlite).

Loop: failing test → minimal adapter/migration/branch code to pass → refactor → repeat to all-green.

---

## 9. Success criteria (DoD, Chunk 1)

- `TRACKER_BACKEND=postgres` + `TRACKER_PER_YEAR_EDITS=1` → Activity Tracker loads, scores, saves,
  adds/deletes years **identically** to sqlite mode (parity tests §8 + a manual smoke).
- All `tests/pg-tracker.test.js` green against Docker Postgres; suite **skips cleanly** when Docker is
  down.
- `TRACKER_BACKEND=sqlite` (default) → **zero behavioural change**; existing tracker tests pass.
- PPTX export (`/api/tracker/export`) consumes only `D`, so it's covered by load parity — **manual
  smoke only** (no separate automated assertion; a fingerprint compare à la `tests/pptx-monthly-golden`
  is optional, not required for DoD).
- Reusable `services/pgDb.js` + `db/postgres/` layout + `tools/pg/*` in place and documented, ready
  for Chunks 2–4 to copy.
- All on `feat/pg-migration-chunk1-tracker`; **prod stays on SQLite**.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `*_json` modelled as JSONB → `JSON.parse(object)` throws | **Pinned to TEXT** (§5.3); test 3 asserts text round-trip. |
| NUMERIC returned as string; `active`/boolean `=== 1` breaks | NUMERIC type parser in `pgDb` (§5.2); `active`/`target` kept INTEGER/TEXT (§5.3). |
| async cascade bigger than the 4 public fns | §5.5 enumerates internals + the 6 server.js call sites + the 2 sync handlers to convert; flag keeps sqlite path untouched. |
| `INSERT OR REPLACE`/`OR IGNORE` + FK-CASCADE are load-bearing now | Named as **in-scope** rewrites (§5.2/§5.3); test 5 proves cascade. |
| Lazy sync `getDB()` has no async analog | Boot-time `await pgDb.connect()`/`exec` before routes serve (§5.6). |
| Testing the wrong (legacy) path | Tests run `TRACKER_PER_YEAR_EDITS=1` and target `_loadFromNewSchema`/`_saveV2` (§6/§8). |
| Dev-box Postgres availability | Docker confirmed up; harness self-provisions a db and skips when unreachable (§8.0). |
| Divergence between later parallel module agents | tracker = the reference recipe; each later agent copies it in an isolated worktree + adversarial review before merge. |
| Accidental prod/`fmp_v2` writes | dedicated `sdp_dashboard_test_*` db + throwaway creds; never the 4MyPeople DB. |
