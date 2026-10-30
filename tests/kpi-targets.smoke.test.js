'use strict';
// Committee #40 — KPI targets per site through the real server: who sets them, site → platform resolution,
// the value against its target, history kept.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'kpi-targets-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'kt-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'kt-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'kt-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, mana, T = {};
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'kpi_site_targets'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'kt_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('admin', ['admin']); await mk('viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const KEY = 'meetings.overdue_issues';

test('per-site target wins over the platform target; none = no target, as before', async () => {
  let m = await (await send('GET', `/api/metrics/${KEY}?site=${hounde}`, T.viewer)).json();
  assert.equal(m.ok, true); assert.equal(m.target, null); assert.equal(m.vs_target.rag, 'NA', 'no target = no verdict');
  assert.equal((await send('POST', '/api/metrics/targets', T.admin, { metric_key: KEY, target: 3, reason: 'group standard' })).status, 403, 'targets are a super_admin decision');
  assert.equal((await send('POST', '/api/metrics/targets', T.super, { metric_key: 'nope', target: 3, reason: 'group standard' })).status, 400);
  assert.equal((await send('POST', '/api/metrics/targets', T.super, { metric_key: KEY, target: 'x', reason: 'group standard' })).status, 400);
  assert.equal((await send('POST', '/api/metrics/targets', T.super, { metric_key: KEY, target: 3, reason: 'group standard' })).status, 201);
  const s = await (await send('POST', '/api/metrics/targets', T.super, { metric_key: KEY, site_id: hounde, target: 1, reason: 'Hounde agreed a tighter target' })).json();
  m = await (await send('GET', `/api/metrics/${KEY}?site=${hounde}`, T.viewer)).json();
  assert.equal(m.target, 1); assert.equal(m.target_source, 'site');
  m = await (await send('GET', `/api/metrics/${KEY}?site=${mana}`, T.admin)).json();
  assert.equal(m.target, 3); assert.equal(m.target_source, 'platform');
  // replacing a target ends the previous one (kept), one live target per metric × scope
  assert.equal((await send('POST', '/api/metrics/targets', T.super, { metric_key: KEY, site_id: hounde, target: 2, reason: 'revised at the quarterly review' })).status, 201);
  const list = (await (await send('GET', '/api/metrics/targets', T.viewer)).json()).targets.filter((t) => t.metric_key === KEY);
  assert.equal(list.length, 2);
  assert.equal(Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM kpi_site_targets WHERE metric_key=?').get(KEY)).n), 3, 'the replaced target is kept');
  const hid = list.find((t) => t.site_id === hounde).id;
  assert.equal((await send('POST', `/api/metrics/targets/${hid}/end`, T.super, { reason: 'site back on the group standard' })).status, 200);
  m = await (await send('GET', `/api/metrics/${KEY}?site=${hounde}`, T.viewer)).json();
  assert.equal(m.target, 3); assert.equal(m.target_source, 'platform');
  const ev = await rdb.db.prepare("SELECT action FROM governance_role_events WHERE entity='kpi_target' ORDER BY id").all();
  assert.deepEqual(ev.map((e) => e.action), ['set', 'set', 'replaced', 'set', 'ended']);
  void s;
});

test('vs_target: higher-is-better ratio, lower-is-better inverse, no verdict on nothing', () => {
  const K = require('../services/kpiTargets');
  assert.deepEqual(K.vsTarget(95, 100), { attainment: 0.95, rag: 'AMBER' });
  assert.deepEqual(K.vsTarget(100, 100), { attainment: 1, rag: 'GREEN' });
  assert.equal(K.vsTarget(4, 2, false).rag, 'RED', 'twice the allowed overdue issues');
  assert.equal(K.vsTarget(0, 2, false).rag, 'GREEN', 'zero overdue against a target of two');
  assert.equal(K.vsTarget(null, 2).rag, 'NA'); assert.equal(K.vsTarget(5, null).rag, 'NA');
});
