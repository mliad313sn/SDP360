'use strict';
// DEC-03 (transplanted 2026-10-28 from the 1.11 line) — the internal integrations plan is for
// signed-in staff only: anonymous → 302 to login; valid session → the page.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'plan-gate-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pg-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, token;
const get = (p, headers = {}) => new Promise((resolve) => http.get(base + p, { headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, location: r.headers.location, body: b })); }));
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'plan-viewer', full_name: 'V', password: 'plan-viewer-0000', roles: ['viewer'] });
  token = (await rdb.login('plan-viewer', 'plan-viewer-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
test('anonymous → redirect to login', async () => {
  const r = await get('/itsm-integrations-plan.html');
  assert.equal(r.status, 302); assert.match(r.location, /login\.html/);
});
test('forged cookie → redirect to login', async () => {
  assert.equal((await get('/itsm-integrations-plan.html', { cookie: 'report_token=forged' })).status, 302);
});
test('signed-in → the page', async () => {
  const r = await get('/itsm-integrations-plan.html', { cookie: `report_token=${token}` });
  assert.equal(r.status, 200); assert.match(r.body, /Plan projet/);
});
