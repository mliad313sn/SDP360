// tests/assets-investment-readers.test.js — seeds sqlite directly, then reads the
// investment history summary + the hardware/software forecast (dual-backend readers
// that delegate to the PURE services/assetForecast.js builders).
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
const adb = require('../assets-db');
const { DEFAULT_DEPRECIATION_CONFIG } = require('../services/depreciation');

const RATE = 0.00165;

// ── assets: 2 sites × 2 product_types ───────────────────────────────────────
const aCols = ['asset_id', 'asset_name', 'product_type', 'site', 'manufacturer',
  'state', 'purchase_cost', 'acquisition_date'];
const aRows = [
  // MANA Laptop acquired 2020, XOF 1,000,000.00 → ×0.00165 = 1650 USD (past-life)
  { asset_id: 'A1', asset_name: 'MANA Laptop', product_type: 'Laptop', site: 'MANA',
    manufacturer: 'Dell', state: 'In Use', purchase_cost: '1,000,000.00', acquisition_date: '2020-03-01' },
  // MANA Desktop acquired 2024, XOF 500000
  { asset_id: 'A2', asset_name: 'MANA Desktop', product_type: 'Desktop', site: 'MANA',
    manufacturer: 'HP', state: 'In Use', purchase_cost: '500000', acquisition_date: '2024-06-01' },
  // HGO Laptop acquired 2019, no cost (0.00 → excluded from coverage)
  { asset_id: 'A3', asset_name: 'HGO Laptop', product_type: 'Laptop', site: 'HGO',
    manufacturer: 'Dell', state: 'In Use', purchase_cost: '0.00', acquisition_date: '2019-01-01' },
];
__bootChain(async () => { (await adb.replaceTable('assets', aCols, aRows)); });

// ── software_licenses: 2 sites ──────────────────────────────────────────────
const lCols = ['license_id', 'license_name', 'license_type', 'license_state', 'expiry_date',
  'cost', 'site', 'vendor', 'license_option', 'acquisition_date'];
const lRows = [
  // MANA perpetual, acquired 2023, USD 300, expiry 2027
  { license_id: 'L1', license_name: 'Acme Pro', license_type: 'Volume', license_state: 'Active',
    expiry_date: '30 Jun 2027', cost: '300', site: 'MANA', vendor: 'Acme',
    license_option: 'Perpetual', acquisition_date: '2023-04-01' },
  // HGO subscription, acquired 2022, USD 100, expiry 2025 (already expired)
  { license_id: 'L2', license_name: 'Cloud Sub', license_type: 'Subscription', license_state: 'Active',
    expiry_date: '30 Jun 2025', cost: '100', site: 'HGO', vendor: 'Cloudy',
    license_option: 'Subscription', acquisition_date: '2022-05-01' },
];
__bootChain(async () => { (await adb.replaceTable('software_licenses', lCols, lRows)); });

// ── getInvestmentSummary ─────────────────────────────────────────────────────
test('getInvestmentSummary — shape + XOF→USD conversion in the right year', async () => {
  const s = (await adb.getInvestmentSummary({}, { rate: RATE }));
  assert.ok(Array.isArray(s.years), 'years is an array');
  assert.ok(s.coverage && s.coverage.hardware && s.coverage.software, 'coverage.hardware/software present');
  const y2020 = s.years.find(y => y.year === 2020);
  assert.ok(y2020, '2020 year bucket present');
  assert.strictEqual(y2020.hardware_usd, 1650, "1,000,000 XOF × 0.00165 = 1650 USD");
  const y2023 = s.years.find(y => y.year === 2023);
  assert.ok(y2023 && y2023.software_usd === 300, 'MANA licence 300 USD in 2023 software_usd');
});

test('getInvestmentSummary — product_type narrows hardware coverage (ONLY hardware)', async () => {
  const all = (await adb.getInvestmentSummary({}, { rate: RATE }));
  const lap = (await adb.getInvestmentSummary({ product_type: 'Laptop' }, { rate: RATE }));
  assert.strictEqual(all.coverage.hardware.total, 3, 'unfiltered = 3 assets');
  assert.strictEqual(lap.coverage.hardware.total, 2, 'Laptop = A1 + A3');
  assert.ok(lap.coverage.hardware.total < all.coverage.hardware.total, 'product_type narrows hardware');
});

// ── getInvestmentForecast ────────────────────────────────────────────────────
test('getInvestmentForecast — shape + past-life asset lands in hardware.due_now', async () => {
  const f = (await adb.getInvestmentForecast({}, {
    config: DEFAULT_DEPRECIATION_CONFIG, rate: RATE, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01',
  }));
  assert.ok(f.hardware && f.software, 'both hardware + software blocks present');
  for (const k of ['years', 'due_now', 'beyond_horizon', 'total_forecast_usd', 'coverage']) {
    assert.ok(k in f.hardware, `hardware.${k} present`);
    assert.ok(k in f.software, `software.${k} present`);
  }
  assert.ok(f.hardware.due_now.count >= 1, 'MANA Laptop (acquired 2020) is due_now');
});

test('getInvestmentForecast — site narrows BOTH hardware AND software coverage', async () => {
  const opts = { config: DEFAULT_DEPRECIATION_CONFIG, rate: RATE, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01' };
  const all = (await adb.getInvestmentForecast({}, opts));
  const mana = (await adb.getInvestmentForecast({ site: 'MANA' }, opts));
  assert.ok(mana.hardware.coverage.total < all.hardware.coverage.total, 'site narrows hardware');
  assert.strictEqual(all.software.coverage.total, 2, 'unfiltered = 2 licences');
  assert.strictEqual(mana.software.coverage.total, 1, 'site=MANA → 1 licence (L1)');
  assert.ok(mana.software.coverage.total < all.software.coverage.total, 'site narrows software TOO');
});

// ── empty-but-valid ──────────────────────────────────────────────────────────
test('empty result set (filter matches nothing) → empty-but-valid, no throw', async () => {
  const s = (await adb.getInvestmentSummary({ site: 'NOWHERE' }, { rate: RATE }));
  assert.deepStrictEqual(s.years, []);
  assert.strictEqual(s.coverage.hardware.total, 0);
  assert.strictEqual(s.coverage.software.total, 0);
  const f = (await adb.getInvestmentForecast({ site: 'NOWHERE' }, {
    config: DEFAULT_DEPRECIATION_CONFIG, rate: RATE, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01',
  }));
  assert.deepStrictEqual(f.hardware.years, []);
  assert.strictEqual(f.hardware.coverage.total, 0);
  assert.strictEqual(f.software.coverage.total, 0);
});
