# Chunk 4B-RR — risk-register (rr_site_aliases) → PostgreSQL (design spec)

**Date:** 2026-06-26
**Status:** approved (pending spec-review + user review)
**Branch:** `feat/pg-reports-4b-rr` (off `main`)
**Depends on:** Chunks 4A–4D-2d + 4D-wiring-1/2 — all merged. The deferred risk-register slice from
4B. Mirrors the **groupPresets** fork (4B Task 4) exactly: `_h(db)` resolver + async module fns +
pg schema in `002_config.sql` + pg seed in `_seedConfigPg`.

---

## Goal

Fork `risk-register-export.js` (the Risk Register monthly Occurrence export + the `rr_site_aliases`
admin CRUD) to PostgreSQL behind `REPORTS_BACKEND=postgres`. The module currently runs every query on
the raw sqlite handle (`rdb.db` passed in by server.js) → in pg mode it reads the empty sqlite DB. After
this, the export + the 4 alias-config routes work in pg mode. One of the last two isolated pieces before
the prod flip (the other is the `/api/survey/voice` follow-up + the KPI reconciliation).

**Why safe in sqlite mode:** the module fns become `async`; their ONLY callers are the server routes
(no un-awaited legacy caller — `buildRiskRegisterExport` is already awaited; the 4 CRUD routes get
`await`). `await` on a non-Promise (sqlite path) is a no-op.

## Scope

### 1. pg schema — `rr_site_aliases` in `002_config.sql`

Add (mirroring the sqlite `_initConfigSchema` shape, TEXT→TEXT, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
→ `TIMESTAMPTZ DEFAULT now()`):
```sql
CREATE TABLE IF NOT EXISTS rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);
```
`initPgReports` already applies `002_config.sql` (4B) so no boot wiring change.

### 2. pg seed — in `_seedConfigPg` (reports-db.js)

Mirror the existing groupPresets seed block: lazy-require the module for `DEFAULT_SITE_ALIASES`
(exported), seed-if-empty:
```js
// rr_site_aliases — reuse risk-register's DEFAULT_SITE_ALIASES (lazy require; the module requires
// reports-db lazily inside _h(), so the cycle resolves at call-time).
const rr = require('./risk-register-export');
const n = Number((await H.prepare('SELECT COUNT(*) AS n FROM rr_site_aliases').get()).n);
if (n === 0) {
  for (const [label, code] of Object.entries(rr.DEFAULT_SITE_ALIASES)) {
    await H.prepare('INSERT INTO rr_site_aliases (sdp_label, code, updated_by) VALUES (?, ?, ?) ON CONFLICT (sdp_label) DO NOTHING').run(label, code, '_system');
  }
}
```
Idempotent (count-guard + `ON CONFLICT DO NOTHING`). Runs on every `initPgReports` (no-op when populated).

### 3. `risk-register-export.js` fork — `_h(db)` + async fns

Add the `_h(db)` resolver (copy from `services/groupPresets.js`):
```js
function _h(db) {
  const rdb = require('./reports-db');   // lazy — rdb does NOT require this module at load time
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: db, isPg: false };
}
```
Make these **DB-touching fns `async`** and route every query through `_h(db).H` with `await`:
- **`_initConfigSchema(db)`** — pg: `return` early (schema via `002_config.sql`, seed via `_seedConfigPg`
  — mirrors groupPresets `_initSchema`). sqlite: existing `CREATE TABLE` + seed-if-empty (unchanged).
  Add a `_sqliteSchemaReady` guard (the existing repeated-call-safe behaviour stays).
- **`getSiteAliases(db)`** — `await H.prepare('SELECT sdp_label, code FROM rr_site_aliases').all()`;
  keep the try/catch → `DEFAULT_SITE_ALIASES` fallback.
- **`loadOccurrencesFromDB(db, month)`** — `await getSiteAliases(db)`; `await H.prepare(<request_records
  SELECT>).all(startISO, endISO)`. The SELECT (`created_time >= ? AND created_time < ?` raw-ISO TEXT
  cutoffs, `request_type LIKE '%Incident%'`, `COALESCE(category,'') != 'Inspection'`) is dialect-safe
  → UNCHANGED. JS aggregation reused.
- **`buildRiskRegisterExport(db, month)`** — `await loadOccurrencesFromDB(db, month)`; the XLSX gen is
  pure/sync, reused. Already `async`-compatible (route awaits it).
- **`listAliases(db)`** — `await _initConfigSchema(db)`; `await H.prepare('SELECT … ORDER BY code,
  sdp_label').all()`.
- **`upsertAlias(db, sdp_label, code, updated_by)`** — `await _initConfigSchema(db)`; the validation
  JS unchanged; `await H.prepare(<INSERT … ON CONFLICT(sdp_label) DO UPDATE SET … = excluded.… ,
  updated_at = CURRENT_TIMESTAMP>).run(...)`. **The upsert SQL is pg-compatible as-is** — `ON CONFLICT`,
  `excluded.*`, and `CURRENT_TIMESTAMP` all work in pg → UNCHANGED.
- **`deleteAlias(db, sdp_label)`** — `await H.prepare('DELETE … WHERE sdp_label = ?').run(...)`; returns
  `{ deleted: r.changes }` (the adapter exposes `.changes` on pg runs).
- **`listUnmappedSites(db, month)`** — `await getSiteAliases(db)`; `await H.prepare(<request_records
  GROUP BY site SELECT>).all(...)`; JS filter reused. raw-ISO cutoffs UNCHANGED.

`classifyIncident`, `resolveSite`, `generateRiskRegisterExcel`, the constants — **pure, no `db`,
unchanged.**

### 4. server.js — await the 4 CRUD routes

`/api/risk-register-config/aliases` (GET `listAliases`, POST `upsertAlias`, DELETE `deleteAlias`),
`/api/risk-register-config/unmapped` (GET `listUnmappedSites`) — currently NOT async, call `rr.*(rdb.db)`
un-awaited. Make each handler `async` + `await rr.<fn>(rdb.db, …)`. (`rdb.db` stays as the passed arg —
`_h` ignores it in pg mode, like groupPresets.) `GET /api/risk-register-export` already `await`s
`buildRiskRegisterExport`.

## Dialect / correctness rules

- `rr_site_aliases`: `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` (sqlite) → `TIMESTAMPTZ DEFAULT now()` (pg
  schema). The upsert's `CURRENT_TIMESTAMP` literal + `ON CONFLICT(col) DO UPDATE SET x = excluded.x`
  are valid in BOTH engines → query UNCHANGED.
- `request_records` reads: raw-ISO `created_time >= ? AND created_time < ?` (TEXT lexical compare,
  same both engines) → UNCHANGED. `LIKE`, `COALESCE`, `GROUP BY <real col>`, `COUNT(*)` → unchanged
  (COUNT bigint → JS number via the adapter parser).
- `await` on the sqlite path is a no-op (better-sqlite3 `.get/.all/.run` are sync; awaiting their value
  returns it). `.changes` / `.lastID` shape: the pgDb adapter exposes `.changes` on `.run()` results
  (used by deleteAlias) — confirm during impl (groupPresets `setPresets` relies on the same).

## Sync-dispatch note

UNLIKE the reports-db forked fns, the risk-register module fns become **async in both modes** (no
synchronous-return requirement — every caller is an awaited server route, exactly like groupPresets).
No sqlite-synchronous-return smoke for this module.

## Testing (TDD)

New `tests/pg-reports-rr.test.js` (or extend `tests/pg-reports-config.test.js` — it's the config
suite). Header = `REPORTS_BACKEND=postgres` + the standard provision/boot. `initPgReports` seeds
`rr_site_aliases` via `_seedConfigPg`. Assertions:
1. **seed + listAliases** — after `initPgReports`, `await rr.listAliases(rdb.db)` returns the
   `DEFAULT_SITE_ALIASES` rows (count + a sample mapping e.g. `HOUNDE → HGO`).
2. **upsert + delete** — `await rr.upsertAlias(rdb.db, 'NEWSITE', '<valid SITES code>', 'tester')`
   then `listAliases` includes it; re-upsert with a different code updates (not dup); `deleteAlias`
   removes it (`{deleted:1}`).
3. **loadOccurrencesFromDB + listUnmappedSites** — seed a few `request_records` (via the 4D-1
   `upsertRequestBatch`) for a month with an Incident at a mapped site + one at an unmapped site;
   assert `loadOccurrencesFromDB` aggregates the mapped one (diagnostics.classified ≥ 1) and
   `listUnmappedSites` surfaces the unmapped label.

sqlite regression: existing config/reports suites stay green; a quick sqlite smoke that
`rr.listAliases(rdb.db)` works on the default backend (seeds + returns defaults).

## Success criteria

- `tests/pg-reports-rr.test.js` (or config-suite increment) green against local PG.
- `node --check risk-register-export.js` + `reports-db.js` + `server.js` clean.
- sqlite default-backend behaviour unchanged (the export + admin CRUD render identically).
- Full reports.db pg regression stays green.
- **After this + the `/api/survey/voice` follow-up + a KPI reconciliation, the
  `REPORTS_BACKEND=postgres` prod flip is unblocked.** Nothing deployed; `REPORTS_BACKEND` defaults to
  `sqlite`.
