'use strict';
// R1-PROFILES — "a profile grants nothing" (REBUILD-SPEC Rules: profiles are presentation only and are tested to
// grant nothing). With the switch ON and a forged preference row claiming the administrator / finance profiles and
// privileged destinations, a viewer: (1) is served the reader profile and no privileged destination; (2) keeps
// exactly the same roles in the session and in /api/reports/auth/me; (3) is still refused by the real server's
// super_admin and money routes; (4) cannot save a privileged profile through the API.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wsg-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');

let srvApp, srvWs, baseApp, baseWs, viewerToken, viewerId;
function req(base, method, p, token, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(base + p, { method, agent: false, headers: { 'content-type': 'application/json', ...(token ? { 'x-report-token': token } : {}) } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
    r.on('error', reject); if (body !== undefined) r.write(JSON.stringify(body)); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  await require('../services/reportConfig').setConfig(rdb.db, { workspace_profiles_enabled: '1' }, 'test');
  await rdb.createUser({ username: 'wsg-viewer', full_name: 'V', password: 'wsg-pass-1234', role: 'viewer' });
  viewerId = ((await rdb.listUsers()) || []).find((u) => u.username === 'wsg-viewer').id;
  viewerToken = (await rdb.login('wsg-viewer', 'wsg-pass-1234')).token;
  // forged row: a privileged profile and privileged destinations, written straight into the table
  await rdb.pgHandle().prepare(`INSERT INTO user_workspace_prefs (user_id, profile, card_order, cards_hidden, density, updated_at)
    VALUES (?, 'administrator', ?, NULL, 'compact', ?)`).run(viewerId,
    JSON.stringify(['system-logs', 'integrations', 'finance-assets', 'analytics', 'exec-home', 'policies', 'home']), new Date().toISOString());
  await new Promise((r) => { srvApp = http.createServer(app).listen(0, '127.0.0.1', r); });
  baseApp = `http://127.0.0.1:${srvApp.address().port}`;
  const ws = express(); ws.use(express.json());
  ws.use(require('../routes/workspace')({ express, sendHtmlPage: (res) => res.send('ok'),
    requireReportSession: async (q, s, next) => { const u = await rdb.validateSession(q.headers['x-report-token']); if (!u) return s.status(401).end(); q.reportUser = u; next(); } }));
  await new Promise((r) => { srvWs = http.createServer(ws).listen(0, '127.0.0.1', r); });
  baseWs = `http://127.0.0.1:${srvWs.address().port}`;
});
after(() => { try { srvApp && srvApp.close(); } catch {} try { srvWs && srvWs.close(); } catch {} });

test('a forged privileged preference is served as the reader profile with no privileged destination', async () => {
  const me = (await req(baseWs, 'GET', '/api/workspace/me', viewerToken)).json;
  assert.equal(me.profile, 'reader');
  assert.equal(me.reason, 'not_allowed_fallback');
  assert.deepEqual(me.eligible, ['reader']);
  const shown = me.destinations.map((d) => d.id);
  for (const id of ['system-logs', 'integrations', 'finance-assets', 'analytics', 'exec-home', 'policies']) assert.ok(!shown.includes(id), id + ' must not be shown');
  assert.deepEqual(shown, ['home', 'dashboard', 'site-actions', 'dashboards']);
});

test('the roles are unchanged — in the session and in /api/reports/auth/me', async () => {
  const rdb = require('../reports-db');
  const s = await rdb.validateSession(viewerToken);
  assert.deepEqual(s.roles, ['viewer']);
  const me = await req(baseApp, 'GET', '/api/reports/auth/me', viewerToken);
  assert.equal(me.status, 200);
  const roles = (me.json.user || me.json).roles;
  assert.deepEqual(roles, ['viewer']);
});

test('the real server still refuses the super_admin and money routes to this viewer', async () => {
  assert.equal((await req(baseApp, 'GET', '/api/reports/system-log', viewerToken)).status, 403);
  assert.equal((await req(baseApp, 'GET', '/api/reports/config', viewerToken)).status, 403);
  assert.equal((await req(baseApp, 'GET', '/api/integrations/analytics', viewerToken)).status, 403);
  assert.equal((await req(baseApp, 'GET', '/api/assets/finance/summary', viewerToken)).status, 403);
});

test('saving a privileged profile through the API is refused; nothing in the code reads the table for access', async () => {
  assert.equal((await req(baseWs, 'PUT', '/api/workspace/prefs', viewerToken, { profile: 'finance' })).status, 400);
  assert.equal((await req(baseWs, 'PUT', '/api/workspace/prefs', viewerToken, { profile: 'administrator' })).status, 400);
  // static guard: only the workspace store reads user_workspace_prefs — no middleware, gate or role helper does
  const root = _path.join(__dirname, '..');
  const hits = [];
  const walk = (d) => {
    for (const e of _fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'tests', 'docs', 'db'].includes(e.name)) continue;
      const p = _path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && _fs.readFileSync(p, 'utf8').includes('user_workspace_prefs')) hits.push(_path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  assert.deepEqual(hits, ['services/workspaceProfiles.js']);
});
