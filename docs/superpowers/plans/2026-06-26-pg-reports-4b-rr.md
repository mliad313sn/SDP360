# Chunk 4B-RR — risk-register (rr_site_aliases) → PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `risk-register-export.js` to PostgreSQL behind `REPORTS_BACKEND` (mirroring the groupPresets fork): `rr_site_aliases` pg table + seed + an `_h(db)` resolver + 8 async DB fns + 4 server route awaits. Behaviour-preserving in sqlite (the module fns become async in both modes; every caller is an awaited server route, exactly like groupPresets).

**Spec:** `docs/superpowers/specs/2026-06-26-pg-reports-4b-rr-design.md` (reviewed ✅).

**Verified:** upsert `ON CONFLICT(sdp_label) DO UPDATE SET …=excluded.…, updated_at=CURRENT_TIMESTAMP` is pg-valid unchanged; `pgDb.js .run()` returns `{changes: rowCount, lastID}` (deleteAlias `.changes` works); COUNT→JS number; require-cycle safe (both legs lazy). Valid SITES codes: `IGO·SGO·MASSAWA·HGO·KGO·MGO·EXPLO·OUAGA OFF1·EMSA·SML`.

---

### Task 1: pg schema + seed + module fork (TDD)

**Files:** `db/postgres/reports/002_config.sql`, `reports-db.js` (`_seedConfigPg`), `risk-register-export.js`. Test: NEW `tests/pg-reports-rr.test.js`.

- [ ] **Step 1: Write the failing test** — `tests/pg-reports-rr.test.js`:
```js
'use strict';
// Chunk 4B-RR — risk-register rr_site_aliases + export readers → PostgreSQL. Skips when PG down.
process.env.REPORTS_BACKEND = 'postgres';
const _os=require('os'),_fs=require('fs'),_path=require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(),'rr-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
// request_records writer needs all @named cols (subset that loadOccurrences reads + the writer's set)
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  site:null, tech_group:null, mode:null, impact:null, ...o });

async function boot() {
  const ctx = await provisionTestDb(); if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db'); await rdb.initPgReports();
  const rr = require('../risk-register-export');
  return { ctx, rdb, rr };
}

test('rr pg: seed + listAliases (from _seedConfigPg)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    const aliases = await rr.listAliases(rdb.db);
    assert.ok(aliases.length >= Object.keys(rr.DEFAULT_SITE_ALIASES).length - 1, 'seeded defaults present');
    assert.ok(aliases.find(a => a.sdp_label === 'HOUNDE' && a.code === 'HGO'), 'HOUNDE→HGO seeded');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('rr pg: upsert + delete', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    await rr.upsertAlias(rdb.db, 'NEWSITE', 'HGO', 'tester');
    let aliases = await rr.listAliases(rdb.db);
    assert.equal(aliases.find(a => a.sdp_label === 'NEWSITE').code, 'HGO', 'inserted');
    await rr.upsertAlias(rdb.db, 'NEWSITE', 'MGO', 'tester2');   // update, not dup
    aliases = await rr.listAliases(rdb.db);
    assert.equal(aliases.filter(a => a.sdp_label === 'NEWSITE').length, 1, 'no dup');
    assert.equal(aliases.find(a => a.sdp_label === 'NEWSITE').code, 'MGO', 'updated');
    const del = await rr.deleteAlias(rdb.db, 'NEWSITE');
    assert.equal(del.deleted, 1, 'deleted (rowCount)');
    assert.ok(!(await rr.listAliases(rdb.db)).find(a => a.sdp_label === 'NEWSITE'), 'gone');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('rr pg: loadOccurrencesFromDB + listUnmappedSites', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, rr } = b;
  try {
    await rdb.upsertRequestBatch([
      // mapped site (HOUNDE→HGO seeded) + a Network/Internet incident → classifies to a domain
      _req({request_id:'I1', site:'HOUNDE', request_type:'Incident', category:'Network & Internet Access', sub_category:'Network issues', created_time:'2026-05-10 09:00:00'}),
      // unmapped site
      _req({request_id:'I2', site:'ZZZ-OFFGRID', request_type:'Incident', category:'Network & Internet Access', sub_category:'Network issues', created_time:'2026-05-11 09:00:00'}),
    ]);
    const { occurrences, diagnostics } = await rr.loadOccurrencesFromDB(rdb.db, '2026-05');
    assert.ok(diagnostics.total_incident_rows >= 2, 'both incident rows read');
    assert.ok(diagnostics.classified >= 1, 'mapped+classified ≥ 1');
    assert.ok(occurrences['HGO'], 'HGO bucket present');
    const unmapped = await rr.listUnmappedSites(rdb.db, '2026-05');
    assert.ok(unmapped.find(u => u.sdp_label === 'ZZZ-OFFGRID'), 'unmapped site surfaced');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
```
> Confirm the `category`/`sub_category` in the I1 seed actually maps to a domain via `DOMAIN_RULES` (read `classifyIncident` + `DOMAIN_RULES` in risk-register-export.js; pick a category/sub pair that matches a rule — "Network & Internet Access / Network issues" per the CLAUDE.md domain table). If unsure, assert only `diagnostics.total_incident_rows>=2` + `listUnmappedSites` (less coupled to the classifier).

- [ ] **Step 2: Run red** — `PG_ADMIN_URL='postgres://postgres:<PG_PASSWORD>@localhost:5432/postgres' node --test --test-force-exit tests/pg-reports-rr.test.js` → FAILS (table missing / fns sync-on-sqlite-handle return empty).

- [ ] **Step 3a: Schema** — add to `db/postgres/reports/002_config.sql` (after dashboard_preset_groups):
```sql
CREATE TABLE IF NOT EXISTS rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by TEXT
);
```

- [ ] **Step 3b: Seed** — in `reports-db.js` `_seedConfigPg(H)`, after the dashboard_preset_groups block:
```js
// rr_site_aliases — reuse risk-register's DEFAULT_SITE_ALIASES (lazy require; rr requires reports-db
// lazily in _h(), so the cycle resolves at call-time — same as groupPresets above).
const rr = require('./risk-register-export');
const rrN = Number((await H.prepare('SELECT COUNT(*) AS n FROM rr_site_aliases').get()).n);
if (rrN === 0) {
  for (const [label, code] of Object.entries(rr.DEFAULT_SITE_ALIASES)) {
    await H.prepare('INSERT INTO rr_site_aliases (sdp_label, code, updated_by) VALUES (?, ?, ?) ON CONFLICT (sdp_label) DO NOTHING').run(label, code, '_system');
  }
}
```

- [ ] **Step 3c: Module fork** — in `risk-register-export.js`:
  - Add the `_h(db)` resolver (copy groupPresets' shape; `require('./reports-db')`):
    ```js
    function _h(db) {
      const rdb = require('./reports-db');
      if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
      return { H: db, isPg: false };
    }
    ```
  - `_initConfigSchema(db)` → `async`; FIRST line `if (_h(db).isPg) return;` (pg: schema+seed owned by 002_config.sql + _seedConfigPg). sqlite path UNCHANGED (keep the existing `db.exec` CREATE + count-guarded seed — do NOT add a new flag; preserve current repeated-call-safe behaviour).
  - `getSiteAliases(db)` → `async`; `const { H } = _h(db); … const rows = await H.prepare('SELECT sdp_label, code FROM rr_site_aliases').all();` (keep try/catch → DEFAULT fallback; `await _initConfigSchema(db)` inside the try).
  - `loadOccurrencesFromDB(db, month)` → `async`; `const aliases = await getSiteAliases(db);` `const { H } = _h(db); const rows = await H.prepare(<SELECT … request_records …>).all(startISO, endISO);` (SQL UNCHANGED — raw-ISO cutoffs). JS aggregation reused.
  - `buildRiskRegisterExport(db, month)` → `async`; `const { occurrences, diagnostics } = await loadOccurrencesFromDB(db, month);` (XLSX gen reused).
  - `listAliases(db)` → `async`; `await _initConfigSchema(db); const { H } = _h(db); return await H.prepare('SELECT … ORDER BY code, sdp_label').all();`
  - `upsertAlias(db, sdp_label, code, updated_by)` → `async`; `await _initConfigSchema(db);` validation JS unchanged; `const { H } = _h(db); await H.prepare(<INSERT … ON CONFLICT … excluded … CURRENT_TIMESTAMP>).run(label, c, updated_by||'unknown');` (SQL UNCHANGED).
  - `deleteAlias(db, sdp_label)` → `async`; `await _initConfigSchema(db); const { H } = _h(db); const r = await H.prepare('DELETE FROM rr_site_aliases WHERE sdp_label = ?').run(sdp_label); return { deleted: r.changes };`
  - `listUnmappedSites(db, month)` → `async`; `await _initConfigSchema(db);` validation unchanged; `const aliases = await getSiteAliases(db); const { H } = _h(db); const rows = await H.prepare(<GROUP BY site SELECT>).all(startISO, endISO);` JS filter reused.
  - `classifyIncident`/`resolveSite`/`generateRiskRegisterExcel`/constants — UNCHANGED.

- [ ] **Step 4: Run green** — `node --check risk-register-export.js reports-db.js` clean; the rr pg test PASSES (3 tests).

- [ ] **Step 5: Commit** — `feat(pg-reports-4b-rr): rr_site_aliases pg schema + _seedConfigPg seed + risk-register-export.js _h(db) fork (8 async fns; TDD)`

---

### Task 2: server.js — await the 4 CRUD routes

**Files:** `server.js` (~2594 `listAliases`, ~2610/2619 `upsertAlias`, ~2633/2641 `deleteAlias`, ~2655 `listUnmappedSites`).

- [ ] **Step 1:** Make each of the 4 `/api/risk-register-config/*` CRUD handlers `async` and `await` the `rr.<fn>(rdb.db, …)` call. (`GET /api/risk-register-export` already awaits `buildRiskRegisterExport`; `/api/risk-register-config/sites` returns a constant — leave both.) Keep `rdb.db` as the passed arg (`_h` ignores it in pg).
- [ ] **Step 2:** `node --check server.js` clean.
- [ ] **Step 3:** sqlite smoke — a throwaway check that `await rr.listAliases(require('./reports-db').db)` returns the seeded defaults on the DEFAULT (sqlite) backend (proves the async fork still works sync-side). Optionally add `/api/risk-register-config/aliases` to `tests/server-routes-smoke.test.js` ROUTES (the seeded smoke admin is `admin`; confirm the route allows admin — if it's super_admin-only, skip the smoke addition and rely on the throwaway check).
- [ ] **Step 4: Commit** — `feat(pg-reports-4b-rr): await the 4 /api/risk-register-config CRUD routes (async handlers)`

---

### Task 3: Regression + README + finish-branch

**Files:** `tools/pg/README.md`.

- [ ] **Step 1: Full reports.db pg regression** — auth/config/reports/hot/aggregates + the new rr suite all green.
- [ ] **Step 2: sqlite regression** — `tests/server-routes-smoke.test.js` green; `node --check` on all 3 touched files.
- [ ] **Step 3: README** — add `## reports.db — Sub-chunk 4B-RR` to `tools/pg/README.md`: rr_site_aliases table + seed + the `_h(db)` module fork (mirrors groupPresets) + the 4 route awaits; note that after this only the `/api/survey/voice` follow-up + a KPI reconciliation remain before the prod flip.
- [ ] **Step 4: Commit + finish-branch:**
```bash
git add tools/pg/README.md && git commit -m "feat(pg-reports-4b-rr): regression + README 4B-RR section"
git checkout main && git merge --no-ff feat/pg-reports-4b-rr -m "merge: pg risk-register rr_site_aliases (Chunk 4B-RR) behind REPORTS_BACKEND"
```
- [ ] **Step 5: Post-merge sanity** — on main: `node --check` (3 files) + rr pg suite + smoke green. Update migration memory: 4B-RR merged; remaining before prod flip = `/api/survey/voice` follow-up + KPI reconciliation.

---

## Remember
- Mirror groupPresets exactly: `_h(db)` → `{H, isPg}`; pg `_initConfigSchema` early-returns; sqlite path UNCHANGED (no new guard).
- The upsert SQL + `excluded` + `CURRENT_TIMESTAMP` are pg-valid AS-IS — do NOT rewrite them.
- raw-ISO `created_time` cutoffs UNCHANGED (lexical TEXT, both engines).
- The module fns are async in BOTH modes (no sqlite-synchronous-return requirement — all callers are awaited server routes).
- DRY, YAGNI, TDD, frequent commits.
