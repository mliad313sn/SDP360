// tests/assets-integration.test.js
// End-to-end Foundation proof against the REAL AP CSV exports (committed under
// tests/fixtures/assets/). Each CSV is parsed to {DisplayName: value} row-objects —
// shape-identical to what the live fetchView yields — then driven through the SAME
// path the nightly sync uses (DEFAULT_MAP over each ASSET_VIEWS def -> replaceTable)
// into a throwaway sqlite. Then the enriched reader is asserted on real data.
//
// The single most important assertion is the 2473 asset count: Assets.csv's first
// header is `﻿Asset ID` (leading UTF-8 BOM). If the BOM is not stripped, the
// key is `﻿Asset ID`, asset_id maps to null, every row is dropped by the
// pkCol filter, and the count is 0. Stripping it is what makes this test pass.
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-integ-'));
const adb = require('../assets-db');
const { ASSET_VIEWS, DEFAULT_MAP } = require('../assets-sync');

const FIX = path.join(__dirname, 'fixtures', 'assets');

// ── tiny quote-aware CSV parser ────────────────────────────────────────────────
// Handles quoted fields, embedded commas/newlines, and "" escapes. Strips a leading
// UTF-8 BOM so the first header is `Asset ID`, not `﻿Asset ID`.
function parseCsv(text) {
  text = text.replace(/^﻿/, '');            // ← the BOM trap
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readCsvObjects(file) {
  const rows = parseCsv(fs.readFileSync(path.join(FIX, file), 'utf8'));
  const headers = rows[0];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === '') continue;   // trailing blank line
    const o = {};
    headers.forEach((h, j) => { o[h] = rows[i][j]; });
    out.push(o);
  }
  return out;
}

// Load every fixture through the live sync mapping into the throwaway sqlite.
const CSV_FOR = {
  assets: 'Assets.csv',
  asset_memory: 'Memory_Modules.csv',
  asset_logical_drives: 'Logical_Drives.csv',
  asset_monitors: 'Monitors.csv',
  software_licenses: 'Software_Licenses.csv',
};
for (const def of ASSET_VIEWS) {
  const raw = readCsvObjects(CSV_FOR[def.name]);
  const mapped = raw.map(r => DEFAULT_MAP(r, def)).filter(m => m[def.pkCol]);   // same PK-drop as syncAssetView
  adb.replaceTable(def.table, Object.values(def.columns), mapped);
}
const db = adb.getDB();

// Real observed numbers (recon 2026-07-17): 2473 assets, 2246 no-cost, first machine
// with memory = 212627000010546609 @ 16 GB.
const EXPECTED_ASSETS  = 2473;
const EXPECTED_NO_COST = 2246;

test('all 2473 assets land — proves the BOM was stripped', () => {
  const n = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
  console.log(`[assets-integration] assets rows loaded = ${n}`);
  assert.ok(n > 2000, `expected >2000 assets, got ${n} (BOM likely unstripped if 0)`);
  assert.strictEqual(n, EXPECTED_ASSETS, `expected exactly ${EXPECTED_ASSETS} assets`);
});

test('no-cost filter (0.00/0/"") matches 2246 rows — NOT via IS NULL', () => {
  const n = db.prepare("SELECT COUNT(*) c FROM assets WHERE purchase_cost IN ('0.00','0','')").get().c;
  const viaReader = adb.getEnrichedAssets({}).filter(r => ['0.00','0',''].includes(r.purchase_cost)).length;
  console.log(`[assets-integration] no-cost rows = ${n}`);
  assert.strictEqual(n, EXPECTED_NO_COST, `expected exactly ${EXPECTED_NO_COST} no-cost assets`);
  assert.strictEqual(viaReader, EXPECTED_NO_COST, 'reader path agrees with the raw count');
});

test('getEnrichedAssets returns a real machine with ram_total_gb > 0 (RAM join works)', () => {
  const rows = adb.getEnrichedAssets({});
  // find the first asset_id that has memory rows in the fixture, programmatically
  const memWs = new Set(
    db.prepare('SELECT DISTINCT workstation_id v FROM asset_memory WHERE workstation_id IS NOT NULL').all().map(r => r.v)
  );
  const target = rows.find(r => memWs.has(r.asset_id));
  assert.ok(target, 'at least one asset joins to memory');
  console.log(`[assets-integration] sample machine ${target.asset_id} ram_total_gb=${target.ram_total_gb}`);
  assert.ok(target.ram_total_gb > 0, 'ram_total_gb aggregated from asset_memory');
});

test('monitor_count and system_disk_free_pct are sane across the fleet', () => {
  const rows = adb.getEnrichedAssets({});
  assert.ok(rows.every(r => r.monitor_count >= 0), 'monitor_count is never negative');
  assert.ok(rows.every(r => r.system_disk_free_pct == null || r.system_disk_free_pct >= 0),
    'free pct is null or non-negative');
  assert.ok(rows.some(r => r.monitor_count > 0), 'at least one asset has a monitor');
  assert.ok(rows.some(r => r.system_disk_free_pct != null), 'at least one asset has a C: free pct');
});

// copy-assets.js is CLI-guarded (require.main === module) so it is require-safe.
// No prod assets.db exists, so a full parity copy is out of reach here — a require +
// SQL-parse + table/column-coverage smoke is the guard.
test('copy-assets module is require-safe and its TABLES cover all 5 asset tables', () => {
  const cp = require('../tools/pg/copy-assets');
  assert.strictEqual(typeof cp.copyAssets, 'function');
  const names = cp.TABLES.map(t => t[0]);
  assert.deepStrictEqual(names.sort(), Object.values(CSV_FOR).length ? ASSET_VIEWS.map(v => v.table).sort() : []);
  // every copy column exists in the live schema (assets.db was created from 001_init.sql)
  for (const [table, cols] of cp.TABLES) {
    const dbCols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
    for (const c of cols) assert.ok(dbCols.has(c), `${table}.${c} exists in schema`);
    // upsert SQL builds without throwing
    const pk = cp.TABLES.find(t => t[0] === table)[2];
    assert.match(cp._upsertSql(table, cols, pk), /^INSERT INTO/);
  }
});
