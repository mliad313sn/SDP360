'use strict';
// E-D07 — switch 0 → page + API 404; switch 1 → admin 200 / viewer 403; nothing written.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'dq-'));
process.env.DASH_USER = process.env.DASH_USER || 'dq-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'dq-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'dq-key-0123456789abcdef0123456789';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, superToken, viewerToken;
const get = (p, token) => new Promise((resolve, reject) => {
  http.get(base + p, { headers: token ? { 'x-report-token': token } : {} }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, text: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); }).on('error', reject);
});
const setOn = async (v) => { const rdb = require('../reports-db'); await require('../services/reportConfig').setConfig(rdb.db, { ui_data_quality_page: v }, 'test'); };
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'dq-viewer', full_name: 'V', password: 'dq-pass-1111', role: 'viewer' });
  viewerToken = (await rdb.login('dq-viewer', 'dq-pass-1111')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('switch 0 (default) → page and API 404', async () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_data_quality_page, '0');
  assert.equal((await get('/data-quality.html', superToken)).status, 404);
  assert.equal((await get('/api/data-quality', superToken)).status, 404);
});

test('switch 1 → admin 200 with composed cells, viewer 403, page served with nonce', async () => {
  await setOn('1');
  const r = await get('/api/data-quality', superToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.sources) && r.json.sources.length > 0);
  assert.ok(Array.isArray(r.json.sites));
  for (const s of r.json.sources) assert.notEqual(s.freshness.status, 'ok', 'nothing synced in a fresh test DB → never ok');
  assert.equal((await get('/api/data-quality', viewerToken)).status, 403);
  const page = await get('/data-quality.html', superToken);
  assert.equal(page.status, 200);
  assert.ok(!page.text.includes('%%CSP_NONCE%%'));
  await setOn('0');
});
