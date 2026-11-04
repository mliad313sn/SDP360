'use strict';
// A-26 — cost-outlier worklist: a JS-only reader (never a SQL CAST) that flags an
// asset whose parsed cost is > factor × the median cost of the same product type and
// currency, plus its money-gated route. Outliers stay SUMMED unless
// asset_cost_outlier_exclude = '1' (default '0').
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cost-outliers-'));
process.env.DASH_USER = process.env.DASH_USER || 'outlier-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'outlier-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'outlier-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const RATE = 0.00165;
let server, base, adminTok, viewerTok, adb;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  adb = require('../assets-db');
  const reportConfig = require('../services/reportConfig');
  (await reportConfig.setConfig(rdb.db, { xof_usd_rate: String(RATE) }, 'test'));
  const desk = (id, site, cost) => ({ asset_id: id, asset_name: id, site, product_type: 'Desktop', purchase_cost: cost,
    current_book_value: '', total_cost_of_ownership: '', operational_cost: '', months_since_acquisition: '' });
  (await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'product_type', 'purchase_cost', 'current_book_value',
     'total_cost_of_ownership', 'operational_cost', 'months_since_acquisition'],
    [desk('D1', 'MANA', '1,000,000.00'), desk('D2', 'MANA', '1,100,000.00'), desk('D3', 'HOUNDE', '900,000.00'),
     desk('D4', 'HOUNDE', '110,000,000.00'),   // 100× the median desktop
     desk('D5', 'LONDON', '1,000,000.00'),     // other currency once the map is set
     { ...desk('L1', 'MANA', '2,000,000.00'), product_type: 'Laptop' }]));

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['admin']));
  adminTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  (await rdb.createUser({ username: 'outlier-viewer', password: 'viewer-pass-0000', full_name: 'V', role: 'viewer' }));
  const v = ((await rdb.listUsers()) || []).find(u => u.username === 'outlier-viewer');
  (await rdb.setUserRoles(v.id, ['viewer']));
  viewerTok = (await rdb.login('outlier-viewer', 'viewer-pass-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('a desktop 100× the median desktop cost is listed; median per product_type + currency', async () => {
  const out = (await adb.getCostOutliers({}, { rate: RATE, outlierFactor: 10 }));
  assert.deepStrictEqual(out.rows.map(r => r.asset_id), ['D4']);
  const r = out.rows[0];
  assert.strictEqual(r.currency, 'XOF');
  assert.strictEqual(r.product_type, 'Desktop');
  assert.ok(Math.abs(r.median_cost_usd - 1000000 * RATE) < 1e-6);
  assert.ok(r.ratio > 100 && r.ratio < 111);
  assert.ok(!('purchase_cost' in r), 'no raw XOF column');
  // With a map, LONDON (GBP) forms its own group and is not compared to XOF desktops.
  const m = (await adb.getCostOutliers({}, { rate: RATE, outlierFactor: 10,
    currencyMap: '{"*":"XOF","LONDON":"GBP"}', rates: { XOF: RATE, USD: 1, GBP: 1.27 } }));
  assert.deepStrictEqual(m.rows.map(x => x.asset_id), ['D4']);
});

test('outliers are summed unless asset_cost_outlier_exclude = 1', async () => {
  const keep = (await adb.getFinanceSummary({}, RATE, { outlierFactor: 10 }));
  assert.ok(!('excluded' in keep));
  const drop = (await adb.getFinanceSummary({}, RATE, { outlierFactor: 10, outlierExclude: true }));
  assert.strictEqual(drop.excluded.outlier, 1);
  assert.ok(Math.abs(keep.fleet.purchase_cost_usd - drop.fleet.purchase_cost_usd - 110000000 * RATE) < 1e-3);
  assert.strictEqual(drop.fleet.asset_count, keep.fleet.asset_count, 'asset still counted');
});

test('GET /api/assets/finance/outliers — 200 for admin, 403 for a non-money role', async () => {
  const ok = await fetch(base + '/api/assets/finance/outliers', { headers: { 'x-report-token': adminTok } });
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  assert.deepStrictEqual(body.rows.map(r => r.asset_id), ['D4']);
  assert.strictEqual(body.factor, 10);
  const no = await fetch(base + '/api/assets/finance/outliers', { headers: { 'x-report-token': viewerTok } });
  assert.strictEqual(no.status, 403);
  const x = await fetch(base + '/api/assets/finance/outliers/export.xlsx', { headers: { 'x-report-token': adminTok } });
  assert.strictEqual(x.status, 200);
  assert.strictEqual(Buffer.from(await x.arrayBuffer()).slice(0, 2).toString(), 'PK');
  const nx = await fetch(base + '/api/assets/finance/outliers/export.xlsx', { headers: { 'x-report-token': viewerTok } });
  assert.strictEqual(nx.status, 403);
});
