'use strict';
// SEC-01 — three routes that any signed-in viewer could reach (found by the route-matrix probe once
// its viewer session stopped being revoked mid-run):
//   POST /api/notes        overwrote the Executive Scorecard's shared commentary (page is executive|scorecard-viewer,
//                          and scorecard-viewer is read-only) → executive+
//   POST /api/save-charts  wrote up to 50 MB to data/chart_images.json and answered the server's absolute path;
//                          no page calls it → report-author, and the path is no longer returned
//   GET /api/orgs, /api/workspaces, /api/views, /api/debug/raw-test — Zoho tenant diagnostics (org/workspace
//                          ids, every view name, raw upstream headers) driven with the service token; no page calls
//                          them → super_admin
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'sec01-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sec01-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base; const tok = {};
const call = (method, p, token, body) => new Promise((resolve) => {
  const r = http.request(base + p, { method, agent: false, headers: { 'content-type': 'application/json', 'x-report-token': token } },
    (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  if (body !== undefined) r.write(JSON.stringify(body)); r.end();
});
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  for (const [u, roles] of [['s1-viewer', ['viewer']], ['s1-scv', ['viewer', 'scorecard-viewer']], ['s1-exec', ['executive']], ['s1-author', ['viewer', 'report-author']]]) {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles });
    tok[u] = (await rdb.login(u, u + '-pass-0000')).token;
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('POST /api/notes: viewer and read-only scorecard-viewer are refused, executive saves', async () => {
  assert.equal((await call('POST', '/api/notes', tok['s1-viewer'], { f: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/notes', tok['s1-scv'], { f: 'x' })).status, 403);
  assert.equal((await call('POST', '/api/notes', tok['s1-exec'], { f: 'x' })).status, 200);
  assert.equal((await call('GET', '/api/notes', tok['s1-scv'])).status, 200, 'reading stays open to the page readers');
});

test('POST /api/save-charts: viewer refused; report-author saves and the answer carries no server path', async () => {
  assert.equal((await call('POST', '/api/save-charts', tok['s1-viewer'], { a: 1 })).status, 403);
  const r = await call('POST', '/api/save-charts', tok['s1-author'], { a: 1 });
  assert.equal(r.status, 200);
  assert.ok(!/chart_images|[\\/]data[\\/]/.test(r.body), r.body);
});

test('Zoho tenant diagnostics are super_admin only', async () => {
  for (const p of ['/api/orgs', '/api/workspaces', '/api/views', '/api/debug/raw-test']) {
    assert.equal((await call('GET', p, tok['s1-viewer'])).status, 403, p);
    assert.equal((await call('GET', p, tok['s1-exec'])).status, 403, p);
  }
});
