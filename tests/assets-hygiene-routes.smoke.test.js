'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Sub-project B, Task 1 smoke — the /api/assets/hygiene/* route block.
// Boots the express app IN-PROCESS (start() is guarded by require.main → no port bind,
// so the Zoho/PG boot steps inside start() never run) and asserts the hygiene summary,
// exceptions (incl. unknown-kind 400 + hostile-input 200), and the xlsx export.
// Backends pinned to sqlite; assets-db eager-inits its sqlite file at require against
// SDP_DATA_DIR. Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'assets-hyg-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'assets-hyg-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'assets-hyg-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'assets-hyg-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, viewerToken;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  const adb = require('../assets-db');

  // Seed a handful of assets covering a couple of hygiene kinds so counts are non-zero:
  //   A1  → Discovered (kind: discovered)
  //   A2  → healthy scan but stale >90d (kind: ghost)
  //   A3  → an ordinary In-Use asset with a full record
  // A2 is a GENUINE ghost: a prior SUCCESSFUL scan (non-empty last_successful_audit_time)
  // that is now stale >90d. It must carry a success-time, else NOT(never_scanned) is false
  // and it would (correctly) fall into never_scanned instead — the disjointness fix.
  (await adb.replaceTable('assets',
    ['asset_id', 'asset_name', 'site', 'state', 'product_type', 'manufacturer',
     'serial_number', 'last_audit_status', 'last_successful_audit_time', 'days_since_scan', 'user_name', 'department'],
    [
      { asset_id: 'A1', asset_name: 'PC-DISCOVERED-01', site: 'MANA', state: 'Discovered',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0001',
        last_audit_status: null, last_successful_audit_time: null, days_since_scan: null, user_name: null, department: null },
      { asset_id: 'A2', asset_name: 'PC-GHOST-02', site: 'HGO', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'HP', serial_number: 'SN-0002',
        last_audit_status: 'Success', last_successful_audit_time: '2026-01-01', days_since_scan: '120', user_name: 'jdoe', department: 'IT' },
      { asset_id: 'A3', asset_name: 'PC-HEALTHY-03', site: 'MANA', state: 'In Use',
        product_type: 'Workstation', manufacturer: 'Dell', serial_number: 'SN-0003',
        last_audit_status: 'Success', last_successful_audit_time: '2026-07-14', days_since_scan: '3', user_name: 'asmith', department: 'Ops' },
    ]));

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  (await rdb.setUserRoles(me.id, ['super_admin']));   // the routes under test are super_admin-gated (admin settings → super_admin since 5e2f40e / 2026-08-16; IT Review → executive since 7162ac7)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  // A NON-admin (viewer) session to prove requireAdmin on POST /send.
  await rdb.createUser({ username: 'assets-hyg-viewer', full_name: 'Hyg Viewer',
    password: 'assets-hyg-viewer-0000', roles: ['viewer'] });
  const vsess = await rdb.login('assets-hyg-viewer', 'assets-hyg-viewer-0000');
  assert.ok(vsess && vsess.token, 'viewer login returned a token');
  viewerToken = vsess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });

test('GET /api/assets/hygiene/summary → 200 with by_kind (object) + by_site + total', async () => {
  const res = await fetch(base + '/api/assets/hygiene/summary', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.total, 'number', 'total is numeric');
  assert.ok(body.by_kind && typeof body.by_kind === 'object' && !Array.isArray(body.by_kind), 'by_kind is an object');
  assert.ok(Array.isArray(body.by_site), 'by_site is an array');
  assert.ok(body.by_kind.discovered >= 1, 'the seeded Discovered row is counted');
  assert.ok(body.by_kind.ghost >= 1, 'the seeded ghost row is counted');
});

test('GET /api/assets/hygiene/exceptions?kind=discovered → 200, JSON array, NO purchase_cost on the wire', async () => {
  const res = await fetch(base + '/api/assets/hygiene/exceptions?kind=discovered', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
  assert.ok(body.some(a => a.asset_id === 'A1'), 'the Discovered asset is listed');
  for (const row of body) {
    assert.ok(!('purchase_cost' in row), 'no purchase_cost key leaks to the wire');
  }
});

test('GET /api/assets/hygiene/exceptions?kind=nonsense → 400 (NOT 500)', async () => {
  const res = await fetch(base + '/api/assets/hygiene/exceptions?kind=nonsense', { headers: auth() });
  assert.equal(res.status, 400, `unknown kind must be 400, got ${res.status}`);
});

test("GET /api/assets/hygiene/exceptions?kind=ghost&q=' OR 1=1 → 200 (hostile input param-bound, no 500)", async () => {
  const res = await fetch(base + "/api/assets/hygiene/exceptions?kind=ghost&q=%27%20OR%201=1", { headers: auth() });
  assert.equal(res.status, 200, `SQLi-shaped filter must be 200 (bound param), got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'array body');
});

test('GET /api/assets/hygiene/export.xlsx?kind=all → 200, spreadsheet content-type, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/hygiene/export.xlsx?kind=all', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/hygiene/export.xlsx?kind=discovered → 200, PK zip magic', async () => {
  const res = await fetch(base + '/api/assets/hygiene/export.xlsx?kind=discovered', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(String(res.headers.get('content-type') || ''), /spreadsheetml/, 'xlsx content-type');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 2).toString('latin1'), 'PK', 'body starts with the ZIP magic PK');
});

test('GET /api/assets/hygiene/summary without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/hygiene/summary');
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

// Task 5 — POST send-now with the digest disarmed (default config) must be a
// clean 200 {sent:0, reason:'disabled'}: the arm gate short-circuits BEFORE any
// SMTP is attempted, so this asserts no real send.
// A PREVIEW is never blocked by the arm gate (an admin previews the digest BEFORE arming it —
// same contract as the asset-group / weekly senders): 200, nothing sent, a subject comes back.
test('POST /api/assets/hygiene/send?preview=1 (disarmed) → 200 preview, nothing sent', async () => {
  const res = await fetch(base + '/api/assets/hygiene/send?preview=1', { method: 'POST', headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.sent, 0, 'nothing sent in preview');
  assert.ok(body.preview === true || typeof body.subject === 'string', 'preview payload (preview flag or subject)');
});

// A real send-now while disarmed short-circuits at the gate BEFORE any SMTP: {sent:0, reason:'disabled'}.
test('POST /api/assets/hygiene/send (disarmed, no preview) → 200 {sent:0, reason:"disabled"}', async () => {
  const res = await fetch(base + '/api/assets/hygiene/send?preview=0', { method: 'POST', headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.sent, 0, 'nothing sent while disarmed');
  assert.equal(body.reason, 'disabled', 'arm gate reports disabled');
});

test('POST /api/assets/hygiene/send without a session → 401/403 (requireReportSession)', async () => {
  const res = await fetch(base + '/api/assets/hygiene/send?preview=1', { method: 'POST' });
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

// A valid NON-admin session must be rejected by requireAdmin BEFORE the arm gate.
test('POST /api/assets/hygiene/send as a viewer (non-admin) → 403 (requireAdmin)', async () => {
  const res = await fetch(base + '/api/assets/hygiene/send?preview=1', {
    method: 'POST', headers: { 'x-report-token': viewerToken } });
  assert.equal(res.status, 403, `viewer must be 403 (requireAdmin), got ${res.status}`);
});
