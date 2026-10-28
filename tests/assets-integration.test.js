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
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
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
  software: 'Software.csv',
};
__bootChain(async () => {
  for (const def of ASSET_VIEWS) {
    const raw = readCsvObjects(CSV_FOR[def.name]);
    const mapped = raw.map(r => DEFAULT_MAP(r, def)).filter(m => m[def.pkCol]);   // same PK-drop as syncAssetView
    await adb.replaceTable(def.table, Object.values(def.columns), mapped);
  }
});
const db = adb.getDB();

// Real observed numbers (recon 2026-07-17): 2473 assets, 2246 no-cost, first machine
// with memory = 212627000010546609 @ 16 GB.
const EXPECTED_ASSETS  = 2473;
const EXPECTED_NO_COST = 2246;

test('all 2473 assets land — proves the BOM was stripped', async () => {
  const n = (await db.prepare('SELECT COUNT(*) c FROM assets').get()).c;
  console.log(`[assets-integration] assets rows loaded = ${n}`);
  assert.ok(n > 2000, `expected >2000 assets, got ${n} (BOM likely unstripped if 0)`);
  assert.strictEqual(n, EXPECTED_ASSETS, `expected exactly ${EXPECTED_ASSETS} assets`);
});

// Assets C-2 Task 0 (Software compliance) — the software catalog view (002070) must now
// sync RAW into the new `software` table. These fail until 001_init.sql carries the table
// AND the ASSET_VIEWS column map + copy-assets TABLES + _ASSET_TABLES + CSV_FOR are extended.
const EXPECTED_SOFTWARE        = 9830;   // Software.csv = 9831 lines - 1 header
const EXPECTED_UNDER_LICENSED  = 32;

test('all 9830 software rows land — proves the BOM was stripped', async () => {
  const n = (await db.prepare('SELECT COUNT(*) c FROM software').get()).c;
  console.log(`[assets-integration] software rows loaded = ${n}`);
  assert.ok(n > 9000, `expected >9000 software rows, got ${n} (BOM likely unstripped if 0)`);
  assert.strictEqual(n, EXPECTED_SOFTWARE, `expected exactly ${EXPECTED_SOFTWARE} software rows`);
});

test('PIX4Dmapper row is captured RAW (compliance / installations / allowed)', async () => {
  const r = (await db.prepare(
    "SELECT compliance_type, installations, installations_allowed FROM software " +
    "WHERE software_name LIKE 'PIX4Dmapper%'"
  ).get());
  assert.ok(r, 'PIX4Dmapper row exists');
  console.log(`[assets-integration] PIX4Dmapper compliance=${r.compliance_type} ` +
    `installs=${r.installations} allowed=${r.installations_allowed}`);
  assert.strictEqual(r.compliance_type, 'Under Licensed');
  assert.strictEqual(r.installations, '24');
  assert.strictEqual(r.installations_allowed, '1');
});

test("32 software rows are compliance_type = 'Under Licensed'", async () => {
  const n = (await db.prepare("SELECT COUNT(*) c FROM software WHERE compliance_type = 'Under Licensed'").get()).c;
  console.log(`[assets-integration] Under Licensed rows = ${n}`);
  assert.strictEqual(n, EXPECTED_UNDER_LICENSED, `expected exactly ${EXPECTED_UNDER_LICENSED} Under Licensed rows`);
});

test('no-cost filter (0.00/0/"") matches 2246 rows — NOT via IS NULL', async () => {
  const n = (await db.prepare("SELECT COUNT(*) c FROM assets WHERE purchase_cost IN ('0.00','0','')").get()).c;
  const viaReader = (await adb.getEnrichedAssets({})).filter(r => ['0.00','0',''].includes(r.purchase_cost)).length;
  console.log(`[assets-integration] no-cost rows = ${n}`);
  assert.strictEqual(n, EXPECTED_NO_COST, `expected exactly ${EXPECTED_NO_COST} no-cost assets`);
  assert.strictEqual(viaReader, EXPECTED_NO_COST, 'reader path agrees with the raw count');
});

test('getEnrichedAssets returns a real machine with ram_total_gb > 0 (RAM join works)', async () => {
  const rows = (await adb.getEnrichedAssets({}));
  // find the first asset_id that has memory rows in the fixture, programmatically
  const memWs = new Set(
    (await db.prepare('SELECT DISTINCT workstation_id v FROM asset_memory WHERE workstation_id IS NOT NULL').all()).map(r => r.v)
  );
  const target = rows.find(r => memWs.has(r.asset_id));
  assert.ok(target, 'at least one asset joins to memory');
  console.log(`[assets-integration] sample machine ${target.asset_id} ram_total_gb=${target.ram_total_gb}`);
  assert.ok(target.ram_total_gb > 0, 'ram_total_gb aggregated from asset_memory');
});

test('monitor_count and system_disk_free_pct are sane across the fleet', async () => {
  const rows = (await adb.getEnrichedAssets({}));
  assert.ok(rows.every(r => r.monitor_count >= 0), 'monitor_count is never negative');
  assert.ok(rows.every(r => r.system_disk_free_pct == null || r.system_disk_free_pct >= 0),
    'free pct is null or non-negative');
  assert.ok(rows.some(r => r.monitor_count > 0), 'at least one asset has a monitor');
  assert.ok(rows.some(r => r.system_disk_free_pct != null), 'at least one asset has a C: free pct');
});

// Task 1 (Licence/Finance) — the finance columns + licence extras must now be captured
// RAW from the real CSV. These assertions fail until 001_init.sql carries the new columns
// AND the ASSET_VIEWS column maps are extended (nothing computes yet — just raw capture).
test('finance columns populate on a real asset (current_book_value + total_cost_of_ownership)', async () => {
  // pick the assertion target programmatically: the first asset with a non-empty book value
  const target = (await db.prepare(
    "SELECT asset_id, current_book_value, total_cost_of_ownership FROM assets " +
    "WHERE current_book_value IS NOT NULL AND current_book_value != '' LIMIT 1"
  ).get());
  assert.ok(target, 'at least one asset has a non-empty current_book_value');
  console.log(`[assets-integration] finance sample ${target.asset_id} ` +
    `book=${target.current_book_value} tco=${target.total_cost_of_ownership}`);
  assert.ok(target.current_book_value && target.current_book_value !== '',
    'current_book_value captured (non-empty)');
  assert.ok(target.total_cost_of_ownership && target.total_cost_of_ownership !== '',
    'total_cost_of_ownership captured (non-empty)');
});

test('licence extras populate (installations_allowed + license_option)', async () => {
  const target = (await db.prepare(
    "SELECT license_id, installations_allowed, license_option FROM software_licenses " +
    "WHERE installations_allowed IS NOT NULL AND installations_allowed != '' LIMIT 1"
  ).get());
  assert.ok(target, 'at least one licence has a non-empty installations_allowed');
  console.log(`[assets-integration] licence sample ${target.license_id} ` +
    `installs=${target.installations_allowed} option=${target.license_option}`);
  assert.ok(target.installations_allowed && target.installations_allowed !== '',
    'installations_allowed captured (non-empty)');
  assert.ok(target.license_option && target.license_option !== '',
    'license_option captured (non-empty)');
});


