'use strict';
// DEC-4 — the site-code registry vs the hard-coded maps: diff, fill, switch (off by default).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'site-codes-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'sc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sc-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sc-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, T = {};
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name));
  const mk = async (k, roles, site) => { const u = 'sc_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('admin', ['admin']); await mk('viewer', ['viewer'], hounde.id);
  await require('../services/siteCodeRegistry').refresh(rdb);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('off by default: the hard-coded map answers; the diff shows where the registry differs', async () => {
  const tdb = require('../tracker-db');
  const hard = tdb.hardSiteNameToCode(hounde.name);
  assert.ok(hard, 'Hounde has a hard-coded tracker code');
  assert.equal(tdb.siteNameToCode(hounde.name), hard);
  assert.equal((await send('GET', '/api/governance/site-codes', T.viewer)).status, 403);
  const v = await (await send('GET', '/api/governance/site-codes', T.admin)).json();
  assert.equal(v.enabled, false); assert.ok(Array.isArray(v.diff));
  // fill the registry with a different tracker code, switch on: the registry wins; off again: the map
  assert.equal((await send('PUT', `/api/governance/site-codes/${hounde.id}`, T.admin, { module: 'tracker', code: 'HGX', reason: 'new code' })).status, 403, 'super_admin only');
  assert.equal((await send('PUT', `/api/governance/site-codes/${hounde.id}`, T.super, { module: 'nope', code: 'HGX', reason: 'new code' })).status, 400);
  assert.equal((await send('PUT', `/api/governance/site-codes/${hounde.id}`, T.super, { module: 'tracker', code: 'HGX', reason: 'registry is now the source' })).status, 200);
  const d = await (await send('GET', '/api/governance/site-codes', T.admin)).json();
  assert.ok(d.diff.some((x) => x.module === 'tracker' && x.site_id === hounde.id && x.registry === 'HGX' && x.hard_coded === hard && x.kind === 'different'));
  assert.equal(tdb.siteNameToCode(hounde.name), hard, 'still off: registry not consulted');
  assert.equal((await send('PUT', '/api/governance/site-codes', T.super, { enabled: true, reason: 'short' })).status, 400);
  const on = await (await send('PUT', '/api/governance/site-codes', T.super, { enabled: true, reason: 'committee reviewed the differences' })).json();
  assert.equal(on.enabled, true); assert.ok(on.open_differences >= 1);
  assert.equal(tdb.siteNameToCode(hounde.name), 'HGX', 'registry wins');
  const risk = await rdb.db.prepare("SELECT risk FROM system_log WHERE action='site_registry_enabled' ORDER BY id DESC LIMIT 1").get();
  assert.equal(Number(risk.risk), 1, 'switched on with differences left = a risk event');
  await send('PUT', '/api/governance/site-codes', T.super, { enabled: false, reason: 'back to the hard-coded maps' });
  assert.equal(tdb.siteNameToCode(hounde.name), hard);
});
