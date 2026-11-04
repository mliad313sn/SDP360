'use strict';
const fetch = require('./_http-fetch');
// C-09 — POST /api/ux/page-view (one row per user × page × day, user id + tier only, no name/IP) and the
// read-only GET /api/ux/page-usage report (super_admin).
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'pu-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pu-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pu-smoke-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, sup, adm, viewer, viewerId;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  try { await rdb.createUser({ username: 'pu_super', full_name: 'Super Person', password: 'superpass1234', role: 'super_admin', roles: ['super_admin'] }); } catch {}
  try { await rdb.createUser({ username: 'pu_admin', full_name: 'Admin Person', password: 'adminpass1234', role: 'admin', roles: ['admin'] }); } catch {}
  try { await rdb.createUser({ username: 'pu_viewer', full_name: 'Viewer Person', password: 'viewerpass1234', role: 'viewer', roles: ['viewer', 'scorecard-viewer'] }); } catch {}
  sup = (await rdb.login('pu_super', 'superpass1234')).token;
  adm = (await rdb.login('pu_admin', 'adminpass1234')).token;
  const v = await rdb.login('pu_viewer', 'viewerpass1234'); viewer = v.token; viewerId = v.user.id;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const post = (t, body) => fetch(base + '/api/ux/page-view', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, t ? { 'x-report-token': t } : {}), body: JSON.stringify(body) });
const get = (p, t) => fetch(base + p, { headers: t ? { 'x-report-token': t } : {} });
const rows = async () => (await rdb.pgHandle().prepare(`SELECT * FROM system_log WHERE action = 'page_viewed' ORDER BY id`).all());
const settle = () => new Promise((r) => setTimeout(r, 150));   // logEvent is fire-and-forget

test('page-view: 401 anonymous, 400 unknown page, one row per user × page × day', async () => {
  assert.equal((await post(null, { page: 'executive' })).status, 401);
  assert.equal((await post(viewer, { page: 'not-a-page' })).status, 400);
  assert.equal((await post(viewer, { page: '../server' })).status, 400);
  const a = await (await post(viewer, { page: 'executive' })).json();
  const b = await (await post(viewer, { page: 'executive' })).json();
  assert.equal(a.logged, true); assert.equal(b.logged, false);
  assert.equal((await (await post(viewer, { page: 'dashboards:exec-home' })).json()).logged, true);
  await settle();
  const r = (await rows()).filter((x) => String(x.actor_id) === String(viewerId));
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.target).sort(), ['dashboards:exec-home', 'executive']);
});

test('page-view row carries user id + role tier only — no name, no e-mail, no IP', async () => {
  const r = (await rows()).find((x) => String(x.actor_id) === String(viewerId));
  assert.equal(r.category, 'ux');
  assert.equal(r.actor, 'u' + viewerId);
  assert.equal(r.ip, null);
  assert.deepEqual(JSON.parse(r.details), { tier: 'viewer' });
  const flat = JSON.stringify(r);
  assert.ok(!/pu_viewer|Viewer Person/.test(flat), 'no username / full name in the row');
});

test('page-usage: super_admin only; distinct users per page per tier', async () => {
  assert.equal((await get('/api/ux/page-usage', null)).status, 401);
  assert.equal((await get('/api/ux/page-usage', viewer)).status, 403);
  assert.equal((await get('/api/ux/page-usage', adm)).status, 403);
  await post(adm, { page: 'executive' });
  await settle();
  const j = await (await get('/api/ux/page-usage?days=30', sup)).json();
  assert.equal(j.ok, true); assert.equal(j.days, 30);
  const ex = j.pages.find((p) => p.page === 'executive');
  assert.equal(ex.users, 2);
  assert.equal(ex.by_tier.viewer, 1); assert.equal(ex.by_tier.admin, 1);
  assert.ok(!JSON.stringify(j).includes('pu_'), 'the report never lists people');
});
