'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afu-'));
const adb = require('../assets-db');

const COLS = ['asset_id', 'asset_name', 'product_type', 'manufacturer', 'serial_number', 'state', 'site',
  'user_name', 'department', 'purchase_cost', 'acquisition_date', 'asset_tag', 'barcode'];
const ok = { product_type: 'Laptop', manufacturer: 'Dell', serial_number: 'SN', state: 'In Use',
  user_name: 'u', department: 'IT', purchase_cost: '1,250,000.00', acquisition_date: '2024-01-01' };

// Baseline register (day 1), then new arrivals (day 2).
adb.replaceTable('assets', COLS, [{ ...ok, asset_id: 'B1', asset_name: 'Base-1', site: 'Hounde' }]);
adb.recordAssetSightings({ asOf: '2026-07-20' });
adb.replaceTable('assets', COLS, [
  { ...ok, asset_id: 'B1', asset_name: 'Base-1', site: 'Hounde' },                                        // baseline → never "new"
  { ...ok, asset_id: 'N1', asset_name: 'New-1', site: 'Hounde' },                                         // new in window, no QR code
  { ...ok, asset_id: 'T1', asset_name: 'New-tagged', site: 'Hounde', asset_tag: 'QR-0001' },            // new but tagged → NOT listed
  { ...ok, asset_id: 'T2', asset_name: 'New-barcode', site: 'Hounde', asset_tag: ' ', barcode: 'BC-1' }, // new, barcode only (= serial, not a QR label) → listed
  { ...ok, asset_id: 'U1', asset_name: 'Unassigned-blank', site: 'Hounde', user_name: '  ', department: ' ' }, // unassigned (spaces)
  { ...ok, asset_id: 'U2', asset_name: 'Store-no-user', site: 'Hounde', state: 'In Store', user_name: '', department: '' }, // unassigned (In Store counts)
  { ...ok, asset_id: 'U3', asset_name: 'Dept-only', site: 'Hounde', user_name: '', department: 'HR' },   // unassigned (a department is not a user)
  { ...ok, asset_id: 'C1', asset_name: 'Cost-000', site: 'Hounde', purchase_cost: ' 0.00 ' },             // no cost (trimmed)
  { ...ok, asset_id: 'C2', asset_name: 'Cost-null', site: 'Hounde', state: 'In Repair', purchase_cost: null }, // no cost (In Repair counts)
  { ...ok, asset_id: 'C3', asset_name: 'Cost-disposed', site: 'Hounde', state: 'Disposed', purchase_cost: '0' }, // NOT counted (state)
  { ...ok, asset_id: 'D1', asset_name: 'Date-blank', site: 'Hounde', acquisition_date: ' ' },             // no date
  { ...ok, asset_id: 'D2', asset_name: 'Date-expired', site: 'Hounde', state: 'Expired', acquisition_date: '' }, // NOT counted (state)
  { ...ok, asset_id: 'M1', asset_name: 'Massawa-1', site: 'MASSAWA', user_name: '', department: '' },   // second label of a multi-label site
  { ...ok, asset_id: 'X1', asset_name: 'Other-site', site: 'MANA', user_name: '', department: '' },     // other site
]);
adb.recordAssetSightings({ asOf: '2026-07-28' });
// GONE: simulates an asset removed from the register after being first seen — its
// asset_first_seen row exists but it was never inserted into `assets`.
adb.getDB().prepare(`INSERT INTO asset_first_seen (asset_id, site, first_seen_date, baseline) VALUES ('GONE','Hounde','2026-07-28',0)`).run();

const W = { newFrom: '2026-07-26', newTo: '2026-08-01' };
const ids = (rows) => rows.map(r => r.asset_id).sort();

test('each list follows its predicate (trim, states, all product types)', () => {
  const f = adb.getSiteAssetFollowups(['Hounde'], W);
  assert.deepStrictEqual(ids(f.unassigned), ['U1', 'U2', 'U3']);
  assert.deepStrictEqual(ids(f.no_cost), ['C1', 'C2']);
  assert.deepStrictEqual(ids(f.no_date), ['D1']);
  // new = first seen in the window AND no QR code (Asset Tag blank; barcode ignored)
  assert.deepStrictEqual(ids(f.new), ['C1', 'C2', 'C3', 'D1', 'D2', 'N1', 'T2', 'U1', 'U2', 'U3']);
  assert.ok(!ids(f.new).includes('T1'), 'a tagged new asset is not listed');
  assert.deepStrictEqual(f.counts, { new: f.new.length, unassigned: 3, no_cost: 2, no_date: 1 });
  assert.match(f.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('new respects the window bounds (inclusive)', () => {
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], { newFrom: '2026-07-28', newTo: '2026-07-28' }).counts.new > 0, true);
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], { newFrom: '2026-07-29', newTo: '2026-08-01' }).counts.new, 0);
  assert.strictEqual(adb.getSiteAssetFollowups(['Hounde'], {}).counts.new, 0, 'no window → no "new" list');
});

test('multi-label site sums across labels; other sites excluded', () => {
  const f = adb.getSiteAssetFollowups(['Hounde', 'MASSAWA'], W);
  assert.deepStrictEqual(ids(f.unassigned), ['M1', 'U1', 'U2', 'U3']);
  assert.ok(!ids(f.unassigned).includes('X1'));
});

test('empty labels → zeros and empty lists', () => {
  const f = adb.getSiteAssetFollowups([], W);
  assert.deepStrictEqual(f.counts, { new: 0, unassigned: 0, no_cost: 0, no_date: 0 });
  assert.deepStrictEqual([f.new, f.unassigned, f.no_cost, f.no_date], [[], [], [], []]);
});

test('rows carry has_cost (boolean) and NO amount key', () => {
  const f = adb.getSiteAssetFollowups(['Hounde'], W);
  for (const list of [f.new, f.unassigned, f.no_cost, f.no_date]) {
    for (const r of list) {
      assert.strictEqual(typeof r.has_cost, 'boolean');
      for (const k of ['purchase_cost', 'current_book_value', 'total_cost_of_ownership', 'operational_cost']) {
        assert.ok(!(k in r), `money key ${k} must not leak`);
      }
    }
  }
  assert.strictEqual(f.no_cost.find(r => r.asset_id === 'C1').has_cost, false);
  assert.strictEqual(f.new.find(r => r.asset_id === 'N1').has_cost, true);
  assert.strictEqual(f.new.find(r => r.asset_id === 'N1').first_seen_date, '2026-07-28');
});
