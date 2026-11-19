'use strict';
// P07 — session controls, one test each, against the real app: fixation (a pre-supplied token is never adopted),
// reuse after logout, forced logout by a super_admin, and every sso_mode value for password sign-in including the
// break-glass account. Deactivation and role removal on the next request are proved by
// tests/access-revocation.smoke.test.js; a deprovisioned Entra account by tests/entra-deprovision.test.js.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'sesssec-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'ss-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'ss-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ss-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
delete process.env.SSO_ENABLED; delete process.env.SSO_MODE; delete process.env.SSO_BREAKGLASS_USER;
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, sso, superTok;
const H = (t) => ({ 'Content-Type': 'application/json', ...(t ? { 'x-report-token': t } : {}) });
const me = (t) => fetch(base + '/api/reports/auth/me', { headers: H(t) });
const cookieTok = (r) => (/report_token=([^;]+)/.exec(String(r.headers.get('set-cookie') || '')) || [])[1] || null;
async function login(username, password, extraHeaders = {}) {
  return fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ username, password }) });
}
async function mkUser(username, roles = ['viewer']) {
  await rdb.createUser({ username, full_name: username, password: username + '-pass-0000', roles });
  return username + '-pass-0000';
}
async function setSso(mode, breakglass) {
  await cfg.setConfig(rdb.db, { sso_mode: mode, sso_breakglass_user: breakglass || '' }, 'test');
  sso._invalidate();
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); cfg = require('../services/reportConfig'); sso = require('../services/ssoSettings');
  const u = ((await rdb.listUsers()) || []).find((x) => x.username === process.env.DASH_USER);
  await rdb.setUserRoles(u.id, ['super_admin']);
  superTok = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { try { await setSso('', ''); } catch (_) { /* db gone */ } try { server && server.close(); } catch {} });

test('fixation: a token planted before sign-in is never adopted — login issues a new one', async () => {
  const pw = await mkUser('ss-fix');
  const planted = 'f'.repeat(64);
  const r = await login('ss-fix', pw, { Cookie: 'report_token=' + planted, 'x-report-token': planted });
  assert.equal(r.status, 200);
  const issued = cookieTok(r);
  assert.ok(issued && issued !== planted, 'a fresh token is issued');
  assert.equal((await me(planted)).status, 401, 'the planted token is not a session');
  assert.equal((await me(issued)).status, 200);
});

test('reuse after logout: the token is refused on the next request', async () => {
  const pw = await mkUser('ss-out');
  const tok = cookieTok(await login('ss-out', pw));
  assert.equal((await me(tok)).status, 200);
  assert.equal((await fetch(base + '/api/reports/auth/logout', { method: 'POST', headers: H(tok) })).status, 200);
  assert.equal((await me(tok)).status, 401);
});

test('forced logout: a super_admin ends another session; the user is refused at once; a viewer cannot force-logout', async () => {
  const pw = await mkUser('ss-kill');
  const tok = (await rdb.login('ss-kill', pw)).token;   // HTTP login budget (10 per window) kept for the tests about sign-in
  const vpw = await mkUser('ss-viewer');
  const vtok = (await rdb.login('ss-viewer', vpw)).token;
  assert.equal((await fetch(base + '/api/reports/sessions/' + encodeURIComponent(tok), { method: 'DELETE', headers: H(vtok) })).status, 403);
  assert.equal((await me(tok)).status, 200, 'still alive after the refused attempt');
  assert.equal((await fetch(base + '/api/reports/sessions/' + encodeURIComponent(tok), { method: 'DELETE', headers: H(superTok) })).status, 200);
  assert.equal((await me(tok)).status, 401);
});

test('sso_mode off / available: password sign-in open to every account', async () => {
  const pw = await mkUser('ss-mode');
  for (const mode of ['off', 'available']) {
    await setSso(mode, 'ss-bg');
    assert.equal((await login('ss-mode', pw)).status, 200, mode);
    const cfgRes = await (await fetch(base + '/api/auth/config')).json();
    assert.equal(cfgRes.password_login, true, mode);
    assert.equal(cfgRes.breakglass_user, null, mode + ': break-glass name not published');
  }
});

test('sso_mode only: password refused for normal accounts (even with the right password), allowed for break-glass, logged as risk', async () => {
  const pw = await mkUser('ss-only');
  const bgpw = await mkUser('ss-bg', ['super_admin']);
  await setSso('only', 'ss-bg');
  const refused = await login('ss-only', pw);
  assert.equal(refused.status, 403);
  assert.equal(cookieTok(refused), null, 'no session issued');
  const bg = await login('ss-bg', bgpw);
  assert.equal(bg.status, 200, 'break-glass keeps password sign-in');
  assert.ok(cookieTok(bg));
  const cfgRes = await (await fetch(base + '/api/auth/config')).json();
  assert.equal(cfgRes.password_login, false);
  assert.equal(cfgRes.breakglass_user, null, 'the break-glass account name is never published to anonymous visitors');
  await new Promise((r) => setTimeout(r, 100));
  const rows = await rdb.listSystemLog({ category: 'auth', limit: 50 });
  const list = Array.isArray(rows) ? rows : (rows && rows.rows) || [];
  assert.ok(list.some((x) => x.action === 'breakglass_login'), 'break-glass use is in the security journal');
});

test('sso_mode only, break-glass unset: nobody can sign in with a password (lock-out risk the security owner must accept)', async () => {
  await setSso('only', '');
  assert.equal((await login(process.env.DASH_USER, process.env.DASH_PASS)).status, 403);
  await setSso('', '');
  assert.equal((await login(process.env.DASH_USER, process.env.DASH_PASS)).status, 200, 'back to today');
});

test('the active-sessions list never returns a bearer token; force-logout works by session_ref (no token in a URL)', async () => {
  const pw = await mkUser('ss-ref');
  const tok = (await rdb.login('ss-ref', pw)).token;
  assert.equal((await me(tok)).status, 200);
  const r = await fetch(base + '/api/reports/sessions/active?idle_minutes=60', { headers: H(superTok) });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!text.includes(tok), 'a full session token is in the list');
  assert.ok(!text.includes(superTok), 'the caller\'s own token is in the list');
  const row = JSON.parse(text).sessions.find((s) => s.username === 'ss-ref');
  assert.ok(row && /^ref-[a-f0-9]{64}$/.test(row.session_ref), 'session_ref present');
  const ownRef = 'ref-' + require('crypto').createHash('sha256').update(superTok).digest('hex');
  const self = JSON.parse(text).sessions.find((s) => s.session_ref === ownRef);
  assert.ok(self && self.is_self);
  assert.equal((await fetch(base + '/api/reports/sessions/' + self.session_ref, { method: 'DELETE', headers: H(superTok) })).status, 400, 'own session refused by ref too');
  assert.equal((await fetch(base + '/api/reports/sessions/ref-' + '0'.repeat(64), { method: 'DELETE', headers: H(superTok) })).status, 404, 'unknown ref');
  assert.equal((await fetch(base + '/api/reports/sessions/' + row.session_ref, { method: 'DELETE', headers: H(superTok) })).status, 200);
  assert.equal((await me(tok)).status, 401);
});
