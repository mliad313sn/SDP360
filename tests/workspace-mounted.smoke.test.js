'use strict';
// R1-PROFILES wiring — the real server.js mounts routes/workspace.js. The route tests build their own express
// app, so a mount left inside a trailing `//` comment of server.js passed them all while the feature answered
// 404 for good. Off → 404; on → the signed-in user's workspace is served.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wsm-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'wsm-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'wsm-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wsm-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok;
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'wsm-viewer', full_name: 'wsm-viewer', password: 'wsm-viewer-pass-0000' });
  const u = ((await rdb.listUsers()) || []).find((x) => x.username === 'wsm-viewer');
  await rdb.setUserRoles(u.id, ['viewer']);
  tok = (await rdb.login('wsm-viewer', 'wsm-viewer-pass-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const get = (p) => fetch(base + p, { headers: { 'x-report-token': tok } });

test('switch off: /api/workspace/me answers 404 (today)', async () => {
  const r = await get('/api/workspace/me');
  assert.equal(r.status, 404);
});

test('switch on: the real server serves /api/workspace/me and the settings page', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { workspace_profiles_enabled: '1' }, 'test');
  await new Promise((r) => setTimeout(r, 50));
  let r = await get('/api/workspace/me');
  if (r.status === 404) { await new Promise((res) => setTimeout(res, 1100)); r = await get('/api/workspace/me'); }
  assert.equal(r.status, 200, 'mounted in server.js');
  const p = await get('/workspace-settings.html');
  assert.equal(p.status, 200);
});
