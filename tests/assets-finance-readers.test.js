// tests/assets-finance-readers.test.js — seeds sqlite directly, then reads the
// per-site finance summary (Task 2, Licence/Finance): value / book / TCO / opex
// in USD (assets are XOF, multiplied by rate), % depreciated, refresh-due count.
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-'));
const adb = require('../assets-db');

const cols = ['asset_id', 'asset_name', 'site', 'product_type',
  'purchase_cost', 'current_book_value', 'total_cost_of_ownership',
  'operational_cost', 'months_since_acquisition'];

const rows = [
  // MANA A1 — Laptop, 40mo (≥36 → refresh-due), partly depreciated.
  { asset_id: 'A1', asset_name: 'A1', site: 'MANA', product_type: 'Laptop',
    purchase_cost: '1,000,000.00', current_book_value: '250,000.00',
    total_cost_of_ownership: '1,100,000.00', operational_cost: '100,000.00',
    months_since_acquisition: '40' },
  // MANA A2 — Desktop, 5mo (<36 → not refresh-due), new / not depreciated.
  { asset_id: 'A2', asset_name: 'A2', site: 'MANA', product_type: 'Desktop',
    purchase_cost: '2,000,000.00', current_book_value: '2,000,000.00',
    total_cost_of_ownership: '2,000,000.00', operational_cost: '0.00',
    months_since_acquisition: '5' },
  // HGO A3 — Server, 70mo (≥60 → refresh-due), fully depreciated.
  { asset_id: 'A3', asset_name: 'A3', site: 'HGO', product_type: 'Server',
    purchase_cost: '500,000.00', current_book_value: '0.00',
    total_cost_of_ownership: '600,000.00', operational_cost: '100,000.00',
    months_since_acquisition: '70' },
  // HGO A4 — Monitor, all-empty money + empty months (must not NaN anything).
  { asset_id: 'A4', asset_name: 'A4', site: 'HGO', product_type: 'Monitor',
    purchase_cost: '', current_book_value: '', total_cost_of_ownership: '',
    operational_cost: '', months_since_acquisition: '' },
];
__bootChain(async () => { (await adb.replaceTable('assets', cols, rows)); });

const RATE = 0.00165;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('per-site USD sums, pct_depreciated, and refresh-due at a XOF→USD rate', async () => {
  const s = (await adb.getFinanceSummary({}, RATE));
  const bySite = Object.fromEntries(s.by_site.map(r => [r.site, r]));

  const mana = bySite.MANA;
  assert.strictEqual(mana.asset_count, 2);
  near(mana.purchase_cost_usd, (1000000 + 2000000) * RATE, 0.01, 'MANA purchase_cost_usd'); // 4950
  near(mana.book_value_usd, (250000 + 2000000) * RATE, 0.01, 'MANA book_value_usd');        // 3712.5
  near(mana.tco_usd, (1100000 + 2000000) * RATE, 0.01, 'MANA tco_usd');
  near(mana.operational_cost_usd, (100000 + 0) * RATE, 0.01, 'MANA operational_cost_usd');
  near(mana.pct_depreciated, 1 - 2250000 / 3000000, 0.001, 'MANA pct_depreciated'); // 0.25
  assert.strictEqual(mana.refresh_due, 1, 'MANA: A1 Laptop 40mo only');

  const hgo = bySite.HGO;
  assert.strictEqual(hgo.asset_count, 2);
  near(hgo.purchase_cost_usd, 500000 * RATE, 0.01, 'HGO purchase_cost_usd'); // A4 empty excluded
  near(hgo.book_value_usd, 0, 0.01, 'HGO book_value_usd');
  near(hgo.pct_depreciated, 1.0, 0.001, 'HGO pct_depreciated'); // 1 - 0/500000
  assert.strictEqual(hgo.refresh_due, 1, 'HGO: A3 Server 70mo only');
  // A4 all-empty must not corrupt HGO sums into NaN.
  assert.ok(Number.isFinite(hgo.purchase_cost_usd), 'HGO purchase_cost_usd is finite');
  assert.ok(Number.isFinite(hgo.book_value_usd), 'HGO book_value_usd is finite');
});

test('fleet totals = sum across all sites', async () => {
  const s = (await adb.getFinanceSummary({}, RATE));
  near(s.fleet.purchase_cost_usd, (3000000 + 500000) * RATE, 0.01, 'fleet purchase_cost_usd'); // 5775
  near(s.fleet.book_value_usd, (2250000 + 0) * RATE, 0.01, 'fleet book_value_usd');
  assert.strictEqual(s.fleet.asset_count, 4);
  assert.strictEqual(s.fleet.refresh_due, 2, 'A1 + A3');
  near(s.fleet.pct_depreciated, 1 - 2250000 / 3500000, 0.001, 'fleet pct_depreciated');
});

test('a site filter narrows to only that site', async () => {
  const s = (await adb.getFinanceSummary({ site: 'MANA' }, RATE));
  assert.strictEqual(s.by_site.length, 1);
  assert.strictEqual(s.by_site[0].site, 'MANA');
  assert.strictEqual(s.fleet.asset_count, 2);
  assert.strictEqual(s.fleet.refresh_due, 1);
});

test('default rate=1 path returns RAW XOF sums', async () => {
  const s = (await adb.getFinanceSummary({}));
  const mana = s.by_site.find(r => r.site === 'MANA');
  assert.strictEqual(mana.purchase_cost_usd, 3000000, 'MANA raw XOF purchase sum');
  assert.strictEqual(mana.book_value_usd, 2250000, 'MANA raw XOF book sum');
  assert.strictEqual(s.fleet.purchase_cost_usd, 3500000, 'fleet raw XOF purchase sum');
});

test('a site with all-empty costs → USD fields 0, pct_depreciated null', async () => {
  // Prove via a synthetic all-empty site: swap the table for one HGO-empty asset.
  const only = [{ asset_id: 'Z1', asset_name: 'Z1', site: 'ZZZ', product_type: 'Monitor',
    purchase_cost: '', current_book_value: '', total_cost_of_ownership: '',
    operational_cost: '', months_since_acquisition: '' }];
  (await adb.replaceTable('assets', cols, only));
  const z = (await adb.getFinanceSummary({}, RATE)).by_site.find(r => r.site === 'ZZZ');
  assert.strictEqual(z.purchase_cost_usd, 0, 'no cost → 0');
  assert.strictEqual(z.book_value_usd, 0);
  assert.strictEqual(z.tco_usd, 0);
  assert.strictEqual(z.operational_cost_usd, 0);
  assert.strictEqual(z.pct_depreciated, null, 'Σpurchase=0 → pct null');
  assert.strictEqual(z.refresh_due, 0);
  // restore the main seed for any later-added tests
  (await adb.replaceTable('assets', cols, rows));
});
