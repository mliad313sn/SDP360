'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Assets C-2, Task 2 smoke — the /api/assets/software/* route block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the software
// compliance summary, exceptions (incl. unknown-kind 400 + hostile-input 200), and the
// xlsx export. Backends pinned to sqlite; assets-db eager-inits its sqlite file at
// require against SDP_DATA_DIR. Run with --test-force-exit (top-level cron keeps the
// loop alive). NO money is ever on the wire (count-based module).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-sw-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'assets-sw-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-sw-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-sw-key';
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

  // Seed a handful of software rows covering the compliance buckets:
  //   S1 → Managed, Under Licensed (kind: under_licensed)
  //   S2 → Managed, Over Licensed  (kind: over_licensed)
  //   S3 → Managed, Compliant      (kind: managed only)
  //   S4 → UnIdentified, N/A       (unmetered — in NO kind)
  const cols = ['software_id', 'software_name', 'manufacturer', 'licensed_installations',
    'installations', 'installations_allowed', 'available_for_allocation',
    'allocated_to_downgrades', 'purchased', 'allocated', 'purchased_cal',
    'compliance_type', 'software_category', 'software_type'];
  const b = {
    licensed_installations: 'N/A', available_for_allocation: 'N/A',
    allocated_to_downgrades: 'N/A', purchased: 'N/A', allocated: 'N/A',
    purchased_cal: 'N/A', software_category: 'Utility',
  };
  (await adb.replaceTable('software', cols, [
    { ...b, software_id: 'S1', software_name: 'TeamViewer', manufacturer: 'TeamViewer',
      installations: '540', installations_allowed: '1', compliance_type: 'Under Licensed', software_type: 'Managed' },
    { ...b, software_id: 'S2', software_name: 'Adobe Photoshop', manufacturer: 'Adobe',
      installations: '2', installations_allowed: '50', compliance_type: 'Over Licensed', software_type: 'Managed' },
    { ...b, software_id: 'S3', software_name: 'Adobe Acrobat', manufacturer: 'Adobe',
      installations: '10', installations_allowed: '10', compliance_type: 'Compliant', software_type: 'Managed' },
    { ...b, software_id: 'S4', software_name: 'Microsoft Edge', manufacturer: 'Microsoft',
      installations: '500', installations_allowed: 'N/A', compliance_type: 'N/A', software_type: 'UnIdentified' },
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

test('GET /api/assets/software/summary → 200 with by_compliance + managed', async () => {
  const res = await fetch(base + '/api/assets/software/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.managed, 'number', 'managed is numeric');
  assert.ok(body.by_compliance && typeof body.by_compliance === 'object' && !Array.isArray(body.by_compliance),
    'by_compliance is an object');
  assert.ok(body.by_compliance.under_licensed >= 1, 'the seeded Under-Licensed row is counted');
  assert.ok(body.by_compliance.over_licensed >= 1, 'the seeded Over-Licensed row is counted');
  assert.equal(body.managed, 3, 'S1 + S2 + S3 are Managed');
});

test('GET /api/assets/software/exceptions?kind=under_licensed → 200, JSON array, NO cost on the wire', async () => {
  const res = await fetch(base + '/api/assets/software/exceptions?kind=under_licensed', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
  assert.ok(body.some(r => r.software_name === 'TeamViewer'), 'the Under-Licensed software is listed');
  for (const row of body) {
    assert.ok(!('cost' in row), 'no cost key leaks to the wire');
    assert.ok(!('purchase_cost' in row), 'no purchase_cost key leaks to the wire');
  }
});

test('GET /api/assets/software/exceptions?kind=bad → 400 (NOT 500)', async () => {
  const res = await fetch(base + '/api/assets/software/exceptions?kind=bad', { headers: auth() });
  assert.equal(res.status, 400, `unknown kind must be 400, got ${res.status}`);
});

test("GET /api/assets/software/exceptions?kind=under_licensed&q=' OR 1=1 → 200 (hostile input param-bound, no 500)", async () => {
  const res = await fetch(base + "/api/assets/software/exceptions?kind=under_licensed&q=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
});

test('GET /api/assets/software/export.xlsx?kind=all → 200, spreadsheet content-type, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/software/export.xlsx?kind=all', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/software/export.xlsx?kind=under_licensed → 200, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/software/export.xlsx?kind=under_licensed', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/software/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/software/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});
