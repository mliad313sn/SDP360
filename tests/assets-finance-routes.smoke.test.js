'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Licence/Finance, Task 5 smoke — the /api/assets/{finance,licences}/* route block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind).
// Finance money is CONVERTED to USD via the xof_usd_rate config (proved: the returned
// purchase_cost_usd is the XOF sum ×rate, much smaller than the raw XOF). Licence views
// carry families + expiry exceptions (unknown-kind → 400, hostile q → 200).
// Backends pinned to sqlite. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-fin-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'assets-fin-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-fin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-fin-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const RATE = 0.00165;
// Two assets whose XOF purchase_cost sums to 1,500,000 — a big number that, once
// multiplied by the tiny rate, lands at 2,475 USD. That gap is what proves the rate.
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

  // Seed a couple of finance-bearing assets (purchase_cost is RAW XOF, comma-grouped
  // like the real AP export). USD is derived server-side by ×rate.
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type',
     'purchase_cost', 'current_book_value', 'total_cost_of_ownership',
     'operational_cost', 'months_since_acquisition'],
    [
      { asset_id: 'F1', asset_name: 'PC-FIN-01', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', purchase_cost: '1,000,000.00',
        current_book_value: '400,000.00', total_cost_of_ownership: '1,200,000.00',
        operational_cost: '200,000.00', months_since_acquisition: '60' },
      { asset_id: 'F2', asset_name: 'PC-FIN-02', site: 'HGO', state: 'In Use',
        product_type: 'Workstation', purchase_cost: '500,000.00',
        current_book_value: '250,000.00', total_cost_of_ownership: '600,000.00',
        operational_cost: '100,000.00', months_since_acquisition: '12' },
    ]);

  // Seed varied licences: expired / ok / no-expiry, spanning three families.
  // Expiry is the real AP 'DD Mon YYYY' form; 2020 = reliably expired, 2099 = reliably
  // ok, '' = no_expiry — deterministic regardless of the real clock.
  adb.replaceTable('software_licenses',
    ['license_id', 'license_name', 'license_type', 'license_state', 'expiry_date', 'cost', 'site', 'vendor'],
    [
      { license_id: 'L1', license_name: 'Office Volume', license_type: 'Volume License',
        license_state: 'In Use', expiry_date: '30 Jun 2020', cost: '55,920.00', site: 'MANA', vendor: 'Microsoft' },
      { license_id: 'L2', license_name: 'CAD Seat', license_type: 'Named User License',
        license_state: 'In Use', expiry_date: '30 Jun 2099', cost: '1,200.00', site: 'HGO', vendor: 'Autodesk' },
      { license_id: 'L3', license_name: 'Beta Tool', license_type: 'Trial',
        license_state: 'Expired', expiry_date: '', cost: '0.00', site: 'MANA', vendor: 'Acme' },
    ]);

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await rdb.createUser({ username: 'assets-fin-viewer', full_name: 'Fin Viewer',
    password: 'assets-fin-viewer-0000', roles: ['viewer'] });
  const vsess = await rdb.login('assets-fin-viewer', 'assets-fin-viewer-0000');
  viewerToken = vsess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });

test('GET /api/assets/finance/summary → 200, by_site + fleet, purchase_cost_usd is CONVERTED (rate applied)', async () => {
  const res = await fetch(base + '/api/assets/finance/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.by_site), 'by_site is an array');
  assert.ok(body.fleet && typeof body.fleet === 'object', 'fleet is an object');
  assert.equal(body.rate, RATE, 'the applied rate is echoed');
  // The headline proof: the fleet purchase total is the XOF sum ×rate — a small USD
  // number, NOT the raw XOF sum. If the rate were 1 (raw XOF mislabelled USD) this fails.
  assert.ok(Math.abs(body.fleet.purchase_cost_usd - EXP_USD_PURCHASE) < 0.01,
    `fleet.purchase_cost_usd should be ~${EXP_USD_PURCHASE} USD, got ${body.fleet.purchase_cost_usd}`);
  assert.ok(body.fleet.purchase_cost_usd < RAW_XOF_PURCHASE / 10,
    'converted USD is much smaller than the raw XOF sum (rate genuinely applied)');
});

test('GET /api/assets/finance/export.xlsx → 200, spreadsheet content-type, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/finance/export.xlsx', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/licences/summary → 200 with by_family + expiry buckets', async () => {
  const res = await fetch(base + '/api/assets/licences/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.by_family && typeof body.by_family === 'object', 'by_family object');
  assert.ok(body.expiry && typeof body.expiry === 'object', 'expiry object');
  assert.ok(body.expiry.expired >= 1, 'the 2020 licence counts as expired');
  assert.ok(body.expiry.no_expiry >= 1, 'the blank-expiry licence counts as no_expiry');
});

test('GET /api/assets/licences/exceptions?kind=expired → 200 array with the expired licence', async () => {
  const res = await fetch(base + '/api/assets/licences/exceptions?kind=expired', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
  assert.ok(body.some(r => r.license_id === 'L1'), 'the expired licence L1 is listed');
});

test('GET /api/assets/licences/exceptions?kind=bad → 400 (NOT 500)', async () => {
  const res = await fetch(base + '/api/assets/licences/exceptions?kind=bad', { headers: auth() });
  assert.equal(res.status, 400, `unknown kind must be 400, got ${res.status}`);
});

test("GET /api/assets/licences/exceptions?kind=expired&q=' OR 1=1 → 200 (hostile input, param-bound)", async () => {
  const res = await fetch(base + "/api/assets/licences/exceptions?kind=expired&q=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
});

test('GET /api/assets/licences/export.xlsx?kind=all → 200, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/licences/export.xlsx?kind=all', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/finance/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/finance/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test('GET /api/assets/licences/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/licences/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
