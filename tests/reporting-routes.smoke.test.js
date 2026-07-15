'use strict';
// Task 8 smoke — /api/reports/* Foundation routes (config / recipients / site-data / test-smtp).
// Boots the express app IN-PROCESS (start() is guarded → no port bind) and asserts the
// admin-gated CRUD surface plus the authenticated site-data reader. Schedule routes are
// NOT tested here — they land in Task 9 (reportSchedule.js doesn't exist yet).
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
// This is a SQLite-path smoke (the boot-init + config/recipients readers are the
// sqlite fork). Force it so a dev box whose .env pins REPORTS_BACKEND=postgres
// doesn't drag the harness onto the (uninitialised) PG adapter. Set BEFORE any
// require of server/reports-db, and before dotenv (which never overrides an
// already-set process.env var).
process.env.REPORTS_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'reporting-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'reporting-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'reporting-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'reporting-smoke-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset) — supply dummy
// ZOHO_* creds; they're never used (this smoke makes no Zoho call).
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
  // The default-admin seed only sets the legacy users.role column; grant the
  // 'admin' role in the user_roles table so requireAdmin (which reads via
  // userHasRole → user_roles) recognises the account.
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  assert.ok(((sess.user && sess.user.roles) || []).includes('admin'), 'session carries admin role');
  adminToken = sess.token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const authHeaders = () => ({ 'Content-Type': 'application/json', 'x-report-token': adminToken });

test('GET /api/reports/config (admin) → 200 with smtp transport default', async () => {
  const res = await fetch(base + '/api/reports/config', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.transport, 'smtp', 'transport defaults to smtp');
});

test('PUT /api/reports/config (admin) → 200 and echoes the saved value', async () => {
  const res = await fetch(base + '/api/reports/config', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ smtp_host: 'x' }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.smtp_host, 'x', 'saved smtp_host reflected in response');
});

test('PUT /api/reports/recipients/HGO (admin) → 200', async () => {
  const res = await fetch(base + '/api/reports/recipients/HGO', {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ coordinator_name: 'X' }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

test('GET /api/reports/recipients (admin) → 200 array including HGO', async () => {
  const res = await fetch(base + '/api/reports/recipients', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'recipients body is an array');
  assert.ok(body.some(r => r.site_code === 'HGO'), 'HGO recipient row present');
});

test('GET /api/reports/site-data?site=HGO (admin) → 200 with score present', async () => {
  const res = await fetch(base + '/api/reports/site-data?site=HGO', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok('score' in body, 'site-data body carries a score block');
});

test('GET /api/reports/config WITHOUT auth → 401', async () => {
  const res = await fetch(base + '/api/reports/config'); // no token
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});
