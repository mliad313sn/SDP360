'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Effort-trend (Progress tab) smoke — the /api/assets/progress/* route block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the leaderboard,
// trend (incl. hostile/edge params + SQLi-shaped asOf → 200 not 500), and the admin-only
// snapshot POST. Backends pinned to sqlite; assets-db eager-inits its sqlite file at
// require against SDP_DATA_DIR. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-effort-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'assets-effort-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-effort-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-effort-key';
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

  // Seed a couple of assets so a snapshot has something to aggregate (leaderboard/trend
  // history may still be empty — that's an accepted shape, we only assert 200 + keys).
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer',
     'serial_number', 'months_since_acquisition', 'purchase_cost', 'current_book_value'],
    [
      { asset_id: 'A1', asset_name: 'PC-01', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001',
        months_since_acquisition: '12', purchase_cost: '970,000.00', current_book_value: '480,000.00' },
      { asset_id: 'A2', asset_name: 'PC-02', site: 'HGO', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'HP', serial_number: 'SN-0002',
        months_since_acquisition: '18', purchase_cost: '820,000.00', current_book_value: '410,000.00' },
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

test('GET /api/assets/progress/leaderboard → 200 with rows[] + most_improved + needs_attention keys', async () => {
  const res = await fetch(base + '/api/assets/progress/leaderboard', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.rows), 'rows is an array');
  assert.ok('most_improved' in body, 'most_improved key present');
  assert.ok('needs_attention' in body, 'needs_attention key present');
});

test('GET /api/assets/progress/trend → 200 with dates[] + sites[]', async () => {
  const res = await fetch(base + '/api/assets/progress/trend', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.dates), 'dates is an array');
  assert.ok(Array.isArray(body.sites), 'sites is an array');
});

test('GET /api/assets/progress/trend?site=MANA&months=3 → 200 (edge params, no 500)', async () => {
  const res = await fetch(base + '/api/assets/progress/trend?site=MANA&months=3', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.dates) && Array.isArray(body.sites), 'dates + sites arrays');
});

test('GET /api/assets/progress/trend?months=abc → 200 (bad months falls back to default, no crash)', async () => {
  const res = await fetch(base + '/api/assets/progress/trend?months=abc', { headers: auth() });
  assert.equal(res.status, 200, `bad months must fall back, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.dates) && Array.isArray(body.sites), 'dates + sites arrays');
});

test('POST /api/assets/progress/snapshot (admin) → 200 with date + sites', async () => {
  const res = await fetch(base + '/api/assets/progress/snapshot', { method: 'POST', headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(typeof body.date === 'string' && body.date.length >= 10, 'date is a YYYY-MM-DD string');
  assert.equal(typeof body.sites, 'number', 'sites is numeric');
});

test("GET /api/assets/progress/leaderboard?asOf=' OR 1=1 → 200 (parameter-bound, no injection/500)", async () => {
  const res = await fetch(base + "/api/assets/progress/leaderboard?asOf=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped asOf must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.rows), 'rows array');
});

test('GET /api/assets/progress/leaderboard without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/progress/leaderboard');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test('POST /api/assets/progress/snapshot without a session → 401/403 (requireReportSession + requireAdmin)', async () => {
  const res = await fetch(base + '/api/assets/progress/snapshot', { method: 'POST' });
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
