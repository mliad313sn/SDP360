# Design — reports.db migration, Sub-chunk A: auth/sessions → PostgreSQL

**Date**: 2026-06-24
**Status**: Approved (design dialogue 2026-06-24).
**Branch**: `feat/pg-reports-auth`
**Audience**: Implementer (this repo) + reviewers.

---

## 1. Context & goal

`endeavour-dashboard` (Node/Express, PM2, port 3456) persists data in four SQLite
files via `better-sqlite3` (synchronous). The PostgreSQL migration is underway:

| DB | Chunk | State |
|---|---|---|
| `tracker.db` | 1 | ✅ done, merged to `main` (`TRACKER_BACKEND` flag) |
| `meetings.db` | 2 | 🔨 in progress (`feat/pg-meetings` + `agent/pg-meetings` worktree) |
| `inspection.db` | 3 | 🔨 in progress (`agent/pg-inspection` worktree) |
| `reports.db` | **4** | this effort — **the hardest** |

The reusable async adapter **`services/pgDb.js`** is proven (Chunk 1) and already
supports better-sqlite3 **named `@param` binding** (`.run(obj)`/`.get(obj)`/`.all(obj)`)
and a **BIGINT type-parser** so `COUNT(*)`/`SUM()` return JS numbers. The cutover
pattern is established: a `*_BACKEND=sqlite|postgres` flag, `initPg*()` at boot,
`pgHandle()`, and per-function `if (BACKEND==='postgres') return _fnPg(...)` forks.

**Why reports.db is the hardest** (discovery, verified): it is the auth backbone +
the hot read path (`request_records` cached in `_rawCache`) + the highest-volume
write path (Zoho sync, ~47k-row upsert) **simultaneously**, and its raw `db` handle
**leaks** out of `reports-db.js` into `services/reportPayload.js` (7 call sites),
inline `server.js` (4), `services/groupPresets.js` + `risk-register-export.js` (via a
`db` parameter), and 2 test files — all using synchronous `.prepare().get/all/run`.

**Decomposition (decided):** reports.db is four coupled sub-systems. This spec covers
**Sub-chunk A — auth/sessions ONLY** (the blocking foundation; everything else depends
on auth). The others get their own specs later:

- **A (this spec)** — `users`, `sessions`, `user_roles`, `sites` + auth functions +
  auth middleware + the shared `pgHandle()` access convention.
- B — config tables (`dashboard_preset_groups`, `rr_site_aliases`, `action_departments`, `audit_log`).
- C — report-CRUD (`weekly_reports`, `helpdesk_data`, `monthly_reports`, `weeks`, …).
- D — hot read path (`request_records` + `_rawCache` + `/api/data/*` aggregates) + Zoho
  sync writes + the `reportPayload`/`groupPresets`/inline-server `db`-handle refactor +
  the KPI-reconciliation harness + 47k-row batching + pool tuning.

**Transition model (decided): all-or-nothing flip.** Sub-chunks are **build/review
units, not independent deploys**. `REPORTS_BACKEND=postgres` migrates the **whole**
reports.db at once (it is one database — you cannot run `users` on pg while
`request_records` stays on sqlite and remain coherent). Prod stays
`REPORTS_BACKEND=sqlite` until A+B+C+D are all built AND the KPI-reconciliation harness
(D) passes. So A ships behind the flag, fully tested against pg, but **does not flip
prod**.

---

## 2. Scope

**In scope (Sub-chunk A)**
- `REPORTS_BACKEND=sqlite|postgres` flag (default `sqlite`), `initPgReports()` (connect
  pool + apply auth schema), `pgHandle()` — **exposed** (the access convention B/C/D
  reuse to retire the leaked `db` handle).
- `db/postgres/reports/001_auth.sql` — **auth tables only**: `users`, `sessions`,
  `user_roles`, `sites`.
- Async `postgres` forks of the auth/session/user/sites functions (see §5.3).
- The **two auth middlewares** become `async` (`requireReportSession` + the global
  `/api/` gate) and `await validateSession`.
- `validateSession` **last_seen 60s throttle** (decided).
- A one-shot `copy-reports-auth.js` (sqlite → pg) for those 4 tables.
- TDD parity tests (`tests/pg-reports-auth.test.js`).

**Out of scope (own specs)**
- Sub-chunks B, C, D (config, report-CRUD, hot path + sync).
- The `reportPayload.js`/`groupPresets.js`/`risk-register-export.js`/inline-`server.js`
  raw-`db`-handle refactor (that's where those consumers live — B/C/D).
- KPI-reconciliation harness, 47k-row batching, pool-size tuning (D).
- Any prod flag flip (deferred to the end of the whole reports.db migration).

---

## 3. Approach (chosen) & rejected alternatives

**Chosen — `REPORTS_BACKEND` flag + per-function async fork + exposed `pgHandle()`**,
identical in shape to tracker/meetings/inspection. The auth functions already have a
clean function API (`login`/`validateSession`/…), so A forks those; the leaked raw
handle is a B/C/D concern, but A **establishes** the `pgHandle()` convention those
sub-chunks will use. Reuses `services/pgDb.js` unchanged.

**Rejected — full repository-pattern / DB-agnostic interface.** Over-engineered now;
the migration is evolving toward a shared layer organically (`pgDb` + `pgHandle`)
without paying the abstraction cost upfront. (Same call as Chunk 1.)

**Rejected — split-brain coexistence** (flip auth to pg in prod while the hot path
stays sqlite). Two live stores during transition, drift risk, Zoho sync still feeding
sqlite. User chose all-or-nothing.

**Rejected — dual-write.** Doubles write code; doesn't actually migrate. (Same call as
Chunk 1.)

---

## 4. The leaked `db` handle — A's boundary

`reports-db.js` exports the raw better-sqlite3 handle (`module.exports = { db, … }`),
consumed synchronously **outside** the module. **A does NOT touch those consumers**
(they read `request_records`/presets — B/C/D). A's contract:

- Keep `module.exports.db` as the sqlite handle (sqlite mode), so the not-yet-migrated
  consumers keep compiling. (Under all-or-nothing, pg mode is never deployed with only
  A done, so this never runs split-brain in prod.)
- **Add `pgHandle` to the exports** as the forward convention: when B/C/D migrate
  `reportPayload`/`groupPresets`/inline-server, they rewrite
  `reportsDb.db.prepare(sql).get/all/run(...)` → `await reportsDb.pgHandle().prepare(sql).get/all/run(...)`.
- A's auth functions use `pgHandle()` internally (not the exported `db`), so no consumer
  outside reports-db.js changes in A.

---

## 5. Architecture & components

### 5.1 Flag + boot (`reports-db.js`)
```js
const REPORTS_BACKEND = (process.env.REPORTS_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgReports() {            // called once at server boot
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('REPORTS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(fs.readFileSync(path.join(__dirname,'db','postgres','reports','001_auth.sql'),'utf8'));
  return _pg;
}
function pgHandle() { if (!_pg) throw new Error('pgDb not initialised — await initPgReports() at boot'); return _pg; }
```
Boot wiring in `server.js` inside async `start()` before `app.listen` (next to tracker's):
```js
if (require('./reports-db').REPORTS_BACKEND === 'postgres') {
  await require('./reports-db').initPgReports();
  console.log('[Reports] PostgreSQL backend ready (auth)');
}
```
> Note: when B/C/D land, `001_auth.sql` is joined by `002_config.sql`/`003_reports.sql`/
> `004_requests.sql`, all applied by the same `initPgReports()` (idempotent). A ships
> only `001_auth.sql`.

### 5.2 Schema — `db/postgres/reports/001_auth.sql`
Postgres DDL for the four auth tables, type-preserving:
- `users` — `id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`; `username TEXT UNIQUE`;
  `password_hash`/`salt`/`full_name`/`role` TEXT; `site_id INTEGER`; **`active INTEGER`**
  (code does `WHERE active=1` and reads `u.active`); `created_at TIMESTAMPTZ DEFAULT now()`.
- `sessions` — `token TEXT PRIMARY KEY`; `user_id INTEGER`; **`expires_at`/`created_at`/
  `last_seen` TIMESTAMPTZ** (login writes ISO strings → pg coerces; comparisons use
  `now()`). Index on `(user_id)` and `(expires_at)`.
- `user_roles` — composite `PRIMARY KEY (user_id, role)`; `FOREIGN KEY (user_id) REFERENCES
  users(id) ON DELETE CASCADE`.
- `sites` — `id` IDENTITY PK; `name TEXT`; `zoho_group TEXT`; **`active INTEGER`**; plus the
  other columns the live `sites` schema carries (the implementer mirrors the exact column
  set from `reports-db.js` `_initSchema`, including idempotent-ALTER columns folded into
  CREATE). `sites` is the FK target for `users.site_id` (kept as a plain INTEGER column,
  **no FK** — mirrors sqlite, where `users.site_id` is not a declared FK — to avoid
  ordering/seed coupling; verify against `_initSchema` and preserve whatever sqlite does).

Type rules (same as prior chunks): `*_json`→TEXT (none in the auth tables), boolean-ish
INTEGER stays INTEGER, `AUTOINCREMENT`→IDENTITY, `datetime('now')`→`now()`, idempotent.

### 5.3 Function forks (`reports-db.js`)
Each routes at the top `if (REPORTS_BACKEND==='postgres') return _fnPg(...)`; the sqlite
body is unchanged. Forks (file:line for reference):

| Function | line | Notes for the pg fork |
|---|---|---|
| `login` | 736 | SELECT user by username+active; PBKDF2 (`hashPassword`, pure) unchanged; INSERT session. |
| `validateSession` | 748 | SELECT session `WHERE token=? AND expires_at > now()`; SELECT user; **+ roles** (`getUserRoles` fork, see below); **60s last_seen throttle** (see §5.5). 3 reads + ≤1 write. |
| `logout` | 764 | DELETE session by token. |
| `listActiveSessions` | 772 | **SQL-dialect rewrites** — `julianday('now')-julianday(x)`→`EXTRACT(EPOCH FROM (now()-x))`; `datetime('now','-'||?||' minutes')`→`now() - (? * interval '1 minute')`; `COALESCE(last_seen,created_at)` unchanged; `CAST(... AS INTEGER)`→`::int`. |
| `forceLogoutByToken` | 800 | DELETE; return `{ deleted: r.changes }` (pgDb `.run()` returns `{changes}`). |
| `getUserRoles` | (used by `safeUser` 807) | SELECT roles for a user_id → `string[]`. Needed by `validateSession`'s pg path. |
| `userHasRole` | (grep) | role-hierarchy check; reads roles — pg fork or reuse `getUserRoles`. |
| `listUsers` | 818 | SELECT users JOIN sites. |
| `createUser` | ~845 | INSERT (reads `.lastInsertRowid`→`.lastID`); `setUserRoles` (tx). |
| `updateUser`/`deleteUser`/`changePassword` | ~860-904 | UPDATE/DELETE; `deleteUser` relies on `user_roles` FK CASCADE. |
| `setUserRoles` | (grep) | `db.transaction`→`await runTransaction`; DELETE + INSERT roles. |
| `listSites` | (grep) | SELECT sites; consumed by meetings/inspection `loadLookups` (still sqlite — unaffected because A is build-only, not flipped). |

`safeUser` (805) stays pure JS but its `getUserRoles(u.id)` call becomes `await`ed inside
the `validateSession` pg fork (so `safeUser` itself either becomes async or the pg fork
inlines the roles read — implementer's choice, plan will pin it).

### 5.4 Async middleware (`server.js`)
Two middlewares gate auth and must `await validateSession`:
- The global **`/api/` gate** (`app.use('/api/', …)`, ~`server.js:957`) — becomes `async`,
  `await rdb.validateSession(...)`.
- **`requireReportSession`** (~`server.js:3921`) — becomes `async`, `await`.

Express supports async middleware (a returned promise; errors must still be caught — both
already branch to `res.status(401)`/`next()`). This is the **only** ripple in A: every
`/api/*` route flows through these two, but the routes themselves are unchanged (they call
`next()` after the gate sets `req.reportUser`). Forks return a Promise in pg mode and a
plain value in sqlite mode; `await` works for both.

### 5.5 `last_seen` 60s throttle (decided)
`validateSession` already SELECTs the session row (which carries `last_seen`). The pg fork
issues the UPDATE **only when** `now() - last_seen > 60s`:
```sql
UPDATE sessions SET last_seen = now()
 WHERE token = @token AND (last_seen IS NULL OR last_seen < now() - interval '60 seconds')
```
No extra read, no in-memory state, naturally correct under concurrency. The Active Sessions
card uses idle windows ≥1 min, so 60s granularity is lossless for it. (sqlite path keeps its
unconditional per-request write — unchanged.)

### 5.6 Data copy — `tools/pg/copy-reports-auth.js`
Reads `reports.db` (better-sqlite3) → writes `users`, `sites`, `user_roles`, `sessions`
into pg via `pgDb` (idempotent upsert on PK), advancing the `users`/`sites` IDENTITY
sequences past copied ids (same pattern as `copy-tracker.js`). Sessions are optional to
copy (they're ephemeral; a fresh login re-creates them) — copy them for parity but it's
acceptable to skip expired ones.

### 5.7 Tests — `tests/pg-reports-auth.test.js`
TDD against the local PG (`PG_ADMIN_URL`, skip-clean when down), reusing
`tests/pg-helpers.js`. `process.env.REPORTS_BACKEND='postgres'` at top. Cases:
1. schema idempotence (apply 001_auth twice; 4 tables present).
2. `login` (good/bad password, inactive user) → `validateSession` round-trip → `safeUser`
   shape (id/username/role/roles[]/site_id/active).
3. **60s throttle**: validate twice quickly → `last_seen` unchanged; force `last_seen` to
   >60s ago → next validate bumps it.
4. session expiry: `expires_at` in the past → `validateSession` returns null.
5. `userHasRole` RBAC (hierarchical + feature roles).
6. `listActiveSessions(idleMinutes)` window (the rewritten `interval`/`EXTRACT` SQL) returns
   the right rows + `seconds_idle` as a number.
7. `forceLogoutByToken` → `{deleted:1}` then `validateSession` null.
8. user CRUD: `createUser` (+ `setUserRoles` tx) → `listUsers` → `updateUser` →
   `changePassword` (new hash validates) → `deleteUser` (user_roles cascade gone).
9. `listSites` returns rows.
- Plus: **sqlite path unchanged** smoke (`require('./reports-db').REPORTS_BACKEND` ⇒
  `sqlite`; existing auth still works), and `node --check` on touched files.

---

## 6. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Async-middleware ripple breaks routes | Only 2 middlewares change; they already exit via `next()`/`res`; `await` is transparent for the sqlite path. Smoke a real `GET /api/...` under both backends. |
| `expires_at`/`last_seen` TEXT-vs-TIMESTAMPTZ coercion | Store as TIMESTAMPTZ; login writes `toISOString()` (pg coerces); all comparisons use `now()`. Copy script lets pg coerce the ISO strings. |
| `getUserRoles` extra read per request | Unchanged from sqlite (it already reads roles per validation via `safeUser`); throttle only removes the *write*. Roles read is one indexed lookup; pool sizing flagged for D. |
| Pool exhaustion under load | Auth-only is light; `PG_POOL_MAX` default 10 is fine for A. Real tuning is a D concern (hot path + 47k sync) — explicitly deferred, noted here. |
| `module.exports.db` consumed in pg mode | Out of scope for A; all-or-nothing means pg mode isn't deployed until B/C/D retire those consumers. A only *adds* `pgHandle`. |

---

## 7. Definition of done (Sub-chunk A)
- `REPORTS_BACKEND=postgres` runs the auth/session/user/sites functions against pg;
  `tests/pg-reports-auth.test.js` green; skips clean with PG down.
- `REPORTS_BACKEND=sqlite` (default) behaviour byte-identical; existing auth unaffected.
- The two auth middlewares are async and await `validateSession`; a real `/api/*` request
  authenticates under both backends.
- `pgHandle` exported (convention for B/C/D). `module.exports.db` unchanged.
- Prod stays `sqlite` (no flag flip). Nothing deployed.
- `services/pgDb.js` NOT modified.

---

## 8. Open items (for B/C/D, not this spec)
- The raw-`db`-handle refactor (`reportPayload`/`groupPresets`/`risk-register`/inline-server).
- KPI-reconciliation harness (sqlite vs pg equality on every aggregate) — gates the flip.
- 47k-row `upsertRequestBatch` multi-row/`COPY` batching.
- `survey_answers` `ON CONFLICT` needs an explicit unique target (D).
- `_rawCache` async boot; pool-size + PgBouncer evaluation.
