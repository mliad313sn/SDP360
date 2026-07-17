'use strict';
// Task 4 smoke — the /api/assets/* route block + the manual sync trigger.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the read routes plus
// the admin-gated sync trigger. Backends pinned to sqlite; assets-db eager-inits its
// sqlite file at require against SDP_DATA_DIR.
// Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'assets-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-smoke-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset) — supply
// dummy ZOHO_* creds; the read routes make no Zoho call.
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

  // Seed one asset (full-replace with a minimal column list; other columns default null).
  adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer', 'serial_number'],
    [{ asset_id: 'A1', asset_name: 'PC-MANA-01', site: 'MANA', state: 'In Use',
       product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001' }]);

  // Grant the 'admin' role in user_roles so requireAdmin (userHasRole) recognises the seed admin.
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

test('GET /api/assets/inventory?site=MANA → 200 + JSON array with the seeded asset', async () => {
  const res = await fetch(base + '/api/assets/inventory?site=MANA', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'body is a JSON array');
  assert.ok(body.some(a => a.asset_id === 'A1'), 'seeded MANA asset present');
});

test("GET /api/assets/inventory with a hostile site value → 200, NOT 500 (param-bound whitelist)", async () => {
  const res = await fetch(base + "/api/assets/inventory?site=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
  assert.equal(body.length, 0, "hostile value matches nothing (it's a bound literal, not SQL)");
});

test('GET /api/assets/lookups → 200 with sites/states/product_types/manufacturers', async () => {
  const res = await fetch(base + '/api/assets/lookups', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body.sites) && body.sites.includes('MANA'), 'sites lookup has MANA');
  assert.ok(Array.isArray(body.states), 'states lookup present');
  assert.ok(Array.isArray(body.product_types), 'product_types lookup present');
  assert.ok(Array.isArray(body.manufacturers), 'manufacturers lookup present');
});

test('GET /api/assets/summary → 200 with a total count', async () => {
  const res = await fetch(base + '/api/assets/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.total, 'number', 'summary.total is numeric');
  assert.ok(body.total >= 1, 'at least the seeded asset counted');
});

test('POST /api/sync/trigger/assets → 200 (admin) and reports the sync started', async () => {
  const res = await fetch(base + '/api/sync/trigger/assets', { method: 'POST', headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.ok, true, 'ok:true');
  assert.match(String(body.message || ''), /start/i, 'message says the sync started');
});

test('GET /api/assets/inventory without a session → 401 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/inventory');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
