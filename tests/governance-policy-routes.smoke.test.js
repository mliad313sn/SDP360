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
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']); await mk('admin', ['admin']); await mk('member', ['viewer', 'committee-member']);
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
  // dual approval: the first super_admin only proposes (202); the same person cannot approve; a second one does
  const ok = await put(T.super, `site:${hounde}`, 'publication.four_eyes', false, 'one-person site office for now');
  assert.equal(ok.status, 202); const prop = (await ok.json()).pending; assert.ok(prop && prop.id);
  const pl = await (await send('GET', '/api/governance/policies/proposals', T.member)).json();
  assert.ok(pl.proposals.some((x) => x.id === prop.id));
  assert.equal((await send('POST', `/api/governance/policies/proposals/${prop.id}/approve`, T.super, { reason: 'self approve' })).status, 403);
  assert.equal((await send('POST', `/api/governance/policies/proposals/${prop.id}/approve`, T.admin, { reason: 'admin approve' })).status, 403);
  const ap = await send('POST', `/api/governance/policies/proposals/${prop.id}/approve`, T.super2, { reason: 'agreed until a second person is hired' });
  assert.equal(ap.status, 200);
  const proposed = await rdb.db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action='policy_relaxation_proposed'").get();
  assert.ok(Number(proposed.n) >= 1, 'proposal logged');
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
  const missedBefore = (await (await send('GET', '/api/governance/overview', T.admin)).json()).compliance_30d.missed;
  await put(T.admin, `site:${hounde}`, 'meetings.missed_grace_hours', 6, 'weekly site meetings start on time');
  assert.equal((await (await send('GET', `/api/governance/sessions/${s.id}`, T.admin)).json()).session.stage, 'missed');
  // the overview judges each cadence with its own site's policy (committee QA P1-7) — same answer as the detail
  assert.equal((await (await send('GET', '/api/governance/overview', T.admin)).json()).compliance_30d.missed, missedBefore + 1);
});

test('bounds are enforced and platform-only rules refuse a site value', async () => {
  assert.equal((await put(T.super, 'global', 'meetings.missed_grace_hours', 0, 'never miss')).status, 400);
  assert.equal((await put(T.super, `site:${hounde}`, 'freshness.helpdesk_hours', 1, 'site value')).status, 400);
  assert.equal((await put(T.super, 'site:abc', 'handoffs.reason_min', 6, 'bad scope')).status, 400);
});

test('oversight register: relaxations and deviations, JSON and CSV; committee only', async () => {
  assert.equal((await send('GET', '/api/governance/oversight', T.viewer)).status, 403);
  const o = await (await send('GET', '/api/governance/oversight', T.member)).json();
  assert.ok(o.relaxations.some((x) => x.key === 'publication.four_eyes'));
  assert.ok(Array.isArray(o.deviations));
  const csv = await send('GET', '/api/governance/oversight?format=csv', T.member);
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type') || '', /csv/);
  assert.match(await csv.text(), /publication\.four_eyes/);
});

test('sync health and publication read the same freshness limit (committee architect P1-3)', async () => {
  assert.equal((await put(T.admin, 'global', 'freshness.assets_hours', 4, 'assets sync runs every 2 h now')).status, 200);
  const h = await (await send('GET', '/api/sync/health', T.admin)).json();
  const job = (h.jobs || []).find((j) => j.job === 'assets.sync');
  assert.ok(job, 'assets.sync listed'); assert.equal(job.freshness_hours, 4);
});

test('meetings.reopen_two_people and meetings.group_decisions_public change behaviour at once', async () => {
  // a group (site-less) cadence with a decision, and accepted minutes
  const c = await (await send('PUT', '/api/governance/cadences', T.admin, { key: 'gp-grp', name: 'Group committee', kind: 'committee', participants: [] })).json();
  const s = (await (await send('POST', `/api/governance/cadences/${c.cadence.id}/sessions`, T.admin, { scheduled_at: new Date(Date.now() + 864e5).toISOString() })).json()).session;
  await send('POST', `/api/governance/sessions/${s.id}/start`, T.admin);
  const d = (await (await send('POST', `/api/governance/sessions/${s.id}/decisions`, T.admin, { title: 'Group-only decision' })).json()).decision;
  await send('POST', `/api/governance/sessions/${s.id}/close`, T.admin);
  assert.equal((await send('POST', `/api/governance/sessions/${s.id}/accept`, T.super)).status, 200);
  // decisions of group sessions: public by default, restricted once the policy says so
  const seen = async () => ((await (await send('GET', '/api/governance/decisions', T.viewer)).json()).decisions || []).some((x) => x.id === d.id);
  assert.equal(await seen(), true);
  assert.equal((await put(T.admin, 'global', 'meetings.group_decisions_public', false, 'committee decisions stay with the committee')).status, 200);
  assert.equal(await seen(), false);
  // two-person reopening
  assert.equal((await put(T.admin, 'global', 'meetings.reopen_two_people', true, 'audit asked for two people')).status, 200);
  const r1 = await send('POST', `/api/governance/sessions/${s.id}/reopen`, T.admin, { reason: 'decision text was wrong' });
  assert.equal(r1.status, 202);
  assert.equal((await send('POST', `/api/governance/sessions/${s.id}/reopen`, T.admin, { reason: 'decision text was wrong' })).status, 409, 'the requester cannot confirm');
  const r2 = await send('POST', `/api/governance/sessions/${s.id}/reopen`, T.super, { reason: 'confirmed, text was wrong' });
  assert.equal(r2.status, 200); assert.equal((await r2.json()).session.stage, 'held');
});

test('site profiles: every value is a valid site rule; applying one goes through the guardrails', async () => {
  const GP = require('../services/governancePolicy'); const Pr = require('../services/governanceProfiles');
  assert.deepEqual(Pr.validateProfiles(GP), []);
  const list = await (await send('GET', '/api/governance/profiles', T.member)).json();
  assert.deepEqual(list.profiles.map((p) => p.name).sort(), ['large_mine', 'office', 'small_site']);
  assert.equal((await send('POST', '/api/governance/policies/profile', T.member, { site_id: mana, profile: 'small_site', reason: 'one IT person' })).status, 403);
  const r = await (await send('POST', '/api/governance/policies/profile', T.admin, { site_id: mana, profile: 'small_site', reason: 'one IT person at Mana' })).json();
  const by = Object.fromEntries(r.results.map((x) => [x.key, x]));
  assert.equal(by['meetings.missed_grace_hours'].result, 'error', 'lengthening a protected grace is a relaxation: an admin cannot');
  assert.equal(by['handoffs.escalation_grace_days'].result, 'error');
  assert.equal(by['publication.four_eyes'].result, 'unchanged');
  const s = await (await send('POST', '/api/governance/policies/profile', T.super, { site_id: mana, profile: 'small_site', reason: 'one IT person at Mana' })).json();
  const bs = Object.fromEntries(s.results.map((x) => [x.key, x]));
  assert.equal(bs['meetings.minutes_four_eyes'].result, 'pending', 'a relaxation becomes a two-person proposal');
  assert.equal(bs['meetings.missed_grace_hours'].result, 'pending');
});

test('governance.dual_approval_tightening: once on, tightening a protected rule is a proposal too', async () => {
  assert.equal((await put(T.admin, 'global', 'governance.dual_approval_tightening', true, 'large changes need two people')).status, 200);
  const r = await put(T.admin, 'global', 'freshness.survey_hours', 1, 'survey every hour');
  assert.equal(r.status, 202); assert.equal((await r.json()).change.relaxes, false);
  const v = await (await send('GET', '/api/governance/policies/effective', T.admin)).json();
  assert.equal(v.values['freshness.survey_hours'], 3, 'unchanged until a second person approves');
});
