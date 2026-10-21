'use strict';
// Fiche E5 (2026-10-20) — the httpOnly report_token cookie is the only session a browser presents.
//   (a) POST /api/reports/auth/login no longer returns the token in the JSON body (Set-Cookie only);
//   (b) the cookie alone authenticates a same-origin API call carrying an Origin header;
//   (c) an x-report-token header WITHOUT cookie but WITH an Origin header is refused (browser context);
//   (d) the header alone (no cookie, no Origin) still works for non-browser callers (CLI/tools);
//   (e) logout clears the cookie (Max-Age=0) and the session no longer authenticates.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'auth-cookie-smoke-'));
for (const k of ['REPORTS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND', 'ASSETS_BACKEND']) process.env[k] = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'cookie-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'cookie-pass-0000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, cookieToken;

before(async () => {
  const { app } = require('../server');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('(a) login sets the httpOnly cookie and keeps the token out of the JSON body', async () => {
  const res = await fetch(base + '/api/reports/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.DASH_USER, password: process.env.DASH_PASS }),
  });
  assert.equal(res.status, 200);
  const sc = String(res.headers.get('set-cookie') || '');
  const m = /report_token=([^;]+)/.exec(sc);
  assert.ok(m, 'Set-Cookie carries report_token');
  assert.match(sc, /HttpOnly/i);
  cookieToken = decodeURIComponent(m[1]);
  const body = await res.json();
  assert.ok(body.user, 'profile returned');
  assert.equal(body.token, undefined, 'no token in the JSON body');
  assert.ok(!JSON.stringify(body).includes(cookieToken), 'the token value appears nowhere in the body');
});

test('(b) the cookie alone authenticates a same-origin call with an Origin header', async () => {
  const r = await fetch(base + '/api/reports/auth/me', { headers: { cookie: `report_token=${cookieToken}`, origin: base } });
  assert.equal(r.status, 200);
  const g = await fetch(base + '/api/ping', { headers: { cookie: `report_token=${cookieToken}`, origin: base } });
  assert.notEqual(g.status, 401, 'the global /api/ gate accepts the cookie');
});

test('(c) a token header without cookie in a browser context (Origin) is refused', async () => {
  const r = await fetch(base + '/api/reports/auth/me', { headers: { 'x-report-token': cookieToken, origin: base } });
  assert.equal(r.status, 401);
  const g = await fetch(base + '/api/ping', { headers: { 'x-report-token': cookieToken, origin: base } });
  assert.equal(g.status, 401);
});

test('(d) a non-browser caller (no cookie, no Origin) may still present the header', async () => {
  const r = await fetch(base + '/api/reports/auth/me', { headers: { 'x-report-token': cookieToken } });
  assert.equal(r.status, 200);
});

test('(e) logout clears the cookie and ends the session', async () => {
  const r = await fetch(base + '/api/reports/auth/logout', { method: 'POST', headers: { cookie: `report_token=${cookieToken}`, origin: base } });
  assert.equal(r.status, 200);
  const sc = String(r.headers.get('set-cookie') || '');
  assert.match(sc, /report_token=;/);
  assert.match(sc, /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  const after = await fetch(base + '/api/reports/auth/me', { headers: { cookie: `report_token=${cookieToken}`, origin: base } });
  assert.equal(after.status, 401);
});
