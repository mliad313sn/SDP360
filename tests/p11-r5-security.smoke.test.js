'use strict';
// P11 round 5, security seat — repros of the reviewer's probes (r5-probe test 1 / test 8, r5-takeover), through the
// real server:
//   N-R5-1  PUT /api/teams-sla/settings {enabled:true} armed the four-eyes switch teams_sla_enabled alone while the
//           Policy Center is on → now a typed 409 pointing to the Policy Center (disarming stays immediate);
//   N-R5-2  one super_admin resets a second account's password and approves their own Policy Center request / Lot 5
//           decision with it → the approver is not independent (credential control), refused;
//   N-R5-5  an administrator's password reset revokes every session of the target.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p11r5-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'p11r5-root';
process.env.DASH_PASS = process.env.DASH_PASS || 'p11r5-root-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p11r5-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
process.env.SDP_CONFIG_KEY = process.env.SDP_CONFIG_KEY || 'p11-test-config-key-0123456789abcdef';   // P11 r9 R9-A2: requests carry an origin signature keyed from it

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC; const T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'policy_change_requests'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const root = await rdb.db.prepare('SELECT id FROM users WHERE username = ?').get(process.env.DASH_USER);
  const mk = async (k, roles) => {
    const u = 'p11r5_' + k;
    try { await rdb.createUser({ username: u, full_name: u, password: u + '-pass-0000', roles }); } catch {}
    ID[k] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username = ?').get(u)).id);
    // established accounts created by the root admin (outside the cooling-off window, named author)
    await rdb.db.prepare("UPDATE users SET created_at = now() - interval '30 days' WHERE id = ?").run(ID[k]);
    await rdb.db.prepare("INSERT INTO system_log (ts, category, action, actor, actor_id, target, details) VALUES (?, 'identity', 'user_created', 'root', ?, ?, ?)").run(new Date(Date.now() - 30 * 864e5).toISOString(), root ? Number(root.id) : null, u, JSON.stringify({ after: { roles } }));
    T[k] = (await rdb.login(u, u + '-pass-0000')).token;
  };
  await mk('s1', ['super_admin']); await mk('s2', ['super_admin']); await mk('s3', ['super_admin']);
  await mk('c1', ['viewer', 'committee-member']); await mk('c2', ['viewer', 'committee-member']);
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', teams_sla_enabled: '0' }, 'test');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const cfg = async () => RC.getConfig(rdb.db);

test('N-R5-1: the Teams SLA card cannot arm teams_sla_enabled alone while the Policy Center is on', async () => {
  const r = await send('PUT', '/api/teams-sla/settings', T.s1, { enabled: true });
  assert.strictEqual(r.status, 409, 'refused');
  const j = await r.json();
  assert.strictEqual(j.code, 'CONFLICT'); assert.match(j.error, /policy-center/); assert.match(j.error, /teams_sla_enabled/);
  assert.strictEqual((await cfg()).teams_sla_enabled, '0', 'nothing written');
  // a save that re-sends the unchanged switch with other fields still works
  const ok = await send('PUT', '/api/teams-sla/settings', T.s1, { enabled: false, sdp_api_open_filter: 'Open_System' });
  assert.strictEqual(ok.status, 200, await ok.text());
  // disarming (towards strict) stays immediate
  await RC.setConfig(rdb.db, { teams_sla_enabled: '1' }, 'test');
  assert.strictEqual((await send('PUT', '/api/teams-sla/settings', T.s1, { enabled: false })).status, 200);
  assert.strictEqual((await cfg()).teams_sla_enabled, '0');
  // center OFF: the card behaves as before
  await RC.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
  assert.strictEqual((await send('PUT', '/api/teams-sla/settings', T.s1, { enabled: true })).status, 200);
  assert.strictEqual((await cfg()).teams_sla_enabled, '1');
  await RC.setConfig(rdb.db, { teams_sla_enabled: '0', policy_center_enabled: '1' }, 'test');
});

test('N-R5-2 + N-R5-5: a password reset by the requester disqualifies the approver; the target\'s sessions are revoked', async () => {
  // s1 hardens then requests a reset to the weak default (needs a second super_admin)
  assert.strictEqual((await send('PUT', '/api/policy-center/rules/dashkey_scope_mode', T.s1, { value: 'restrict', reason: 'harden the dash key scope now' })).status, 200);
  const p = await send('PUT', '/api/policy-center/rules/dashkey_scope_mode', T.s1, { reset: true, reason: 'relax back to open please' });
  assert.strictEqual(p.status, 202); const { request } = await p.json();
  // s1 takes over s2 by resetting its password
  const old = T.s2;
  const r = await send('PUT', `/api/reports/users/${ID.s2}`, T.s1, { full_name: 'p11r5_s2', password: 'taken-over-pass-9999' });
  assert.strictEqual(r.status, 200, await r.text());
  assert.ok((await r.json()).sessions_revoked >= 1, 'sessions revoked count reported');
  assert.strictEqual((await send('GET', '/api/policy-center/catalogue', old)).status, 401, 'N-R5-5: the old session of the target is gone');
  const j = await rdb.db.prepare("SELECT actor_id FROM system_log WHERE category='identity' AND action='password_reset' AND target='p11r5_s2'").get();
  assert.ok(j && Number(j.actor_id) === ID.s1, 'password reset journalled with the actor');
  const lg = await rdb.login('p11r5_s2', 'taken-over-pass-9999');
  const a = await send('POST', `/api/policy-center/requests/${request}/approve`, lg.token, { reason: 'approved by my second account' });
  assert.strictEqual(a.status, 403, 'refused');
  assert.match((await a.json()).error, /reset the credentials/);
  assert.strictEqual((await cfg()).dashkey_scope_mode, 'restrict', 'nothing applied');
  // control: an independent super_admin still approves
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${request}/approve`, T.s3, { reason: 'agreed, back to open' })).status, 200);
  assert.strictEqual((await cfg()).dashkey_scope_mode, 'open');
});

test('N-R5-2 (Lot 5 review workflow): a decider whose password the requester reset is not independent', async () => {
  await RC.setConfig(rdb.db, { ppm_review_workflow_enabled: '1' }, 'test');
  const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
  const prog = (await (await put('programme', T.s1, { key: 'r5s-prog', name: 'R5S' })).json()).id;
  const obj = (await (await put('objective', T.s1, { programme_id: prog, key: 'r5s-o', name: 'O' })).json()).id;
  const CH = 'Objective, scope and benefits of the project, long enough.';
  const pr = await put('project', T.s1, { objective_id: obj, key: 'R5S-RV', name: 'Review', owner: 'someone', sponsor: 'Sam', charter: CH, start_date: '2027-01-01', end_date: '2027-06-30', baseline_end: '2027-06-30' });
  assert.strictEqual(pr.status, 200, await pr.text());
  const pid = (await pr.json()).id;
  const st = (t, to) => send('POST', `/api/governance/portfolio/project/${pid}/stage`, t, { to, note: 'stage move for the test' });
  assert.strictEqual((await st(T.s1, 'approval')).status, 200);
  const rr = await send('PUT', `/api/reports/users/${ID.c2}`, T.s1, { full_name: 'p11r5_c2', password: 'exec-taken-9999' });
  assert.strictEqual(rr.status, 200);
  const lg = await rdb.login('p11r5_c2', 'exec-taken-9999');
  const a = await st(lg.token, 'in_progress');
  const body = await a.json();
  assert.ok(a.status === 409 || a.status === 403, 'refused: ' + a.status + ' ' + JSON.stringify(body));
  assert.strictEqual(body.code, 'APPROVER_NOT_INDEPENDENT', JSON.stringify(body));
  // control: c1 (independent of s1) decides
  assert.strictEqual((await st(T.c1, 'in_progress')).status, 200);
});
