'use strict';
// P11 round 8 R8-A1 (fix 36, AI-written) — repro pinned from /tmp/claude-0/p11attack-r8/tests/r8imp.test.js (R8-5):
// with only the application database login, a row INSERTed into policy_change_requests as source='cli' naming NO operator
// token was approvable (the token check ran only when the reason named a token). A request filed outside the web session
// flow (source='cli', or the CLI's "filed by activate-switches" marker) now needs verifiable token evidence: 409 otherwise.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'r8pc-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'pc-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pc-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pc-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
process.env.SDP_CONFIG_KEY = process.env.SDP_CONFIG_KEY || 'r6imp-test-config-key-0123456789';   // P11 r7 R7-A1: tokens are bound with it

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'operator_tokens'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const mk = async (k, roles) => { const u = 'pc_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); } catch { /* exists */ } T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']); await mk('admin', ['admin']);
  await rdb.db.prepare("UPDATE users SET created_at = ? WHERE username IN ('pc_super','pc_super2')").run(new Date(Date.now() - 60 * 864e5).toISOString());
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const issue = async (t) => { const r = await send('POST', '/api/policy-center/operator-tokens', t, {}); return { status: r.status, body: await r.json().catch(() => ({})) }; };


const insertRow = async (requesterName, source, reason) => {
  const H = rdb.pgHandle();
  const u = await H.prepare('SELECT id FROM users WHERE username = ?').get(requesterName);
  await H.exec("UPDATE policy_change_requests SET status = 'cancelled' WHERE status = 'pending'");
  return H.prepare(`INSERT INTO policy_change_requests (key, scope, old_value, new_value, reason, requested_by, requested_by_name, requested_at, expires_at, source) VALUES ('portfolio_editor_plan_writes', 'global', '0', '1', ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(reason, u.id, requesterName, new Date().toISOString(), new Date(Date.now() + 7 * 864e5).toISOString(), source);
};

test('R8-A1: a source=cli request row naming no operator token is refused at approval (409), value unchanged', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_editor_plan_writes: '0' }, 'test');
  const ins = await insertRow('pc_super2', 'cli', 'pilot wave 2 change filed via CLI');
  const ap = await send('POST', `/api/policy-center/requests/pc-${ins.id}/approve`, T.super, { reason: 'approve the colleague request' });
  assert.equal(ap.status, 409);
  assert.match(JSON.stringify(await ap.json()), /not created by a trusted path/);   // P11 r9 fix 39: origin signature supersedes the source heuristic
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '0', 'value unchanged');
  const ev = await rdb.pgHandle().prepare("SELECT details FROM system_log WHERE action = 'policy_approval_refused' ORDER BY id DESC LIMIT 1").get();
  assert.match(String(ev.details), /request origin not verifiable/);
  assert.equal((await send('POST', `/api/policy-center/requests/pc-${ins.id}/reject`, T.super, { reason: 'forged request, no operator token' })).status, 200);
});

test('R8-A1: a row carrying the CLI marker but no token reference is refused too; a web-flow request still approves', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_editor_plan_writes: '0' }, 'test');
  const ins = await insertRow('pc_super2', 'policy_center', 'pilot [filed by activate-switches; os x@y]');
  assert.equal((await send('POST', `/api/policy-center/requests/pc-${ins.id}/approve`, T.super, { reason: 'approve the colleague request' })).status, 409);
  await send('POST', `/api/policy-center/requests/pc-${ins.id}/reject`, T.super, { reason: 'forged request, no operator token' });
  // control: a request filed through the web session (Policy Center PUT) by pc_super2 is approved by pc_super
  const put = await send('PUT', '/api/policy-center/rules/portfolio_editor_plan_writes', T.super2, { value: '1', reason: 'pilot wave 2 needs plan writes on' });
  assert.equal(put.status, 202);
  const id = (await put.json()).request;
  const ap = await send('POST', `/api/policy-center/requests/${id}/approve`, T.super, { reason: 'approved after review of the plan' });
  assert.equal(ap.status, 200);
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '1');
  await RC.setConfig(rdb.db, { portfolio_editor_plan_writes: '0' }, 'test');
});
