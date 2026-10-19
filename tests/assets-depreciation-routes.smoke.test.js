'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Depreciation, Task 2 smoke — the /api/assets/depreciation/{summary,schedule} +
// GET/PUT /api/assets/depreciation-config route block. Boots the express app
// IN-PROCESS (start() is guarded by require.main → no port bind). Depreciation money
// is CONVERTED to USD via the xof_usd_rate config (proved: computed_book_value_usd is
// a small USD number, not the raw XOF). asOf is honoured + echoed. The config PUT
// validates (method∈METHODS, life>0, salvage 0..1) → 400 on garbage, requireAdmin.
// Backends pinned to sqlite. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-deprec-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'assets-deprec-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-deprec-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-deprec-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const RATE = 0.00165;
// Two assets whose XOF purchase_cost sums to 1,500,000 — a big number that, once
// multiplied by the tiny rate, lands in the low thousands of USD. That gap proves the rate.
const RAW_XOF_PURCHASE = 1000000 + 500000;   // 1,500,000
const EXP_USD_PURCHASE  = RAW_XOF_PURCHASE * RATE;   // 2,475

let server, base, adminToken, viewerToken;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  const adb = require('../assets-db');
  const reportConfig = require('../services/reportConfig');

  // Pin the conversion rate in config so the assertion is deterministic (also proves
  // the route reads config, not a hardcoded constant).
  reportConfig.setConfig(rdb.db, { xof_usd_rate: String(RATE) }, 'smoke');

  // Seed finance-bearing, depreciable assets (purchase_cost RAW XOF, acquisition_date
  // in the past so the book value has genuinely depreciated). USD is derived ×rate.
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type',
     'purchase_cost', 'current_book_value', 'acquisition_date'],
    [
      { asset_id: 'D1', asset_name: 'PC-DEP-01', site: 'MANA', state: 'In Use',
        product_type: 'Laptop', purchase_cost: '1,000,000.00',
        current_book_value: '400,000.00', acquisition_date: '2023-01-01' },
      { asset_id: 'D2', asset_name: 'PC-DEP-02', site: 'HGO', state: 'In Use',
        product_type: 'Server', purchase_cost: '500,000.00',
        current_book_value: '250,000.00', acquisition_date: '2022-06-01' },
    ]);

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['super_admin']);   // the routes under test are super_admin-gated (admin settings → super_admin since 5e2f40e / 2026-08-16; IT Review → executive since 7162ac7)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await rdb.createUser({ username: 'assets-deprec-viewer', full_name: 'Deprec Viewer',
    password: 'assets-deprec-viewer-0000', roles: ['viewer'] });
  const vsess = await rdb.login('assets-deprec-viewer', 'assets-deprec-viewer-0000');
  viewerToken = vsess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });
const authJson = () => ({ 'x-report-token': adminToken, 'content-type': 'application/json' });

test('GET /api/assets/depreciation/summary → 200, by_site + fleet, computed_book_value_usd CONVERTED + sdp present, echoes rate+asOf', async () => {
  const res = await fetch(base + '/api/assets/depreciation/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.by_site), 'by_site is an array');
  assert.ok(body.fleet && typeof body.fleet === 'object', 'fleet is an object');
  assert.equal(body.rate, RATE, 'the applied rate is echoed');
  assert.ok(typeof body.asOf === 'string' && body.asOf.length >= 10, 'asOf echoed (default today ISO)');
  assert.equal(typeof body.fleet.computed_book_value_usd, 'number', 'computed_book_value_usd is a number');
  assert.ok(body.fleet.sdp_book_value_usd != null, 'sdp_book_value_usd present');
  // Headline proof: the converted USD book value is tiny vs the raw XOF sum — the rate
  // genuinely applied. If the rate were 1 (raw XOF mislabelled USD) this fails.
  assert.ok(body.fleet.computed_book_value_usd > 0 && body.fleet.computed_book_value_usd < RAW_XOF_PURCHASE / 10,
    `computed USD (${body.fleet.computed_book_value_usd}) must be much smaller than raw XOF sum (rate applied)`);
  // sdp is the SDP current_book_value ×rate: (400,000+250,000)×rate = 1,072.5
  assert.ok(Math.abs(body.fleet.sdp_book_value_usd - (650000 * RATE)) < 0.01,
    `sdp_book_value_usd should be ~${650000 * RATE}, got ${body.fleet.sdp_book_value_usd}`);
});

test('GET /api/assets/depreciation/summary?asOf=2025-01-01 → 200, asOf honoured + echoed exactly', async () => {
  const res = await fetch(base + '/api/assets/depreciation/summary?asOf=2025-01-01', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.asOf, '2025-01-01', 'asOf echoed exactly');
});

test('GET /api/assets/depreciation/schedule → 200 with aligned {years, book_value_usd}', async () => {
  const res = await fetch(base + '/api/assets/depreciation/schedule', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.years), 'years is an array');
  assert.ok(Array.isArray(body.book_value_usd), 'book_value_usd is an array');
  assert.equal(body.years.length, body.book_value_usd.length, 'aligned arrays');
  assert.equal(body.rate, RATE, 'rate echoed');
  assert.ok(typeof body.asOf === 'string', 'asOf echoed');
});

test('GET /api/assets/depreciation-config → 200, parsed config with default + by_type', async () => {
  const res = await fetch(base + '/api/assets/depreciation-config', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.default && typeof body.default === 'object', 'default object present');
  assert.ok(body.by_type && typeof body.by_type === 'object', 'by_type object present');
});

test('PUT /api/assets/depreciation-config valid body → 200, round-trips on subsequent GET', async () => {
  const cfg = {
    default: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 },
    by_type: { Laptop: { method: 'declining_balance', useful_life_months: 24, salvage_pct: 0.1 } },
  };
  const put = await fetch(base + '/api/assets/depreciation-config',
    { method: 'PUT', headers: authJson(), body: JSON.stringify(cfg) });
  assert.equal(put.status, 200, `expected 200, got ${put.status}`);

  const get = await fetch(base + '/api/assets/depreciation-config', { headers: auth() });
  const body = await get.json();
  assert.equal(body.default.method, 'straight_line', 'default method persisted');
  assert.equal(body.default.useful_life_months, 36, 'default life persisted');
  assert.equal(body.by_type.Laptop.method, 'declining_balance', 'by_type Laptop method persisted');
  assert.equal(body.by_type.Laptop.salvage_pct, 0.1, 'by_type Laptop salvage persisted');
});

test('PUT /api/assets/depreciation-config garbage → 400 (validation)', async () => {
  const bad = { default: { method: 'not_a_method', useful_life_months: -5 } };
  const put = await fetch(base + '/api/assets/depreciation-config',
    { method: 'PUT', headers: authJson(), body: JSON.stringify(bad) });
  assert.equal(put.status, 400, `garbage config must be 400, got ${put.status}`);
});

test('PUT /api/assets/depreciation-config without a session → 401/403', async () => {
  const cfg = { default: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 } };
  const put = await fetch(base + '/api/assets/depreciation-config',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) });
  assert.ok(put.status === 401 || put.status === 403, `expected 401/403, got ${put.status}`);
});

test('PUT /api/assets/depreciation-config as viewer (no admin) → 403', async () => {
  const cfg = { default: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 } };
  const put = await fetch(base + '/api/assets/depreciation-config',
    { method: 'PUT', headers: { 'x-report-token': viewerToken, 'content-type': 'application/json' },
      body: JSON.stringify(cfg) });
  assert.ok(put.status === 401 || put.status === 403, `viewer PUT must be 401/403, got ${put.status}`);
});

test('GET /api/assets/depreciation/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/depreciation/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
