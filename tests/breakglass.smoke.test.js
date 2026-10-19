'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Step 4 (SDP-DASH-2.0) — with SSO enforced (sso_mode=only) the password sign-in is refused to
// everyone except the break-glass account; its use is journaled as a RISK event; repeated failures
// against one account are throttled (persistent throttle), whatever the address.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'breakglass-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'bg-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'bg-super-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'bg-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb;

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await rdb.createUser({ username: 'bg-emergency', full_name: 'Break glass', password: 'bg-emergency-pass-0000', roles: ['super_admin'] });
  await rdb.createUser({ username: 'bg-normal', full_name: 'Normal', password: 'bg-normal-pass-0000', roles: ['viewer'] });
  await require('../services/reportConfig').setConfig(rdb.db, { sso_mode: 'only', entra_tenant_id: 't', entra_client_id: 'c',
    entra_client_secret: 's', entra_redirect_uri: 'https://x/cb', sso_breakglass_user: 'bg-emergency' }, 'test');
  require('../services/ssoSettings')._invalidate();
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const login = (u, p) => fetch(base + '/api/reports/auth/login', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });

test('SSO enforced: normal accounts are refused the password sign-in, break-glass is not', async () => {
  assert.equal((await login('bg-normal', 'bg-normal-pass-0000')).status, 403);
  const r = await login('bg-emergency', 'bg-emergency-pass-0000');
  assert.equal(r.status, 200);
  assert.ok((await r.json()).token);
  await new Promise(res => setTimeout(res, 150));
  const ev = rdb.db.prepare(`SELECT * FROM system_log WHERE action='breakglass_login'`).all();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].risk, 1, 'every break-glass sign-in is a risk event');
  assert.equal(ev[0].actor, 'bg-emergency');
});

test('10 failures against one account → throttled (429) even with the right password', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await login('bg-emergency', 'wrong-password-' + i)).status, 401);
  assert.equal((await login('bg-emergency', 'bg-emergency-pass-0000')).status, 429);
  await new Promise(res => setTimeout(res, 150));
  assert.ok(rdb.db.prepare(`SELECT COUNT(*) AS n FROM system_log WHERE action='login_throttled'`).get().n >= 1);
});
