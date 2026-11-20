'use strict';
// P11 r5 N-12 — a database stall used to log users out. A pool-acquire timeout (typed DB_BUSY, fix 17) was swallowed
// by the global /api/ gate into "no user" → 401, and by requireReportSession into 500 "Auth check failed"; the browser
// (public/auth.js) answers a 401 on /api/reports/auth/me with clearSession() + redirect to login. Both layers now
// answer 503 database_busy + Retry-After for DB_BUSY, and auth.js keeps the session on any non-401 status.
// The proof uses a REAL pool of ONE client held by a long statement (no stubbed rdb).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'auth-db-busy-'));
process.env.DASH_USER = process.env.DASH_USER || 'busy-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'busy-pass-00000';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fetch = require('./_http-fetch');

let server, base, cookie, rdb;
const prev = { max: process.env.PG_POOL_MAX, to: process.env.PG_POOL_ACQUIRE_TIMEOUT_MS };

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  // log in on the normal pool, then shrink the reports pool to ONE client with a short acquire bound
  const res = await fetch(base + '/api/reports/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.DASH_USER, password: process.env.DASH_PASS }),
  });
  assert.equal(res.status, 200, 'login works before the stall');
  cookie = 'report_token=' + /report_token=([^;]+)/.exec(String(res.headers.get('set-cookie')))[1];
  process.env.PG_POOL_MAX = '1'; process.env.PG_POOL_ACQUIRE_TIMEOUT_MS = '400';
  const q = console.log; console.log = () => {};
  try { await rdb.initPgReports(); } finally { console.log = q; }
});
after(async () => {
  if (prev.max == null) delete process.env.PG_POOL_MAX; else process.env.PG_POOL_MAX = prev.max;
  if (prev.to == null) delete process.env.PG_POOL_ACQUIRE_TIMEOUT_MS; else process.env.PG_POOL_ACQUIRE_TIMEOUT_MS = prev.to;
  try { server && server.close(); } catch {}
});

async function whileHeld(fn) {
  const held = rdb.pgHandle().prepare('SELECT pg_sleep(2.5) AS slept').get();
  await new Promise((r) => setTimeout(r, 100));
  const errLog = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = errLog; await held; }
}

test('pool of 1 held: the global /api/ gate answers 503 database_busy + Retry-After, never 401', async () => {
  const r = await whileHeld(() => fetch(base + '/api/ping', { headers: { cookie, origin: base } }));
  assert.equal(r.status, 503, 'DB_BUSY is not "unauthorised"');
  assert.equal(r.headers.get('retry-after'), '5');
  const b = await r.json();
  assert.equal(b.error, 'database_busy');
  assert.equal(b.code, 'DB_BUSY');
});

test('pool of 1 held: requireReportSession (/api/reports/auth/me) answers 503, never 500 / 401', async () => {
  const r = await whileHeld(() => fetch(base + '/api/reports/auth/me', { headers: { cookie, origin: base } }));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('retry-after'), '5');
  assert.equal((await r.json()).error, 'database_busy');
});

test('after the stall the same session still authenticates (it was never invalidated)', async () => {
  const r = await fetch(base + '/api/reports/auth/me', { headers: { cookie, origin: base } });
  assert.equal(r.status, 200);
});

test('public/auth.js logs out ONLY on 401 — a 503 keeps the session', () => {
  const src = _fs.readFileSync(_path.join(__dirname, '..', 'public', 'auth.js'), 'utf8').replace(/\r\n/g, '\n');
  const i = src.indexOf("fetch('/api/reports/auth/me'");
  assert.ok(i > 0, 'the background session check exists');
  const block = src.slice(i, src.indexOf('.catch(', i));
  assert.match(block, /r\.status === 401\)\s*\{\s*clearSession\(\);/, 'clearSession only under the 401 branch');
  assert.equal((block.match(/clearSession\(\)/g) || []).length, 1, 'no other logout path in the check');
  assert.match(block, /r\.status === 503[^\n]*return/, '503 (database busy) returns without logging out');
});
