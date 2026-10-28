'use strict';
// Consolidation P0 (transplanted from the 1.11 line M06 / DEC-02, adapted to 2.0's site-awareness-only view) — business-only accounts (only site-business / group-business) are bounded SERVER-side:
// every GET /api route they can reach with 2xx must be inside services/businessGuard ALLOWED, and
// writes outside it are 403. Before 2026-10-28 the restriction was browser-only (~110 routes reachable).
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'bizonly-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'bo-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'bo-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'bo-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');
const { collect, concrete } = require('../tools/qa/route-matrix');
const guard = require('../services/businessGuard');

let server, base, routes, tok = {};
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const A = (rdb.listSites() || []).find((s) => s.name === 'Hounde');
  const mk = async (u, roles, extra = {}) => { await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, ...extra }); tok[u] = (await rdb.login(u, u + '-pw-0000')).token; };
  await mk('bo-site', ['site-business'], { site_id: A.id });
  await mk('bo-group', ['group-business']);
  await mk('bo-mixed', ['site-business', 'viewer'], { site_id: A.id });
  routes = []; collect(app._router.stack, '', routes);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const call = (method, p, t) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-report-token': t },
  body: ['GET', 'DELETE'].includes(method) ? undefined : '{}' });

for (const who of ['bo-site', 'bo-group']) {
  test(`${who}: every GET /api route answering 2xx is inside the business allowlist`, async () => {
    const leaks = [];
    for (const r of routes) {
      const p = concrete(r.path);
      if (r.method !== 'GET' || !p || !p.startsWith('/api/')) continue;
      const res = await call('GET', p, tok[who]);
      if (res.status < 300 && !guard.isAllowed(p.slice(4))) leaks.push(r.path);
    }
    assert.deepEqual(leaks, [], 'business-only session reached routes outside its view');
  });
}

test('business-only writes outside the allowlist are 403', async () => {
  for (const p of ['/api/meetings/save', '/api/inspection/save', '/api/reports/ensure', '/api/field/quick-actions', '/api/tracker/save'])
    assert.equal((await call('POST', p, tok['bo-site'])).status, 403, p);
});

test('2.0: dashboards and metrics are outside the business-only view; Site Awareness is inside', async () => {
  assert.equal((await call('GET', '/api/metrics/requests', tok['bo-site'])).status, 403);
  assert.equal((await call('GET', '/api/dashboards', tok['bo-site'])).status, 403);
  assert.equal((await call('GET', '/api/site-awareness/summary', tok['bo-site'])).status, 200);
});

test('an account holding another role besides site-business is not restricted by this guard', async () => {
  assert.equal((await call('GET', '/api/meetings/list', tok['bo-mixed'])).status, 200);
});
