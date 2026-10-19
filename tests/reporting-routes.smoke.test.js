'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
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
// Same rationale for meetings: the /recipients/suggest test seeds a PV straight
// into the sqlite meetings.db, so meetings-db must be on its sqlite fork.
process.env.MEETINGS_BACKEND = 'sqlite';
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
  rdb.setUserRoles(me.id, ['super_admin']);   // the routes under test are super_admin-gated (admin settings → super_admin since 5e2f40e / 2026-08-16; IT Review → executive since 7162ac7)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  assert.ok(((sess.user && sess.user.roles) || []).includes('super_admin'), 'session carries super_admin role');
  adminToken = sess.token;

  // Seed PV data so /recipients/suggest has something real to fill FROM.
  // 'HGO' is a real meetings code (site_module_codes seed → Hounde). Two PVs so
  // both halves of _pickContacts fire: site_it_lead → coordinator_name, and the
  // finance department_head → fm_name. Dated today so the reader's rolling
  // 6-month window always covers them.
  const mdb = require('../meetings-db').getDB();
  const today = new Date().toISOString().slice(0, 10);
  const ins = mdb.prepare(`INSERT OR IGNORE INTO md_meetings
    (reference, site_code, department, meeting_date, department_head, site_it_lead, status)
    VALUES (?, ?, ?, ?, ?, ?, 'signed')`);
  ins.run(`HGO_maintenance_PV_${today}`, 'HGO', 'maintenance', today, 'Ops Head', 'Jean Traore');
  ins.run(`HGO_finance_PV_${today}`, 'HGO', 'finance', today, 'Marie Kone', 'Jean Traore');

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

// filled MUST be > 0. Asserting only `typeof filled === 'number'` is worthless:
// {ok:true, filled:0} is precisely what every silent-zero bug on this path
// returns (unawaited pg promises, a missing reader guarded into a no-op).
test('POST /api/reports/recipients/suggest (admin) → 200 {ok, filled>0} against a seeded PV', async () => {
  const res = await fetch(base + '/api/reports/recipients/suggest', { method: 'POST', headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.ok, true, 'suggest reported ok');
  assert.ok(body.filled > 0, `expected filled > 0 against the seeded HGO PVs, got ${body.filled}`);

  // …and prove the fill is the REAL PV value, not just a non-zero counter.
  const rows = await (await fetch(base + '/api/reports/recipients', { headers: authHeaders() })).json();
  const hgo = rows.find(r => r.site_code === 'HGO');
  assert.ok(hgo, 'HGO recipient row exists after suggest');
  assert.equal(hgo.fm_name, 'Marie Kone', 'fm_name pre-filled from the finance PV department_head');
});

test('GET /api/reports/site-data?site=HGO (admin) → 200 with score present', async () => {
  const res = await fetch(base + '/api/reports/site-data?site=HGO', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok('score' in body, 'site-data body carries a score block');
});

test('GET /api/reports/schedule (admin) → 200 array', async () => {
  const res = await fetch(base + '/api/reports/schedule', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(Array.isArray(body), 'schedule body is an array');
});

test('PUT /api/reports/schedule (admin, disable) → 200', async () => {
  // enabled:0 only hits the delete path (schtasks /Delete of a likely-absent
  // task) which the default runner resolves ok — no real create.
  const res = await fetch(base + '/api/reports/schedule', {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ report_type: 'coordinator', cadence: 'weekly', enabled: 0 }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.ok, 'setSchedule returned ok');
});

test('GET /api/reports/config WITHOUT auth → 401', async () => {
  const res = await fetch(base + '/api/reports/config'); // no token
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});
