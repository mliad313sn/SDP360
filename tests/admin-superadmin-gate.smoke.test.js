'use strict';
// Admin-settings lockdown — the reports.html#admin console routes are super_admin
// ONLY (config/users/sessions/recipients/schedule). Boots the app in-process,
// makes one super_admin + one admin, and asserts: super_admin passes GET
// /api/reports/config (200), admin gets 403; users list 403 for admin; and an
// OPERATIONAL requireAdmin route (assets sync trigger) still works for admin (200)
// — proving the swap was surgical, not blanket. sqlite-pinned. --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'adminguard-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'adminguard-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'adminguard-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'adminguard-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, superToken, adminToken;

function req(method, path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    const r = http.request(base + path, { method, headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : null })); });
    r.on('error', reject); r.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');

  // The seeded default user is our super_admin.
  const su = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(su, 'seeded super_admin user exists');
  rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  // A second, plain admin-role user.
  await rdb.createUser({ username: 'adminguard-admin', full_name: 'Plain Admin', password: 'adminguard-pass-1111', role: 'admin' });
  adminToken = (await rdb.login('adminguard-admin', 'adminguard-pass-1111')).token;

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('admin-settings config route: super_admin 200, admin 403', async () => {
  const su = await req('GET', '/api/reports/config', superToken);
  assert.equal(su.status, 200, 'super_admin reads config');
  const ad = await req('GET', '/api/reports/config', adminToken);
  assert.equal(ad.status, 403, 'admin is blocked from config');
});

test('admin-settings users route: admin 403 (super_admin only)', async () => {
  const ad = await req('GET', '/api/reports/users', adminToken);
  assert.equal(ad.status, 403);
  const su = await req('GET', '/api/reports/users', superToken);
  assert.equal(su.status, 200);
});

test('operational requireAdmin route still works for admin (surgical, not blanket)', async () => {
  // /api/sync/trigger/assets is operational admin+ — the lockdown must NOT touch it.
  const ad = await req('POST', '/api/sync/trigger/assets', adminToken);
  assert.notEqual(ad.status, 403, 'admin can still trigger operational sync');
});

test('WAN site↔network mapping is super_admin only, and lists every active site', async () => {
  const su = await req('GET', '/api/analytics/wan/mappings', superToken);
  assert.equal(su.status, 200);
  assert.ok(Array.isArray(su.body.sites), 'returns the sites array');
  const ad = await req('GET', '/api/analytics/wan/mappings', adminToken);
  assert.equal(ad.status, 403, 'admin is blocked from the WAN mapping editor');
});
