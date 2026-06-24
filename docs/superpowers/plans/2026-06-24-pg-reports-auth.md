# reports.db Sub-chunk A (auth/sessions → PostgreSQL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut reports.db's auth/session layer (`users`/`sessions`/`user_roles` + the `sites` table as FK target) onto PostgreSQL behind a reversible `REPORTS_BACKEND` flag, test-first, with zero behavioural change when the flag is `sqlite`.

**Architecture:** Reuse the proven `services/pgDb.js` async adapter (unchanged) + the `tracker-db.js` per-function fork pattern: a `REPORTS_BACKEND=sqlite|postgres` flag, `initPgReports()` at boot, `pgHandle()`, and `if (REPORTS_BACKEND==='postgres') return _fnPg(...)` on each auth function. The forked functions become `async`; every synchronous server.js route consumer + the one cross-module consumer (`inspection-db.js:listPeople`) is converted to `await`. `validateSession` throttles its `last_seen` write to 60s and preloads `.roles` so the role middlewares stay synchronous. Prod stays SQLite (all-or-nothing flip deferred to the end of the whole reports.db migration).

**Tech Stack:** Node.js, `pg` (node-postgres), `better-sqlite3` (sqlite path, unchanged), `node:test`, local PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-06-24-pg-reports-auth-design.md`
**Branch:** `feat/pg-reports-auth`
**Test command (all tasks):** `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-auth.test.js`

---

## File structure

| File | Responsibility |
|---|---|
| `db/postgres/reports/001_auth.sql` *(create)* | Postgres DDL for `sites`→`users`→`user_roles`→`sessions` (FK order), type-preserving, real FKs incl. `sessions.user_id ON DELETE CASCADE`. |
| `tools/pg/copy-reports-auth.js` *(create)* | One-shot `reports.db`→pg copy of the 4 auth tables (FK order; idempotent upsert; advance IDENTITY sequences). |
| `tests/pg-reports-auth.test.js` *(create)* | TDD suite (10 cases incl. the route-level pg-mode test). Reuses `tests/pg-helpers.js`. |
| `reports-db.js` *(modify)* | `REPORTS_BACKEND` flag + `initPgReports`/`pgHandle`; async `_*Pg` forks of the 12 auth functions; exports. `module.exports.db` unchanged; `listSites`/`createSite`/`updateSite`/`userHasRole` NOT forked. |
| `server.js` *(modify)* | Make the 2 auth middlewares + ~11 route handlers `async` + `await`; boot wiring; `/api/meetings/people` handler async. |
| `inspection-db.js` *(modify)* | `listPeople` → `async` + `await rdb.listUsers()`. |
| `routes/inspection.js` *(modify)* | `/api/inspection/people` handler → `async` + `await`. |
| `.env.example` or `tools/pg/README.md` *(modify)* | Document `REPORTS_BACKEND`. |

**Fork framing.** The auth functions already have a clean function API (callers use `rdb.login(...)`, `rdb.validateSession(...)`, not the raw handle), so each gets a sibling `async function _fnPg(...)` and a one-line route at the top of the sqlite function: `if (REPORTS_BACKEND==='postgres') return _fnPg(...)`. Transform rules (from `tracker-db.js`): `db.prepare(sql).get/all/run(...)` → `await pgHandle().prepare(sql).get/all/run(...)`; `db.transaction(()=>{})()` → `await pgHandle().runTransaction(async()=>{})`; `.lastInsertRowid` → `(await …run()).lastID`; `datetime('now')` → `now()`; `INSERT OR IGNORE` → `... ON CONFLICT DO NOTHING`. The pg fork returns a Promise; callers `await` (transparent for sqlite, which returns a plain value).

---

## Task 0: Branch + schema sanity

**Files:** none (verification only).

- [ ] **Step 1: confirm branch + deps + PG**

Run: `git branch --show-current` → `feat/pg-reports-auth`.
Run: `node -e "require('pg'); require('better-sqlite3'); console.log('deps ok')"`.
Run: `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node -e "const{Client}=require('pg');new Client({connectionString:process.env.PG_ADMIN_URL}).connect().then(c=>{console.log('pg ok');return c.end()}).catch(e=>{console.log('pg DOWN:',e.message)})"`
Expected: `deps ok` + `pg ok`.

- [ ] **Step 2: confirm the live auth schema (read-only, to mirror it exactly)**

Run: `grep -nE "CREATE TABLE IF NOT EXISTS (sites|users|sessions|user_roles)" reports-db.js`
Read each definition (sites ~30, users ~38, sessions ~51, user_roles ~374) + any `ALTER TABLE sessions ADD COLUMN last_seen`. Confirm: `users.site_id` has `FOREIGN KEY (site_id) REFERENCES sites(id)` (line 48); `sessions.user_id` has `… REFERENCES users(id) ON DELETE CASCADE` (line 56); `user_roles` is `(user_id, role)` composite PK + FK CASCADE.

---

## Task 1: Postgres auth schema (TDD: idempotence + FKs)

**Files:** Create `db/postgres/reports/001_auth.sql`; Create `tests/pg-reports-auth.test.js`.

- [ ] **Step 1: Write the failing test** (`tests/pg-reports-auth.test.js`)

```javascript
'use strict';
// Sub-chunk A — reports.db auth/sessions → PostgreSQL. TDD. Skips when PG down.
process.env.REPORTS_BACKEND = 'postgres';
const fs = require('fs'); const path = require('path'); const os = require('os');
// Isolate the module-load sqlite handle: reports-db.js opens data/reports.db at
// require time even in pg mode — point it at a throwaway dir so a running prod
// instance's WAL lock can't break (or pollute) the suite.
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-auth-'));
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8');

test('schema: idempotent + real FKs (sessions + user_roles CASCADE, users.site_id)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(SCHEMA); await db.exec(SCHEMA);               // idempotent
    const n = await db.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                WHERE table_name IN ('sites','users','sessions','user_roles')`).get();
    assert.equal(n.n, 4);
    // sessions.user_id FK is ON DELETE CASCADE
    const cas = await db.prepare(`
      SELECT rc.delete_rule FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
      WHERE k.table_name='sessions' AND k.column_name='user_id'`).get();
    assert.equal(cas.delete_rule, 'CASCADE');
    // users.site_id FK exists
    const fk = await db.prepare(`SELECT count(*)::int n FROM information_schema.key_column_usage
      WHERE table_name='users' AND column_name='site_id'
        AND constraint_name LIKE '%fkey%'`).get();
    assert.ok(fk.n >= 1, 'users.site_id FK present');
  } finally { await db.close(); await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run → fails** (file missing). `… node --test … tests/pg-reports-auth.test.js` → FAIL.

- [ ] **Step 3: Write `db/postgres/reports/001_auth.sql`**

```sql
-- reports.db Sub-chunk A — auth/sessions schema. sites→users→user_roles→sessions
-- (FK order). Type-preserving: active INTEGER, AUTOINCREMENT→IDENTITY,
-- DB-managed timestamps TIMESTAMPTZ, session timestamps TIMESTAMPTZ (login writes
-- ISO strings → pg coerces). Real FKs incl. ON DELETE CASCADE. Idempotent.
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  zoho_group TEXT,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  site_id INTEGER REFERENCES sites(id),
  role TEXT DEFAULT 'editor',
  active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT now(),        -- live schema has this (reports-db.js:377)
  PRIMARY KEY (user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_ur_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_ur_role ON user_roles(role);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);
```
> **`active` columns stay `INTEGER` (NOT `BOOLEAN`)** — every `WHERE active=1` predicate depends on it (§5.2 rule). Verify the `user_roles` columns against reports-db.js ~374-382 at implementation time; the DDL above already mirrors `granted_at` + the two indexes the live schema carries.

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git add db/postgres/reports/001_auth.sql tests/pg-reports-auth.test.js && git commit -m "feat(pg-reports): 001_auth schema (TDD idempotence + FKs)"`

---

## Task 2: `REPORTS_BACKEND` selector + boot init (TDD)

**Files:** Modify `reports-db.js` (the `getDB`/module-init area near the top + `module.exports`); Modify `tests/pg-reports-auth.test.js`.

- [ ] **Step 1: Write the failing test** (append)

```javascript
async function boot() {                 // reused by later tests
  const ctx = await provisionTestDb(); if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}
test('reports-db: REPORTS_BACKEND selector + initPgReports applies schema', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    assert.equal(rdb.REPORTS_BACKEND, 'postgres');
    const h = rdb.pgHandle();
    assert.deepEqual(await h.prepare('SELECT 1 AS x').get(), { x: 1 });
    assert.equal((await h.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                   WHERE table_name='users'`).get()).n, 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```

- [ ] **Step 2: Run → fails** (`rdb.REPORTS_BACKEND` undefined).

- [ ] **Step 3: Implement** — add to `reports-db.js` (after the `db`/schema init block, before the auth functions):

```javascript
// ── PostgreSQL backend selector (Sub-chunk A) ────────────────────────────────
const REPORTS_BACKEND = (process.env.REPORTS_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgReports() {            // called once at server boot
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('REPORTS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '001_auth.sql'), 'utf8'));
  return _pg;
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgReports() at boot');
  return _pg;
}
```
Add `REPORTS_BACKEND, initPgReports, pgHandle` to `module.exports` (keep `db` and everything else). Leave the module-level `db = new Database(...)` + sqlite schema exactly as-is (the sqlite handle stays the default; the pg path never touches it).

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-reports): REPORTS_BACKEND selector + initPgReports/pgHandle (TDD)"`

---

## Task 3: Data-copy script (TDD: copy parity)

**Files:** Create `tools/pg/copy-reports-auth.js`; Modify `tests/pg-reports-auth.test.js`.

- [ ] **Step 1: Write the failing parity test** — build a tiny `reports.db` fixture (better-sqlite3 in a temp dir: the 4 auth tables, one site, one user with that `site_id`, two roles, one session), run `copyReportsAuth(sqlitePath, pgHandle)`, assert pg row counts + that `users.site_id` resolves (LEFT JOIN sites) + a bare insert gets `id > maxCopied` (sequence advanced). *(Mirror the structure of `tests/pg-tracker.test.js`'s copy test.)*
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement `tools/pg/copy-reports-auth.js`** — open `reports.db` (better-sqlite3, readonly), apply `001_auth.sql` via the passed `pgDb`, then inside `runTransaction` copy **`sites` → `users` → `user_roles` → `sessions`** (FK order) with `INSERT ... ON CONFLICT (<pk>) DO UPDATE`/`DO NOTHING`; afterwards `setval(pg_get_serial_sequence('sites','id'), GREATEST(MAX(id),1))` and same for `users`. Export `copyReportsAuth(sqlitePath, pg)` + a CLI (`PG_URL=… node tools/pg/copy-reports-auth.js [reports.db path]`). Model on `tools/pg/copy-tracker.js`.
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-reports): reports.db auth copy script (TDD parity)"`

---

## Task 4: Fork login / validateSession / getUserRoles / logout (TDD: round-trip + 60s throttle + roles preload)

**Files:** Modify `reports-db.js` (`login` 736, `validateSession` 748, `getUserRoles` 675, `logout` 764, `safeUser` 805).

- [ ] **Step 1: Write failing tests** — using `boot()`, seed via `pgHandle()` (a site, a user with a known PBKDF2 hash via the module's `hashPassword`, two roles). Then:
  - `login(username,password)` good → `{token,user}`; bad password → null; inactive user → null.
  - `validateSession(token)` → `safeUser` shape incl. **`roles` array preloaded**; expired session → null.
  - **60s throttle**: call `validateSession` twice quickly → `last_seen` unchanged; backdate `last_seen` 2 min (`UPDATE sessions SET last_seen = now() - interval '2 minutes'`) → next `validateSession` bumps it.
  - `logout(token)` → subsequent `validateSession` null.
  - **`userHasRole` sync invariant (spec test #5)** — a SEPARATE `test()` that needs **no boot/PG** (do not skip on PG-down): `const rdb = require('../reports-db'); assert.equal(rdb.userHasRole({roles:['admin']}, 'editor'), true)` (hierarchy grants down), `userHasRole({roles:['tracker-admin']}, 'tracker-admin') === true` (feature role), `userHasRole({roles:['viewer']}, 'admin') === false`. **No `await`** — proves the preloaded-array path stays synchronous (the invariant the role middlewares rely on). Place it before the `boot()`-using tests.

- [ ] **Step 2: Run → fails** (sqlite forks hit the real `reports.db`, wrong/absent data → assertions fail).

- [ ] **Step 3: Implement the forks** — route each at the top, add the async siblings:

```javascript
function login(username, password) {
  if (REPORTS_BACKEND === 'postgres') return _loginPg(username, password);
  /* …existing sqlite body unchanged… */
}
async function _loginPg(username, password) {
  const h = pgHandle();
  const user = await h.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(username);
  if (!user) return null;
  if (hashPassword(password, user.salt) !== user.password_hash) return null;
  const token = makeSession();
  const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
  await h.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(token, user.id, expiresAt);
  return { token, user: await _safeUserPg(user) };
}

function validateSession(token) {
  if (REPORTS_BACKEND === 'postgres') return _validateSessionPg(token);
  /* …existing sqlite body unchanged… */
}
async function _validateSessionPg(token) {
  if (!token) return null;
  const h = pgHandle();
  const s = await h.prepare(`SELECT * FROM sessions WHERE token=? AND expires_at > now()`).get(token);
  if (!s) return null;
  const user = await h.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(s.user_id);
  if (!user) return null;
  try {                                    // 60s throttle (decided)
    await h.prepare(`UPDATE sessions SET last_seen = now()
      WHERE token = ? AND (last_seen IS NULL OR last_seen < now() - interval '60 seconds')`).run(token);
  } catch (_) { /* non-fatal */ }
  return await _safeUserPg(user);          // preloads .roles
}

function getUserRoles(userId) {
  if (REPORTS_BACKEND === 'postgres') return _getUserRolesPg(userId);
  /* …existing sqlite body unchanged… */
}
async function _getUserRolesPg(userId) {
  if (!userId) return [];
  return (await pgHandle().prepare(`SELECT role FROM user_roles WHERE user_id=? ORDER BY role`).all(userId)).map(r => r.role);
}

function logout(token) {
  if (REPORTS_BACKEND === 'postgres') return pgHandle().prepare(`DELETE FROM sessions WHERE token=?`).run(token);
  /* …existing sqlite body unchanged… */
}

// pg variant of safeUser — preloads roles so userHasRole stays sync downstream.
async function _safeUserPg(u) {
  const roles = await _getUserRolesPg(u.id);
  return { id:u.id, username:u.username, full_name:u.full_name, site_id:u.site_id, role:u.role, roles, active:u.active };
}
```
> `safeUser` (sqlite) is unchanged; the pg path uses `_safeUserPg`. `hashPassword`/`makeSession` are pure — reused as-is.

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-reports): login/validateSession/getUserRoles/logout pg forks + 60s throttle (TDD)"`

---

## Task 5: Fork listActiveSessions / forceLogoutByToken (TDD: dialect rewrites)

**Files:** Modify `reports-db.js` (`listActiveSessions` 772, `forceLogoutByToken` 800).

- [ ] **Step 1: Write failing tests** — seed 2 sessions (one with `last_seen = now()`, one backdated 30 min). `listActiveSessions(5)` returns only the fresh one; `seconds_idle` is a **JS number** (`typeof === 'number'`), ROUNDed. `forceLogoutByToken(token)` → `{deleted:1}` then `validateSession` null.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — route + async forks with the dialect rewrites:

```javascript
function listActiveSessions(idleMinutes) {
  if (REPORTS_BACKEND === 'postgres') return _listActiveSessionsPg(idleMinutes);
  /* …existing sqlite body unchanged… */
}
async function _listActiveSessionsPg(idleMinutes) {
  const m = Math.max(1, Math.min(1440, Number(idleMinutes) || 5));
  return pgHandle().prepare(`
    SELECT s.token, s.created_at, s.expires_at,
           COALESCE(s.last_seen, s.created_at) AS last_seen,
           ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(s.last_seen, s.created_at))))::int AS seconds_idle,
           u.id AS user_id, u.username, u.full_name, u.role, site.name AS site_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN sites site ON site.id = u.site_id
    WHERE COALESCE(s.last_seen, s.created_at) > now() - (? * interval '1 minute')
      AND s.expires_at > now() AND u.active = 1
    ORDER BY last_seen DESC`).all(m);
}

function forceLogoutByToken(token) {
  if (REPORTS_BACKEND === 'postgres') return _forceLogoutByTokenPg(token);
  /* …existing sqlite body unchanged… */
}
async function _forceLogoutByTokenPg(token) {
  const r = await pgHandle().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  return { deleted: r.changes };
}
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-reports): listActiveSessions/forceLogout pg forks (TDD dialect)"`

---

## Task 6: Fork user management (TDD: CRUD + both cascades)

**Files:** Modify `reports-db.js` (`listUsers` 818, `createUser` 833, `changePassword` 852, `updateUser` 864, `deleteUser` 903, `setUserRoles` 687).

- [ ] **Step 1: Write failing tests** — `createUser` (+roles via `setUserRoles` tx) → `listUsers` shows the row with `site_name` (LEFT JOIN sites, pg sites copied/seeded) → `updateUser` → `changePassword` (new hash validates via `login`) → seed a session for the user → `deleteUser` → assert **both** cascades: `user_roles` AND `sessions` rows for that user are gone.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement the forks** — route each at the top to an async `_fnPg` mirroring the sqlite body with the transform rules:
  - `_listUsersPg` — same SELECT (LEFT JOIN sites), `await …all()`.
  - `_createUserPg` — `await …run()` (bare INSERT → `RETURNING *` → `.lastID`); then `await _setUserRolesPg(id, roles)`.
  - `_changePasswordPg` / `_updateUserPg` — `await …run()`; preserve the return shape (`{ok:…}` etc.).
  - `_deleteUserPg` — `await pgHandle().prepare('DELETE FROM users WHERE id=?').run(id)` (FK CASCADE clears user_roles + sessions).
  - `_setUserRolesPg` — `await pgHandle().runTransaction(async()=>{ DELETE user_roles; for(r of clean) INSERT ... ON CONFLICT DO NOTHING; UPDATE users SET role=highest; })`. (`INSERT OR IGNORE`→`ON CONFLICT (user_id,role) DO NOTHING`.) Reuse the existing `allowed`/`clean`/`highest` JS logic verbatim.
  > `userHasRole` is **NOT forked** — it reads the preloaded `.roles` array (reports-db.js:716-720) and never the DB in the middleware path. Leave it as-is.

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(pg-reports): user CRUD + setUserRoles pg forks; cascades (TDD)"`

---

## Task 7: Async middleware + route consumers + cross-module listPeople (TDD: route-level pg-mode)

**Files:** Modify `server.js` (2 middlewares + ~9 route handlers + boot wiring); Modify `inspection-db.js` (`listPeople` 490); Modify `routes/inspection.js` (`/api/inspection/people` ~70).

- [ ] **Step 1: Write the failing route-level test** (test #10) — with `REPORTS_BACKEND=postgres` + a booted pg (seed a site, an admin user, a session). **Default approach: direct-handler harness** — do NOT `require('../server.js')` (that triggers a full boot: Zoho scheduling, `_rawCache`, `app.listen`). Instead, replicate each handler's body inline (or extract it) and drive it with the booted `rdb`/`inspectionDb` and a mock `req`/`res` (`res.json = (b)=>{captured=b}`, `res.status = (c)=>{code=c; return res}`). Assert **real JSON arrays/objects, not a serialized Promise** (`assert.ok(Array.isArray(body))` / `assert.ok(!(body instanceof Promise))`), for: the login route (good creds → token; **duplicate-username createUser → 409, not 500** — guards the §Task7 matcher fix), `GET /api/reports/users` (array), `GET /api/reports/sessions/active` (array), and **`GET /api/inspection/people`** (array — the `listUsers→listPeople` cross-module path). Only fall back to supertest if a handler genuinely can't be invoked without the full app.

- [ ] **Step 2: Run → fails** (handlers sync-consume Promises in pg mode).

- [ ] **Step 3: Convert the consumers.** Make each `async` and `await` the forked call. Exact sites (verify line numbers):
  - **`server.js` global `/api/` gate (957-968):** `app.use('/api/', async (req,res,next) => { … const user = await rdb.validateSession(token); … })`.
  - **`requireReportSession` (3921):** `async (req,res,next) => { … const user = await rdb.validateSession(token); … }`.
  - **`/api/health/views` (~599):** handler is **already `async`** — only add `await`: `const user = await validateSession(token)`.
  - **login route (~3975):** add `async`; `const result = await rdb.login(...)`.
  - **logout route (~3997):** add `async`; `await rdb.logout(token)`.
  - **change-password (~4008):** add `async`; `const result = await rdb.changePassword(...)`.
  - **`GET /api/reports/users` (~4100):** add `async`; `res.json(await rdb.listUsers())`.
  - **create/update/delete user (~4109/4122/4131):** add `async`; `await rdb.createUser(...)` etc. **Adapt the UNIQUE-collision matcher** at server.js:4112 — better-sqlite3 throws `UNIQUE constraint failed…` but node-postgres throws `duplicate key value violates unique constraint` with `e.code==='23505'`. Change `if (e.message.includes('UNIQUE'))` → `if (e.code === '23505' || /UNIQUE|duplicate key/i.test(e.message))` so the 409 still fires in pg mode (wrap as `try { await rdb.createUser(...) } catch (e) { …409… }`).
  - **`GET /api/reports/sessions/active` (~4147):** `async`; `const sessions = await rdb.listActiveSessions(idle)`.
  - **force-logout (~4191):** `async`; `const r = await rdb.forceLogoutByToken(token)`.
  - **`inspection-db.js:listPeople` (490):** `async function listPeople(opts={}){ … const users = (await rdb.listUsers() || []).filter(...) … }`.
  - **`routes/inspection.js` `/api/inspection/people` (~70):** handler `async`; `await inspectionDb.listPeople(...)`.
  - **`server.js` `/api/meetings/people` (~5783):** handler `async`; `await inspectionDb.listPeople(...)` (it reuses the same function).
  > The 3 role middlewares (`requireAdmin`/`requireExecutiveOrSuperAdmin`/`requireRole`, 3936-3969) **stay sync** (preloaded `.roles`). Do NOT add `await` there.
  > The ~14 `rdb.listSites().find()/.filter()` chains (server.js 4661+, meetings-db.js:400, inspection-db.js:417) **stay sync** (`listSites` not forked).

- [ ] **Step 4: Boot wiring** — in `server.js` async `start()` before `app.listen` (next to the tracker init ~6352): `if (require('./reports-db').REPORTS_BACKEND==='postgres'){ await require('./reports-db').initPgReports(); console.log('[Reports] PostgreSQL backend ready (auth)'); }`.

- [ ] **Step 5: Run → test #10 passes.** Then `node --check server.js inspection-db.js routes/inspection.js reports-db.js`.

- [ ] **Step 6: Smoke sqlite unchanged** — `node -e "console.log(require('./reports-db').REPORTS_BACKEND)"` (env unset) → `sqlite`; and a quick sqlite-mode login still returns a token (`node -e "const r=require('./reports-db'); console.log(typeof r.login)"`). `node --check` all four files.

- [ ] **Step 7: Commit** — `git commit -am "feat(pg-reports): async auth middleware + route consumers + listPeople cross-module (TDD)"`

---

## Task 8: Docs + env + full verification

**Files:** Modify `tools/pg/README.md` (+ `.env.example` if present); Modify `CLAUDE.md` (one-line note).

- [ ] **Step 1:** Document `REPORTS_BACKEND=sqlite|postgres` + that prod stays sqlite (all-or-nothing flip after B/C/D). Note the `pgHandle()` convention + that B/C/D add `002/003/004_*.sql`.
- [ ] **Step 2: Full suite green** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-auth.test.js` all PASS; verify it **skips cleanly** with PG down (unset `PG_ADMIN_URL`/stop PG).
- [ ] **Step 3: Confirm DoD** (spec §7): postgres mode runs all 12 auth fns; sqlite default unchanged; the §5.4 consumers awaited (incl. listPeople); 3 role middlewares stay sync; `pgHandle` exported; `module.exports.db` unchanged; `services/pgDb.js` NOT modified; prod stays sqlite (no flip).
- [ ] **Step 4: Commit** — `git commit -am "docs(pg-reports): env + CLAUDE.md note; Sub-chunk A done"`.

---

## After Sub-chunk A
B (config + `sites` functions + their sync consumers) · C (report-CRUD) · D (hot read path + Zoho sync + the `reportPayload`/`groupPresets`/inline-server `db`-handle refactor + KPI-reconciliation harness + 47k-row batching). The whole reports.db flips to pg only after D + reconciliation pass.
