'use strict';
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'asset-rem-route-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'asset-review-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'asset-review-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'asset-review-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb;
const tok = {};
const post = (p, t) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-report-token': t }, body: '{}' });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  const adb = require('../assets-db');
  const COLS = ['asset_id', 'asset_name', 'site', 'state', 'user_name', 'department', 'purchase_cost', 'acquisition_date'];
  adb.replaceTable('assets', COLS, [{ asset_id: 'U1', asset_name: 'U', site: 'Hounde', state: 'In Use', user_name: '', department: '', purchase_cost: '5', acquisition_date: '2024-01-01' }]);
  adb.recordAssetSightings({});
  require('../services/reportDirectory').upsertRecipient(rdb.db, 'HGO',
    { coordinator_email: 'coord@edv-ops.com', coordinator_email_confirmed: 1, active: 1 }, 'seed');
  const me = rdb.listUsers().find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'rem-admin', full_name: 'a', password: 'rem-admin-0000', roles: ['admin'] });
  tok.admin = (await rdb.login('rem-admin', 'rem-admin-0000')).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('admin (non super_admin) → 403', async () => {
  assert.strictEqual((await post('/api/reports/asset-reminders/send?type=asset_reminder&preview=1', tok.admin)).status, 403);
});

test('unknown type → 400', async () => {
  assert.strictEqual((await post('/api/reports/asset-reminders/send?type=nope&preview=1', tok.super)).status, 400);
});

test('super_admin preview (disarmed) composes for the site, sends nothing', async () => {
  const r = await post('/api/reports/asset-reminders/send?type=asset_reminder&site=HGO&preview=1', tok.super);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.previewed, true);
  assert.deepStrictEqual(j.previews.map(p => [p.site, p.to]), [['HGO', 'coord@edv-ops.com']]);
});

test('disarmed Send now → sent 0, reason disabled', async () => {
  const j = await (await post('/api/reports/asset-reminders/send?type=asset_new_alert&preview=0', tok.super)).json();
  assert.deepStrictEqual([j.sent, j.reason], [0, 'disabled']);
});
