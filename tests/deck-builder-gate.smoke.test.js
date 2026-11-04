'use strict';
// C-28 (PO decision P12) — the server routes the Deck Builder page writes to (exec-editorial GET/PUT,
// exec-pptx, the group-discovery list) follow report_config ui_deck_builder_roles like the page gate:
// default = today (admin floor, report-author refused); 'super_admin,report-author' admits report-author.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'deck-gate-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'dg-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'dg-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'dg-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, tok = {}, rdb, reportConfig;
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  const mk = async (u, roles) => {
    await rdb.createUser({ username: u, full_name: u, password: u + '-pw-0000', roles });
    tok[u] = (await rdb.login(u, u + '-pw-0000')).token;
  };
  await mk('dg-author', ['viewer', 'report-author']);
  await mk('dg-admin', ['admin']);
  await mk('dg-editor', ['editor']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  try { await reportConfig.setConfig(rdb.db, { ui_deck_builder_roles: 'super_admin' }, 'test'); } catch (_) { /* best effort */ }
  try { server && server.close(); } catch {}
});
const ED = '/api/reports/exec-editorial?period=2026-07&scope=ops';
const get = (p, t) => fetch(base + p, { headers: { 'x-report-token': t } });
const put = (p, t, body) => fetch(base + p, { method: 'PUT', headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('default (super_admin): today\'s gate — admin passes, report-author and editor refused', async () => {
  await reportConfig.setConfig(rdb.db, { ui_deck_builder_roles: 'super_admin' }, 'test');
  assert.equal((await get(ED, tok['dg-admin'])).status, 200);
  assert.equal((await get(ED, tok['dg-author'])).status, 403);
  assert.equal((await put(ED, tok['dg-author'], { payload: { goal: 'x' } })).status, 403);
  assert.equal((await get(ED, tok['dg-editor'])).status, 403);
  assert.equal((await get('/api/dashboard/groups/discovered?scope=tickets', tok['dg-author'])).status, 403);
});

test('widened (super_admin,report-author): report-author reads and writes the deck editorial; editor still refused', async () => {
  await reportConfig.setConfig(rdb.db, { ui_deck_builder_roles: 'super_admin,report-author' }, 'test');
  assert.equal((await put(ED, tok['dg-author'], { payload: { goal: 'author' } })).status, 200);
  const r = await get(ED, tok['dg-author']);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).payload.goal, 'author');
  assert.equal((await get(ED, tok['dg-admin'])).status, 200, 'admin floor kept');
  assert.equal((await get(ED, tok['dg-editor'])).status, 403);
  assert.notEqual((await fetch(base + '/api/reports/exec-pptx', { method: 'POST', headers: { 'x-report-token': tok['dg-editor'], 'content-type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal((await fetch(base + '/api/reports/exec-pptx', { method: 'POST', headers: { 'x-report-token': tok['dg-editor'], 'content-type': 'application/json' }, body: '{}' })).status, 403);
});
