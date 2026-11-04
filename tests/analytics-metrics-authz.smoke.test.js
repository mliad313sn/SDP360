'use strict';
// C-02 / G31 — the Analytics data API carries the same role gate as its page
// (public/analytics.html data-require="admin|scorecard-viewer"). Before this fix the five
// /api/metrics/{requests,change,cab,survey,request-filter-options} routes required only a
// session, so any viewer/editor could read fleet or another site's aggregates directly.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'metrics-authz-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ma-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'ma-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ma-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

const ROUTES = ['/api/metrics/requests', '/api/metrics/change', '/api/metrics/cab', '/api/metrics/survey', '/api/metrics/request-filter-options'];
let server, base, tok = {};
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const A = ((await rdb.listSites()) || []).find((s) => s.name === 'Hounde');
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: A && A.id });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
  };
  await mk('ma-viewer', ['viewer']);
  await mk('ma-editor', ['editor']);
  await mk('ma-admin', ['admin']);
  await mk('ma-scorecard', ['viewer', 'scorecard-viewer']);
  await mk('ma-exec', ['executive']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const get = (p, t) => fetch(base + p, { headers: { 'x-report-token': t } });

for (const who of ['ma-viewer', 'ma-editor']) {
  test(`${who} is refused every Analytics data route (403)`, async () => {
    for (const p of ROUTES) assert.equal((await get(p, tok[who])).status, 403, `${who} ${p}`);
  });
}

for (const who of ['ma-admin', 'ma-scorecard', 'ma-exec']) {
  test(`${who} reads every Analytics data route (200)`, async () => {
    for (const p of ROUTES) assert.equal((await get(p, tok[who])).status, 200, `${who} ${p}`);
  });
}

test('the 403 body names the required roles', async () => {
  const body = await (await get('/api/metrics/requests', tok['ma-editor'])).json();
  assert.match(String(body.error || ''), /admin or scorecard-viewer/);
});
