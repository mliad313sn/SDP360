'use strict';
// Governance policies by country / business unit through the real server (committee #49).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gov-groups-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'gg-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'gg-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'gg-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
// committee #49 — country / business-unit scopes: site → country → business unit → platform.
let server, base, rdb, hounde, mana, T = {};
before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sites' AND column_name = 'business_unit'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'gg_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('admin', ['admin']); await mk('viewer', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const put = (t, scope, key, value, reason) => send('PUT', '/api/governance/policies', t, { scope, key, value, reason });
const eff = async (site, key) => (await (await send('GET', `/api/governance/policies/effective?site=${site}`, T.admin)).json()).values[key];

test('a country value applies to its sites, a site value wins, the platform value elsewhere', async () => {
  const hier = (t, id, body) => send('PUT', `/api/governance/sites/${id}/hierarchy`, t, body);
  assert.equal((await hier(T.admin, hounde, { country: 'BF', reason: 'Burkina Faso mine' })).status, 403, 'grouping a site is a super_admin act');
  assert.equal((await hier(T.super, hounde, { country: 'Burkina Faso!', reason: 'Burkina Faso mine' })).status, 400, 'codes only');
  assert.equal((await hier(T.super, hounde, { country: 'bf', business_unit: 'wa', reason: 'Burkina Faso mine' })).status, 200);
  assert.equal((await hier(T.super, mana, { country: 'BF', reason: 'Burkina Faso mine' })).status, 200);
  const v = await (await send('GET', '/api/governance/policies', T.admin)).json();
  assert.deepEqual(v.groups, ['bu:WA', 'country:BF']);
  assert.equal(v.sites.find((s) => s.id === hounde).country, 'BF');
  assert.equal((await put(T.admin, 'country:BF', 'freshness.helpdesk_hours', 2, 'not per country')).status, 400, 'platform-only rules have no country value');
  assert.equal((await put(T.admin, 'country:BF', 'handoffs.reason_min', 12, 'Burkina Faso audit wants longer reasons')).status, 200, 'tightening: admin tier');
  assert.equal(await eff(hounde, 'handoffs.reason_min'), 12); assert.equal(await eff(mana, 'handoffs.reason_min'), 12);
  assert.equal((await put(T.admin, 'bu:WA', 'handoffs.reason_min', 20, 'business unit standard')).status, 200);
  assert.equal(await eff(hounde, 'handoffs.reason_min'), 12, 'country before business unit');
  assert.equal((await put(T.admin, `site:${hounde}`, 'handoffs.reason_min', 15, 'site standard')).status, 200);
  assert.equal(await eff(hounde, 'handoffs.reason_min'), 15, 'site wins'); assert.equal(await eff(mana, 'handoffs.reason_min'), 12);
  // relaxing a protected rule at country level is still a two-person proposal
  assert.equal((await put(T.super, 'country:BF', 'handoffs.reason_min', 4, 'shorter reasons for the whole country')).status, 202);
  // moving Mana out of the country would relax its rule: refused (two-person rule), nothing moved, logged as a risk
  const no = await hier(T.super, mana, { country: '', reason: 'site moved to another country' });
  assert.equal(no.status, 409); assert.deepEqual((await no.json()).relaxed, [{ key: 'handoffs.reason_min', before: 12, after: 5 }]);
  assert.equal(await eff(mana, 'handoffs.reason_min'), 12, 'still in the country');
  const risk = await rdb.db.prepare("SELECT risk FROM system_log WHERE action='site_hierarchy_refused' AND target=? ORDER BY id DESC LIMIT 1").get(`site:${mana}`);
  assert.equal(Number(risk.risk), 1);
  // the way through: keep the stricter value on the site itself, then move
  assert.equal((await put(T.admin, `site:${mana}`, 'handoffs.reason_min', 12, 'keep the country standard')).status, 200);
  const out = await (await hier(T.super, mana, { country: '', reason: 'site moved to another country' })).json();
  assert.deepEqual(out.relaxed, []);
  assert.equal(await eff(mana, 'handoffs.reason_min'), 12);
  assert.equal(await eff(hounde, 'handoffs.reason_min'), 15, 'its own site value stays');
  assert.equal((await send('PUT', '/api/governance/policies', T.admin, { scope: 'region:X1', key: 'handoffs.reason_min', value: 9, reason: 'nope' })).status, 400);
});
