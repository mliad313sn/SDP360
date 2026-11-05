'use strict';
// C-17 — GET /api/access/me/why (session required) feeds the no-access page with the missing capability;
// authz_capability_mode=shadow never changes a response.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'access-why-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'aw-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'aw-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'aw-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, tok = {}, rdb;
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const A = ((await rdb.listSites()) || []).find((s) => s.name === 'Hounde');
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles, site_id: A && A.id });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
  };
  await mk('aw-viewer', ['viewer']);
  await mk('aw-super', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const get = (p, t) => fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });

test('why needs a session', async () => {
  assert.equal((await get('/api/access/me/why?cap=finance.read')).status, 401);
});

test('why by capability id: viewer lacks finance.read, reason missing_role, label in both languages', async () => {
  const r = await get('/api/access/me/why?cap=finance.read', tok['aw-viewer']);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.allow, false); assert.equal(b.reason_code, 'missing_role');
  assert.deepEqual(b.needed, ['admin', 'finance-viewer']);
  assert.equal(b.capability.id, 'finance.read'); assert.ok(b.capability.en && b.capability.fr);
});

test('why by the page gate role set, and allow for a holder', async () => {
  const b = await (await get('/api/access/me/why?need=admin%7Cscorecard-viewer', tok['aw-viewer'])).json();
  assert.equal(b.capability.id, 'analytics.data.read'); assert.equal(b.allow, false);
  const s = await (await get('/api/access/me/why?cap=platform.settings.manage', tok['aw-super'])).json();
  assert.equal(s.allow, true); assert.equal(s.reason_code, 'granted_by_role');
});

test('unknown capability denies; missing parameters is a 400', async () => {
  const b = await (await get('/api/access/me/why?cap=no.such.thing', tok['aw-viewer'])).json();
  assert.equal(b.allow, false); assert.equal(b.reason_code, 'unknown_capability'); assert.equal(b.capability, null);
  assert.equal((await get('/api/access/me/why', tok['aw-viewer'])).status, 400);
});

test('shadow mode leaves every answer unchanged and logs no divergence on agreeing guards', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { authz_capability_mode: 'shadow' }, 'test');
  require('../services/authzShadow')._resetCache();
  assert.equal((await get('/api/reports/users', tok['aw-viewer'])).status, 403);
  assert.equal((await get('/api/reports/users', tok['aw-super'])).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  const rows = await rdb.pgHandle().prepare("SELECT count(*)::int AS n FROM system_log WHERE category='authz'").get();
  assert.equal(rows.n, 0);
  await require('../services/reportConfig').setConfig(rdb.db, { authz_capability_mode: 'off' }, 'test');
  require('../services/authzShadow')._resetCache();
});

test('E-S01: enforce with review.read listed refuses a viewer with the reason, logs authz_enforce_denied; a holder still passes', async () => {
  const rc = require('../services/reportConfig');
  await rc.setConfig(rdb.db, { authz_capability_mode: 'enforce', authz_enforce_caps: 'review.read' }, 'test');
  require('../services/authzShadow')._resetCache();
  try {
    const r = await get('/api/reports/review-data', tok['aw-viewer']);
    assert.equal(r.status, 403);
    const b = await r.json();
    assert.equal(b.reason_code, 'missing_role'); assert.equal(b.capability, 'review.read');
    assert.notEqual((await get('/api/reports/review-data', tok['aw-super'])).status, 403);
    assert.equal((await get('/api/reports/review-data')).status, 401, 'no session keeps the legacy 401');
    await new Promise((res) => setTimeout(res, 150));
    const n = await rdb.pgHandle().prepare("SELECT count(*)::int AS n FROM system_log WHERE category='authz' AND action='authz_enforce_denied'").get();
    assert.equal(n.n, 1);
  } finally {
    await rc.setConfig(rdb.db, { authz_capability_mode: 'off', authz_enforce_caps: '' }, 'test');
    require('../services/authzShadow')._resetCache();
  }
});

test('no-access page carries the capability row and asks the why endpoint', async () => {
  const html = await (await get('/no-access.html', tok['aw-viewer'])).text();
  assert.match(html, /id="naCap"/);
  const js = _fs.readFileSync(_p.join(__dirname, '..', 'public', 'no-access.js'), 'utf8');
  assert.match(js, /\/api\/access\/me\/why\?/);
});
