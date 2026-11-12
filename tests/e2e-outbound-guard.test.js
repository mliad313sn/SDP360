'use strict';
// UAT-OI-07 (G1-SYNC) — the browser journeys' SERVER makes no external call. Proves the test-only guard
// (tests/e2e/fixtures/outboundGuard.js) refuses and records every non-loopback connection whatever the client
// (https, axios, fetch, raw net), lets loopback and the database through, and — on the real token-refresh path of
// server.js — that the harness setup (no Zoho credentials) produces ZERO attempts while a dummy pair (the old
// harness setup) produced a call to accounts.zoho.com.
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'oi07-'));
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = '';   // what the e2e harness sets
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const fetch = require('./_http-fetch');
const guardMod = require('./e2e/fixtures/outboundGuard');

let guard, server, base, token;
before(async () => {
  guard = guardMod.install({ allowHosts: guardMod.dbHosts(process.env.PG_URL || '') });
  const rdb = require('../reports-db');
  const { app } = require('../server');
  try { await rdb.createUser({ username: 'oi07_super', full_name: 'S', password: 'superpass12345', role: 'super_admin', roles: ['super_admin'] }); } catch (_) { /* rerun */ }
  token = (await rdb.login('oi07_super', 'superpass12345')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { if (server) server.close(); if (guard) guard.uninstall(); });

const blocked = (e) => e && (e.code === 'E2E_OUTBOUND_BLOCKED' || (e.cause && e.cause.code === 'E2E_OUTBOUND_BLOCKED'));

test('target(): host/port of every Socket#connect form; local sockets are not targets', () => {
  assert.deepStrictEqual(guardMod.target([[{ host: 'Accounts.Zoho.com', port: 443 }, null]]), { host: 'accounts.zoho.com', port: 443 });
  assert.deepStrictEqual(guardMod.target([{ port: 5432 }]), { host: 'localhost', port: 5432 });
  assert.deepStrictEqual(guardMod.target([587, 'smtp.office365.com']), { host: 'smtp.office365.com', port: 587 });
  assert.deepStrictEqual(guardMod.target([{ host: '[::1]', port: 1 }]), { host: '::1', port: 1 });
  assert.equal(guardMod.target([{ path: '/tmp/.s.PGSQL.5432' }]), null);
  assert.equal(guardMod.target(['/tmp/sock']), null);
});

test('every client is refused for an external host and the attempt is recorded; nothing leaves', async () => {
  guard.reset();
  await assert.rejects(new Promise((res, rej) => https.get('https://accounts.zoho.com/oauth/v2/token', res).on('error', rej)), blocked);
  await assert.rejects(require('axios').post('https://api.meraki.com/api/v1/organizations', {}), (e) => blocked(e) || /outbound guard/.test(e.message));
  await assert.rejects(globalThis.fetch('https://oneitsupport.endeavourmining.com/app/itdesk/api/v3/requests'), (e) => blocked(e) || /fetch failed/.test(e.message));
  await assert.rejects(new Promise((res, rej) => { const s = net.connect(587, 'smtp.office365.com', res); s.on('error', rej); }), blocked);
  const hosts = guard.attempts().map((a) => a.host);
  for (const k of guardMod.PROXY_VARS) assert.equal(process.env[k], undefined, k + ' cleared: a loopback proxy would carry the call out');
  assert.deepStrictEqual(hosts, ['accounts.zoho.com', 'api.meraki.com', 'oneitsupport.endeavourmining.com', 'smtp.office365.com']);
});

test('loopback and the test database stay reachable under the guard', async () => {
  guard.reset();
  const r = await fetch(base + '/api/reports/auth/me', { headers: { 'x-report-token': token } });
  assert.equal(r.status, 200);
  const one = await require('../reports-db').pgHandle().prepare('SELECT 1 AS one').get();
  assert.equal(one.one, 1);
  assert.deepStrictEqual(guard.attempts(), []);
});

test('real token-refresh path: harness setup (no Zoho credentials) → 0 attempts; old dummy pair → accounts.zoho.com refused', async () => {
  const call = () => fetch(base + '/api/integrations/analytics/test', { method: 'POST', headers: { 'x-report-token': token, 'content-type': 'application/json' }, body: '{}' });
  guard.reset();
  const r1 = await call();
  assert.equal(r1.status, 502, 'credentials missing → refresh fails');
  assert.deepStrictEqual(guard.attempts(), [], 'no connection attempted');

  for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = 'unused-in-e2e';   // the pre-OI-07 harness
  try {
    const r2 = await call();
    assert.equal(r2.status, 502);
    assert.deepStrictEqual(guard.attempts().map((a) => a.host), ['accounts.zoho.com'], 'the dummy pair called Zoho — refused by the guard');
  } finally {
    for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = '';
    require('../services/analyticsSettings')._invalidate();
  }
});

test('the e2e harness installs the guard, clears the Zoho credentials, and fails a journey on any server attempt', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
  const srv = read('tests/e2e/fixtures/server.js');
  assert.match(srv, /require\('\.\/outboundGuard'\)\.install\(\)/);
  assert.match(srv, /'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN'\]\) process\.env\[k\] = '';/);
  assert.doesNotMatch(srv, /unused-in-e2e/);
  assert.match(read('tests/e2e/fixtures/harness.js'), /assert\.deepStrictEqual\(app\.outbound\.attempts\(\), \[\]/);
  assert.match(read('tests/e2e/fixtures/harness.js'), /server_unexpected = app\.outbound\.attempts\(\)/);
  assert.match(read('tools/test/run-e2e.js'), /server_unexpected_count/);
});
