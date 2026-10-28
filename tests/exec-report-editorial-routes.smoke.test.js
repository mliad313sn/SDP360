'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Task 1 smoke — GET/PUT /api/reports/exec-editorial, the server surface over the
// deck builder's monthly analysis store. Boots the express app IN-PROCESS (start()
// is guarded by require.main → no port bind, so the Zoho/PG boot steps never run).
// Backends pinned to sqlite against a throwaway SDP_DATA_DIR — set BEFORE any
// require of server/reports-db, and before dotenv (which never overrides an
// already-set var). Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'exec-ed-routes-'));
process.env.DASH_USER = process.env.DASH_USER || 'exec-ed-route-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'exec-ed-route-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'exec-ed-route-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken;
const URL_ = '/api/reports/exec-editorial';

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');

  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  (await rdb.setUserRoles(me.id, ['admin']));
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const auth = () => ({ 'x-report-token': adminToken });
const put = (qs, body, headers) => fetch(base + URL_ + qs, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', ...(headers || auth()) },
  body: JSON.stringify(body),
});

test('GET absent (period, scope) → 200 with payload:null', async () => {
  const res = await fetch(base + URL_ + '?period=2026-07&scope=ops', { headers: auth() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.strictEqual(body.payload, null, 'an unset key reads back as payload:null');
});

test('PUT then GET round-trips the payload', async () => {
  const wr = await put('?period=2026-07&scope=ops', { payload: { goal: 'x' } });
  assert.equal(wr.status, 200, `PUT expected 200, got ${wr.status}`);
  assert.strictEqual((await wr.json()).ok, true, 'PUT answers {ok:true}');

  const rd = await fetch(base + URL_ + '?period=2026-07&scope=ops', { headers: auth() });
  assert.equal(rd.status, 200);
  assert.strictEqual((await rd.json()).payload.goal, 'x', 'the payload came back from the server');
});

test('a commentary scope is independent of the ops scope in the same period', async () => {
  await put('?period=2026-07&scope=commentary:MANA:Operations', { payload: { 'f-exec': 'mana' } });
  const rd = await fetch(base + URL_ + '?period=2026-07&scope=commentary:MANA:Operations', { headers: auth() });
  assert.strictEqual((await rd.json()).payload['f-exec'], 'mana');
  const ops = await fetch(base + URL_ + '?period=2026-07&scope=ops', { headers: auth() });
  assert.strictEqual((await ops.json()).payload.goal, 'x', 'the ops scope was not clobbered');
});

test('malformed or missing period → 400 on GET and PUT', async () => {
  for (const qs of ['?period=2026-7&scope=ops', '?period=abc&scope=ops', '?scope=ops', '?period=&scope=ops']) {
    const g = await fetch(base + URL_ + qs, { headers: auth() });
    assert.equal(g.status, 400, `GET ${qs} must be 400, got ${g.status}`);
    const p = await put(qs, { payload: { goal: 'nope' } });
    assert.equal(p.status, 400, `PUT ${qs} must be 400, got ${p.status}`);
  }
});

test('absent, blank or over-long scope → 400 on GET and PUT', async () => {
  const long = 'c'.repeat(121);
  for (const qs of ['?period=2026-07', '?period=2026-07&scope=', '?period=2026-07&scope=%20',
                    `?period=2026-07&scope=${long}`]) {
    const g = await fetch(base + URL_ + qs, { headers: auth() });
    assert.equal(g.status, 400, `GET ${qs} must be 400, got ${g.status}`);
    const p = await put(qs, { payload: { goal: 'nope' } });
    assert.equal(p.status, 400, `PUT ${qs} must be 400, got ${p.status}`);
  }
});

test('a scope of exactly 120 chars is accepted (the boundary is inclusive)', async () => {
  const at120 = 'c'.repeat(120);
  const res = await fetch(base + URL_ + `?period=2026-07&scope=${at120}`, { headers: auth() });
  assert.equal(res.status, 200, `120-char scope must be accepted, got ${res.status}`);
});

test('no session → 401/403 on GET and PUT', async () => {
  const g = await fetch(base + URL_ + '?period=2026-07&scope=ops');
  assert.ok([401, 403].includes(g.status), `unauthenticated GET must be 401/403, got ${g.status}`);
  const p = await put('?period=2026-07&scope=ops', { payload: { goal: 'nope' } }, {});
  assert.ok([401, 403].includes(p.status), `unauthenticated PUT must be 401/403, got ${p.status}`);
  // …and the unauthenticated PUT changed nothing.
  const rd = await fetch(base + URL_ + '?period=2026-07&scope=ops', { headers: auth() });
  assert.strictEqual((await rd.json()).payload.goal, 'x', 'the stored payload survived the rejected write');
});
