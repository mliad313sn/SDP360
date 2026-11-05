'use strict';
// SEC-01 (parity check vs 1.11) — the login limiter is per-IP only and counts every attempt, so a guessing run
// spread over several addresses is never slowed for one account. auth_account_throttle_enabled ('0' = today)
// adds a per-ACCOUNT bucket of FAILED attempts (rate_limit_hits, scope 'login-user'): over the cap the account
// answers 429 without the password even being checked; a success clears the bucket.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'acct-thr-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'acct-thr-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, reportConfig;
const login = (username, password) => new Promise((resolve) => {
  const r = http.request(base + '/api/reports/auth/login', { method: 'POST', agent: false, headers: { 'content-type': 'application/json' } },
    (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.end(JSON.stringify({ username, password }));
});
before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db'); reportConfig = require('../services/reportConfig');
  for (const u of ['thr-a', 'thr-b']) await rdb.createUser({ username: u, full_name: u, password: u + '-good-pass-0000', roles: ['viewer'] });
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('switch off (default): failures never lock the account — today\'s behaviour', async () => {
  assert.equal((await reportConfig.getConfig(rdb.db)).auth_account_throttle_enabled, '0');
  for (let i = 0; i < 3; i++) assert.equal(await login('thr-a', 'wrong-pass-xx'), 401);
  assert.equal(await login('thr-a', 'thr-a-good-pass-0000'), 200);
});

test('switch on: after `max` failures the account answers 429 even with the right password; other accounts unaffected', async () => {
  await reportConfig.setConfig(rdb.db, { auth_account_throttle_enabled: '1', auth_account_throttle_max: '2' }, 'test');
  assert.equal(await login('THR-B', 'wrong-pass-xx'), 401);
  assert.equal(await login('thr-b', 'wrong-pass-xx'), 401);
  assert.equal(await login('thr-b', 'thr-b-good-pass-0000'), 429, 'bucket is per account, case-insensitive');
  assert.equal(await login('thr-a', 'thr-a-good-pass-0000'), 200, 'another account is not blocked');
});
