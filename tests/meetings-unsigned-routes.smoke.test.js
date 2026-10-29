'use strict';

// Smoke — the unsigned-worklist HTTP surface. Boots the express app in-process
// (start() is guarded → no port bind). Asserts:
//   • GET /api/meetings/unsigned without a session → 401/403 (auth gate).
//   • GET /api/meetings/unsigned does NOT fall into GET /api/meetings/:id.
//   • POST /api/meetings/:id/sign with an invalid `which` → 400.
//   • happy path: sign both signatures → the PV leaves the unsigned list.
// Run with --test-force-exit (top-level cron keeps the loop alive).

const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'mtg-unsigned-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'mtg-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'mtg-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'mtg-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, apiKey, meetingId;

function req(method, p, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(base + p);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Dash-Key': apiKey },
        token ? { 'x-report-token': token } : {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return b; } })() })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const mdb = require('../meetings-db');
  apiKey = process.env.DASHBOARD_API_KEY;
  (await mdb.loadLookups());
  const m = (await mdb.saveMeeting({ header: { site_code: 'HGO', department: 'smoke-unsigned', meeting_date: '2026-07-15', status: 'draft' } }, null, 1));
  meetingId = m.id;
  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  await rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  adminToken = sess.token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('GET /api/meetings/unsigned without a session → 401/403', async () => {
  const r = await req('GET', '/api/meetings/unsigned');
  assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
});

test('GET /api/meetings/unsigned is not shadowed by /:id (returns rows, not "Not found")', async () => {
  const r = await req('GET', '/api/meetings/unsigned', { token: adminToken });
  assert.strictEqual(r.status, 200, `expected 200, got ${r.status}: ${JSON.stringify(r.json)}`);
  assert.ok(Array.isArray(r.json.rows), 'response has rows[]');
  assert.ok(r.json.rows.some(m => m.id === meetingId), 'seeded unsigned PV present');
});

test('POST /api/meetings/:id/sign with invalid which → 400', async () => {
  const r = await req('POST', `/api/meetings/${meetingId}/sign`, { token: adminToken, body: { which: 'ceo' } });
  assert.strictEqual(r.status, 400, `expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
});

test('POST /api/meetings/:id/sign on a missing PV → 404', async () => {
  const r = await req('POST', '/api/meetings/99999999/sign', { token: adminToken, body: { which: 'dept_head' } });
  assert.strictEqual(r.status, 404, `expected 404, got ${r.status}: ${JSON.stringify(r.json)}`);
});

test('happy path: signing both signatures removes the PV from the unsigned list', async () => {
  // UAT F-02: an editor signing FOR the department head must give a reason, kept with the signature
  const s0 = await req('POST', `/api/meetings/${meetingId}/sign`, { token: adminToken, body: { which: 'dept_head' } });
  assert.strictEqual(s0.status, 400); assert.strictEqual(s0.json.code, 'ON_BEHALF_REASON');
  const s1 = await req('POST', `/api/meetings/${meetingId}/sign`, { token: adminToken, body: { which: 'dept_head', reason: 'head away on site, signed on paper' } });
  assert.ok(s1.json.dept_head_signed_by, 'the signer is recorded'); assert.match(String(s1.json.dept_head_signed_on_behalf), /signed on paper/);
  assert.strictEqual(s1.status, 200, `dept sign 200, got ${s1.status}: ${JSON.stringify(s1.json)}`);
  assert.ok(s1.json.dept_head_signed_at, 'dept signature returned');
  const s2 = await req('POST', `/api/meetings/${meetingId}/sign`, { token: adminToken, body: { which: 'site_it' } });
  assert.strictEqual(s2.status, 200, `it sign 200, got ${s2.status}`);
  assert.ok(s2.json.site_it_signed_at, 'IT signature returned');
  const list = await req('GET', '/api/meetings/unsigned', { token: adminToken });
  assert.ok(!list.json.rows.some(m => m.id === meetingId), 'fully-signed PV left the unsigned list');
});
