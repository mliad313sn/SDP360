'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Sub-project D, Task 1 smoke — the /api/assets/hardware/* route block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the hardware-health
// summary, exceptions (incl. unknown-kind 400 + hostile-input 200), and the xlsx export.
// Backends pinned to sqlite; assets-db eager-inits its sqlite file at require against
// SDP_DATA_DIR. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-hw-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'assets-hw-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-hw-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-hw-key';
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

  // Seed a handful of workstations covering the hardware-health kinds so counts are
  // non-zero:
  //   A1 → low-RAM machine (4 GB)
  //   A2 → full-disk machine (C: 5% free)
  //   A3 → workstation whose only "monitor" is a webcam → no real monitor
  (await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer',
     'serial_number', 'months_since_acquisition', 'purchase_cost', 'current_book_value'],
    [
      { asset_id: 'A1', asset_name: 'PC-LOWRAM-01', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001',
        months_since_acquisition: '12', purchase_cost: '970,000.00', current_book_value: '480,000.00' },
      { asset_id: 'A2', asset_name: 'PC-FULLDISK-02', site: 'HGO', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'HP', serial_number: 'SN-0002',
        months_since_acquisition: '18', purchase_cost: '820,000.00', current_book_value: '410,000.00' },
      { asset_id: 'A3', asset_name: 'PC-WEBCAM-03', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0003',
        months_since_acquisition: '6', purchase_cost: '0.00', current_book_value: '0.00' },
    ]));

  // Memory — A1 low (4 GB), A2/A3 healthy (16 GB) so they don't trip low_ram.
  (await adb.replaceTable('asset_memory',
    ['memory_module_id', 'workstation_id', 'capacity_gb'],
    [
      { memory_module_id: 'M1', workstation_id: 'A1', capacity_gb: '4' },
      { memory_module_id: 'M2', workstation_id: 'A2', capacity_gb: '16' },
      { memory_module_id: 'M3', workstation_id: 'A3', capacity_gb: '16' },
    ]));

  // Logical drives — A2's C: is 5% free (full disk); A1/A3 healthy at 80%.
  (await adb.replaceTable('asset_logical_drives',
    ['drive_id', 'workstation_id', 'drive_letter', 'capacity_gb', 'free_gb', 'free_pct'],
    [
      { drive_id: 'D1', workstation_id: 'A1', drive_letter: 'C:', capacity_gb: '256', free_gb: '205', free_pct: '80%' },
      { drive_id: 'D2', workstation_id: 'A2', drive_letter: 'C:', capacity_gb: '256', free_gb: '13', free_pct: '5%' },
      { drive_id: 'D3', workstation_id: 'A3', drive_letter: 'C:', capacity_gb: '512', free_gb: '410', free_pct: '80%' },
    ]));

  // Monitors — A2 a real Dell panel; A3 only a webcam (denylisted → real=0); A1 none.
  (await adb.replaceTable('asset_monitors',
    ['workstation_id', 'monitor_id', 'monitor_type'],
    [
      { workstation_id: 'A2', monitor_id: 'MON1', monitor_type: 'Dell U2419H' },
      { workstation_id: 'A3', monitor_id: 'MON2', monitor_type: 'Integrated Webcam' },
    ]));

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  (await rdb.setUserRoles(me.id, ['admin']));
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });

test('GET /api/assets/hardware/summary → 200 with by_kind (object) + by_site + total', async () => {
  const res = await fetch(base + '/api/assets/hardware/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.total, 'number', 'total is numeric');
  assert.ok(body.by_kind && typeof body.by_kind === 'object' && !Array.isArray(body.by_kind), 'by_kind is an object');
  assert.ok(Array.isArray(body.by_site), 'by_site is an array');
  assert.ok(body.by_kind.low_ram >= 1, 'the seeded low-RAM row is counted');
  assert.ok(body.by_kind.full_disk >= 1, 'the seeded full-disk row is counted');
  assert.ok(body.by_kind.no_real_monitor >= 1, 'the seeded webcam-only row is counted');
});

test('GET /api/assets/hardware/exceptions?kind=low_ram → 200, JSON array, NO money on the wire', async () => {
  const res = await fetch(base + '/api/assets/hardware/exceptions?kind=low_ram', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
  assert.ok(body.some(a => a.asset_id === 'A1'), 'the low-RAM asset is listed');
  for (const row of body) {
    assert.ok(!('purchase_cost' in row), 'no purchase_cost key leaks to the wire');
    assert.ok(!('current_book_value' in row), 'no current_book_value key leaks to the wire');
    assert.ok(!JSON.stringify(row).includes('$'), 'no $ money symbol on the wire');
  }
});

test('GET /api/assets/hardware/exceptions?kind=bad → 400 (NOT 500)', async () => {
  const res = await fetch(base + '/api/assets/hardware/exceptions?kind=bad', { headers: auth() });
  assert.equal(res.status, 400, `unknown kind must be 400, got ${res.status}`);
});

test("GET /api/assets/hardware/exceptions?kind=low_ram&q=' OR 1=1 → 200 (hostile input param-bound, no 500)", async () => {
  const res = await fetch(base + "/api/assets/hardware/exceptions?kind=low_ram&q=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
});

test('GET /api/assets/hardware/export.xlsx?kind=all → 200, spreadsheet content-type, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/hardware/export.xlsx?kind=all', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/hardware/export.xlsx?kind=no_real_monitor → 200, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/hardware/export.xlsx?kind=no_real_monitor', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/hardware/export.xlsx?kind=bogus → 400 (unknown specific kind)', async () => {
  const res = await fetch(base + '/api/assets/hardware/export.xlsx?kind=bogus', { headers: auth() });
  assert.equal(res.status, 400, `unknown specific export kind must be 400, got ${res.status}`);
});

test('GET /api/assets/hardware/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/hardware/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
