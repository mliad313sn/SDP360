'use strict';
// E-Q07 — GET /api/health/deps: admin tier, unknown items reported unknown, a stale job reported stale.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'hdeps-'));
process.env.DASH_USER = process.env.DASH_USER || 'hdeps-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'hdeps-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'hdeps-key-0123456789abcdef0123456789';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, superToken, viewerToken;
const get = (p, token) => new Promise((resolve, reject) => {
  http.get(base + p, { headers: token ? { 'x-report-token': token } : {} }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })(), text: b })); }).on('error', reject);
});
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'hdeps-viewer', full_name: 'V', password: 'hdeps-pass-1111', role: 'viewer' });
  viewerToken = (await rdb.login('hdeps-viewer', 'hdeps-pass-1111')).token;
  const sync = require('../services/sync'); await sync.ensureReady();
  const old = new Date(Date.now() - 10 * 3600000).toISOString();
  await rdb.pgHandle().prepare(`INSERT INTO sync_runs (job, started_at, finished_at, status) VALUES ('zoho.survey', ?, ?, 'ok')`).run(old, old);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('viewer 403, anonymous 401', async () => {
  assert.equal((await get('/api/health/deps', viewerToken)).status, 403);
  assert.equal((await get('/api/health/deps')).status, 401);
});

test('admin: postgres ok, unknown items unknown, stale job stale, no secret in the answer', async () => {
  const r = await get('/api/health/deps', superToken);
  assert.equal(r.status, 200);
  const { items, sync_jobs, overall } = r.json;
  assert.equal(items.postgres.status, 'ok');
  assert.equal(items.smtp.status, 'unknown');
  assert.equal(items.restore_drill.status, 'unknown', 'no drill recorded');
  assert.equal(items.backup.status, 'unknown', 'no backup run recorded');
  assert.notEqual(items.zoho_token.status, 'ok', 'the test boot never got a real token');
  assert.equal(sync_jobs.find((j) => j.job === 'zoho.survey').status, 'stale');
  assert.equal(sync_jobs.find((j) => j.job === 'zoho.requests').status, 'unknown');
  assert.notEqual(overall, 'ok');
  assert.ok(!r.text.includes(process.env.DASHBOARD_API_KEY));
});
