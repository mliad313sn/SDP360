'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// E6 — identity journal: the three user admin routes (routes/adminUsers.js) write
// category 'identity' rows into system_log with actor / target / ip and a before/after
// diff of roles, site_id, extra_site_ids, active, email, full_name — never the password.
// Boots the app with sqlite (dev .env is postgres → 'pgDb not initialised' otherwise).
const _os = require('os'), _fs = require('fs'), _path = require('path');
for (const m of ['REPORTS', 'TRACKER', 'MEETINGS', 'INSPECTION', 'ASSETS']) process.env[m + '_BACKEND'] = 'sqlite';
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'identity-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'identity-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'identity-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'identity-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superToken, rdb, siteA, siteB, userId;
const SECRET = 'Sup3r-Secret-P4ssw0rd!';
const NEW_SECRET = 'Rotated-P4ssw0rd-2026!';

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  try { await rdb.createUser({ username: 'id_super', full_name: 'S', password: 'superpass123', role: 'super_admin', roles: ['super_admin'] }); } catch {}
  superToken = (await rdb.login('id_super', 'superpass123')).token;
  const sites = await rdb.listSites();
  siteA = sites[0] && sites[0].id; siteB = sites[1] && sites[1].id;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

const call = (method, pathq, body) => fetch(base + pathq, {
  method, headers: { 'x-report-token': superToken, 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const identityRows = async (action) => {
  const { rows } = await rdb.listSystemLog({ category: 'identity' }, { limit: 100, offset: 0 });
  // listSystemLog is newest-first; tests reason in chronological order.
  rows.sort((a, b) => a.id - b.id);
  return action ? rows.filter(r => r.action === action) : rows;
};

test('POST /users → user_created with the after snapshot, no password anywhere', async () => {
  const res = await call('POST', '/api/reports/users', { username: 'coord_e6', full_name: 'Coord E6', password: SECRET, roles: ['editor', 'tracker-editor'], site_id: siteA, email: 'Coord.E6@Example.com' });
  assert.equal(res.status, 200);
  const rows = await identityRows('user_created');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.target, 'coord_e6');
  assert.equal(r.actor, 'id_super');
  assert.ok(r.actor_id != null);
  assert.ok(r.ip, 'ip recorded');
  assert.equal(r.risk, 0);
  const d = JSON.parse(r.details);
  userId = d.user_id;
  assert.ok(Number.isFinite(userId));
  assert.deepEqual(d.after.roles, ['editor', 'tracker-editor']);
  assert.equal(d.after.email, 'coord.e6@example.com');
  assert.equal(d.after.site_id, siteA);
  assert.ok(!r.details.includes(SECRET), 'password never journaled');
});

test('PUT /users/:id with roles + site + active → user_updated diff + user_role_changed (risk)', async () => {
  const res = await call('PUT', `/api/reports/users/${userId}`, { full_name: 'Coord E6 bis', roles: ['admin'], site_id: siteB, active: 0, email: 'coord.e6@example.com', extra_site_ids: [siteA] });
  assert.equal(res.status, 200);
  const upd = await identityRows('user_updated');
  assert.equal(upd.length, 1);
  const d = JSON.parse(upd[0].details);
  assert.equal(upd[0].target, 'coord_e6');
  assert.equal(upd[0].risk, 0);
  assert.equal(d.password_reset, false);
  assert.deepEqual(d.diff.roles, { before: ['editor', 'tracker-editor'], after: ['admin'] });
  assert.deepEqual(d.diff.site_id, { before: siteA, after: siteB });
  assert.deepEqual(d.diff.active, { before: 1, after: 0 });
  assert.deepEqual(d.diff.full_name, { before: 'Coord E6', after: 'Coord E6 bis' });
  assert.deepEqual(d.diff.extra_site_ids, { before: [], after: [siteA] });
  assert.ok(!('email' in d.diff), 'unchanged e-mail is not in the diff');
  const rc = await identityRows('user_role_changed');
  assert.equal(rc.length, 1);
  assert.equal(rc[0].risk, 1, 'role change is a risk event');
  assert.deepEqual(JSON.parse(rc[0].details), { user_id: userId, before: ['editor', 'tracker-editor'], after: ['admin'] });
  assert.equal((await identityRows('password_reset')).length, 0);
});

test('PUT /users/:id with a password → password_reset (risk), the secret never lands; same roles → no role event', async () => {
  const res = await call('PUT', `/api/reports/users/${userId}`, { full_name: 'Coord E6 bis', password: NEW_SECRET, roles: ['admin'], site_id: siteB, active: 0, email: 'coord.e6@example.com', extra_site_ids: [siteA] });
  assert.equal(res.status, 200);
  const pr = await identityRows('password_reset');
  assert.equal(pr.length, 1);
  assert.equal(pr[0].risk, 1);
  assert.equal(pr[0].target, 'coord_e6');
  const upd = await identityRows('user_updated');
  assert.equal(upd.length, 2);
  assert.equal(JSON.parse(upd[1].details).password_reset, true);
  assert.deepEqual(JSON.parse(upd[1].details).changed, [], 'no governed field changed');
  assert.equal((await identityRows('user_role_changed')).length, 1, 'unchanged roles → no new role event');
  const all = await identityRows();
  assert.ok(all.every(r => !String(r.details || '').includes(NEW_SECRET) && !String(r.details || '').includes(SECRET)), 'no password in any row');
});

test('DELETE /users/:id → user_deleted (risk) with the before snapshot', async () => {
  const res = await call('DELETE', `/api/reports/users/${userId}`);
  assert.equal(res.status, 200);
  const rows = await identityRows('user_deleted');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target, 'coord_e6');
  assert.equal(rows[0].risk, 1);
  assert.equal(rows[0].actor, 'id_super');
  const d = JSON.parse(rows[0].details);
  assert.equal(d.user_id, userId);
  assert.deepEqual(d.before.roles, ['admin']);
});

test('the identity rows are readable through the System Logs route (category filter)', async () => {
  const res = await fetch(base + '/api/reports/system-log?category=identity&limit=50', { headers: { 'x-report-token': superToken } });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual([...new Set(j.rows.map(r => r.action))].sort(), ['password_reset', 'user_created', 'user_deleted', 'user_role_changed', 'user_updated']);
});
