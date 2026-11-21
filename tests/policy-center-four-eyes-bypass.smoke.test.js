'use strict';
// P11 round 4, security seat — through the real server:
//   N-R4-1  one super_admin cannot relax a hardened four-eyes rule alone, neither by "reset to default" in the Policy
//           Center nor through the legacy PUT /api/reports/config while the center is on (typed 409);
//   N-R4-2  Policy Center reads are super_admin only, like GET /api/reports/config (admin tier 403);
//   R4-A2(b) (audit seat) the approver must be independent: not created / promoted by the requester (directly or
//           through a chain), and not a brand-new account of unknown provenance.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pc-r4-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pcr4-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pcr4-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pcr4-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
process.env.SDP_CONFIG_KEY = process.env.SDP_CONFIG_KEY || 'pc-test-config-key-0123456789abcdef';   // P11 r9 R9-A2: requests carry an origin signature keyed from it

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'policy_change_requests'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const mk = async (k, roles) => { const u = 'pcr4_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); } catch {} T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']); await mk('admin', ['admin']);
  // super2 is an ESTABLISHED account (outside the approver cooling-off window, R4-A2(b))
  await rdb.db.prepare("UPDATE users SET created_at = now() - interval '30 days' WHERE username = 'pcr4_super2'").run();
  await RC.setConfig(rdb.db, { sso_breakglass_user: 'bg-secret-user', entra_tenant_id: 'tenant-1111' }, 'test');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const put = (t, key, body) => send('PUT', '/api/policy-center/rules/' + key, t, body);
const cfg = async () => RC.getConfig(rdb.db);

test('center OFF: the legacy config PUT keeps its behaviour for four-eyes keys', async () => {
  assert.strictEqual((await cfg()).policy_center_enabled, '0');
  const r = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: '1' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await cfg()).export_policy_strict, '1');
  await RC.setConfig(rdb.db, { export_policy_strict: '0', policy_center_enabled: '1' }, 'test');
});

test('N-R4-1: reset of a hardened rule to its WEAK default needs a second super_admin', async () => {
  const h = await put(T.super, 'dashkey_scope_mode', { value: 'restrict', reason: 'harden the dash key scope' });
  assert.strictEqual(h.status, 200, 'hardening towards the strict value is immediate');
  assert.strictEqual((await cfg()).dashkey_scope_mode, 'restrict');
  const rs = await put(T.super, 'dashkey_scope_mode', { reset: true, reason: 'revert alone to the default' });
  assert.strictEqual(rs.status, 202, 'reset to the weak default becomes a request');
  const { request } = await rs.json();
  assert.strictEqual((await cfg()).dashkey_scope_mode, 'restrict', 'nothing applied by one person');
  assert.strictEqual((await send('POST', `/api/policy-center/requests/${request}/approve`, T.super, { reason: 'self approval' })).status, 403);
  const ap = await send('POST', `/api/policy-center/requests/${request}/approve`, T.super2, { reason: 'agreed, back to open' });
  assert.strictEqual(ap.status, 200);
  assert.strictEqual((await cfg()).dashkey_scope_mode, 'open');
  // export_policy_strict 1 → 0 by one person
  await RC.setConfig(rdb.db, { export_policy_strict: '1' }, 'test');
  const ex = await put(T.super, 'export_policy_strict', { value: '0', reason: 'loosen exports alone please' });
  assert.strictEqual(ex.status, 202);
  assert.strictEqual((await cfg()).export_policy_strict, '1');
  await send('POST', `/api/policy-center/requests/${(await ex.json()).request}/cancel`, T.super, {});
});

test('N-R4-1: with the center ON the legacy config PUT refuses a CHANGED four-eyes key (typed 409), re-sent values pass', async () => {
  const before = await cfg();
  const r = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: '0', ui_inject_dash_key: '1', authz_capability_mode: 'enforce' });
  assert.strictEqual(r.status, 409);
  const j = await r.json();
  assert.strictEqual(j.code, 'CONFLICT');
  assert.ok(/policy-center/.test(j.error));
  assert.deepStrictEqual(j.four_eyes_keys.sort(), ['authz_capability_mode', 'export_policy_strict']);
  const after = await cfg();
  for (const k of ['export_policy_strict', 'ui_inject_dash_key', 'authz_capability_mode']) assert.strictEqual(after[k], before[k], k + ' unchanged');
  // an admin card re-sending unchanged four-eyes fields + a non-four-eyes change still saves
  const ok = await send('PUT', '/api/reports/config', T.super, { export_policy_strict: before.export_policy_strict, sso_breakglass_user: before.sso_breakglass_user, ui_week_labels: 'explicit' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await cfg()).ui_week_labels, 'explicit');
  // turning the center off is itself a four-eyes rule
  assert.strictEqual((await send('PUT', '/api/reports/config', T.super, { policy_center_enabled: '0' })).status, 409);
  assert.strictEqual((await cfg()).policy_center_enabled, '1');
  await RC.setConfig(rdb.db, { ui_week_labels: 'legacy' }, 'test');
});

test('N-R4-2: Policy Center reads are super_admin only (admin tier gets 403, no identity values leak)', async () => {
  assert.strictEqual((await send('GET', '/api/reports/config', T.admin)).status, 403);
  for (const p of ['/api/policy-center/catalogue', '/api/policy-center/export', '/api/policy-center/export?format=csv', '/api/policy-center/requests', '/api/policy-center/rules/sso_breakglass_user/history']) {
    const r = await send('GET', p, T.admin);
    assert.strictEqual(r.status, 403, p);
    assert.ok(!(await r.text()).includes('bg-secret-user'), p + ' leaks nothing');
  }
  const ok = await send('GET', '/api/policy-center/catalogue', T.super);
  assert.strictEqual(ok.status, 200);
});

const login = async (u, p) => (await rdb.login(u, p)).token;
async function createViaApi(tok, username) {
  const r = await send('POST', '/api/reports/users', tok, { username, full_name: username, password: 'Helper-pass-1234!x', roles: ['super_admin'] });
  assert.strictEqual(r.status, 200, await r.text());
  for (let i = 0; i < 50; i++) { if (await rdb.db.prepare("SELECT 1 FROM system_log WHERE action='user_created' AND target=?").get(username)) break; await new Promise((x) => setTimeout(x, 50)); }
  return login(username, 'Helper-pass-1234!x');
}
const decideReq = (tok, id) => send('POST', `/api/policy-center/requests/${id}/approve`, tok, { reason: 'looks fine to me' });

test('R4-A2(b) exact repro: the requester creates a second super_admin, who cannot approve the request', async () => {
  await RC.setConfig(rdb.db, { teams_sla_enabled: '0', policy_center_enabled: '1' }, 'test');
  const r = await put(T.super, 'teams_sla_enabled', { value: '1', reason: 'arm Teams SLA alerts for the pilot' });
  assert.strictEqual(r.status, 202); const { request } = await r.json();
  const helper = await createViaApi(T.super, 'helper_x');
  const ap = await decideReq(helper, request);
  assert.strictEqual(ap.status, 403, 'an account the requester created is not a second person');
  assert.match((await ap.json()).error, /created or had its roles changed by the requester/);
  assert.strictEqual((await cfg()).teams_sla_enabled, '0', 'nothing applied');
  // a chain: requester → helper_y (super) → helper_z (super)
  const y = await createViaApi(T.super, 'helper_y');
  const z = await createViaApi(y, 'helper_z');
  assert.strictEqual((await decideReq(z, request)).status, 403, 'an account descending from the requester is refused');
  // promotion of an existing account by the requester is refused too
  const me = (await rdb.listUsers()).find((x) => x.username === 'pcr4_admin');
  const pr = await send('PUT', '/api/reports/users/' + me.id, T.super, { full_name: 'pcr4_admin', roles: ['super_admin'] });
  assert.strictEqual(pr.status, 200, await pr.text());
  for (let i = 0; i < 50; i++) { if (await rdb.db.prepare("SELECT 1 FROM system_log WHERE action='user_role_changed' AND target='pcr4_admin'").get()) break; await new Promise((x) => setTimeout(x, 50)); }
  assert.strictEqual((await decideReq(await login('pcr4_admin', 'pcr4_adminpass1234'), request)).status, 403, 'promoted by the requester');
  // fail closed: a brand-new super_admin with no journal row (provenance unknown)
  try { await rdb.createUser({ username: 'ghost_super', full_name: 'g', password: 'ghost_superpass1234', roles: ['super_admin'] }); } catch {}
  const g = await decideReq(await login('ghost_super', 'ghost_superpass1234'), request);
  assert.strictEqual(g.status, 403); assert.match((await g.json()).error, /provenance unknown/);
  // control: an established, independent super_admin approves
  const ok = await decideReq(T.super2, request);
  assert.strictEqual(ok.status, 200, 'an independent second super_admin still approves');
  assert.strictEqual((await cfg()).teams_sla_enabled, '1');
  await RC.setConfig(rdb.db, { teams_sla_enabled: '0' }, 'test');
});
