# Asset Module — Sub-project A (Foundation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PostgreSQL-ready `assets.db` module that syncs 5 ManageEngine Analytics Plus views, joins them by `Workstation ID = Asset ID`, and serves a filterable enriched-inventory page with Excel export.

**Architecture:** New standalone module (`assets-db.js` + `assets-sync.js`) mirroring `tracker`/`meetings`/`inspection`, but PostgreSQL-native from day one via `services/pgDb.js` + an `ASSETS_BACKEND` flag. The sync is config-driven (one declarative array, one engine) and full-replaces each table (the discovery views have no reliable modified-time signal). No monetary display anywhere.

**Tech Stack:** Node.js, better-sqlite3 (sqlite path) + `services/pgDb.js` (async PG path), Express, `node:test`, `services/tableExcel.js` (Excel), Chart.js not required (list only).

**Spec:** `docs/superpowers/specs/2026-07-17-assets-foundation-design.md` — read §3 (data facts + the two traps) and §10 (risks) before starting.

**Branch:** `feat/assets-foundation` (already created from `main`).

---

## Ground rules (read once, apply throughout)

- **`ASSETS_BACKEND=sqlite|postgres`**, default `sqlite`. Tests run sqlite. The
  PG path exists and is smoke-tested but sqlite is the test backbone.
- **Every dual-backend function** dispatches `if (ASSETS_BACKEND === 'postgres') return _fooPg(...)`. The PG fork is `async`; **every caller `await`s it**. `tests/await-precedence.test.js` will scan this module (Task 4) — don't drop an `await`, and don't chain `.method()` onto an unawaited call.
- **No money on screen.** Costs are stored as raw TEXT strings (`purchase_cost`, `cost`) and never rendered as currency in A.
- **`server.js` is an existing module → the user approves its edits at review time.** The plan touches it only in Task 4 (routes/boot/cron) and Task 5 (nav), both flagged.
- **Commit after every green step.** `git commit --no-verify` (a post-commit hook regenerates the deploy script otherwise; `--no-verify` does NOT skip it, that's expected and harmless).
- **Run tests with:** `node --test --test-force-exit tests/<file>.test.js`.

---

## File structure

| File | Responsibility |
|---|---|
| `db/postgres/assets/001_init.sql` | PG schema of the 5 tables (applied at boot by `initPgAssets`) |
| `assets-db.js` | schema (sqlite `_initSchema` + PG init) · the enriched-asset readers · lookups/summary · `ASSETS_BACKEND` flag · `pgHandle()` |
| `assets-sync.js` | `fetchAll` (single-fetch, throws on truncation) · `ASSET_VIEWS` config · `syncAssetView` engine · `syncAllAssets` · `init(fetchView, VIEWS)` |
| `public/assets.html` | the Inventory page (filterable enriched list + Excel button) |
| `tools/pg/copy-assets.js` | one-shot sqlite→PG copy (mirrors `tools/pg/copy-tracker.js`) |
| `server.js` (edit) | 5 `VIEWS` ids · `assets-sync.init` + `initPgAssets` at boot · daily cron · `/api/assets/*` routes |
| `public/_shell.js` (edit) | "Assets" nav entry + one `ICON_LIB` key |
| `tests/assets-*.test.js` | one test file per task |

---

## Task 0: Schema + module skeleton (both backends init)

**Files:**
- Create: `db/postgres/assets/001_init.sql`
- Create: `assets-db.js`
- Test: `tests/assets-db-init.test.js`

- [ ] **Step 1: Write the failing test** — the module inits a sqlite DB with the 5 tables and the composite-PK monitor table.

```javascript
// tests/assets-db-init.test.js
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

// point the module at a throwaway data dir BEFORE requiring it
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
process.env.SDP_DATA_DIR = TMP;
const db = require('../assets-db');

test('init creates the 5 tables', () => {
  const h = db.getDB();
  const names = h.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  for (const t of ['assets','asset_memory','asset_logical_drives','asset_monitors',
                   'software_licenses']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('asset_monitors has a composite PK (workstation_id, monitor_id)', () => {
  const h = db.getDB();
  const pk = h.prepare("PRAGMA table_info(asset_monitors)").all().filter(c => c.pk > 0).map(c => c.name).sort();
  assert.deepStrictEqual(pk, ['monitor_id','workstation_id']);
});

test('purchase_cost is TEXT (no currency coercion into a numeric type)', () => {
  const h = db.getDB();
  const col = h.prepare("PRAGMA table_info(assets)").all().find(c => c.name === 'purchase_cost');
  assert.strictEqual(String(col.type).toUpperCase(), 'TEXT');
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module '../assets-db'`).

- [ ] **Step 3: Implement `assets-db.js` skeleton + `001_init.sql`.**

`db/postgres/assets/001_init.sql` — 5 `CREATE TABLE IF NOT EXISTS`. Costs TEXT. Composite PK on monitors. Every component table has an index on `workstation_id`. Example shape (write all 5):

```sql
CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY, asset_name TEXT, product TEXT, product_type TEXT,
  manufacturer TEXT, state TEXT, serial_number TEXT, barcode TEXT, site TEXT, site_id TEXT,
  purchase_cost TEXT, acquisition_date TEXT, warranty_expiry TEXT,
  user_name TEXT, department TEXT,
  last_successful_audit_time TEXT, last_audit_status TEXT,
  days_since_scan TEXT, last_scan_source TEXT, created_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_site  ON assets(site);
CREATE INDEX IF NOT EXISTS idx_assets_state ON assets(state);

CREATE TABLE IF NOT EXISTS asset_monitors (
  workstation_id TEXT, monitor_id TEXT, monitor_type TEXT, manufacturer TEXT, serial_number TEXT,
  PRIMARY KEY (workstation_id, monitor_id)
);
CREATE INDEX IF NOT EXISTS idx_mon_ws ON asset_monitors(workstation_id);
-- …asset_memory (memory_module_id PK), asset_logical_drives (drive_id PK),
--   software_licenses (license_id PK, incl. license_state/expiry_date/cost/site/vendor)…
--   each per §5 of the spec. (software + software_installations are sub-project C.)
```

`assets-db.js` — mirror `tracker-db.js:141-157` for the flag + PG init, and the sqlite `_initSchema` pattern. Keep the sqlite DDL byte-identical to `001_init.sql` (SQLite accepts the same `CREATE TABLE` text; `SERIAL`/`now()` don't appear here so one SQL string serves both — read it from the `.sql` file for sqlite too, or inline the same statements):

```javascript
'use strict';
const path = require('path'), fs = require('fs');
const DATA_DIR = process.env.SDP_DATA_DIR || path.join(__dirname, 'data');
const ASSETS_BACKEND = (process.env.ASSETS_BACKEND || 'sqlite').toLowerCase();
const SCHEMA = fs.readFileSync(path.join(__dirname, 'db', 'postgres', 'assets', '001_init.sql'), 'utf8');

let _db = null, _pg = null;
function getDB() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const Database = require('better-sqlite3');
  _db = new Database(path.join(DATA_DIR, 'assets.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(SCHEMA);                    // same DDL both backends
  return _db;
}
async function initPgAssets() {
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('ASSETS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url); await _pg.connect(); await _pg.exec(SCHEMA); return _pg;
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgAssets() at boot');
  return _pg;
}
if (ASSETS_BACKEND !== 'postgres') getDB();     // eager sqlite init at require, like tracker-db
module.exports = { getDB, initPgAssets, pgHandle, ASSETS_BACKEND };
```

> **PG-DDL caveat for the plan-executor:** SQLite `CREATE INDEX IF NOT EXISTS` + `TEXT`/composite-PK are valid PG too, so one file serves both. If PG rejects any statement during the Task 4 boot smoke, split the sqlite-only bits — but the plain DDL above is portable.

- [ ] **Step 4: Run → PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add assets-db.js db/postgres/assets/001_init.sql tests/assets-db-init.test.js
git commit --no-verify -m "feat(assets): schema + module skeleton (5 tables, both backends)"
```

---

## Reconnaissance — DONE (2026-07-17). No human gate remains.

Live-fetched every Foundation view; the 121 k risk left with sub-project C.

- **View IDs (verified live):** `assets` 002058 · `asset_memory` 002066 ·
  `asset_logical_drives` 002064 · `asset_monitors` 002067 · `software_licenses`
  002074. All five are **< 5 000 rows** (largest: memory 4 995) → each fetches in
  one call, **no paging needed anywhere in A**.
- **`software_installations` (121 097 rows) does NOT single-fetch** (> 7 min live,
  past `fetchView`'s 120 s timeout) → moved to **C** with `software`. `software`'s
  real view id is still unknown (the `002061` the user gave is Physical Drives) —
  C resolves it.
- `fetchView(viewId, maxRows)` (server.js:710) takes a **number** and sends no
  offset — so a subagent must NEVER invent a `startRow`. `fetchAll` is a single
  fetch (Task 1).
- **The API IGNORES `maxRows`** (recon fact): asked for 10 000 it returned all
  121 117 `software_installations` rows. It returns the whole view or times out —
  it never truncates. So `fetchAll` has no truncation guard, only a data-gone-wrong
  sanity cap; the real protection against a silent partial is `fetchView`'s 120 s
  timeout on a huge view (throws) + Task 2's transaction order.

---

## Task 1: `fetchAll` — one fetch, throws on truncation

**Files:**
- Create: `assets-sync.js`
- Test: `tests/assets-fetchall.test.js`

**The non-negotiable behaviour:** a fetch that comes back at the `maxRows` ceiling
is *assumed truncated* and **throws** — never a silent partial (the frozen-sync
class of bug from 2026-07-17). Signature matches the REAL `fetchView(viewId,
maxRows)` — no invented `{startRow}` object. All 5 Foundation views are < 5 000
rows, so `maxRows=20000` clears them with headroom and the throw only fires on a
genuine truncation.

- [ ] **Step 1: Write the failing test** — `fetchAll(viewId, fetchView, {maxRows})`, `fetchView(viewId, maxRows)` injected.

```javascript
// tests/assets-fetchall.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { fetchAll } = require('../assets-sync');

// The recon (2026-07-17) proved the Analytics-Plus /data endpoint IGNORES the
// `maxRows` param: asked for 10 000 it returned all 121 117 software_installations
// rows. So the API never truncates — it returns EVERYTHING, or times out. There
// is therefore NO silent-partial-by-truncation risk to guard against; the only
// failure is a slow fetch hitting fetchView's timeout (which throws → Task 2
// keeps the table intact). The guard here is a *sanity ceiling*, not a truncation
// check: it throws only if a Foundation view unexpectedly balloons past a hard
// cap (data went wrong), which for these 5 small views should never happen.
const makeFetch = (total) => async () => ({
  rows: Array.from({ length: total }, (_, i) => ({ id: i })),   // API returns ALL rows, ignoring maxRows
});

test('returns every row the API sends (maxRows is not a ceiling the API honours)', async () => {
  const rows = await fetchAll('v', makeFetch(4995), { hardCap: 50000 });
  assert.strictEqual(rows.length, 4995);
});

test('throws only if a view blows past the hard sanity cap (data-gone-wrong)', async () => {
  await assert.rejects(() => fetchAll('v', makeFetch(60000), { hardCap: 50000 }),
    /hard cap|unexpectedly large/i);
});

test('propagates a fetch error (never swallows it — a timeout must NOT store a partial)', async () => {
  await assert.rejects(() => fetchAll('v', async () => { throw new Error('zoho timeout'); }),
    /zoho timeout/);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `fetchAll` in `assets-sync.js`.**

```javascript
'use strict';
// fetchView is the server.js primitive, injected by init(): fetchView(viewId, maxRows) → { rows }.
// RECON FACT (2026-07-17): the AP /data endpoint ignores maxRows and returns the WHOLE view,
// or times out on a huge one (software_installations = 121k took 13.6 min → past fetchView's
// 120s cap, which is why it moved to C). So for A's 5 small views this is a plain single fetch
// that returns everything, fast. No truncation guard — the API doesn't truncate. The hardCap
// is only a data-gone-wrong tripwire (a view should not suddenly be 10× its size); a slow/huge
// view fails via fetchView's timeout (throws), and Task 2 keeps the table intact on any throw.
async function fetchAll(viewId, fetchView, { maxRows = 20000, hardCap = 50000 } = {}) {
  const { rows } = await fetchView(viewId, maxRows);   // maxRows passed but the API ignores it
  if (rows.length > hardCap) {
    throw new Error(`fetchAll(${viewId}): ${rows.length} rows exceeds the hard cap ${hardCap} — ` +
      `unexpectedly large for a Foundation view. Refusing to store; investigate before raising the cap.`);
  }
  return rows;
}
module.exports = { fetchAll };
```

> **Why no truncation guard:** the recon showed the API returns all rows regardless
> of `maxRows`, so a "short vs full page" check is meaningless here. The real
> protection against a silent partial is `fetchView`'s timeout on an over-large
> view (it throws) plus Task 2's "table survives a failed fetch" transaction order.

- [ ] **Step 4: Run → PASS** (3 tests).

- [ ] **Step 5: Commit**

```bash
git add assets-sync.js tests/assets-fetchall.test.js
git commit --no-verify -m "feat(assets): single-fetch fetchAll that throws on truncation, never a partial"
```

---

## Task 2: The config-driven sync engine (full-replace, transactional)

**Files:**
- Modify: `assets-sync.js`
- Test: `tests/assets-sync.test.js`

**Engine shape (fixed — ONE form).** `syncAssetView(def, deps)` where
`deps = { fetchView, replaceTable, markSuccess, markError }`. **`replaceTable(table,
cols, rows)` is owned by `assets-db.js`** (sqlite sync / PG async, one function) so
all SQL lives in one module and the PG fork is a single place — not scattered
through the sync engine. The sync engine is backend-agnostic; it never touches a
`db` handle directly. This is the ONLY shape; there is no `db`-direct variant.

- [ ] **Step 1: Add `replaceTable` to `assets-db.js` FIRST (its own micro-step).**
  `replaceTable(table, cols, rows)` — transaction: `DELETE FROM table` then
  batch `INSERT OR REPLACE`. sqlite sync via `db.transaction()`; PG async via
  `pgHandle().runTransaction(async () => …)` under the `ASSETS_BACKEND` fork.
  Test it directly (seed → replaceTable with fewer rows → count drops).

```javascript
// assets-db.js  (sqlite path shown; add the ASSETS_BACKEND==='postgres' fork)
function replaceTable(table, cols, rows) {
  const db = getDB();
  const ph = cols.map(() => '?').join(', ');
  const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`);
  const tx = db.transaction((rs) => {
    db.prepare(`DELETE FROM ${table}`).run();
    for (const m of rs) insert.run(...cols.map(c => m[c] ?? null));
  });
  tx(rows);
  return rows.length;
}
```

- [ ] **Step 2: Write the failing engine tests.** `deps.replaceTable` comes from `assets-db` (real), `fetchView`/`markSuccess`/`markError` are stubs.

```javascript
// tests/assets-sync.test.js
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-sync-'));
const adb = require('../assets-db');
const { syncAssetView, ASSET_VIEWS } = require('../assets-sync');

const db = adb.getDB();
const assetsDef = ASSET_VIEWS.find(v => v.name === 'assets');
const deps = (fetchView, markError = async () => {}) =>
  ({ fetchView, replaceTable: adb.replaceTable, markSuccess: async () => {}, markError });

const rowsV1 = [{ 'Asset ID':'A1', 'State':'In Store', 'Purchase Cost($)':'0.00', 'Site':'MANA' },
                { 'Asset ID':'A2', 'State':'Discovered', 'Purchase Cost($)':'1,250,000.00', 'Site':'ITY' }];

test('full-replace inserts the mapped rows', async () => {
  await syncAssetView(assetsDef, deps(async () => ({ rows: rowsV1 })));
  const got = db.prepare('SELECT asset_id, state, purchase_cost, site FROM assets ORDER BY asset_id').all();
  assert.deepStrictEqual(got, [
    { asset_id:'A1', state:'In Store',   purchase_cost:'0.00',        site:'MANA' },
    { asset_id:'A2', state:'Discovered', purchase_cost:'1,250,000.00', site:'ITY' },
  ]);
});

test('full-replace REPLACES (a smaller second sync drops the vanished row)', async () => {
  await syncAssetView(assetsDef, deps(async () => ({ rows: [rowsV1[0]] })));
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM assets').get().c, 1);
});

test('a failed fetch leaves the existing table UNTOUCHED and calls markError', async () => {
  let errored = false;
  await assert.rejects(() => syncAssetView(assetsDef,
    deps(async () => { throw new Error('zoho down'); }, async () => { errored = true; })));
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM assets').get().c, 1, 'table survives a failed fetch');
  assert.ok(errored, 'markError must be called');
});

test('the licence transform keeps the cost as a RAW string', async () => {
  const licDef = ASSET_VIEWS.find(v => v.name === 'software_licenses');
  assert.strictEqual(typeof licDef.transform, 'function');
  const out = licDef.transform({ 'License ID':'L1', 'License State':'Expired',
    'Cost($)':'55,920.00', 'Expiry Date':'30 Jan 2025' }, {});
  assert.strictEqual(out.cost, '55,920.00');   // no numeric coercion
});
```

- [ ] **Step 3: Run → FAIL. Step 4: Implement `syncAssetView` + `ASSET_VIEWS`.**

```javascript
const DEFAULT_MAP = (row, def) => {
  const out = {};
  for (const [zoho, col] of Object.entries(def.columns)) out[col] = (row[zoho] ?? '').toString().trim() || null;
  return def.transform ? def.transform(row, out) : out;
};

async function syncAssetView(def, { fetchView, replaceTable, markSuccess, markError }) {
  try {
    const raw = await fetchAll(def.viewId, fetchView, { maxRows: def.maxRows || 20000 });
    const mapped = raw.map(r => DEFAULT_MAP(r, def)).filter(m => m[def.pkCol]);   // drop rows missing PK
    const n = await replaceTable(def.table, Object.values(def.columns), mapped);  // DELETE+INSERT in one tx
    await markSuccess(def.job, n);
    return n;
  } catch (e) {
    await markError(def.job, e.message);   // table untouched — fetch/replace never ran to completion
    throw e;
  }
}
```

The "table survives a failed fetch" guarantee holds because `fetchAll` runs and
throws **before** `replaceTable` (which owns the DELETE) is ever called.

`ASSET_VIEWS` — **5 entries**, each `{ name, job, table, viewId, pkCol, columns:{zoho→col}, transform? }`. Column maps per spec §5 (write all 5 fully). `transform` only on `software_licenses` (keeps raw strings; exists so date/currency handling has a home). The verified live view IDs:

| name | viewId | pkCol |
|---|---|---|
| `assets` | `106803000000002058` | `Asset ID` |
| `asset_memory` | `106803000000002066` | `Memory Module ID` |
| `asset_logical_drives` | `106803000000002064` | `Drive ID` |
| `asset_monitors` | `106803000000002067` | `(Workstation ID, Monitor ID)` composite — no single pkCol; drop rows missing either |
| `software_licenses` | `106803000000002074` | `License ID` |

No `maxRows` override needed (all < 5 000; the 20 000 default clears them).

- [ ] **Step 4: Run → PASS** (4 tests).

- [ ] **Step 5: Add `syncAllAssets(deps)`** — loops `ASSET_VIEWS`, runs each `syncAssetView` **independently** (one table's throw is caught + logged, doesn't stop the others — per spec §6), returns a per-view `{name, rows|error}` summary. Add a test that a failing view doesn't abort the rest.

- [ ] **Step 6: Commit**

```bash
git add assets-sync.js assets-db.js tests/assets-sync.test.js
git commit --no-verify -m "feat(assets): config-driven full-replace sync engine (5 views, per-view isolation)"
```

---

## Task 3: The enriched-asset readers

**Files:**
- Modify: `assets-db.js`
- Test: `tests/assets-readers.test.js`

- [ ] **Step 1: Write the failing tests.** `getEnrichedAssets(filters)` joins components; an orphan doesn't break it; the no-cost predicate is `'0.00'` not NULL; monitor count is RAW.

```javascript
// tests/assets-readers.test.js  — seeds sqlite directly, then reads
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os=require('node:os'), path=require('node:path'), fs=require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'assets-rd-'));
const adb = require('../assets-db');
const db = adb.getDB();

db.prepare("INSERT INTO assets (asset_id,asset_name,state,site,purchase_cost) VALUES ('A1','L1','In Store','MANA','0.00'),('A2','L2','In Store','ITY','1,250,000.00')").run();
db.prepare("INSERT INTO asset_memory (memory_module_id,workstation_id,capacity_gb) VALUES ('m1','A1','8'),('m2','A1','8')").run();
db.prepare("INSERT INTO asset_logical_drives (drive_id,workstation_id,drive_letter,capacity_gb,free_pct) VALUES ('d1','A1','C:','476','12'),('d2','A1','D:','200','90')").run();
db.prepare("INSERT INTO asset_monitors (workstation_id,monitor_id,monitor_type) VALUES ('A1','1','Integrated Monitor'),('A1','2','Intel(R) AVStream Camera')").run();
db.prepare("INSERT INTO asset_memory (memory_module_id,workstation_id,capacity_gb) VALUES ('mX','ORPHAN','16')").run();  // orphan component

test('getEnrichedAssets joins RAM (sum), the C: drive, and a RAW monitor count', () => {
  const rows = adb.getEnrichedAssets({});
  const a1 = rows.find(r => r.asset_id === 'A1');
  assert.strictEqual(a1.ram_total_gb, 16);
  assert.strictEqual(a1.system_disk_free_pct, 12);   // the C: drive, not D:
  assert.strictEqual(a1.monitor_count, 2);           // RAW — includes the camera; NOT split
});

test('an orphan component does not create a phantom asset', () => {
  const rows = adb.getEnrichedAssets({});
  assert.ok(!rows.some(r => r.asset_id === 'ORPHAN'));
  assert.strictEqual(rows.length, 2);
});

test('the no-cost predicate matches 0.00 rows (NOT via IS NULL)', () => {
  const noCost = adb.getEnrichedAssets({}).filter(r => ['0.00','0',''].includes(r.purchase_cost));
  assert.strictEqual(noCost.length, 1);
  assert.strictEqual(noCost[0].asset_id, 'A1');
});

test('filters narrow by site/state', () => {
  assert.strictEqual(adb.getEnrichedAssets({ site: 'ITY' }).length, 1);
  assert.strictEqual(adb.getEnrichedAssets({ site: 'NOPE' }).length, 0);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `getEnrichedAssets(filters)`, `getAssetLookups()`, `getAssetSummary()` in `assets-db.js`, each with the `ASSETS_BACKEND` fork. The join:

```sql
SELECT a.*,
  (SELECT COALESCE(SUM(CAST(capacity_gb AS REAL)),0) FROM asset_memory m WHERE m.workstation_id=a.asset_id) AS ram_total_gb,
  (SELECT capacity_gb FROM asset_logical_drives d WHERE d.workstation_id=a.asset_id AND d.drive_letter='C:' LIMIT 1) AS system_disk_gb,
  (SELECT free_pct    FROM asset_logical_drives d WHERE d.workstation_id=a.asset_id AND d.drive_letter='C:' LIMIT 1) AS system_disk_free_pct,
  (SELECT COUNT(*) FROM asset_monitors mo WHERE mo.workstation_id=a.asset_id) AS monitor_count,
FROM assets a
WHERE 1=1  -- + whitelisted filters (site,state,product_type,manufacturer,q)
ORDER BY a.site, a.asset_name
```
Cast RAM/free_pct to numbers in JS after read (sqlite returns them; PG NUMERIC parser handles it — but these are TEXT columns, so `CAST(... AS REAL)`/parse in the reader). **Filters are whitelisted** (a fixed allowlist of columns; `q` → `asset_name/serial LIKE ?`). Monitor count is a raw `COUNT` — **do not** denylist cameras here (that's D).

- [ ] **Step 4: Run → PASS** (4 tests).

- [ ] **Step 5: Commit**

```bash
git add assets-db.js tests/assets-readers.test.js
git commit --no-verify -m "feat(assets): enriched-asset readers (RAM/C:-disk/raw monitors) + lookups + summary"
```

---

## Task 4: Routes + server wiring + the await guard

**Files:**
- Modify: `server.js` (⚠ existing module — flag for user approval), `tests/await-precedence.test.js`
- Test: `tests/assets-routes.smoke.test.js`

- [ ] **Step 1: Extend the await-precedence guard FIRST** (so the new module is covered before its routes exist). In `tests/await-precedence.test.js`: add `'assets-sync.js'` to `CALLER_FILES` and `'assets-db.js'` to `DB_MODULES`. Run it → still green (nothing wrong yet), and the `findDispatchers` count assertion should now include assets-db's `postgres` dispatchers once Task 3's forks exist.

- [ ] **Step 2: Write the failing smoke test.** Boot the app with `ASSETS_BACKEND=sqlite`, seed one asset, assert the routes.

```javascript
// tests/assets-routes.smoke.test.js
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';   // boot server.js on sqlite
// … mint a session token like the other *-routes.smoke tests do …
test('GET /api/assets/inventory returns rows; hostile filter does not 500', async () => {
  // seed one asset via assets-db, GET /api/assets/inventory?site=MANA → 200 + array
  // GET /api/assets/inventory?site=%27%20OR%201=1 → 200 (whitelisted), not 500
});
test('POST /api/sync/trigger/assets responds 200 and reports started', async () => {});
```
(Model this on `tests/server-routes-smoke.test.js` / the exec-routes smoke test for how the app is booted + a token minted.)

- [ ] **Step 3: Wire `server.js`** (the four edits from spec §4):
  1. Add the **5** asset view IDs to the `VIEWS` map (verified live, workspace `106803000000002012`): assets `002058`, memory `002066`, logical_drives `002064`, monitors `002067`, licenses `002074`.
  2. At boot: `const assetsSync = require('./assets-sync'); assetsSync.init(fetchView, VIEWS);` (2-arg, like `zoho-sync.init` — `VIEWS` is the same map extended in edit 1) and, in the PG-init block, `if (ASSETS_BACKEND==='postgres') await require('./assets-db').initPgAssets();`.
  3. `cron.schedule('30 4 * * *', () => assetsSync.syncAllAssets(deps).catch(e => console.error('[Cron:assets]', e.message)));`
  4. The `/api/assets/*` route block (`requireReportSession`) — `inventory`, `lookups`, `summary`, `export.xlsx` (Task 5), and `POST /api/sync/trigger/assets` (`requireAdmin`) that calls `syncAllAssets`. **Every reader call `await`ed.**

  The sync `deps` wires `assets-db`'s `replaceTable` + `markSyncSuccess`/`markSyncError` from `reports-db` (sync_metadata lives in reports.db — seed the 5 job rows there, or let markSuccess upsert them).

  > **No paging in A.** All 5 views single-fetch (< 5 000 rows). The injected
  > `fetchView(viewId, maxRows)` sends only `maxRows`; `fetchAll` throws on a
  > ceiling result. (121k `software_installations` is C's, not here.)

- [ ] **Step 4: Run** the smoke test + `await-precedence` → PASS. Also `node -e "require('./server.js')"`-style boot check (or the smoke test's boot) shows no throw.

- [ ] **Step 5: Commit**

```bash
git add server.js tests/assets-routes.smoke.test.js tests/await-precedence.test.js
git commit --no-verify -m "feat(assets): /api/assets/* routes + daily sync cron + await guard coverage"
```

---

## Task 5: The Inventory page + Excel export + nav

**Files:**
- Create: `public/assets.html`
- Modify: `public/_shell.js` (nav entry + ICON_LIB key), `server.js` (the `export.xlsx` route + `_htmlCache` entry + route handler for the page)
- Test: `tests/assets-export.test.js`

- [ ] **Step 1: Write the failing test** for the Excel builder wiring — `buildAssetWorkbook(rows)` returns a `tableExcel` workbook with two sheets (Assets + Installed Software) and no currency formatting.

```javascript
// tests/assets-export.test.js
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');   // already vendored (services/tableExcel.js uses it)
const { buildAssetWorkbook } = require('../services/assetExcel');

test('workbook is a Buffer with an Assets sheet and a Software sheet', () => {
  const buf = buildAssetWorkbook([{ asset_id:'A1', site:'MANA', ram_total_gb:16 }],
                                 [{ asset_id:'A1', software_name:'Chrome' }]);
  assert.ok(Buffer.isBuffer(buf));                         // buildWorkbook returns a Buffer
  const wb = XLSX.read(buf, { type: 'buffer' });           // round-trip to inspect
  assert.deepStrictEqual(wb.SheetNames.sort(), ['Assets', 'Installed Software']);
});
```
`buildAssetWorkbook` lives in **`services/assetExcel.js`** and calls
`tableExcel.buildWorkbook(sheets)`, which returns a **Buffer** — assert via an
`XLSX.read` round-trip, not by poking a workbook object.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `buildAssetWorkbook` using `services/tableExcel.js` `buildWorkbook(sheets)`; add `GET /api/assets/export.xlsx` (filtered view → workbook → `res` with the xlsx content-type, mirroring `GET /api/inspection/export.xlsx`). **No cost columns formatted as money** — `purchase_cost` ships as the raw string.

- [ ] **Step 4: Build `public/assets.html`** — copy the `inspections.html` skeleton (shell nav, session cookie, filter bar, table). Header band (total · per-state chips · sync freshness from `/api/assets/summary`). Filters: Site/State/Product Type/Manufacturer/search. Table columns: name, product, site, state, **RAM**, **C: free %**, **Monitors (raw)**, last scan, + an **Export Excel** button. Add it to the `_htmlCache` boot list + a `sendHtmlPage` route (`injectApiKey=false`, session via cookie — the `site-report.html` precedent). **No money column.**

- [ ] **Step 5: Nav in `_shell.js`** — an "Assets" entry under the `performance` (Insights) parent, after `meetings`, `roles:['any']`. **`brand/icons.js` has NO hardware/asset glyph** (its keys are alert-*, bar-chart-3, book-open, calendar, camera, check, chevron-*, clipboard-check, clock, cloud-off, copy, download, edit, file-text, filter, gauge, headset, info, lightbulb, line-chart, log-out, mic, plus, presentation, refresh-cw, save, search, shield*, sliders, target, trash, trending-up, upload, user, users, wifi-off, x, zap). So the plan **adds a new icon** — TWO edits:
  1. add a `hard-drive` (or `box`) SVG path to `brand/icons.js` (a simple Lucide-style glyph, e.g. `<rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="18" x2="6.01" y2="18"/>` for a drive);
  2. add that same key to the curated `ICON_LIB` subset in `_shell.js` (`ICON_LIB` is NOT a mirror of `icons.js` — a key absent there renders an empty span with no error).
  Don't reuse `clipboard-check` (Inspections/Meetings) or `bar-chart-3` (IT Review).

- [ ] **Step 6: Verify in the browser** (mandatory — the visible page is the proof the sync isn't silently empty). `preview_start` the dev server, seed a few assets (or run a real sync if a token is available), load `/assets.html`, confirm the enriched table renders with real RAM/disk/monitor values, the filters narrow, and the Excel export downloads. Screenshot. **Restart, don't reload** (`_htmlCache`).

- [ ] **Step 7: Commit**

```bash
git add public/assets.html public/_shell.js server.js services/assetExcel.js tests/assets-export.test.js
git commit --no-verify -m "feat(assets): Inventory page + Excel export + Insights nav entry"
```

---

## Task 6: copy script + real-CSV integration + regression + docs

**Files:**
- Create: `tools/pg/copy-assets.js`, `tests/assets-integration.test.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `tools/pg/copy-assets.js`** — mirror `tools/pg/copy-tracker.js` (apply `001_init.sql`, copy the 5 tables by PK upsert). A parity test is optional here (no prod assets.db yet); a smoke that the script loads + the SQL is valid suffices.

- [ ] **Step 2: Real-CSV integration test.** Parse the **7 in-scope CSVs** with a **BOM-stripping** reader (`Assets.csv`'s first header is `﻿Asset ID` — `utf-8-sig` / strip the BOM, or every row's `asset_id` maps null and all 2 473 drop). Load them from a fixtures path (copy them into `tests/fixtures/assets/` OR read from an env-pointed dir) through the sync engine into a throwaway sqlite, then assert on real data:
  - all **2 473** assets present; the `Workstation ID = Asset ID` join produces non-null RAM for a known machine;
  - the no-cost filter (`'0.00'`) returns **2 246**, not 0;
  - `getEnrichedAssets` returns sane aggregates (RAM > 0 for machines with memory rows).

- [ ] **Step 3: Full regression** — `node --test --test-force-exit tests/` (or the repo's runner). The pre-existing 16 failures documented in CLAUDE.md stay as-is; nothing new red. `await-precedence` green with the new module covered.

- [ ] **Step 4: `CLAUDE.md`** — a Current-State entry + the pitfalls this earned: the `$`-label currency trap (XOF vs USD), `stripPiiColumns` eating IP/MAC/email, `Monitor Type` pollution, `Purchase Cost` present-as-`0.00`, and the no-paging-precedent risk. Point at the spec.

- [ ] **Step 5: Commit + finish the branch** (merge to `main` is the user's call; nothing pushed to origin).

---

## Done criteria (sub-project A)

- [ ] `assets.db` with 5 tables; `001_init.sql` PG mirror; `ASSETS_BACKEND` selects the backend; both init paths tested.
- [ ] `fetchAll` single-fetches and **throws on truncation** (proven by stub); `syncAllAssets` full-replaces all 5 views, per-view isolated, every write awaited, a failed fetch never empties a table.
- [ ] `getEnrichedAssets` joins by `Workstation ID = Asset ID`; orphan-safe; no-cost filters on `'0.00'`; monitor count is raw.
- [ ] `/api/assets/*` serves inventory/lookups/summary/export, filters whitelisted (no 500 on hostile input); `await`-guard covers `assets-db.js` + `assets-sync.js`.
- [ ] `public/assets.html` renders the filterable enriched inventory + Excel export; in Insights ▾; **verified in the browser against real data**.
- [ ] Real-CSV integration green (2 473 assets, 2 246 no-cost); full suite green.
- [ ] **No monetary display anywhere in A.**
- [ ] No paging anywhere in A (all 5 views single-fetch); `fetchAll` throws on truncation — never a silent partial.
