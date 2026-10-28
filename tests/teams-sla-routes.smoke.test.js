'use strict';
const fetch = require('./_http-fetch');
// Teams SLA alerts — /api/teams-sla/* (super_admin). Webhook URLs and API secrets are
// written, never read back: GET says WHICH groups are mapped and WHETHER a secret is set.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'teams-sla-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'teams-sla-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'teams-sla-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'teams-sla-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, tok = {};
const call = (method, p, t, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'x-report-token': t }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'ts-admin', full_name: 'ts-admin', password: 'ts-admin-0000', roles: ['admin'], site_id: null });
  tok.admin = (await rdb.login('ts-admin', 'ts-admin-0000')).token;
  const me = (await rdb.listUsers()).find(u => u.username === process.env.DASH_USER);
  (await rdb.setUserRoles(me.id, ['super_admin']));
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  (await rdb.db.prepare(`INSERT INTO request_records (request_id, tech_group, created_time) VALUES ('r1','Hounde IT Agents', ?)`).run(new Date().toISOString()));
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('admin (not super_admin) is refused', async () => {
  assert.equal((await call('GET', '/api/teams-sla/settings', tok.admin)).status, 403);
});

test('PUT stores secrets + channels; GET never returns them', async () => {
  const put = await call('PUT', '/api/teams-sla/settings', tok.super, {
    enabled: true, sdp_api_client_id: 'cid', sdp_api_client_secret: 'S3CRET', sdp_api_refresh_token: 'RTOK',
    rules: { res_soon_pct: 80 },
    channels: [{ group: 'Hounde IT Agents', url: 'https://prod.webhook.office.com/hounde-xyz' }],
  });
  assert.equal(put.status, 200);
  const text = await (await call('GET', '/api/teams-sla/settings', tok.super)).text();
  assert.ok(!/S3CRET|RTOK|hounde-xyz/.test(text), 'no secret in the GET');
  const g = JSON.parse(text);
  assert.equal(g.enabled, true);
  assert.equal(g.has_client_secret, true); assert.equal(g.has_refresh_token, true);
  assert.equal(g.sdp_api_client_id, 'cid');
  assert.equal(g.rules.res_soon_pct, 80);
  assert.deepEqual(g.channels, [{ group: 'Hounde IT Agents', configured: true }]);
  assert.ok(g.known_groups.includes('Hounde IT Agents'));
  // the generic config GET redacts them too
  const cfg = await (await call('GET', '/api/reports/config', tok.super)).json();
  assert.equal(cfg.teams_sla_channels, ''); assert.equal(cfg.sdp_api_client_secret, '');
});

test('a blank URL / secret keeps the stored one; a group left out is removed', async () => {
  await call('PUT', '/api/teams-sla/settings', tok.super, {
    sdp_api_client_secret: '', channels: [{ group: 'Hounde IT Agents', url: '' }, { group: 'Mana IT Agents', url: 'https://w.webhook.office.com/mana' }],
  });
  const rc = require('../services/reportConfig');
  const c = await rc.getConfig(rdb.db);
  assert.equal(c.sdp_api_client_secret, 'S3CRET');
  assert.deepEqual(JSON.parse(c.teams_sla_channels), [
    { group: 'Hounde IT Agents', url: 'https://prod.webhook.office.com/hounde-xyz' }, { group: 'Mana IT Agents', url: 'https://w.webhook.office.com/mana' }]);
  await call('PUT', '/api/teams-sla/settings', tok.super, { channels: [{ group: 'Mana IT Agents', url: '' }] });
  assert.deepEqual(JSON.parse((await rc.getConfig(rdb.db)).teams_sla_channels).map(c => c.group), ['Mana IT Agents']);
});

test('validation: non-https webhook, a new group without URL, bad rules → 400', async () => {
  assert.equal((await call('PUT', '/api/teams-sla/settings', tok.super, { channels: [{ group: 'X', url: 'http://plain' }] })).status, 400);
  assert.equal((await call('PUT', '/api/teams-sla/settings', tok.super, { channels: [{ group: 'Nouveau', url: '' }] })).status, 400);
  assert.equal((await call('PUT', '/api/teams-sla/settings', tok.super, { rules: '{not json' })).status, 400);
});

// M4 — a webhook that points inside the network is refused at save time; the stored list is untouched.
test('M4: a private / loopback webhook URL is refused with 400 and the stored channels are unchanged', async () => {
  const rc = require('../services/reportConfig');
  const before = (await rc.getConfig(rdb.db)).teams_sla_channels;
  for (const url of ['https://10.20.30.40/hook', 'https://127.0.0.1:8443/hook', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/hook', 'https://localhost/hook']) {
    const r = await call('PUT', '/api/teams-sla/settings', tok.super, { channels: [{ group: 'Mana IT Agents', url }] });
    assert.equal(r.status, 400, url);
    assert.match((await r.json()).error, /refused|private|loopback|metadata|local/i);
  }
  assert.equal((await call('PUT', '/api/teams-sla/settings', tok.super, { sdp_api_base_url: 'https://192.168.1.10/app/itdesk/api/v3' })).status, 400);
  assert.equal((await rc.getConfig(rdb.db)).teams_sla_channels, before, 'stored channels unchanged');
  // the change is journalled as scheme+host only (never the full webhook path)
  const rows = await rdb.listSystemLog({ action: 'config_url_changed' }, { limit: 50 });
  const row = (rows.rows || rows).find(r => /teams_sla_channels/.test(String(r.target)));
  assert.ok(row, 'a config_url_changed row exists for the channel');
  assert.ok(!/hounde-xyz|\/mana/.test(String(row.details)), 'details carry scheme+host only');
});

test('test card: unknown group → 404', async () => {
  assert.equal((await call('POST', '/api/teams-sla/test', tok.super, { group: 'Nope' })).status, 404);
});

test('preview never throws and reports why it cannot run', async () => {
  await call('PUT', '/api/teams-sla/settings', tok.super, { sdp_api_client_id: '' });
  const r = await (await call('POST', '/api/teams-sla/preview', tok.super)).json();
  assert.equal(r.skipped, 'sdp_api_not_configured');
});
