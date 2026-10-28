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
