'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// System Logs routes smoke — super_admin gate, {rows,total}, hostile-input-not-500,
// analytics, CSV/JSON export. Boots the app with sqlite (dev .env is postgres →
// would fail 'pgDb not initialised' without this).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'syslog-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'syslog-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'syslog-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'syslog-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superToken, lesserToken;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  // The seeded DASH_USER admin is role 'admin' (not super_admin), so create a
  // real super_admin for the 200 case + a lesser user for the 403 case.
  try { await rdb.createUser({ username: 'sl_super', full_name: 'S', password: 'superpass123', role: 'super_admin', roles: ['super_admin'] }); } catch {}
  const sess = await rdb.login('sl_super', 'superpass123');
  superToken = sess.token;
  try { await rdb.createUser({ username: 'sl_viewer', full_name: 'V', password: 'viewerpass123', role: 'viewer', roles: ['viewer'] }); } catch {}
  const vs = await rdb.login('sl_viewer', 'viewerpass123');
  lesserToken = vs && vs.token;
  await rdb.logEvent({ category: 'auth', action: 'login_failed', actor: 'x', ip: '1.2.3.4' });
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const get = (pathq, token) => fetch(base + pathq, token ? { headers: { 'x-report-token': token } } : {});

test('gate: lesser role → 403 super_admin only', async () => {
  const res = await get('/api/reports/system-log', lesserToken);
  assert.equal(res.status, 403);
});

test('super_admin → 200 {rows,total}', async () => {
  const res = await get('/api/reports/system-log?limit=10', superToken);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(Array.isArray(j.rows) && typeof j.total === 'number');
  assert.ok(j.total >= 1);
});

test('hostile filter input → not 500', async () => {
  for (const q of ["?actor=' OR 1=1--", '?from=../../etc/passwd', '?category=<script>']) {
    const res = await get('/api/reports/system-log' + q, superToken);
    assert.notEqual(res.status, 500, q);
  }
});

test('analytics → 200 with totals', async () => {
  const res = await get('/api/reports/system-log/analytics?window=30d', superToken);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.totals && typeof j.totals.events === 'number');
});

test('export csv/json', async () => {
  const csv = await get('/api/reports/system-log/export.csv', superToken);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') || '', /text\/csv/);
  const body = await csv.text();
  assert.match(body.split('\r\n')[0], /ts,category,action/);
  const j = await get('/api/reports/system-log/export.json', superToken);
  assert.equal(j.status, 200);
  assert.ok(Array.isArray(await j.json()));
});
