// tests/assets-depreciation-readers.test.js — seeds sqlite directly, then reads
// the per-site COMPUTED book value (Task 1, Asset Depreciation): each asset's
// current book value is derived from services/depreciation.js (method / useful
// life / salvage resolved per product_type from the config), summed per site and
// ×rate to USD. SDP's own Current Book Value is carried alongside as a
// cross-check. Money is XOF raw TEXT parsed by the ONE money.parseAmount.
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deprec-'));
const adb = require('../assets-db');
const { DEFAULT_DEPRECIATION_CONFIG } = require('../services/depreciation');

const cols = ['asset_id', 'asset_name', 'site', 'product_type',
  'purchase_cost', 'acquisition_date', 'current_book_value'];

const rows = [
  // MANA A1 — Laptop, acq 2022-01, SL/36mo → by 2025-01 fully depreciated (36mo elapsed).
  { asset_id: 'A1', asset_name: 'A1', site: 'MANA', product_type: 'Laptop',
    purchase_cost: '1,000,000.00', acquisition_date: '01 Jan 2022', current_book_value: '250,000.00' },
  // MANA A2 — Desktop, acq 2024-01, SL/36mo → 12mo elapsed → book 1,333,333.33.
  { asset_id: 'A2', asset_name: 'A2', site: 'MANA', product_type: 'Desktop',
    purchase_cost: '2,000,000.00', acquisition_date: '01 Jan 2024', current_book_value: '1,500,000.00' },
  // HGO A3 — Server, acq 2020-01, SL/60mo → 60mo elapsed → book 0.
  { asset_id: 'A3', asset_name: 'A3', site: 'HGO', product_type: 'Server',
    purchase_cost: '5,000,000.00', acquisition_date: '01 Jan 2020', current_book_value: '0.00' },
  // HGO A4 — no cost / no date (must not NaN anything; excluded from money sums).
  { asset_id: 'A4', asset_name: 'A4', site: 'HGO', product_type: 'Monitor',
    purchase_cost: '', acquisition_date: '', current_book_value: '' },
];
adb.replaceTable('assets', cols, rows);

const RATE = 0.00165;
const OPTS = { config: DEFAULT_DEPRECIATION_CONFIG, rate: RATE, asOf: '2025-01-01' };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// Hand-computed computed book values (straight-line, at asOf 2025-01-01):
//   A1 Laptop  SL/36: 2022-01→2025-01 = 36mo → 0
//   A2 Desktop SL/36: 2024-01→2025-01 = 12mo → 2,000,000 × (1 - 12/36) = 1,333,333.33
//   A3 Server  SL/60: 2020-01→2025-01 = 60mo → 0
const MANA_COMPUTED = 0 + (2000000 * (1 - 12 / 36));   // 1,333,333.33
const HGO_COMPUTED = 0;

test('per-site computed book value (USD) + SDP cross-check + pct (M-5)', () => {
  const s = adb.getAssetDepreciation({}, OPTS);
  const bySite = Object.fromEntries(s.by_site.map(r => [r.site, r]));

  const mana = bySite.MANA;
  assert.strictEqual(mana.asset_count, 2);
  near(mana.computed_book_value_usd, MANA_COMPUTED * RATE, 1, 'MANA computed_book_value_usd'); // ≈2200
  near(mana.sdp_book_value_usd, (250000 + 1500000) * RATE, 0.01, 'MANA sdp_book_value_usd');   // 2887.50
  near(mana.purchase_cost_usd, (1000000 + 2000000) * RATE, 0.01, 'MANA purchase_cost_usd');
  // pct = 1 - Σcomputed / Σpurchase (M-5)
  near(mana.pct_depreciated, 1 - MANA_COMPUTED / 3000000, 0.001, 'MANA pct_depreciated'); // ≈0.5556

  const hgo = bySite.HGO;
  assert.strictEqual(hgo.asset_count, 2, 'A3 + A4 (no-cost still counts)');
  near(hgo.computed_book_value_usd, HGO_COMPUTED, 0.01, 'HGO computed_book_value_usd'); // ≈0
  near(hgo.sdp_book_value_usd, 0, 0.01, 'HGO sdp_book_value_usd');
  near(hgo.pct_depreciated, 1.0, 0.001, 'HGO pct_depreciated'); // 1 - 0/5,000,000
  // A4 all-empty must not corrupt HGO sums into NaN.
  assert.ok(Number.isFinite(hgo.computed_book_value_usd), 'HGO computed is finite');
  assert.ok(Number.isFinite(hgo.sdp_book_value_usd), 'HGO sdp is finite');
});

test('fleet totals = sum across all sites', () => {
  const s = adb.getAssetDepreciation({}, OPTS);
  near(s.fleet.computed_book_value_usd, (MANA_COMPUTED + HGO_COMPUTED) * RATE, 1, 'fleet computed'); // ≈2200
  near(s.fleet.sdp_book_value_usd, (250000 + 1500000 + 0) * RATE, 0.01, 'fleet sdp');
  near(s.fleet.purchase_cost_usd, (3000000 + 5000000) * RATE, 0.01, 'fleet purchase');
  assert.strictEqual(s.fleet.asset_count, 4);
  near(s.fleet.pct_depreciated, 1 - MANA_COMPUTED / 8000000, 0.001, 'fleet pct'); // ≈0.8333
});

test('a site filter narrows to only that site', () => {
  const s = adb.getAssetDepreciation({ site: 'MANA' }, OPTS);
  assert.strictEqual(s.by_site.length, 1);
  assert.strictEqual(s.by_site[0].site, 'MANA');
  assert.strictEqual(s.fleet.asset_count, 2);
  near(s.fleet.computed_book_value_usd, MANA_COMPUTED * RATE, 1, 'MANA-only fleet computed');
});

test('rate defaults to 1 → RAW XOF computed/sdp sums', () => {
  const s = adb.getAssetDepreciation({}, { config: DEFAULT_DEPRECIATION_CONFIG, asOf: '2025-01-01' });
  const mana = s.by_site.find(r => r.site === 'MANA');
  near(mana.computed_book_value_usd, MANA_COMPUTED, 0.01, 'MANA raw computed');
  assert.strictEqual(mana.sdp_book_value_usd, 250000 + 1500000, 'MANA raw sdp');
});

test('getDepreciationSchedule returns {years, book_value_usd} aligned + sorted', () => {
  const sch = adb.getDepreciationSchedule({}, OPTS);
  assert.ok(Array.isArray(sch.years), 'years is an array');
  assert.ok(Array.isArray(sch.book_value_usd), 'book_value_usd is an array');
  assert.strictEqual(sch.years.length, sch.book_value_usd.length, 'aligned lengths');
  // years sorted ascending
  const sorted = [...sch.years].sort((a, b) => a - b);
  assert.deepStrictEqual(sch.years, sorted, 'years sorted ascending');
  // A3 Server (2020) is the earliest schedule year; every value USD-scaled & finite
  assert.strictEqual(sch.years[0], 2020, 'earliest year is 2020 (A3 Server)');
  assert.ok(sch.book_value_usd.every(Number.isFinite), 'all book values finite');
});
