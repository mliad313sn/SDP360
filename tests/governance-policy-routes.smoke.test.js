'use strict';
// Governance policies through the real server: who may read / change / relax, the effective endpoint is
// site-scoped, and a policy change CHANGES behaviour at once (no restart): a site without a second
// publisher may self-publish its dashboard; a longer reason minimum is enforced on handoffs; a shorter
// missed-grace flips a session to "missed"; protected relaxation is logged as a risk.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gov-pol-smoke-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'gp-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'gp-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'gp-key';
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
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'governance_policies'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  hounde = sites.find((s) => /hounde/i.test(s.name)).id; mana = sites.find((s) => /^mana$/i.test(s.name)).id;
  const mk = async (k, roles, site) => { const u = 'gp_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('admin', ['admin']); await mk('member', ['viewer', 'committee-member']);
  await mk('pub', ['editor', 'dashboard-publisher'], hounde); await mk('manaEd', ['editor'], mana); await mk('viewer', ['viewer'], hounde);
  await mk('recv', ['viewer'], hounde);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { 'x-report-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const put = (t, scope, key, value, reason) => send('PUT', '/api/governance/policies', t, { scope, key, value, reason });

test('read / write rights: committee reads, admin writes, protected relaxation needs a super_admin; history + risk log', async () => {
  assert.equal((await send('GET', '/api/governance/policies', T.viewer)).status, 403);
  const v = await (await send('GET', '/api/governance/policies', T.member)).json();
  assert.equal(v.ok, true); assert.equal(v.can_write, false); assert.ok(v.policies.length >= 20);
  assert.equal((await put(T.member, 'global', 'handoffs.reason_min', 8, 'tighter')).status, 403);
  assert.equal((await put(T.admin, `site:${hounde}`, 'publication.four_eyes', false, 'one-person site office')).status, 403);
  const ok = await put(T.super, `site:${hounde}`, 'publication.four_eyes', false, 'one-person site office for now');
  assert.equal(ok.status, 200); assert.equal((await ok.json()).change.relaxes, true);
  const h = await (await send('GET', '/api/governance/policies/history', T.member)).json();
  assert.ok(h.history.some((x) => x.key === 'publication.four_eyes' && x.relaxes));
  const logged = await rdb.db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action='policy_relaxed'").get();
  assert.ok(Number(logged.n) >= 1, 'relaxation logged');
});

test('effective endpoint is scoped to the caller\'s sites', async () => {
  assert.equal((await send('GET', `/api/governance/policies/effective?site=${hounde}`, T.manaEd)).status, 403);
  const e = await (await send('GET', `/api/governance/policies/effective?site=${hounde}`, T.viewer)).json();
  assert.equal(e.values['publication.four_eyes'], false);
  const m = await (await send('GET', `/api/governance/policies/effective?site=${mana}`, T.manaEd)).json();
  assert.equal(m.values['publication.four_eyes'], true);
});

test('behaviour follows the policy at once: a site dashboard can be self-published where four-eyes is off', async () => {
  const def = { key: 'gp-dash', title: 'GP', audience: 'site', grid: { columns: 12 }, widgets: [{ id: 'a', type: 'kpi', metric: 'assets.total', title: 'A', layout: { x: 0, y: 0, w: 3, h: 2 } }] };
  assert.equal((await send('PUT', '/api/dashboards/gp-dash', T.pub, { definition: def })).status, 200);
  assert.equal((await send('POST', '/api/dashboards/gp-dash/publish', T.pub, {})).status, 200, 'Hounde has four-eyes off');
  await put(T.admin, `site:${hounde}`, 'publication.four_eyes', null, 'second publisher appointed');
  await send('PUT', '/api/dashboards/gp-dash', T.pub, { definition: { ...def, title: 'GP v2' } });
  assert.equal((await send('POST', '/api/dashboards/gp-dash/publish', T.pub, {})).status, 409, 'back to four-eyes once cleared');
});

test('handoff reason minimum and missed grace follow the policy', async () => {
  await require('../services/reportConfig').setConfig(rdb.db, { handoffs_enabled: '1' }, 'test');
  const depts = (await rdb.listDepartments()).map((d) => d.name);
  const pubId = (await rdb.db.prepare("SELECT id FROM users WHERE username='gp_pub'").get()).id;
  const h = (await (await send('POST', '/api/handoffs', T.pub, { title: 'x', site_id: hounde, from_department: depts[0], to_department: depts[1], receiver: 'gp_recv' })).json()).handoff;
  await put(T.admin, `site:${hounde}`, 'handoffs.reason_min', 20, 'need real explanations here');
  const r = await send('POST', `/api/handoffs/${h.id}/transition`, T.recv, { to: 'rejected', version: h.version, reason: 'not ours, sorry' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /20\+ characters/);
  void pubId;
  // meetings: 6 h grace makes a session planned 10 h ago missed
  const c = await (await send('PUT', '/api/governance/cadences', T.admin, { key: 'gp-cad', name: 'GP', kind: 'site_weekly', site_id: hounde })).json();
  const s = (await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, T.admin, { scheduled_at: new Date(Date.now() - 10 * 3600e3).toISOString() })).json()).session;
  assert.equal((await (await send('GET', `/api/governance/sessions/${s.id}`, T.admin)).json()).session.stage, 'planned');
  await put(T.admin, `site:${hounde}`, 'meetings.missed_grace_hours', 6, 'weekly site meetings start on time');
  assert.equal((await (await send('GET', `/api/governance/sessions/${s.id}`, T.admin)).json()).session.stage, 'missed');
});

test('bounds are enforced and platform-only rules refuse a site value', async () => {
  assert.equal((await put(T.super, 'global', 'meetings.missed_grace_hours', 0, 'never miss')).status, 400);
  assert.equal((await put(T.super, `site:${hounde}`, 'freshness.helpdesk_hours', 1, 'site value')).status, 400);
  assert.equal((await put(T.super, 'site:abc', 'handoffs.reason_min', 6, 'bad scope')).status, 400);
});
