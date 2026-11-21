'use strict';
// P11 round 6 R6-A1 — repro pinned from /tmp/claude-0/p11attack-r6/tests/r6imp.test.js: with the Policy Center ON, the
// person really running activate-switches (pc_super) passed --operator=pc_super2, the tool filed the four-eyes request
// AS pc_super2, and pc_super approved it in the center → one person both filed and approved. Now the requester of
// record is the account behind a one-time operator token issued in the web UI by that account's own session:
//   - --operator=<colleague> without a token → refused, nothing filed;
//   - pc_super's token with --operator=pc_super2 → refused;
//   - pc_super's token → filed AS pc_super; pc_super cannot approve it (403); pc_super2 (independent) can (200);
//   - the token route is super_admin only and answers 404 while the center is off.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'r6imp-'));
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

function cli() {
  const A = require('../tools/ops/activate-switches.js');
  const deps = { getConfig: () => RC.getConfig(rdb.db), setConfig: (p) => RC.setConfig(rdb.db, p, 'cli'), logEvent: (ev) => rdb.logEvent(ev), log: () => {}, ...A.storedDeps(rdb), osIdentity: { os_user: 'pc_super_os', host: 'SRV-TEST' } };
  const run = (extra) => A.main(['--apply', '--lots=L03', '--db-url=postgres://x', '--reason=pilot wave 2 test run ok', '--rollback-dir=' + process.env.SDP_DATA_DIR, ...extra], deps);
  return { A, run };
}
async function withToken(token, fn) {
  const prev = process.env.SDP_OPERATOR_TOKEN; process.env.SDP_OPERATOR_TOKEN = token;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SDP_OPERATOR_TOKEN; else process.env.SDP_OPERATOR_TOKEN = prev; }
}

test('R6-A1: the token route answers 404 while the Policy Center is off, and is super_admin only', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '0' }, 'test');
  assert.equal((await issue(T.super)).status, 404);
  await RC.setConfig(rdb.db, { policy_center_enabled: '1' }, 'test');
  assert.equal((await issue(T.admin)).status, 403);
  assert.equal((await issue(null)).status, 401);
  const ok = await issue(T.super);
  assert.equal(ok.status, 200); assert.match(ok.body.token, /^sdpop_/); assert.equal(ok.body.username, 'pc_super');
  const stored = await rdb.pgHandle().prepare('SELECT token_hash FROM operator_tokens ORDER BY id DESC LIMIT 1').get();
  assert.notEqual(stored.token_hash, ok.body.token, 'only the hash is stored');
});

test('R6-A1 repro: the CLI runner can no longer file as a colleague and approve it himself', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_editor_plan_writes: '0' }, 'test');
  const { run } = cli();
  // the round-6 attack verbatim: a typed --operator naming the colleague, no token → refused, nothing filed
  await assert.rejects(run(['--operator=pc_super2']), /operator-token[^]*nothing written/);
  const pend = async () => rdb.pgHandle().prepare("SELECT id, requested_by_name FROM policy_change_requests WHERE key = 'portfolio_editor_plan_writes' AND status = 'pending'").all();
  assert.equal((await pend()).length, 0);
  // the runner's own token + --operator=<colleague> → refused
  const mine = (await issue(T.super)).body.token;
  await assert.rejects(withToken(mine, () => run(['--operator-token=env', '--operator=pc_super2'])), /not the account that issued the operator token/);
  assert.equal((await pend()).length, 0);
  // the runner's own token → filed AS the runner
  const mine2 = (await issue(T.super)).body.token;
  const res = await withToken(mine2, () => run(['--operator-token=env']));
  assert.equal(res.requested.length, 1);
  assert.equal(res.requested[0].requested_by, 'pc_super');
  const id = res.requested[0].request_id;
  // he cannot approve his own request …
  const self = await send('POST', `/api/policy-center/requests/pc-${id}/approve`, T.super, { reason: 'approve the colleague request' });
  assert.equal(self.status, 403);
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '0', 'value unchanged after the refused self-approval');
  // … an independent second super_admin can
  const other = await send('POST', `/api/policy-center/requests/pc-${id}/approve`, T.super2, { reason: 'reviewed: pilot wave 2' });
  assert.equal(other.status, 200);
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '1');
  // the request record names the authenticated requester, the token and the OS identity
  const row = await rdb.pgHandle().prepare('SELECT requested_by_name, reason FROM policy_change_requests WHERE id = ?').get(id);
  assert.equal(row.requested_by_name, 'pc_super');
  assert.match(row.reason, /authenticated by operator token #\d+; os pc_super_os@SRV-TEST/);
});

// P11 r7 R7-A1 — a token forged by a direct INSERT with the application database login (which the CLI needs anyway):
// the CLI refuses it (no server binding), and a request that names a token without an issuance event cannot be approved.
test('R7-A1: a token INSERTed with the app DB login is refused by the CLI; a forged request naming a token is refused at approval', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_editor_plan_writes: '0' }, 'test');
  const OT = require('../services/operatorTokens'); const H = rdb.pgHandle();
  const u2 = await H.prepare("SELECT id FROM users WHERE username = 'pc_super2'").get();
  const tok = OT.PREFIX + require('crypto').randomBytes(32).toString('base64url');
  await H.prepare("INSERT INTO operator_tokens (token_hash, user_id, username, purpose, expires_at) VALUES (?, ?, 'pc_super2', 'activate-switches', now() + interval '10 minutes')").run(OT.hash(tok), u2.id);
  const { run } = cli();
  await assert.rejects(withToken(tok, () => run(['--operator-token=env'])), /not issued by the server[^]*nothing written/);
  assert.equal((await H.prepare("SELECT COUNT(*) AS n FROM policy_change_requests WHERE key = 'portfolio_editor_plan_writes' AND status = 'pending'").get()).n, 0, 'nothing filed');
  // a request row written straight into the table, naming a token #id that has no issuance event / binding
  const forgedTok = await H.prepare("SELECT id FROM operator_tokens WHERE token_hash = ?").get(OT.hash(tok));
  const ins = await H.prepare("INSERT INTO policy_change_requests (key, scope, old_value, new_value, reason, requested_by, requested_by_name, requested_at, expires_at) VALUES ('portfolio_editor_plan_writes', 'global', '0', '1', ?, ?, 'pc_super2', ?, ?) RETURNING id")
    .get(`forged [filed by activate-switches; authenticated by operator token #${forgedTok.id}; os x@y]`, u2.id, new Date().toISOString(), new Date(Date.now() + 7 * 864e5).toISOString());
  const list = await (await send('GET', '/api/policy-center/requests', T.super)).json();
  const shown = list.requests.find((r) => r.id === 'pc-' + ins.id);
  assert.deepEqual([shown.operator_token.id, shown.operator_token.issued_event, shown.operator_token.binding_ok], [Number(forgedTok.id), false, false], 'the approver sees the token is not verifiable');
  const ap = await send('POST', `/api/policy-center/requests/pc-${ins.id}/approve`, T.super, { reason: 'approve the colleague request' });
  assert.equal(ap.status, 409);
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '0', 'value unchanged');
  assert.equal((await send('POST', `/api/policy-center/requests/pc-${ins.id}/reject`, T.super, { reason: 'forged request, not issued by the server' })).status, 200);
  // a genuine token (route-issued, event logged) shows as verified
  const mine = (await issue(T.super)).body.token;
  const res = await withToken(mine, () => run(['--operator-token=env']));
  const good = (await (await send('GET', '/api/policy-center/requests', T.super2)).json()).requests.find((r) => r.id === 'pc-' + res.requested[0].request_id);
  assert.deepEqual([good.operator_token.issued_event, good.operator_token.binding_ok, good.operator_token.account_matches], [true, true, true]);
  await send('POST', `/api/policy-center/requests/pc-${res.requested[0].request_id}/cancel`, T.super, {});
});

test('R7-A1: without SDP_CONFIG_KEY the token route refuses (fail closed, 409, clear message)', async () => {
  await RC.setConfig(rdb.db, { policy_center_enabled: '1' }, 'test');
  const saved = process.env.SDP_CONFIG_KEY; delete process.env.SDP_CONFIG_KEY;
  try { const r = await issue(T.super); assert.equal(r.status, 409); assert.match(JSON.stringify(r.body), /SDP_CONFIG_KEY/); }
  finally { process.env.SDP_CONFIG_KEY = saved; }
});
