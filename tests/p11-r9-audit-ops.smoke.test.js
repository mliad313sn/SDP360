'use strict';
// P11 round 9 (fix 39, AI-written) — server side.
//  R9-A2 / N-R9-1  a Policy Center request is approvable only when it carries a valid ORIGIN SIGNATURE written by a
//                  trusted path (web route or CLI with an operator token, services/policyOrigin.js). Rows written straight
//                  into the table are refused whatever their `source` ('web', 'CLI', 'cli ', 'session', default); an edited
//                  signed row is refused; a CLI request must point at a token bound to THIS request (no replay).
//  O-17            a database outage during password login answers 503 database_unavailable, never 500.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'r9ao-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'r9ao-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'r9ao-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'r9ao-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';
process.env.SDP_CONFIG_KEY = process.env.SDP_CONFIG_KEY || 'r9ao-test-config-key-0123456789';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, RC; const T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); RC = require('../services/reportConfig');
  for (let i = 0; i < 80; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'policy_change_requests' AND column_name = 'origin_sig'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  const mk = async (k, roles) => { const u = 'r9_' + k; try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles }); } catch { /* exists */ } T[k] = (await rdb.login(u, u + 'pass1234')).token; };
  await mk('super', ['super_admin']); await mk('super2', ['super_admin']);
  await rdb.db.prepare("UPDATE users SET created_at = ? WHERE username IN ('r9_super','r9_super2')").run(new Date(Date.now() - 60 * 864e5).toISOString());
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = (m, p, t, body) => fetch(base + p, { method: m, headers: { ...(t ? { 'x-report-token': t } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const H = () => rdb.pgHandle();
const uid = async (name) => (await H().prepare('SELECT id FROM users WHERE username = ?').get(name)).id;
const clearPending = () => H().exec("UPDATE policy_change_requests SET status = 'cancelled' WHERE status = 'pending'");
const insertRow = async (cols) => {
  await clearPending();
  const u = await uid('r9_super2');
  const base0 = { key: 'portfolio_editor_plan_writes', scope: 'global', old_value: '0', new_value: '1', reason: 'pilot wave 2 change', requested_by: u, requested_by_name: 'r9_super2', requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 864e5).toISOString(), ...cols };
  const k = Object.keys(base0);
  return H().prepare(`INSERT INTO policy_change_requests (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')}) RETURNING *`).get(...k.map((x) => base0[x]));
};
const approve = async (id) => { const r = await send('POST', `/api/policy-center/requests/pc-${id}/approve`, T.super, { reason: 'approve the colleague request' }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const setup = () => RC.setConfig(rdb.db, { policy_center_enabled: '1', portfolio_editor_plan_writes: '0' }, 'test');

test('R9-A2: rows written straight into the table are refused whatever their source value (no origin signature)', async () => {
  await setup();
  for (const source of ['web', 'CLI', 'cli ', 'session', undefined]) {
    const row = await insertRow(source === undefined ? {} : { source });
    const ap = await approve(row.id);
    assert.equal(ap.status, 409, `source=${JSON.stringify(source)}`);
    assert.match(JSON.stringify(ap.body), /not created by a trusted path/);
    assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '0', 'value unchanged');
  }
  // a row claiming origin 'web' with a made-up signature is refused too
  const fake = await insertRow({ origin: 'web', origin_sig: 'a'.repeat(64) });
  assert.equal((await approve(fake.id)).status, 409);
});

test('R9-A2 control: a web-flow request still approves; editing it afterwards breaks its signature', async () => {
  await setup();
  await clearPending();
  const put = await send('PUT', '/api/policy-center/rules/portfolio_editor_plan_writes', T.super2, { value: '1', reason: 'pilot wave 2 needs plan writes on' });
  assert.equal(put.status, 202);
  const id = Number(String((await put.json()).request).slice(3));
  const row = await H().prepare('SELECT origin, origin_sig FROM policy_change_requests WHERE id = ?').get(id);
  assert.equal(row.origin, 'web'); assert.ok(/^[0-9a-f]{64}$/.test(row.origin_sig));
  const list = await (await send('GET', '/api/policy-center/requests', T.super)).json();
  assert.equal(list.requests.find((x) => x.id === 'pc-' + id).origin_verified, true, 'the approver sees the origin is verified');
  await H().prepare('UPDATE policy_change_requests SET reason = ? WHERE id = ?').run('pilot wave 2 needs plan writes on (edited)', id);
  assert.equal((await approve(id)).status, 409, 'an edited signed row is refused');
  await H().prepare('UPDATE policy_change_requests SET reason = ? WHERE id = ?').run('pilot wave 2 needs plan writes on', id);
  const ap = await approve(id);
  assert.equal(ap.status, 200);
  assert.equal((await RC.getConfig(rdb.db)).portfolio_editor_plan_writes, '1');
});

test('N-R9-1: a genuine CLI request (token consumed and bound to it) approves; a replay of that token on another request is refused', async () => {
  await setup();
  await clearPending();
  const iss = await send('POST', '/api/policy-center/operator-tokens', T.super2, {});
  assert.equal(iss.status, 200);
  const tok = await iss.json();
  const OT = require('../services/operatorTokens');
  const c = await OT.check(H(), tok.token, { consume: true, consumedBy: 'test cli' });
  assert.ok(c.id, JSON.stringify(c));
  const store = require('../services/policyChangeStore').makePolicyChangeStore(() => rdb.pgHandle());
  const u = { id: await uid('r9_super2'), username: 'r9_super2' };
  const r = await store.create({ key: 'portfolio_editor_plan_writes', oldValue: '0', newValue: '1', reason: `wave 2 [filed by activate-switches; authenticated by operator token #${c.id}; os t@h]`, actor: u, origin: 'cli', operatorTokenId: c.id });
  assert.equal(r.origin, 'cli');
  assert.match(String((await H().prepare('SELECT bound_request_ids FROM operator_tokens WHERE id = ?').get(c.id)).bound_request_ids), new RegExp(`,${r.id},`));
  // replay by a key holder: a second, correctly SIGNED request pointing at the same token, which never filed it
  await H().prepare("UPDATE policy_change_requests SET status = 'cancelled' WHERE id = ?").run(r.id);
  const PO = require('../services/policyOrigin');
  const forged = await insertRow({ origin: 'cli', operator_token_id: c.id, source: 'cli', reason: `wave 2 [filed by activate-switches; authenticated by operator token #${c.id}; os t@h]` });
  await H().prepare('UPDATE policy_change_requests SET origin_sig = ? WHERE id = ?').run(PO.sign(PO.originKey(), forged), forged.id);
  const rp = await approve(forged.id);
  assert.equal(rp.status, 409); assert.match(JSON.stringify(rp.body), /replayed/);
  // the DB-login-only version of the same replay has no valid signature at all
  const forged2 = await insertRow({ origin: 'cli', operator_token_id: c.id, origin_sig: 'b'.repeat(64) });
  assert.equal((await approve(forged2.id)).status, 409);
  // the genuine request approves
  await clearPending();
  await H().prepare("UPDATE policy_change_requests SET status = 'pending' WHERE id = ?").run(r.id);
  const ok = await approve(r.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  await RC.setConfig(rdb.db, { portfolio_editor_plan_writes: '0' }, 'test');
});

test('R9-A2: without SDP_CONFIG_KEY nothing is filed (fail closed)', async () => {
  await setup(); await clearPending();
  const saved = process.env.SDP_CONFIG_KEY; delete process.env.SDP_CONFIG_KEY;
  try {
    const put = await send('PUT', '/api/policy-center/rules/portfolio_editor_plan_writes', T.super2, { value: '1', reason: 'pilot wave 2 needs plan writes on' });
    assert.equal(put.status, 409); assert.match(JSON.stringify(await put.json()), /SDP_CONFIG_KEY/);
  } finally { process.env.SDP_CONFIG_KEY = saved; }
});

test('O-17: PostgreSQL unreachable during password login is 503 database_unavailable, never 500; a wrong password stays 401', async () => {
  const orig = rdb.login;
  rdb.login = async () => { const e = new Error('connect ECONNREFUSED 127.0.0.1:5432'); e.code = 'ECONNREFUSED'; throw e; };
  try {
    const r = await send('POST', '/api/reports/auth/login', null, { username: 'r9_super', password: 'r9_superpass1234' });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, 'database_unavailable');
  } finally { rdb.login = orig; }
  const bad = await send('POST', '/api/reports/auth/login', null, { username: 'r9_super', password: 'wrong-password-123' });
  assert.equal(bad.status, 401);
});
