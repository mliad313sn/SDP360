# PostgreSQL Migration — Chunk 1 (tracker.db) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable async PostgreSQL adapter and cut the Activity Tracker module (`tracker.db`) over to PostgreSQL behind a reversible `TRACKER_BACKEND` flag, test-first, with zero behavioural change when the flag is `sqlite`.

**Architecture:** A thin `services/pgDb.js` adapter (ported in concept from 4MyPeople's `PostgresDatabase.js` + `sql-compat.js`) exposes a better-sqlite3-shaped **async** API (`prepare(sql).get/all/run`, `exec`, `runTransaction`) over a single `pg.Pool`. `tracker-db.js` gains a `postgres` branch (every DB-touching fn becomes `async`) selected by `TRACKER_BACKEND`; the `/api/tracker/*` route handlers are made `async`. Tests run the prod-live per-year path (`TRACKER_PER_YEAR_EDITS=1`) against a throwaway Docker `postgres:16` database.

**Tech Stack:** Node.js, `pg` (node-postgres), `better-sqlite3` (legacy/sqlite path, unchanged), `node:test`, Docker `postgres:16`.

**Spec:** `docs/superpowers/specs/2026-06-23-pg-migration-chunk1-tracker-design.md`
**Branch:** `feat/pg-migration-chunk1-tracker`

---

## File structure

| File | Responsibility |
|---|---|
| `services/pgDb.js` *(create)* | Async pg adapter: pool, `?`→`$N`, `prepare()` wrapper, `exec`, `runTransaction`, NUMERIC type-parser, `RETURNING *` for bare INSERTs. Module-agnostic (reused by later chunks). |
| `db/postgres/tracker/001_init.sql` *(create)* | Postgres DDL for all tracker tables (legacy + v2), FK CASCADE, type-preserving (`*_json` TEXT, `active` INT, `target` TEXT). |
| `tools/pg/copy-tracker.js` *(create)* | One-shot `tracker.db` → Postgres data copy (idempotent upsert). |
| `tools/pg/dev-up.cmd` + `tools/pg/dev-up.sh` *(create)* | Start/stop the dev Docker `postgres:16`. |
| `tests/pg-helpers.js` *(create)* | Test harness: preflight, create/drop a per-run DB, build a `pgDb` against it; `skip` cleanly when Docker/PG down. |
| `tests/pg-tracker.test.js` *(create)* | TDD suite: adapter unit, migration idempotence, copy parity, load/save v2 parity, year-delete cascade, RBAC. |
| `tracker-db.js` *(modify)* | Add `TRACKER_BACKEND` branch; `postgres` path uses `pgDb` (async); ON CONFLICT rewrites; boot connect/exec. |
| `server.js` *(modify)* | Make `/api/tracker/load` + `/api/tracker/reset` handlers `async`; `await` tracker calls in all 6 sites; boot-time `await pgDb.connect()` + tracker migration when `TRACKER_BACKEND=postgres`. |
| `.env.example` *(modify)* | Document `TRACKER_BACKEND`, `PG_URL`, `PG_POOL_MAX`. |

**Note on minimal divergence:** the `postgres` branch in `tracker-db.js` reuses the existing function bodies; only three mechanical changes apply per function: (a) `function f(` → `async function f(`, (b) `db.prepare(sql).get/all/run(...)` → `await db.prepare(sql).get/all/run(...)`, (c) the 8 `INSERT OR REPLACE/IGNORE` statements use Postgres `ON CONFLICT` SQL (listed in Task 6). `db.transaction(() => {…})` → `await pgDb.runTransaction(async () => {…})`. The schema's `AUTOINCREMENT` ids become identity columns; `.run().lastInsertRowid` → `.run()`'s `lastID`.

---

## Task 0: Dev Postgres + branch sanity

**Files:** Create `tools/pg/dev-up.cmd`, `tools/pg/dev-up.sh`.

- [ ] **Step 1: Add `pg` dependency**

Run: `npm install pg`
Expected: `pg` added to package.json dependencies.

- [ ] **Step 2: Write the Docker dev-up scripts**

`tools/pg/dev-up.cmd`:
```bat
@echo off
docker rm -f sdp-pg 2>nul
docker run -d --name sdp-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=sdp_dashboard -p 5433:5432 postgres:16
echo Postgres on localhost:5433  db=sdp_dashboard  user=postgres  pass=devpass
```
`tools/pg/dev-up.sh`:
```bash
#!/usr/bin/env bash
docker rm -f sdp-pg 2>/dev/null
docker run -d --name sdp-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=sdp_dashboard -p 5433:5432 postgres:16
echo "Postgres on localhost:5433 db=sdp_dashboard user=postgres pass=devpass"
```

- [ ] **Step 3: Start the container + verify**

Run: `tools/pg/dev-up.cmd` then `docker exec sdp-pg pg_isready -U postgres`
Expected: `accepting connections`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tools/pg/dev-up.cmd tools/pg/dev-up.sh
git commit -m "chore(pg): add pg dep + dev Docker postgres:16 scripts"
```

---

## Task 1: `pgDb` adapter — placeholder translation (TDD)

**Files:** Create `services/pgDb.js`; Create `tests/pg-tracker.test.js`.

- [ ] **Step 1: Write the failing test** (`tests/pg-tracker.test.js`)

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { _translate } = require('../services/pgDb');

test('translate: ? becomes $1..$N, quoted ? untouched', () => {
  assert.equal(_translate('SELECT * FROM t WHERE a=? AND b=?'),
                          'SELECT * FROM t WHERE a=$1 AND b=$2');
  assert.equal(_translate("SELECT '?' , a FROM t WHERE a=?"),
                          "SELECT '?' , a FROM t WHERE a=$1");
});
```

- [ ] **Step 2: Run → fails** — `node --test tests/pg-tracker.test.js` → FAIL (`Cannot find module '../services/pgDb'`).

- [ ] **Step 3: Minimal implementation** (`services/pgDb.js`)

```javascript
'use strict';
// Reusable async PostgreSQL adapter with a better-sqlite3-shaped surface.
// Ported in concept from 4MyPeople's PostgresDatabase.js + sql-compat.js.
// tracker uses snake_case columns, so NO camelCase identifier mapping is needed.
let Pool, pgTypes;
try { const pg = require('pg'); Pool = pg.Pool; pgTypes = pg.types; } catch (_) { Pool = null; }
// node-pg returns NUMERIC (OID 1700) as a string; parse to JS number (preserve sqlite semantics).
if (pgTypes && pgTypes.setTypeParser) pgTypes.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

// ?-positional → $1..$N, honouring single/double-quoted strings + comments.
function _translate(sql) {
  let out = '', inS = false, inD = false, line = false, block = false, i = 0, n = 1;
  while (i < sql.length) {
    const c = sql[i];
    if (line) { out += c; if (c === '\n' || c === '\r') line = false; i++; continue; }
    if (block) { out += c; if (c === '*' && sql[i+1] === '/') { out += '/'; block = false; i += 2; continue; } i++; continue; }
    if (!inS && !inD && c === '-' && sql[i+1] === '-') { out += '--'; line = true; i += 2; continue; }
    if (!inS && !inD && c === '/' && sql[i+1] === '*') { out += '/*'; block = true; i += 2; continue; }
    if (c === "'" && !inD) { inS = !inS || sql[i-1] === '\\'; out += c; i++; continue; }
    if (c === '"' && !inS) { inD = !inD; out += c; i++; continue; }
    if (c === '?' && !inS && !inD) { out += '$' + n++; i++; continue; }
    out += c; i++;
  }
  return out;
}
module.exports = { _translate };
```

- [ ] **Step 4: Run → passes** — `node --test tests/pg-tracker.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add services/pgDb.js tests/pg-tracker.test.js && git commit -m "feat(pgDb): ?->$N placeholder translation (TDD)"`

---

## Task 2: `pgDb` adapter — pool, prepare(), run/get/all, exec, runTransaction (TDD)

**Files:** Modify `services/pgDb.js`; Modify `tests/pg-tracker.test.js`; Create `tests/pg-helpers.js`.

- [ ] **Step 1: Write the test harness** (`tests/pg-helpers.js`)

```javascript
'use strict';
const { Client } = require('pg');
const ADMIN = process.env.PG_ADMIN_URL || 'postgres://postgres:devpass@localhost:5433/postgres';

// Returns a connection string to a fresh per-run DB, or null if Postgres is unreachable.
async function provisionTestDb() {
  let admin;
  try { admin = new Client({ connectionString: ADMIN }); await admin.connect(); }
  catch (_) { return null; }                       // Docker/PG down → caller test.skip()s
  const name = 'sdp_tracker_test_' + Math.random().toString(36).slice(2, 8);
  await admin.query(`CREATE DATABASE ${name}`);     // can't run inside a transaction — bare conn
  await admin.end();
  return { url: ADMIN.replace(/\/postgres$/, '/' + name), name, adminUrl: ADMIN };
}
async function dropTestDb(ctx) {
  if (!ctx) return;
  const admin = new Client({ connectionString: ctx.adminUrl }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${ctx.name} WITH (FORCE)`);
  await admin.end();
}
module.exports = { provisionTestDb, dropTestDb };
```

- [ ] **Step 2: Write failing tests** (append to `tests/pg-tracker.test.js`)

```javascript
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');

test('pgDb: exec/prepare/run/get/all + runTransaction round-trip', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx) return t.skip('Postgres not reachable (start tools/pg/dev-up)');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(`CREATE TABLE k (id INT PRIMARY KEY, v TEXT)`);
    const r = await db.prepare(`INSERT INTO k (id, v) VALUES (?, ?)`).run(1, 'a');
    assert.equal(r.changes, 1);
    assert.deepEqual(await db.prepare(`SELECT v FROM k WHERE id=?`).get(1), { v: 'a' });
    assert.deepEqual(await db.prepare(`SELECT * FROM k`).all(), [{ id: 1, v: 'a' }]);
    // rollback
    await db.runTransaction(async () => { await db.prepare(`INSERT INTO k VALUES (2,'b')`).run(); throw new Error('x'); })
      .catch(() => {});
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM k`).get()).n, 1);
  } finally { await db.close(); await dropTestDb(ctx); }
});
```

- [ ] **Step 3: Run → fails** — `node --test tests/pg-tracker.test.js` → FAIL (`makePgDb is not a function`).

- [ ] **Step 4: Implement** (extend `services/pgDb.js`, before `module.exports`)

```javascript
const { AsyncLocalStorage } = require('async_hooks');
function makePgDb(connectionString) {
  let pool = null;
  const txStore = new AsyncLocalStorage();
  const client = () => txStore.getStore() || pool;
  const isBareInsert = q => /^\s*INSERT\s/i.test(q) && !/\bRETURNING\b/i.test(q);
  async function query(sql, params) {
    let q = _translate(sql);
    if (isBareInsert(q)) q += ' RETURNING *';   // so .run() can surface lastID
    return client().query(q, params);
  }
  return {
    async connect() {
      pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000 });
      const c = await pool.connect(); try { await c.query('SELECT 1'); } finally { c.release(); }
    },
    async exec(sql) { await client().query(sql); },           // DDL / multi-statement; no placeholder xlate
    prepare(sql) {
      return {
        async run(...p) { const r = await query(sql, p); const id = r.rows[0] && r.rows[0].id; return { changes: r.rowCount, lastID: id }; },
        async get(...p) { const r = await client().query(_translate(sql), p); return r.rows[0]; },
        async all(...p) { const r = await client().query(_translate(sql), p); return r.rows; },
      };
    },
    async runTransaction(fn) {
      if (txStore.getStore()) return fn();                     // nested → reuse client
      const c = await pool.connect();
      try {
        return await txStore.run(c, async () => {
          await c.query('BEGIN');
          try { const out = await fn(); await c.query('COMMIT'); return out; }
          catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
        });
      } finally { c.release(); }
    },
    async close() { if (pool) await pool.end(); pool = null; },
  };
}
module.exports = { _translate, makePgDb };
```

- [ ] **Step 5: Run → passes** — `node --test tests/pg-tracker.test.js` → PASS (or `skip` if Docker down).

- [ ] **Step 6: Commit** — `git add services/pgDb.js tests/pg-helpers.js tests/pg-tracker.test.js && git commit -m "feat(pgDb): pool + prepare/run/get/all + runTransaction (TDD)"`

---

## Task 3: Tracker Postgres schema (TDD: migration idempotence)

**Files:** Create `db/postgres/tracker/001_init.sql`; Modify `tests/pg-tracker.test.js`.

- [ ] **Step 1: Write the failing test**

```javascript
const fs = require('fs'); const path = require('path');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/tracker/001_init.sql'), 'utf8');

test('schema: applies twice with no error (idempotent)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const db = makePgDb(ctx.url); await db.connect();
  try { await db.exec(SCHEMA); await db.exec(SCHEMA);
        const r = await db.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                    WHERE table_name LIKE 'tracker_%'`).get();
        assert.ok(r.n >= 7);
  } finally { await db.close(); await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run → fails** (file missing).

- [ ] **Step 3: Write `db/postgres/tracker/001_init.sql`** — Postgres translation of `tracker-db.js:_initSchema`. Rules: `INTEGER PRIMARY KEY AUTOINCREMENT` → `INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` (lets `copy-tracker.js` set explicit ids AND auto-generate on insert); `datetime('now')` → `now()` with TIMESTAMPTZ (metadata only); `*_json` stay **TEXT**; `active` stays **INTEGER**; `target` stays **TEXT**; FK `ON DELETE CASCADE` preserved; everything `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

```sql
CREATE TABLE IF NOT EXISTS tracker_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  activities_json TEXT NOT NULL DEFAULT '[]',
  pillar_weights_json TEXT NOT NULL DEFAULT '{}',
  active_sites_json TEXT NOT NULL DEFAULT '[]',
  years_json TEXT NOT NULL DEFAULT '[]',
  current_month INTEGER NOT NULL DEFAULT 4,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracker_targets (
  site TEXT NOT NULL, activity_ix INTEGER NOT NULL,
  target TEXT NOT NULL DEFAULT '0', active INTEGER NOT NULL DEFAULT 0,
  activity_id INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (site, activity_ix)
);
CREATE TABLE IF NOT EXISTS tracker_inputs (
  year INTEGER NOT NULL, site TEXT NOT NULL, activity_ix INTEGER NOT NULL,
  months_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
  activity_id INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (year, site, activity_ix)
);
CREATE TABLE IF NOT EXISTS tracker_years (
  year INTEGER PRIMARY KEY, active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tracker_pillars (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  year INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, weight REAL NOT NULL,
  display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (year) REFERENCES tracker_years(year) ON DELETE CASCADE,
  UNIQUE (year, code)
);
CREATE INDEX IF NOT EXISTS ix_track_pil_year ON tracker_pillars(year);
CREATE TABLE IF NOT EXISTS tracker_activities (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  pillar_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, kpi_type TEXT NOT NULL,
  start_month INTEGER, end_month INTEGER, display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  legacy_id INTEGER, legacy_num INTEGER, weight REAL DEFAULT 0, shared INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  FOREIGN KEY (pillar_id) REFERENCES tracker_pillars(id) ON DELETE CASCADE,
  UNIQUE (pillar_id, code)
);
CREATE INDEX IF NOT EXISTS ix_track_act_pillar ON tracker_activities(pillar_id);
CREATE INDEX IF NOT EXISTS ix_track_act_code   ON tracker_activities(code);
CREATE TABLE IF NOT EXISTS tracker_targets_v2 (
  year INTEGER NOT NULL, site TEXT NOT NULL, activity_id INTEGER NOT NULL,
  target TEXT NOT NULL DEFAULT '0', active INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (year, site, activity_id),
  FOREIGN KEY (activity_id) REFERENCES tracker_activities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_ttv2_year ON tracker_targets_v2(year);
CREATE TABLE IF NOT EXISTS tracker_inputs_v2 (
  year INTEGER NOT NULL, site TEXT NOT NULL, activity_id INTEGER NOT NULL,
  months_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]', updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (year, site, activity_id),
  FOREIGN KEY (activity_id) REFERENCES tracker_activities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_tiv2_year ON tracker_inputs_v2(year);
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-tracker): Postgres schema 001_init (TDD idempotence)"`

---

## Task 4: Data-copy script `tracker.db` → Postgres (TDD: copy parity)

**Files:** Create `tools/pg/copy-tracker.js`; Modify `tests/pg-tracker.test.js`.

- [ ] **Step 1: Write the failing parity test** — seed a tiny `tracker.db` fixture (config + one year + one pillar + one activity + one v2 input), run the copy, assert Postgres row counts + `months_json` text equal the source. *(Use a temp SQLite file via `SDP_DATA_DIR`.)*
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement `tools/pg/copy-tracker.js`** — open `tracker.db` with `better-sqlite3` (read), apply `001_init.sql` to the target via `pgDb`, then for each table `SELECT *` from sqlite and `INSERT ... ON CONFLICT (<pk>) DO UPDATE` into Postgres inside `runTransaction`. Identity columns (`tracker_pillars.id`, `tracker_activities.id`) are inserted explicitly; afterwards `SELECT setval(pg_get_serial_sequence('tracker_pillars','id'), MAX(id))` to advance the identity sequence past copied ids.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-tracker): tracker.db→Postgres copy script (TDD parity)"`

---

## Task 5: `pgDb`-backed `getDB()` selector + boot wiring (TDD)

**Files:** Modify `tracker-db.js` (the `getDB()`/init area, lines ~124-136); Modify `server.js` (boot).

- [ ] **Step 1: Write a failing test** — with `TRACKER_BACKEND=postgres` + `PG_URL` pointing at a migrated test DB, calling the new async `getTrackerDb()` returns a `pgDb` handle whose `.prepare('SELECT 1 AS x').get()` resolves `{x:1}`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement the selector** — add to `tracker-db.js`:
```javascript
const TRACKER_BACKEND = (process.env.TRACKER_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgTracker() {            // called once at server boot
  const { makePgDb } = require('./services/pgDb');
  _pg = makePgDb(process.env.PG_URL || process.env.DATABASE_URL);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db/postgres/tracker/001_init.sql'), 'utf8'));
  return _pg;
}
function pgHandle() { if (!_pg) throw new Error('pgDb not initialised — await initPgTracker() at boot'); return _pg; }
```
Keep `getDB()` (sqlite) exactly as-is. Export `initPgTracker`, `TRACKER_BACKEND`.
- [ ] **Step 4: Wire boot in `server.js`** — where tracker routes are registered, before `app.listen`:
```javascript
if (require('./tracker-db').TRACKER_BACKEND === 'postgres') {
  await require('./tracker-db').initPgTracker();
  console.log('[Tracker] PostgreSQL backend ready');
}
```
(If `server.js` top-level isn't already async, wrap startup in an async IIFE — verify around the existing `app.listen`.)
- [ ] **Step 5: Run → passes; Commit** — `git commit -am "feat(pg-tracker): TRACKER_BACKEND selector + boot init (TDD)"`

---

## Task 6: Async `postgres` branch for the v2 read/save path (TDD: load/save parity)

**Files:** Modify `tracker-db.js` (`loadTracker` L735, `_loadFromNewSchema` L860, `saveTracker` L1211, `_saveV2` L1154, `_syncYearStructure` L1057).

This is the core. Run all tests with `TRACKER_PER_YEAR_EDITS=1`.

- [ ] **Step 1: Write the failing parity test** — seed identical data into a sqlite tracker and the Postgres test DB (via copy script); assert `loadTracker()` deep-equals across backends; then `saveTracker(D, 'HGO')` + reload round-trips on Postgres; numbers from the engine on the returned `D` match (engine is pure on `D`).
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement the postgres branch.** For each of the 5 functions, add an `async` postgres path selected by `TRACKER_BACKEND`. Mechanical rules:
  - `function f(db, …)` → `async function f(…)` using `pgHandle()` (no `db` arg in pg mode), OR keep signature and pass `pgHandle()`.
  - every `db.prepare(sql).get/all/run(...)` → `await pg.prepare(sql).get/all/run(...)`.
  - `db.transaction(() => {…})()` → `await pg.runTransaction(async () => {…})`.
  - `.run().lastInsertRowid` → `(await …run(...)).lastID` (identity `RETURNING *`).
  - **The 8 ON CONFLICT rewrites** (Postgres-native SQL, written in the pg branch):

  | tracker-db.js (sqlite) | Postgres (pg branch) |
  |---|---|
  | `INSERT OR IGNORE INTO tracker_years (year) VALUES (?)` (L369,1170) | `INSERT INTO tracker_years (year) VALUES (?) ON CONFLICT (year) DO NOTHING` |
  | `INSERT OR REPLACE INTO tracker_targets_v2 (year,site,activity_id,target,active)` (L643,1141) | `... ON CONFLICT (year,site,activity_id) DO UPDATE SET target=EXCLUDED.target, active=EXCLUDED.active, updated_at=now()` |
  | `INSERT OR REPLACE INTO tracker_inputs_v2 (year,site,activity_id,months_json)` (L652,1185) | `... ON CONFLICT (year,site,activity_id) DO UPDATE SET months_json=EXCLUDED.months_json, updated_at=now()` |
  | `INSERT OR REPLACE INTO tracker_config (...)` (L665) | `... ON CONFLICT (id) DO UPDATE SET <each col>=EXCLUDED.<col>` |
  | `INSERT OR REPLACE INTO tracker_targets (site,activity_ix,target,active)` (L678,1239) | `... ON CONFLICT (site,activity_ix) DO UPDATE SET ...` |
  | `INSERT OR REPLACE INTO tracker_inputs (year,site,activity_ix,months_json)` (L692,1254) | `... ON CONFLICT (year,site,activity_ix) DO UPDATE SET ...` |

  (Only the v2 + config + tracker_years statements run in per-year mode; the legacy `tracker_targets/inputs` upserts are reachable via `saveTracker`'s legacy mirror, which is **skipped** when `TRACKER_PER_YEAR_EDITS=1` — so prioritise the v2 ones, port the legacy ones for completeness.)
- [ ] **Step 4: Run → iterate to green** (red→green→refactor per function).
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-tracker): async postgres branch for v2 load/save (TDD parity)"`

---

## Task 7: Year add/delete + reset on Postgres (TDD: FK cascade + RBAC)

**Files:** Modify `tracker-db.js` (`deleteTrackerYear` L1422, `resetTracker` L1314, year-add).

- [ ] **Step 1: Failing tests** — (a) `deleteTrackerYear(N)` removes year N's `tracker_pillars`→`tracker_activities`→`tracker_*_v2` rows via FK CASCADE and leaves year M intact; (b) admin `saveTracker(D,'HGO')` writes only HGO inputs (RBAC), exec/super_admin write all.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** the async postgres path for these (same mechanical rules; `DELETE FROM tracker_years WHERE year=?` triggers the cascades).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-tracker): year delete cascade + RBAC on Postgres (TDD)"`

---

## Task 8: Make the `/api/tracker/*` route handlers async

**Files:** Modify `server.js` — handlers + the 6 `loadTracker()` call sites.

- [ ] **Step 1:** Convert `/api/tracker/load` (~L5270) and `/api/tracker/reset` (~L5598) from `(req,res)=>{…}` to `async (req,res)=>{…}`; `await` every `loadTracker()/saveTracker()/resetTracker()/deleteTrackerYear()` call (sites ~5273, 5341, 5602, 5663 + the post-mutation reloads). Keep response shapes identical.
- [ ] **Step 2: Smoke both backends** — with `TRACKER_BACKEND=sqlite` (default) confirm the existing tracker tests still pass (`node --test --test-force-exit` on any existing tracker test) and a manual `GET /api/tracker/load` works; then `TRACKER_BACKEND=postgres PG_URL=… TRACKER_PER_YEAR_EDITS=1` and confirm load/save/export/year-delete behave identically.
- [ ] **Step 3: Commit** — `git commit -am "feat(pg-tracker): async /api/tracker/* handlers; sqlite path unchanged"`

---

## Task 9: Docs + env + final verification

**Files:** Modify `.env.example`, `CLAUDE.md` (tracker section + a short "pg adapter" note), `tools/pg/README.md` (create).

- [ ] **Step 1:** Document `TRACKER_BACKEND=sqlite|postgres`, `PG_URL`, `PG_POOL_MAX`, `PG_ADMIN_URL` (tests) in `.env.example`; add a CLAUDE.md note pointing at `services/pgDb.js` as the reusable adapter for Chunks 2–4.
- [ ] **Step 2: Full suite green** — `node --test --test-force-exit tests/pg-tracker.test.js` all PASS against Docker PG; verify it **skips cleanly** with the container stopped.
- [ ] **Step 3: Confirm DoD** (spec §9): postgres mode == sqlite mode behaviourally; default sqlite unchanged; prod stays sqlite (no `.env` flip shipped).
- [ ] **Step 4: Commit + open PR (do not merge / deploy)** — `git commit -am "docs(pg-tracker): env + CLAUDE.md + tools/pg README; Chunk 1 done"`.

---

## After Chunk 1 — multi-agent fan-out (roadmap, not this plan)
With the recipe proven, Chunks 2–4 (`meetings.db`, `inspection.db`, `reports.db`) + integration run as **parallel agents in isolated git worktrees**, each copying `services/pgDb.js` + this task pattern, each TDD to green, then an adversarial reviewer per module before merge (per superpowers:dispatching-parallel-agents / a Workflow if opted in).
