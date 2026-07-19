'use strict';
// Investment & Forecast, Task — the /api/assets/investment/* route block smoke.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the investment
// history, forecast (incl. the echoed uplift_pct, bad/clamped horizon, hostile input),
// and the xlsx export. Backends pinned to sqlite; assets-db eager-inits its sqlite file
// at require against SDP_DATA_DIR. Run with --test-force-exit (top-level cron keeps the
// loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-inv-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'assets-inv-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-inv-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-inv-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  const adb = require('../assets-db');

  // Seed a couple of assets with acquisition_date + purchase_cost (raw XOF) so the
  // history + hardware-forecast readers have non-empty, coverage-eligible rows.
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer',
     'serial_number', 'acquisition_date', 'purchase_cost', 'current_book_value'],
    [
      { asset_id: 'A1', asset_name: 'PC-01', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001',
        acquisition_date: '2022-01-15', purchase_cost: '970,000.00', current_book_value: '480,000.00' },
      { asset_id: 'A2', asset_name: 'PC-02', site: 'HGO', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'HP', serial_number: 'SN-0002',
        acquisition_date: '2023-06-01', purchase_cost: '820,000.00', current_book_value: '410,000.00' },
    ]);

  // Seed licences with acquisition_date + expiry_date + cost (native USD) + option.
  adb.replaceTable('software_licenses',
    ['license_id', 'license_name', 'cost', 'acquisition_date', 'expiry_date', 'license_option'],
    [
      { license_id: 'L1', license_name: 'Office', cost: '55,920.00',
        acquisition_date: '2022-03-01', expiry_date: '30 Jun 2026', license_option: 'Subscription' },
      { license_id: 'L2', license_name: 'CAD', cost: '12,000.00',
        acquisition_date: '2023-02-01', expiry_date: '15 Dec 2027', license_option: 'Volume' },
    ]);

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });

test('GET /api/assets/investment/history → 200 with years (array) + coverage', async () => {
  const res = await fetch(base + '/api/assets/investment/history', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.years), 'years is an array');
  assert.ok(body.coverage && typeof body.coverage === 'object', 'coverage present');
});

test('GET /api/assets/investment/forecast → 200 with hardware + software + uplift_pct', async () => {
  const res = await fetch(base + '/api/assets/investment/forecast', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.hardware && typeof body.hardware === 'object', 'hardware block present');
  assert.ok(body.software && typeof body.software === 'object', 'software block present');
  assert.ok('uplift_pct' in body, 'uplift_pct echoed on the response');
  assert.equal(typeof body.uplift_pct, 'number', 'uplift_pct is numeric');
});

test('GET /api/assets/investment/forecast?horizon=abc → 200 (default, no crash)', async () => {
  const res = await fetch(base + '/api/assets/investment/forecast?horizon=abc', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

test('GET /api/assets/investment/forecast?horizon=99 → 200 (clamped, no crash)', async () => {
  const res = await fetch(base + '/api/assets/investment/forecast?horizon=99', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

test("GET /api/assets/investment/history?q=' OR 1=1 → 200 (param-bound, safe)", async () => {
  const res = await fetch(base + "/api/assets/investment/history?q=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
});

test('GET /api/assets/investment/export.xlsx?horizon=5 → 200, spreadsheet content-type, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/investment/export.xlsx?horizon=5', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/investment/history without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/investment/history');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
