# Design — reports.db migration, Sub-chunk A: auth/sessions → PostgreSQL

**Date**: 2026-06-24
**Status**: Approved (design dialogue 2026-06-24). Revised after spec review (rev 2).
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
and a **BIGINT/NUMERIC type-parser** so `COUNT(*)`/`SUM()`/`EXTRACT()` come back as JS
numbers. The cutover pattern is established: a `*_BACKEND=sqlite|postgres` flag,
`initPg*()` at boot, `pgHandle()`, and per-function `if (BACKEND==='postgres') return _fnPg(...)`.

**Why reports.db is the hardest** (discovery, verified): it is the auth backbone + the
hot read path (`request_records` in `_rawCache`) + the highest-volume write path (Zoho
sync) **simultaneously**, and its raw `db` handle **leaks** out of `reports-db.js` into
`services/reportPayload.js`, inline `server.js`, `services/groupPresets.js` +
`risk-register-export.js`, all using synchronous `.prepare().get/all/run`.

**Decomposition (decided):** This spec covers **Sub-chunk A — auth/sessions ONLY** (the
blocking foundation). Others get their own specs:
- **A (this spec)** — `users`, `sessions`, `user_roles` functions + the `sites` table
  (as FK target only — its functions stay sqlite, see §4) + auth middleware + the shared
  `pgHandle()` convention.
- B — config tables + the **`sites` functions** (`listSites`/`createSite`/`updateSite`) +
  `dashboard_preset_groups`, `rr_site_aliases`, `action_departments`, `audit_log`, and the
  conversion of their (and `sites`') sync consumers.
- C — report-CRUD (`weekly_reports`, `helpdesk_data`, `monthly_reports`, `weeks`, …).
- D — hot read path (`request_records` + `_rawCache` + `/api/data/*`) + Zoho sync + the
  `reportPayload`/`groupPresets`/inline-server `db`-handle refactor + the
  KPI-reconciliation harness + 47k-row batching + pool tuning.

**Transition model (decided): all-or-nothing flip.** Sub-chunks are **build/review units,
not independent deploys**. `REPORTS_BACKEND=postgres` migrates the **whole** reports.db at
once (it is one database). Prod stays `REPORTS_BACKEND=sqlite` until A+B+C+D are built AND
the KPI-reconciliation harness (D) passes. A ships behind the flag, fully tested against
pg, but **does not flip prod**.

---

## 2. Scope

**In scope (Sub-chunk A)**
- `REPORTS_BACKEND=sqlite|postgres` flag (default `sqlite`), `initPgReports()`, `pgHandle()`
  exposed (the convention B/C/D reuse to retire the leaked `db` handle).
- `db/postgres/reports/001_auth.sql` — `users`, `sessions`, `user_roles`, **and `sites`**
  (the `sites` table is the FK target for `users.site_id`; its *functions* stay sqlite —
  §4).
- Async `postgres` forks of: `login`, `validateSession` (+ `getUserRoles`), `logout`,
  `listActiveSessions`, `forceLogoutByToken`, `listUsers`, `createUser`, `updateUser`,
  `deleteUser`, `changePassword`, `setUserRoles`, `getUserRoles`. (§5.3)
- The auth middlewares + **every server.js route handler that synchronously consumes a
  forked function** become `async` and `await` (full list §5.4).
- `validateSession` **last_seen 60s throttle** (decided).
- `tools/pg/copy-reports-auth.js` (sqlite → pg) for `sites`, `users`, `user_roles`,
  `sessions` (in that order — FK).
- TDD parity tests (`tests/pg-reports-auth.test.js`) incl. a route-level pg-mode test.

**Explicitly OUT of scope of A**
- **`sites` functions** `listSites`/`createSite`/`updateSite` — they stay **sqlite** in A
  (migrated in sub-chunk B). Rationale: `listSites` is called **synchronously
  cross-module** by `meetings-db.js:400` and `inspection-db.js:417`; forking it to async
  would break meetings/inspection lookups in any `REPORTS_BACKEND=postgres` process. Keeping
  it sync also means the ~12 `rdb.listSites()...` chains in server.js (report/PPTX routes)
  need **no** change in A. The `sites` table still lives in pg (FK target + copied) so B can
  fork the functions later.
- `userHasRole` — **not forked** (see §5.4: it reads the preloaded `.roles` array, never the
  DB, so it stays synchronous — a load-bearing invariant).
- The raw-`db`-handle consumers (`reportPayload`/`groupPresets`/`risk-register`/inline-server
  hot-path/config queries) — B/C/D.
- KPI-reconciliation harness, 47k-row batching, pool tuning (D). Any prod flag flip.

---

## 3. Approach (chosen) & rejected alternatives

**Chosen — `REPORTS_BACKEND` flag + per-function async fork + exposed `pgHandle()`**,
identical in shape to tracker/meetings/inspection. Reuses `services/pgDb.js` unchanged.

**Rejected** — full repository-pattern abstraction (over-engineered now); split-brain
coexistence (user chose all-or-nothing); dual-write (doubles code, doesn't migrate).

---

## 4. The leaked `db` handle + `sites` boundary

`reports-db.js` exports the raw better-sqlite3 handle (`module.exports = { db, … }`),
consumed synchronously outside the module (reportPayload/groupPresets/risk-register/inline
server.js — all B/C/D). **A does NOT touch those consumers.** A's contract:
- Keep `module.exports.db` as the sqlite handle (sqlite mode); **add `pgHandle`** as the
  forward convention (`reportsDb.db.prepare(...)` → `await reportsDb.pgHandle().prepare(...)`
  when B/C/D migrate each consumer).
- A's auth functions use `pgHandle()` internally.
- **`sites` functions stay sqlite in A** (cross-module sync callers, §2). So in
  `REPORTS_BACKEND=postgres`, `users`/`sessions`/`user_roles` go to pg while `sites` reads
  stay sqlite — acceptable because A is build-only (never flipped in prod) and `sites` is a
  small, slow-changing lookup. The `sites` table is mirrored in pg purely as the FK target
  and is populated by the copy script so sub-chunk B can fork the functions cleanly.

---

## 5. Architecture & components

### 5.1 Flag + boot (`reports-db.js`)
```js
const REPORTS_BACKEND = (process.env.REPORTS_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgReports() {
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
Boot wiring in `server.js` inside async `start()` before `app.listen` (next to tracker's,
~6352): `if (require('./reports-db').REPORTS_BACKEND==='postgres'){ await require('./reports-db').initPgReports(); console.log('[Reports] PostgreSQL backend ready (auth)'); }`.
B/C/D add `002_…sql`/`003`/`004`, applied by the same idempotent `initPgReports()`.

### 5.2 Schema — `db/postgres/reports/001_auth.sql`
DDL for the four tables, **`sites` created before `users`** (FK order). Mirror the EXACT
live columns from `reports-db.js` `_initSchema` (incl. idempotent-ALTER columns folded into
CREATE). Confirmed live shapes:
- `sites` (reports-db.js:30-36) — `id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`,
  `name TEXT UNIQUE NOT NULL`, `zoho_group TEXT`, **`active INTEGER DEFAULT 1`**,
  `sort_order INTEGER DEFAULT 0`. (Keep all five — do NOT drop `sort_order`.)
- `users` (reports-db.js:38-50) — `id` IDENTITY PK; `username TEXT UNIQUE NOT NULL`;
  `password_hash`/`salt`/`full_name`/`role` TEXT; **`site_id INTEGER REFERENCES sites(id)`**
  (the FK **does** exist in sqlite — line 48 — and `foreign_keys=ON`; keep it);
  **`active INTEGER DEFAULT 1`**; `created_at TIMESTAMPTZ DEFAULT now()`.
- `sessions` (reports-db.js:51-58, +`last_seen` ALTER) — `token TEXT PRIMARY KEY`;
  `user_id INTEGER`; **`expires_at`/`created_at`/`last_seen` TIMESTAMPTZ** (login writes ISO
  strings via `toISOString()` — pg coerces on INSERT; all comparisons use `now()`). Indices
  on `(user_id)`, `(expires_at)`.
- `user_roles` (reports-db.js:374-380) — composite `PRIMARY KEY (user_id, role)`;
  `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` (`deleteUser` relies on this).

Type rules: boolean-ish INTEGER stays INTEGER; `AUTOINCREMENT`→IDENTITY; `datetime('now')`→
`now()`; idempotent (`IF NOT EXISTS`).

### 5.3 Function forks (`reports-db.js`)
Route at top `if (REPORTS_BACKEND==='postgres') return _fnPg(...)`; sqlite body unchanged.

| Function | line | pg-fork notes |
|---|---|---|
| `login` | 736 | SELECT user by username+active; PBKDF2 (`hashPassword`, pure) unchanged; bare INSERT session (adapter appends `RETURNING *`). |
| `validateSession` | 748 | SELECT session `WHERE token=? AND expires_at > now()`; SELECT user; **preload roles** (await `getUserRoles`) into `safeUser` so `userHasRole` stays sync (§5.4 invariant); **60s throttle** write (§5.5). |
| `getUserRoles` | (used by `safeUser` 807) | SELECT roles for a user_id → `string[]`. |
| `logout` | 764 | DELETE session by token. |
| `listActiveSessions` | 772 | dialect rewrites (§5.3a). |
| `forceLogoutByToken` | 800 | DELETE; `{ deleted: r.changes }`. |
| `listUsers` | 818 | SELECT users LEFT JOIN sites. (`sites` rows exist in pg — copied.) |
| `createUser` | ~845 | INSERT (`.lastInsertRowid`→`.lastID`); then `setUserRoles` (tx). |
| `updateUser` | ~884 | UPDATE. |
| `deleteUser` | ~904 | DELETE (user_roles FK CASCADE). |
| `changePassword` | ~860 | UPDATE password_hash+salt; returns `{ok:…}`. |
| `setUserRoles` | (grep) | `db.transaction`→`await runTransaction`; DELETE + INSERT roles. |

**NOT forked in A:** `userHasRole` (reads `.roles` array, no DB — §5.4); `listSites`/
`createSite`/`updateSite` (stay sqlite — §4); `safeUser` stays a pure helper but the pg
`validateSession` path must `await getUserRoles` before calling it (or inline the roles read).

**§5.3a — `listActiveSessions` dialect rewrites:**
- `datetime('now','-'||?||' minutes')` → `now() - (? * interval '1 minute')`.
- `julianday('now') - julianday(x)` (seconds_idle) → `EXTRACT(EPOCH FROM (now() - x))`; wrap
  with **`ROUND(...)::int`** to match sqlite's `ROUND(...)` (NOT a bare `::int`, which would
  truncate and drift up to ~1s).
- `COALESCE(last_seen, created_at)` and the JOINs carry over unchanged.

### 5.4 Async ripple — middlewares **and** every sync route consumer (`server.js`)
The forked functions return Promises in pg mode; **every synchronous call site that
inspects/serializes the return value must become `async` + `await`** or it breaks in pg
mode. Full list to convert (verify line numbers at implementation time):

| Site | Function | Why it breaks unconverted |
|---|---|---|
| `/api/` global gate (~957/964) | `validateSession` | Promise truthy → wrong user; gate must await. |
| `requireReportSession` (~3921) | `validateSession` | same. |
| `/api/health/views` (~599) | `validateSession` | **3rd consumer** — `user.role` on a Promise → 403. |
| login route (~3975) | `login` | `if(!result)` truthy → bad creds never 401; `result.token` undefined. |
| logout route (~3997) | `logout` | fire-and-forget DELETE; await for correctness. |
| change-password (~4008) | `changePassword` | `result.ok` undefined → 400. |
| list users (~4100) | `listUsers` | serializes a Promise → empty body. |
| create/update/delete user (~4109/4122/4131) | `createUser`/`updateUser`/`deleteUser` | UNIQUE `catch` (4112) never fires on async rejection → unhandled rejection instead of 409. |
| active sessions (~4147) | `listActiveSessions` | `sessions.map` not a function → 500. |
| force-logout (~4191) | `forceLogoutByToken` | `r.deleted` undefined. |

**Load-bearing invariant (state explicitly):** `requireAdmin`/`requireExecutiveOrSuperAdmin`/
`requireRole` (~3936-3969) call `userHasRole(req.reportUser, …)`, which uses the **preloaded
`req.reportUser.roles` array** and never hits the DB — so those three middlewares **stay
synchronous**. This holds ONLY IF the pg `validateSession`/`safeUser` path preloads `.roles`
(it does — §5.3). If that preload were dropped, these middlewares would silently mis-authorize.

**Not converted (because their functions stay sqlite-sync in A):** the ~12 `rdb.listSites()
.find()/.filter()` chains across server.js report/PPTX routes (~4026/4045/4086/4661/4670/…),
and `meetings-db.js:400` / `inspection-db.js:417`. They keep working unchanged because
`listSites` is not forked in A.

Express supports async middleware/handlers; the converted handlers already exit via
`next()`/`res.json()`/`res.status()`. `await` is transparent for the sqlite path.

### 5.5 `last_seen` 60s throttle (decided)
```sql
UPDATE sessions SET last_seen = now()
 WHERE token = @token AND (last_seen IS NULL OR last_seen < now() - interval '60 seconds')
```
No extra read (the row was already SELECTed), idempotent, safe under concurrency. Active
Sessions card uses ≥1-min windows → 60s granularity is lossless. sqlite path keeps its
unconditional per-request write (unchanged).

### 5.6 Data copy — `tools/pg/copy-reports-auth.js`
Reads `reports.db` → writes **`sites` → `users` → `user_roles` → `sessions`** (FK order)
via `pgDb` (idempotent upsert on PK), advancing `sites`/`users` IDENTITY sequences past
copied ids (same pattern as `copy-tracker.js`). pg coerces the ISO-string timestamps on
INSERT. Expired sessions may be skipped.

### 5.7 Tests — `tests/pg-reports-auth.test.js`
TDD against local PG (reuse `tests/pg-helpers.js`; run with
`PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres'` — the harness
default port differs from the local PG). `process.env.REPORTS_BACKEND='postgres'` at top.
Cases:
1. schema idempotence (apply 001_auth twice; 4 tables present; `users.site_id` FK present).
2. `login` (good/bad password, inactive user) → `validateSession` round-trip → `safeUser`
   shape (id/username/role/**roles[]**/site_id/active) — assert `.roles` is preloaded.
3. **60s throttle**: validate twice quickly → `last_seen` unchanged; backdate `last_seen`
   >60s → next validate bumps it.
4. session expiry: `expires_at` in the past → `validateSession` null.
5. `userHasRole` RBAC (hierarchical + feature) on a preloaded user object (no DB) — confirm
   it works without `await`.
6. `listActiveSessions(idleMinutes)` window (rewritten interval/EXTRACT SQL) → right rows +
   `seconds_idle` as a JS **number** (assert `typeof === 'number'`), `ROUND`ed.
7. `forceLogoutByToken` → `{deleted:1}` then `validateSession` null.
8. user CRUD: `createUser` (+ `setUserRoles` tx) → `listUsers` → `updateUser` →
   `changePassword` (new hash validates) → `deleteUser` (user_roles cascade gone).
9. seed a `sites` row + `createUser` with that `site_id` → FK satisfied; `listUsers` shows
   `site_name`.
10. **route-level pg-mode smoke** (the §5.4 ripple guard): drive the actual handlers (direct
    invocation or supertest) for the login route, `/api/reports/users` (list), and
    `/api/reports/sessions/active` under `REPORTS_BACKEND=postgres`; assert real JSON bodies
    (not a serialized Promise). This is the only case that catches a missed `await`.
- Plus: **sqlite path unchanged** smoke (`require('./reports-db').REPORTS_BACKEND` ⇒ `sqlite`;
  existing auth works), `node --check` on touched files.

---

## 6. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Missed `await` at a sync route consumer → broken login/users/sessions in pg mode | §5.4 enumerates every site; **test #10** drives the actual handlers under pg to catch any miss. |
| `userHasRole`/admin middlewares accidentally made async or `.roles` preload dropped | §5.3/§5.4 invariant: pg `validateSession` MUST preload `.roles`; test #2 asserts it; keep `userHasRole` unforked. |
| `listSites` async breaking meetings/inspection | Scoped OUT of A — `listSites` stays sqlite-sync; meetings-db:400 / inspection-db:417 untouched. |
| `users.site_id` FK ordering on copy | Copy `sites` before `users` (§5.6); `001_auth.sql` creates `sites` before `users`. |
| `expires_at`/`last_seen` TEXT(sqlite)→TIMESTAMPTZ(pg) | Columns are TIMESTAMPTZ; `login`'s `toISOString()` write is unchanged, pg coerces; comparisons use `now()`. |
| Pool exhaustion | Auth-only is light; `PG_POOL_MAX=10` fine for A. Real tuning deferred to D (noted). |

---

## 7. Definition of done (Sub-chunk A)
- `REPORTS_BACKEND=postgres` runs `login`/`validateSession`/`logout`/`listActiveSessions`/
  `forceLogoutByToken`/`listUsers`/`createUser`/`updateUser`/`deleteUser`/`changePassword`/
  `setUserRoles`/`getUserRoles` against pg; `tests/pg-reports-auth.test.js` green (incl. the
  route-level pg-mode test #10); skips clean with PG down.
- `REPORTS_BACKEND=sqlite` (default) byte-identical; existing auth unaffected.
- Every server.js sync consumer in §5.4 is `async`+`await`ed; the three role middlewares stay
  sync via the preloaded `.roles` invariant; a real login + a user-management + an
  active-sessions request all succeed under both backends.
- `listSites`/`createSite`/`updateSite` remain sqlite-backed (unchanged); meetings/inspection
  lookups unaffected.
- `pgHandle` exported; `module.exports.db` unchanged.
- Prod stays `sqlite` (no flag flip). Nothing deployed. `services/pgDb.js` NOT modified.

---

## 8. Open items (for B/C/D, not this spec)
- `sites` functions (`listSites`/`createSite`/`updateSite`) + their sync consumers — sub-chunk B.
- The raw-`db`-handle refactor (`reportPayload`/`groupPresets`/`risk-register`/inline-server).
- KPI-reconciliation harness (sqlite vs pg equality per aggregate) — gates the flip.
- 47k-row `upsertRequestBatch` multi-row/`COPY` batching; `survey_answers` `ON CONFLICT` target.
- `_rawCache` async boot; pool-size + PgBouncer evaluation.
