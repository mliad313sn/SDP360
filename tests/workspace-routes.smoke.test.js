'use strict';
// R1-PROFILES — routes/workspace.js on PostgreSQL (migration 078): off → 404 everywhere; on → read defaults,
// save, re-read, refuse an ineligible profile or a foreign default site, the user id is the session's, reset.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wsp-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const rdb = require('../reports-db');
const reportConfig = require('../services/reportConfig');

let server, base, pageCalls = 0;
const tokens = {}; const ids = {};
function req(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + p, { method, agent: false, headers: { 'content-type': 'application/json', ...(token ? { 'x-report-token': token } : {}) } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
    r.on('error', reject); if (body !== undefined) r.write(JSON.stringify(body)); r.end();
  });
}
const setOn = (v) => reportConfig.setConfig(rdb.db, { workspace_profiles_enabled: v }, 'test');
async function mkUser(username, roles, site_id) {
  await rdb.createUser({ username, full_name: username, password: 'wsp-pass-1234', role: roles[0], site_id: site_id || null });
  const u = ((await rdb.listUsers()) || []).find((x) => x.username === username);
  await rdb.setUserRoles(u.id, roles);
  ids[username] = u.id;
  tokens[username] = (await rdb.login(username, 'wsp-pass-1234')).token;
}

before(async () => {
  const sites = (await rdb.listSites({ includeInactive: false })) || [];
  assert.ok(sites.length >= 2, 'seeded sites');
  ids.siteA = Number(sites[0].id); ids.siteB = Number(sites[1].id);
  await mkUser('wsp-viewer', ['viewer'], ids.siteA);
  await mkUser('wsp-editor', ['editor'], ids.siteA);
  await mkUser('wsp-admin', ['admin']);
  await mkUser('wsp-biz', ['site-business'], ids.siteA);
  const app = express();
  app.use(express.json());
  const requireReportSession = async (q, s, next) => {
    const u = await rdb.validateSession(q.headers['x-report-token']);
    if (!u) return s.status(401).json({ error: 'Unauthorized' });
    q.reportUser = u; next();
  };
  app.use(require('../routes/workspace')({ express, requireReportSession, sendHtmlPage: (res) => { pageCalls++; res.send('<html>ws</html>'); } }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('migration 078 created user_workspace_prefs with its foreign keys', async () => {
  const cols = await rdb.pgHandle().prepare(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'user_workspace_prefs' ORDER BY ordinal_position`).all();
  assert.deepEqual(cols.map((c) => c.column_name), ['user_id', 'profile', 'card_order', 'cards_hidden', 'density', 'default_site_id', 'updated_at']);
  const fks = await rdb.pgHandle().prepare(`SELECT confdeltype FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace WHERE t.relname = 'user_workspace_prefs' AND n.nspname = current_schema() AND c.contype = 'f' ORDER BY confdeltype`).all();
  assert.deepEqual(fks.map((f) => f.confdeltype).sort(), ['c', 'n'], 'users ON DELETE CASCADE, sites ON DELETE SET NULL');
});

test('off (default) → page and every API route answer 404, nothing is written', async () => {
  assert.equal((await reportConfig.getConfig(rdb.db)).workspace_profiles_enabled, '0');
  assert.equal((await req('GET', '/workspace-settings.html')).status, 404);
  assert.equal(pageCalls, 0);
  assert.equal((await req('GET', '/api/workspace/me', tokens['wsp-viewer'])).status, 404);
  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-viewer'], { profile: 'reader' })).status, 404);
  assert.equal((await req('DELETE', '/api/workspace/prefs', tokens['wsp-viewer'])).status, 404);
  const n = await rdb.pgHandle().prepare('SELECT COUNT(*)::int AS n FROM user_workspace_prefs').get();
  assert.equal(n.n, 0);
});

test('on → defaults by role, save + re-read, refusals, session user only, reset', async () => {
  await setOn('1');
  assert.equal((await req('GET', '/workspace-settings.html')).status, 200);
  assert.equal((await req('GET', '/api/workspace/me')).status, 401, 'session required');

  const me0 = (await req('GET', '/api/workspace/me', tokens['wsp-editor'])).json;
  assert.equal(me0.profile, 'coordinator'); assert.equal(me0.reason, 'default'); assert.equal(me0.prefs, null);
  assert.deepEqual(me0.sites.map((s) => s.id), [ids.siteA], 'an editor is offered only their own sites');

  const save = await req('PUT', '/api/workspace/prefs', tokens['wsp-editor'],
    { profile: 'field', card_order: ['inspections', 'home'], cards_hidden: ['site-actions'], density: 'compact', default_site_id: ids.siteA, user_id: ids['wsp-admin'] });
  assert.equal(save.status, 200);
  const me1 = (await req('GET', '/api/workspace/me?lang=fr', tokens['wsp-editor'])).json;
  assert.equal(me1.profile, 'field'); assert.equal(me1.reason, 'chosen'); assert.equal(me1.density, 'compact');
  assert.equal(me1.default_site_id, ids.siteA);
  assert.deepEqual(me1.destinations.map((d) => d.id), ['inspections', 'home', 'field', 'site-actions']);
  assert.deepEqual(me1.visible.map((d) => d.id), ['inspections', 'home', 'field']);
  assert.equal(me1.profile_labels.field, 'Terrain');
  const adminRow = await rdb.pgHandle().prepare('SELECT user_id FROM user_workspace_prefs WHERE user_id = ?').get(ids['wsp-admin']);
  assert.equal(adminRow, undefined, 'a user_id in the body is ignored — the row belongs to the session user');

  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-editor'], { profile: 'administrator' })).status, 400);
  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-editor'], { default_site_id: ids.siteB })).status, 400, 'not one of my sites');
  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-editor'], { card_order: ['nope'] })).status, 400);
  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-admin'], { profile: 'pmo', default_site_id: ids.siteB })).status, 200, 'the admin tier may pick any active site');

  const biz = (await req('GET', '/api/workspace/me', tokens['wsp-biz'])).json;
  assert.deepEqual(biz.eligible, ['business']); assert.equal(biz.queue, false);
  assert.equal((await req('PUT', '/api/workspace/prefs', tokens['wsp-biz'], { profile: 'reader' })).status, 400);

  assert.equal((await req('DELETE', '/api/workspace/prefs', tokens['wsp-editor'])).status, 200);
  const me2 = (await req('GET', '/api/workspace/me', tokens['wsp-editor'])).json;
  assert.equal(me2.profile, 'coordinator'); assert.equal(me2.prefs, null);

  await new Promise((r) => setTimeout(r, 300));
  const log = (await rdb.listSystemLog({ action: 'workspace_prefs_saved' }, { limit: 10 })).rows;
  assert.ok(log.length >= 2, 'each save is journalled');
  await setOn('0');
  assert.equal((await req('GET', '/api/workspace/me', tokens['wsp-admin'])).status, 404, 'switching off hides it again');
});
