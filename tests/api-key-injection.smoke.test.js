'use strict';
// Fiche C1 (2026-10-20) — the internal API key is a server-to-server credential, not a page secret.
//   (a) an anonymous GET of an injected page (index.html) carries NO window.__ak;
//   (b) the same page requested with a valid session carries it;
//   (c) GET /api/orgs with the key alone → 401 (route moved to requireReportSession);
//   (d) GET /ready answers 200 without any credential and exposes ONLY {ok, db, last_job_at};
//   (e) the key in the query string never satisfies the /api/ gate → 401;
//   (f) the key alone in a BROWSER context (Origin header, or a report_token cookie that is not a
//       valid session) → 401, while a valid session cookie passes and a bare key (server-to-server) passes.
// Boots the app in-process (sqlite-pinned), like the other route smokes. --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'apikey-smoke-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'apikey-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'apikey-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'apikey-smoke-key-0123456789abcdef0123456789';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const KEY = process.env.DASHBOARD_API_KEY;
let server, base, superToken, viewerToken;

function req(method, path, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + path, { method, headers: headers || {} },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, text: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
    r.on('error', reject); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(su, 'seeded super_admin user exists');
  rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'apikey-viewer', full_name: 'Plain Viewer', password: 'apikey-pass-1111', role: 'viewer' });
  viewerToken = (await rdb.login('apikey-viewer', 'apikey-pass-1111')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('(a) anonymous GET /index.html does not expose window.__ak', async () => {
  const r = await req('GET', '/index.html');
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes("window.__ak='"), 'page served without a session must not contain the API key injection');
  assert.ok(!r.text.includes(KEY), 'the raw key never appears in an anonymous page');
});

test('(b) GET /index.html with a valid session (header or cookie) carries window.__ak', async () => {
  const h = await req('GET', '/index.html', { 'x-report-token': superToken });
  assert.equal(h.status, 200);
  assert.ok(h.text.includes(`window.__ak='${KEY}'`), 'header session → key injected');
  const c = await req('GET', '/executive.html', { cookie: `report_token=${superToken}` });
  assert.equal(c.status, 200);
  assert.ok(c.text.includes(`window.__ak='${KEY}'`), 'cookie session → key injected');
  const bogus = await req('GET', '/index.html', { cookie: 'report_token=not-a-session' });
  assert.ok(!bogus.text.includes("window.__ak='"), 'an invalid cookie is not a session');
});

test('(c) key-only routes now require a session: /api/orgs, /api/workspaces, /api/health/views, risk-register export', async () => {
  for (const p of ['/api/orgs', '/api/workspaces', '/api/health/views', '/api/risk-register-export?month=2026-05']) {
    const r = await req('GET', p, { 'x-dash-key': KEY });
    assert.equal(r.status, 401, `${p} with the key alone → 401`);
  }
  const forbidden = await req('GET', '/api/health/views', { 'x-report-token': viewerToken });
  assert.equal(forbidden.status, 403, 'viewer session on /api/health/views → 403 (admin tier required)');
});

test('(d) GET /ready is anonymous and carries no business data', async () => {
  const r = await req('GET', '/ready');
  assert.equal(r.status, 200);
  assert.ok(r.json, 'JSON body');
  assert.deepEqual(Object.keys(r.json).sort(), ['db', 'last_job_at', 'ok']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.db, true);
  assert.ok(r.json.last_job_at === null || typeof r.json.last_job_at === 'string');
});

test('(e) the key in the query string never satisfies the /api/ gate', async () => {
  for (const q of [`?x-dash-key=${KEY}`, `?key=${KEY}`, `?api_key=${KEY}`, `?token=${KEY}`]) {
    const r = await req('GET', '/api/ping' + q);
    assert.equal(r.status, 401, `query ${q.split('=')[0]} → 401`);
  }
});

test('(f) key alone: accepted server-to-server, refused in a browser context (Origin or cookie)', async () => {
  const s2s = await req('GET', '/api/ping', { 'x-dash-key': KEY });
  assert.equal(s2s.status, 200, 'bare key without cookie/Origin (tools, scheduled jobs) still passes the gate');
  const origin = await req('GET', '/api/ping', { 'x-dash-key': KEY, origin: base });
  assert.equal(origin.status, 401, 'key + Origin header → the session is required');
  const stale = await req('GET', '/api/ping', { 'x-dash-key': KEY, cookie: 'report_token=expired-or-forged' });
  assert.equal(stale.status, 401, 'key + invalid session cookie → 401');
  const ok = await req('GET', '/api/ping', { 'x-dash-key': KEY, origin: base, cookie: `report_token=${superToken}` });
  assert.equal(ok.status, 200, 'key + valid session cookie in a browser context → 200');
  const sessionOnly = await req('GET', '/api/ping', { 'x-report-token': viewerToken, origin: base });
  assert.equal(sessionOnly.status, 200, 'a session alone (no key) passes the gate');
});
