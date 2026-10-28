'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// RBAC audit 2026-10-02, lot 2 (docs/superpowers/plans/2026-10-02-rbac-site-scope-audit.md):
//   A1  GET /api/tracker/load was admin-only while the save accepts tracker-editor — a
//       coordinator demoted to editor + tracker-editor could not open the page it may save.
//   B1  the client locked the site picker from __authUser.site_name, a field the session
//       user does not carry: the lock never applied and edits typed on another site were
//       silently dropped by the save. The load now returns the caller's tracker scope.
//   A2  POST /api/tracker/export was admin-only while the button shows for tracker-admin.
// Throwaway sqlite; boots the app in-process.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'tracker-load-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'tracker-load-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'tracker-load-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'tracker-load-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const load = (t) => fetch(base + '/api/tracker/load', { headers: H(t) });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  if (!(await rdb.listSites()).some(s => s.name === 'Hounde')) (await rdb.createSite({ name: 'Hounde', zoho_group: 'Hounde IT Agents' }));
  const hounde = (await rdb.listSites()).find(s => s.name === 'Hounde');
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.coord   = await mk('tl-coord',   ['editor', 'tracker-editor'], hounde.id);   // demoted coordinator
  tok.tadmin  = await mk('tl-tadmin',  ['viewer', 'tracker-admin'], null);
  tok.viewer  = await mk('tl-viewer',  ['viewer'], hounde.id);
  tok.admin   = await mk('tl-admin',   ['admin'], hounde.id);
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('A1 an editor + tracker-editor coordinator can load the tracker (200)', async () => {
  const r = await load(tok.coord);
  assert.equal(r.status, 200);
});
test('B1 the load tells a tracker-editor its own site scope', async () => {
  const body = await (await load(tok.coord)).json();
  assert.equal(body.scope, 'HGO');
});
test('B1 an unrestricted account gets no scope (all sites)', async () => {
  const body = await (await load(tok.tadmin)).json();
  assert.equal(body.scope, null);
});
test('A1 a tracker-admin without the admin tier can load the tracker (200)', async () => {
  const r = await load(tok.tadmin);
  assert.equal(r.status, 200);
});
test('A1 an admin still loads the tracker (200, unscoped)', async () => {
  const r = await load(tok.admin);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).scope, null);
});
test('A1 a plain viewer still cannot load the tracker (403)', async () => {
  const r = await load(tok.viewer);
  assert.equal(r.status, 403);
});
test('A2 a tracker-admin without the admin tier is not refused the export (not 403)', async () => {
  const r = await fetch(base + '/api/tracker/export', { method: 'POST', headers: H(tok.tadmin), body: JSON.stringify({}) });
  assert.notEqual(r.status, 403);
});
