'use strict';

// SSO route wiring smoke — boots the express app in-process with SSO OFF (the
// default) and asserts the flag-gated behaviour so a plain deploy is inert:
//   • GET /api/auth/config → 200 PUBLIC, {sso_enabled:false}
//   • GET /api/auth/sso/login → 404 (disabled)
//   • password login still works normally (no break-glass gate when SSO off)
// Run with --test-force-exit (top-level cron/timers keep the loop alive).

const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'sso-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'sso-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'sso-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'sso-smoke-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';
delete process.env.SSO_ENABLED; // ensure OFF for this smoke

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base;
before(async () => {
  const { app } = require('../server');
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('GET /api/auth/config is public and reports sso_enabled:false when off', async () => {
  const res = await fetch(base + '/api/auth/config'); // no auth headers
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.sso_enabled, false, 'SSO off by default');
});

test('GET /api/auth/sso/login → 404 when SSO is disabled', async () => {
  const res = await fetch(base + '/api/auth/sso/login', { redirect: 'manual' });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

test('GET /api/auth/sso/callback → 404 when SSO is disabled', async () => {
  const res = await fetch(base + '/api/auth/sso/callback?code=x&state=y', { redirect: 'manual' });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

test('password login still works normally (no break-glass gate when SSO off)', async () => {
  const res = await fetch(base + '/api/reports/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.DASH_USER, password: process.env.DASH_PASS }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.token, 'returns a session token');
});
