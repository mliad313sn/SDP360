'use strict';
// M02 / P0 — the dash key (bearer credential for /api routes behind the global gate only)
// must NOT be handed to an unauthenticated visitor. Before 2026-10-28 an anonymous
// GET /executive.html returned `window.__ak='<key>'`, and that key alone reached 19 API
// routes (Zoho /api/data/* proxies, /api/risk-register-export, /api/orgs …).
// Asserts: anonymous → no key in any of the 5 keyed pages; valid session cookie → key present.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'dashkey-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'dk-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'dk-super-pass-0000';
process.env.DASHBOARD_API_KEY = 'dk-secret-key-must-not-leak';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

const PAGES = ['/', '/index.html', '/executive.html', '/analytics.html', '/reports.html', '/executive-report.html'];
const KEY = process.env.DASHBOARD_API_KEY;
let server, base, token;

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'dk-viewer', full_name: 'DK Viewer', password: 'dk-viewer-0000', roles: ['viewer'] });
  token = (await rdb.login('dk-viewer', 'dk-viewer-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

for (const page of PAGES) {
  test(`anonymous ${page} does not contain the dash key`, async () => {
    const r = await fetch(base + page);
    const html = await r.text();
    assert.ok(!html.includes(KEY), `${page} leaked the dash key to an anonymous visitor`);
    assert.ok(!/window\.__ak=/.test(html), `${page} injected window.__ak anonymously`);
  });
  test(`${page} with a forged/expired session cookie does not contain the key`, async () => {
    const r = await fetch(base + page, { headers: { cookie: 'report_token=not-a-real-session' } });
    assert.ok(!(await r.text()).includes(KEY));
  });
  test(`${page} with a valid session cookie still receives the key`, async () => {
    const r = await fetch(base + page, { headers: { cookie: `report_token=${token}` } });
    assert.ok((await r.text()).includes(KEY), `${page} lost the key for a signed-in user`);
  });
}

// WP-M02-003 — the dash key alone (no session) must reach ONLY the routes below. These are
// the legacy gate-only routes found on 2026-10-28 (docs/remediation/RBAC-MATRIX.md); each still
// needs a decision (R-02). A NEW route that answers the key without a session fails this test.
const KEY_ONLY_KNOWN = new Set([
  'GET /api/ping', 'GET /api/orgs', 'GET /api/workspaces', 'GET /api/risk-register-export',
  ...['ticket-volume', 'changes', 'changes-it', 'resolution-by-site', 'backlog-trend', 'incidents-volume',
    'sla-by-category-week', 'sla-violated-by-cat', 'group-count', 'request-volume', 'sla-by-group',
    'cab-compliance', 'major-inc-by-month', 'major-inc-by-cat', 'major-inc-by-site'].map((v) => 'GET /api/data/' + v),
]);
const PUBLIC_ANON = new Set(['GET /api/exec/summary', 'POST /api/reports/auth/login', 'GET /api/auth/config',
  'GET /api/auth/sso/login', 'GET /api/auth/sso/callback']);

test('dash key alone reaches only the known legacy gate-only routes', async () => {
  const { collect, concrete } = require('../tools/qa/route-matrix');
  const { app } = require('../server');
  const routes = []; collect(app._router.stack, '', routes);
  const reached = [];
  for (const r of routes) {
    const p = concrete(r.path);
    if (!p || !p.startsWith('/api/') || r.method === 'HEAD') continue;
    const id = `${r.method} ${r.path}`;
    if (PUBLIC_ANON.has(id)) continue;
    const res = await fetch(base + p, { method: r.method, headers: { 'content-type': 'application/json', 'x-dash-key': KEY },
      body: ['GET', 'DELETE'].includes(r.method) ? undefined : '{}' });
    if (res.status !== 401 && res.status !== 403) reached.push(id);
  }
  const unexpected = reached.filter((id) => !KEY_ONLY_KNOWN.has(id));
  assert.deepEqual(unexpected, [], 'routes newly reachable with only the dash key');
});
