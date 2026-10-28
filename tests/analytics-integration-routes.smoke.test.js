'use strict';
const fetch = require('./_http-fetch');
// Admin ▸ Intégration API ▸ Analytics (2026-10-04): super_admin only, secrets write-only,
// every value labelled with its source (db / env / default), blank secret = keep.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'an-int-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'an-int-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'an-int-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'an-int-key';
process.env.ZOHO_CLIENT_ID = 'env-client-id';
process.env.ZOHO_CLIENT_SECRET = 'env-secret-value';
process.env.ZOHO_REFRESH_TOKEN = 'env-refresh-value';
// defined-but-empty: dotenv never overrides an existing variable, so the real .env of the
// main checkout (which sets WORKSPACE_ID…) cannot leak into the "default" assertions
for (const k of ['WORKSPACE_ID', 'ORG_ID', 'ZOHO_ACCOUNTS_URL']) process.env[k] = '';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {};
const call = (method, p, t, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-report-token': t }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'an-admin', full_name: 'an-admin', password: 'an-admin-0000', roles: ['admin'], site_id: null });
  tok.admin = (await rdb.login('an-admin', 'an-admin-0000')).token;
  const me = (await rdb.listUsers()).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['super_admin']));
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('admin (not super_admin) is refused', async () => {
  assert.equal((await call('GET', '/api/integrations/analytics', tok.admin)).status, 403);
});

test('GET shows .env values as source "env", never a secret', async () => {
  const text = await (await call('GET', '/api/integrations/analytics', tok.super)).text();
  assert.ok(!/env-secret-value|env-refresh-value/.test(text));
  const g = JSON.parse(text);
  assert.equal(g.client_id, 'env-client-id');
  assert.equal(g.sources.clientId, 'env'); assert.equal(g.sources.workspaceId, 'default');
  assert.equal(g.has_client_secret, true); assert.equal(g.ready, true);
});

test('PUT moves a value to the database; blank secret keeps it; GET never echoes it', async () => {
  assert.equal((await call('PUT', '/api/integrations/analytics', tok.super, { refresh_token: 'db-refresh-value', workspace_id: '42' })).status, 200);
  await call('PUT', '/api/integrations/analytics', tok.super, { refresh_token: '' });
  const text = await (await call('GET', '/api/integrations/analytics', tok.super)).text();
  assert.ok(!text.includes('db-refresh-value'));
  const g = JSON.parse(text);
  assert.equal(g.sources.refreshToken, 'db'); assert.equal(g.workspace_id, '42'); assert.equal(g.sources.clientId, 'env');
  const cfg = await (await call('GET', '/api/reports/config', tok.super)).json();
  assert.equal(cfg.analytics_refresh_token, '', 'generic config GET redacts it too');
});

test('a non-https OAuth server is refused', async () => {
  assert.equal((await call('PUT', '/api/integrations/analytics', tok.super, { accounts_url: 'http://x' })).status, 400);
});
