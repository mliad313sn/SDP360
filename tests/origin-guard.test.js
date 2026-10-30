'use strict';
// Security review (CISO, 2026-10-29) — a state-changing browser request must come from the application's
// own origin (services/originGuard.js); server-to-server callers (no Origin) are not concerned.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'origin-guard-'));
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');
const G = require('../services/originGuard');

const req = (method, headers) => ({ method, headers: { host: 'itops-dashboard.edv-ops.com', ...headers } });
const ALLOWED = ['https://itops-dashboard.edv-ops.com'];

test('decide: safe methods and server-to-server calls pass; foreign origins are refused', () => {
  assert.equal(G.decide(req('GET', { origin: 'https://evil.example' }), ALLOWED), null, 'reads are not concerned');
  assert.equal(G.decide(req('POST', {}), ALLOWED), null, 'no Origin = server-to-server');
  assert.equal(G.decide(req('POST', { origin: 'https://itops-dashboard.edv-ops.com' }), ALLOWED), null);
  assert.equal(G.decide({ method: 'PUT', headers: { host: '127.0.0.1:3456', origin: 'http://127.0.0.1:3456' } }, ALLOWED), null, 'same host');
  assert.match(G.decide(req('POST', { origin: 'https://evil.example' }), ALLOWED), /cross-origin/);
  assert.match(G.decide(req('DELETE', { origin: 'null' }), ALLOWED), /opaque/);
  assert.match(G.decide(req('POST', { 'sec-fetch-site': 'cross-site' }), ALLOWED), /cross-site/);
  assert.equal(G.decide(req('POST', { 'sec-fetch-site': 'same-origin' }), ALLOWED), null);
});

let server, base;
before(async () => {
  const { app } = require('../server');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('the server refuses a cross-origin login attempt before any handler runs', async () => {
  const body = JSON.stringify({ username: 'nobody', password: 'nothing-here' });
  const evil = await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).code, 'CROSS_ORIGIN');
  const own = await fetch(base + '/api/reports/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body });
  assert.notEqual(own.status, 403, 'own origin reaches the handler');
});
