'use strict';
// UAT-OI-02 (G3-UX) — the sign-in limiter counted SUCCESSFUL sign-ins: 10 per 15 min per address, so a site whose
// people are all seen behind one address (NAT, shared kiosk) was locked out after 10 good sign-ins. Switch
// login_limit_failures_only ('0' = today): '1' counts only FAILED attempts (per address + login name, cleared by a
// success; per address alone at 5×; the per-account failure throttle forced on). Each test uses its own
// X-Forwarded-For address (trust proxy = loopback) so the buckets never mix.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'login-fo-'));
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'login-fo-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, reportConfig;
const PASS = (u) => u + '-good-pass-0000';
const login = (username, password, ip) => new Promise((resolve) => {
  const r = http.request(base + '/api/reports/auth/login', { method: 'POST', agent: false,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } },
  (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  r.end(JSON.stringify({ username, password }));
});
const sw = (v) => reportConfig.setConfig(rdb.db, { login_limit_failures_only: v }, 'test');
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); reportConfig = require('../services/reportConfig');
  for (const u of ['lfo-a', 'lfo-b', 'lfo-c', 'lfo-d', 'lfo-e']) await rdb.createUser({ username: u, full_name: u, password: PASS(u), roles: ['viewer'] });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('default is today: switch off, the 11th SUCCESSFUL sign-in from one address is refused', async () => {
  assert.equal((await reportConfig.getConfig(rdb.db)).login_limit_failures_only, '0');
  for (let i = 0; i < 10; i++) assert.equal((await login('lfo-a', PASS('lfo-a'), '10.9.0.1')).status, 200, 'success ' + (i + 1));
  const r = await login('lfo-a', PASS('lfo-a'), '10.9.0.1');
  assert.equal(r.status, 429);
});

test('switch on: 12 successful sign-ins from one address all pass (several colleagues behind one NAT)', async () => {
  await sw('1');
  for (let i = 0; i < 12; i++) {
    const u = ['lfo-a', 'lfo-b', 'lfo-c'][i % 3];
    assert.equal((await login(u, PASS(u), '10.9.0.2')).status, 200, 'success ' + (i + 1));
  }
});

test('11 failures are refused in both modes (the 11th attempt answers 429, even with the right password when on)', async () => {
  await sw('0');
  for (let i = 0; i < 10; i++) assert.equal((await login('lfo-b', 'wrong-pass-xx', '10.9.0.3')).status, 401);
  assert.equal((await login('lfo-b', 'wrong-pass-xx', '10.9.0.3')).status, 429, 'off: 11th refused');
  await sw('1');
  for (let i = 0; i < 10; i++) assert.equal((await login('lfo-c', 'wrong-pass-xx', '10.9.0.4')).status, 401);
  const r = await login('lfo-c', PASS('lfo-c'), '10.9.0.4');
  assert.equal(r.status, 429, 'on: 11th refused, password not even checked');
  assert.match(JSON.parse(r.body).error, /Too many/);
});

test('switch on: a success clears that address+name pair, and only that pair', async () => {
  await sw('1');
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 6; i++) assert.equal((await login('lfo-d', 'wrong-pass-xx', '10.9.0.5')).status, 401);
    assert.equal((await login('lfo-d', PASS('lfo-d'), '10.9.0.5')).status, 200, 'round ' + round);
  }
});

test('switch on: the per-account failure limit stays (failures spread over addresses still lock the name)', async () => {
  await sw('1');
  await reportConfig.setConfig(rdb.db, { auth_account_throttle_enabled: '0', auth_account_throttle_max: '3' }, 'test');
  for (let i = 0; i < 3; i++) assert.equal((await login('lfo-e', 'wrong-pass-xx', '10.9.1.' + i)).status, 401);
  assert.equal((await login('lfo-e', PASS('lfo-e'), '10.9.1.99')).status, 429, 'forced per-account throttle');
});

test('unit: settings / skip — off by default, on forces the account throttle', () => {
  const g = require('../services/loginGuard');
  assert.equal(g.settings({}).failuresOnly, false);
  assert.equal(g.settings({}).throttle.enabled, false);
  const on = g.settings({ login_limit_failures_only: '1' });
  assert.equal(on.failuresOnly, true); assert.equal(on.throttle.enabled, true); assert.equal(on.sprayMax, 50);
});
