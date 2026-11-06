'use strict';
// E-D02 — the /api/reports/sites* routes (extracted from server.js into routes/sites.js) keep their
// gates and answers; PUT /:id also takes `time_zone` (IANA name, validated; '' clears it, audited
// before/after); GET /api/reports/sites/master is the super_admin "site master" export (JSON / CSV).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'sites-smoke-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sites-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superToken, adminToken, execToken, rdb, siteId;

function req(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['x-report-token'] = token;
    if (body) headers['content-type'] = 'application/json';
    const r = http.request(base + path, { method, headers, agent: false },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body: b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : null })); });
    r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
  });
}
const pg = () => rdb.pgHandle();

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'sites-admin', full_name: 'A', password: 'sites-admin-pass-1', role: 'admin' });
  adminToken = (await rdb.login('sites-admin', 'sites-admin-pass-1')).token;
  await rdb.createUser({ username: 'sites-exec', full_name: 'X', password: 'sites-exec-pass-1', role: 'executive' });
  execToken = (await rdb.login('sites-exec', 'sites-exec-pass-1')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('list: 401 anonymous, 200 array; include_inactive needs executive+', async () => {
  assert.equal((await req('GET', '/api/reports/sites')).status, 401);
  const r = await req('GET', '/api/reports/sites', adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body) && r.body.length > 0);
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['active', 'id', 'name', 'sort_order', 'zoho_group']);
  assert.equal((await req('GET', '/api/reports/sites?include_inactive=1', adminToken)).status, 403);
  assert.equal((await req('GET', '/api/reports/sites?include_inactive=1', execToken)).status, 200);
});

test('create (executive), edit (super_admin only), disable, 404', async () => {
  assert.equal((await req('POST', '/api/reports/sites', adminToken, { name: 'Smoke Site' })).status, 403);
  const c = await req('POST', '/api/reports/sites', execToken, { name: 'Smoke Site', zoho_group: 'Smoke IT Agents' });
  assert.equal(c.status, 200);
  siteId = c.body.id;
  assert.equal((await req('POST', '/api/reports/sites', execToken, { name: 'Smoke Site' })).status, 400, 'duplicate');
  assert.equal((await req('PUT', `/api/reports/sites/${siteId}`, adminToken, { zoho_group: 'x' })).status, 403);
  const u = await req('PUT', `/api/reports/sites/${siteId}`, superToken, { zoho_group: 'Smoke Group', sort_order: 99 });
  assert.equal(u.status, 200);
  assert.equal(u.body.zoho_group, 'Smoke Group');
  assert.equal(u.body.sort_order, 99);
  assert.equal((await req('PUT', '/api/reports/sites/999999', superToken, { zoho_group: 'x' })).status, 404);
  assert.equal((await req('DELETE', '/api/reports/sites/999999', execToken)).status, 404);
});

test('time_zone: invalid is 400 and nothing changes; valid is stored, audited and read by siteTimeZone', async () => {
  const bad = await req('PUT', `/api/reports/sites/${siteId}`, superToken, { time_zone: 'Mars/Olympus' });
  assert.equal(bad.status, 400);
  assert.equal((await pg().prepare('SELECT time_zone FROM sites WHERE id=?').get(siteId)).time_zone, null, 'no default guessed');
  const ok = await req('PUT', `/api/reports/sites/${siteId}`, superToken, { time_zone: 'Africa/Abidjan' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.time_zone, 'Africa/Abidjan');
  const row = await pg().prepare('SELECT time_zone, country FROM sites WHERE id=?').get(siteId);
  assert.equal(require('../services/siteTimeZone').siteTimeZone(row, '1'), 'Africa/Abidjan');
  const a = await pg().prepare(`SELECT details FROM audit_log WHERE site_id=? AND action='site_updated' ORDER BY id DESC LIMIT 1`).get(siteId);
  const d = JSON.parse(a.details);
  assert.equal(d.before.time_zone, null);
  assert.equal(d.after.time_zone, 'Africa/Abidjan');
  const clear = await req('PUT', `/api/reports/sites/${siteId}`, superToken, { time_zone: '' });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.time_zone, null, "'' clears — back to today's UTC path");
});

test('site master export: super_admin JSON + CSV, admin 403', async () => {
  assert.equal((await req('GET', '/api/reports/sites/master', adminToken)).status, 403);
  const j = await req('GET', '/api/reports/sites/master', superToken);
  assert.equal(j.status, 200);
  const s = j.body.sites.find((x) => x.id === siteId);
  assert.ok(s, 'includes the created site');
  assert.equal(s.zoho_group, 'Smoke Group');
  assert.equal(s.time_zone, null);
  assert.equal(s.currency, null, 'no currency mapped = unknown');
  assert.ok(s.codes && typeof s.codes === 'object');
  const c = await req('GET', '/api/reports/sites/master?format=csv', superToken);
  assert.equal(c.status, 200);
  assert.match(c.type, /text\/csv/);
  assert.match(c.body.replace(/^\uFEFF/, '').split('\n')[0], /^id,name,active,country,business_unit,time_zone,currency,zoho_group,codes/);
});

test('disable keeps the row (soft delete)', async () => {
  const d = await req('DELETE', `/api/reports/sites/${siteId}`, execToken);
  assert.equal(d.status, 200);
  assert.equal(d.body.active, 0);
});
