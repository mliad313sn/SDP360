// tests/assets-effort-snapshot.test.js — seeds sqlite directly, then exercises the
// nightly effort-snapshot job snapshotEffort() into the append-only history table
// (Task 0, sub-project "asset-manager effort trend").
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eff-'));
const adb = require('../assets-db');

const cols = ['asset_id', 'asset_name', 'product', 'product_type', 'manufacturer', 'state',
  'serial_number', 'barcode', 'asset_tag', 'site', 'site_id', 'purchase_cost', 'acquisition_date',
  'warranty_expiry', 'user_name', 'department', 'last_successful_audit_time',
  'last_audit_status', 'days_since_scan', 'last_scan_source', 'created_time'];

// A "clean" row (present-on-everything, in NO worklist).
const base = {
  product: 'Laptop', product_type: 'Notebook', manufacturer: 'Dell', serial_number: 'SN',
  barcode: 'BC', site_id: 'S', purchase_cost: '1,250,000.00', acquisition_date: '2024-01-01',
  warranty_expiry: '2027-01-01', user_name: 'x', department: 'IT',
  last_successful_audit_time: '2026-07-15', last_audit_status: 'Success',
  days_since_scan: '2', last_scan_source: 'Agent', created_time: '2024-01-01', state: 'In Use',
};

// MANA — 8 assets, one hit per worklist so the 6 counts are all exactly 1 (plus ghost).
const rows = [
  { ...base, asset_id: 'M1', asset_name: 'Asset M1', site: 'MANA' },                                          // clean
  { ...base, asset_id: 'M2', asset_name: 'Asset M2', site: 'MANA', purchase_cost: '0.00' },                   // no_cost
  { ...base, asset_id: 'M3', asset_name: 'Asset M3', site: 'MANA', acquisition_date: '' },                    // no_age
  { ...base, asset_id: 'M4', asset_name: 'Asset M4', site: 'MANA', user_name: '', department: '' },           // no_owner
  { ...base, asset_id: 'M5', asset_name: 'Asset M5', site: 'MANA', last_audit_status: 'Failed', last_successful_audit_time: '', days_since_scan: '5' }, // never_scanned
  { ...base, asset_id: 'M6', asset_name: 'Asset M6', site: 'MANA', barcode: '', asset_tag: '' },              // no_asset_tag
  { ...base, asset_id: 'M7', asset_name: 'Asset M7', site: 'MANA', state: 'Discovered' },                     // discovered
  { ...base, asset_id: 'M8', asset_name: 'Asset M8', site: 'MANA', last_audit_status: 'Success', last_successful_audit_time: '2026-01-01', days_since_scan: '120' }, // ghost (stored, NOT scored)

  // HGO — 2 assets: 1 clean + 1 no_cost. score = round(100*(0.5+1+1+1+1+1)/6) = 92.
  { ...base, asset_id: 'H1', asset_name: 'Asset H1', site: 'HGO' },
  { ...base, asset_id: 'H2', asset_name: 'Asset H2', site: 'HGO', purchase_cost: '0.00' },

  // C1 NULL-site regression — one clean asset with site = null → COALESCE bucket ''.
  { ...base, asset_id: 'Z1', asset_name: 'Asset Z1', site: null },
];
adb.replaceTable('assets', cols, rows);

const readHist = (date) => adb.getDB()
  .prepare(`SELECT * FROM asset_effort_history${date ? ' WHERE snapshot_date = ?' : ''} ORDER BY site`)
  .all(...(date ? [date] : []));

test('snapshotEffort writes one row per site with all columns + hand-computed MANA score', () => {
  const res = adb.snapshotEffort({ asOf: '2026-07-19' });
  assert.strictEqual(res.date, '2026-07-19');
  assert.strictEqual(res.sites, 3, 'MANA + HGO + null-site bucket');

  const hist = readHist('2026-07-19');
  assert.strictEqual(hist.length, 3, 'exactly one row per site for the date');

  const mana = hist.find(r => r.site === 'MANA');
  assert.ok(mana, 'MANA row present');
  // detail columns
  assert.strictEqual(mana.total, 8);
  assert.strictEqual(mana.no_cost, 1);
  assert.strictEqual(mana.no_age, 1);
  assert.strictEqual(mana.no_owner, 1);
  assert.strictEqual(mana.never_scanned, 1);
  assert.strictEqual(mana.no_asset_tag, 1);
  assert.strictEqual(mana.discovered, 1);
  assert.strictEqual(mana.ghost, 1, 'ghost STORED as a detail column');
  // pcts = 1 - worklist/total, each = 1 - 1/8 = 0.875
  assert.strictEqual(mana.cost_pct, 0.875);
  assert.strictEqual(mana.age_pct, 0.875);
  assert.strictEqual(mana.owner_pct, 0.875);
  assert.strictEqual(mana.scan_pct, 0.875);   // uses never_scanned, NEVER ghost
  assert.strictEqual(mana.tag_pct, 0.875);
  assert.strictEqual(mana.enrolled_pct, 0.875);
  // effort_score = round(100 * mean(6 pcts)) = round(87.5) = 88 (ghost NOT in the mean)
  assert.strictEqual(mana.effort_score, 88);

  const hgo = hist.find(r => r.site === 'HGO');
  assert.strictEqual(hgo.total, 2);
  assert.strictEqual(hgo.no_cost, 1);
  assert.strictEqual(hgo.effort_score, 92);
});

test('C1 — NULL-site asset produces a row with site === "", never a crash / NULL-PK', () => {
  const hist = readHist('2026-07-19');
  const empty = hist.find(r => r.site === '');
  assert.ok(empty, 'null-site bucket present as empty string');
  assert.strictEqual(empty.total, 1);
  assert.strictEqual(empty.effort_score, 100, 'the one null-site asset is clean');
});

test('idempotent per day — a second call for the same date does not double rows', () => {
  adb.snapshotEffort({ asOf: '2026-07-19' });
  const hist = readHist('2026-07-19');
  assert.strictEqual(hist.length, 3, 'still exactly one row per site (upsert, not append)');
});

test('append across days — a second date adds a second row per site', () => {
  adb.snapshotEffort({ asOf: '2026-07-20' });
  assert.strictEqual(readHist('2026-07-20').length, 3);
  assert.strictEqual(readHist().length, 6, '2 dates × 3 sites');
});

test('total=0 — a non-seeded site is simply absent (no row)', () => {
  const hist = readHist('2026-07-19');
  assert.ok(!hist.some(r => r.site === 'ZZZ'), 'no phantom row for a site with zero assets');
});
