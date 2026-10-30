'use strict';
// G02 — refused API calls are evidence: a 401 or 403 is written to the security log (category api), at most
// once per actor + route per 10 minutes, with the number of refusals seen. No token or password is stored.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'deny-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'dn-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'dn-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'dn-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, viewerTok;
const wait = () => new Promise((r) => setTimeout(r, 300));   // logEvent is fire-and-forget
const rows = async (action) => (((await rdb.listSystemLog({ action }, { limit: 200 })) || {}).rows || []);

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'dn-viewer', full_name: 'dn-viewer', password: 'dn-viewer-pass-0000' });
  const u = ((await rdb.listUsers()) || []).find((x) => x.username === 'dn-viewer');
  await rdb.setUserRoles(u.id, ['viewer']);
  viewerTok = (await rdb.login('dn-viewer', 'dn-viewer-pass-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('an anonymous call is recorded once per window, with the count', async () => {
  for (let i = 0; i < 3; i++) assert.strictEqual((await fetch(base + '/api/governance/portfolio')).status, 401);
  await wait();
  for (let i = 0; i < 5; i++) await fetch(base + '/api/probe-' + i);   // a prober walking paths is still ONE source
  await wait();
  const r = (await rows('access_unauthenticated')).filter((x) => x.actor === 'anonymous');
  assert.strictEqual(r.length, 1, 'one row per source and window, not one per call or per path');
  assert.ok(String(r[0].details).includes('/api/governance/portfolio'), 'the first path is kept in the details');
});

test('a signed-in user refused by a role gate is recorded with their name and a risk flag', async () => {
  const res = await fetch(base + '/api/reports/users', { headers: { 'x-report-token': viewerTok } });
  assert.strictEqual(res.status, 403);
  await wait();
  const r = (await rows('access_denied')).filter((x) => x.actor === 'dn-viewer');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(Number(r[0].risk), 1);
  assert.ok(!JSON.stringify(r[0]).includes(viewerTok), 'the session token is never logged');
});

test('a token in the path is cut to 8 characters before it is logged', async () => {
  const tok = 'a'.repeat(8) + 'b'.repeat(56);
  assert.strictEqual((await fetch(base + '/api/reports/sessions/' + tok, { method: 'DELETE', headers: { 'x-report-token': viewerTok } })).status, 403);
  await wait();
  const all = JSON.stringify(await rows('access_denied'));
  assert.ok(!all.includes(tok), 'full token never stored'); assert.ok(all.includes('aaaaaaaa…'));
});
