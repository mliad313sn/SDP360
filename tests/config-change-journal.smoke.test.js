'use strict';
// E-A07 — PUT /api/reports/config journals every changed key (secrets: set/cleared only), carries warnings[];
// GET /api/reports/config/history (super_admin) reads them back.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'cfgj-'));
process.env.DASH_USER = process.env.DASH_USER || 'cfgj-super';
process.env.DASH_PASS = process.env.DASH_PASS || 'cfgj-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'cfgj-key-0123456789abcdef0123456789';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, superToken, viewerToken;
function req(method, p, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-report-token': token } : {}) } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return null; } })() })); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const su = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(su.id, ['super_admin']);
  superToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'cfgj-viewer', full_name: 'V', password: 'cfgj-pass-1111', role: 'viewer' });
  viewerToken = (await rdb.login('cfgj-viewer', 'cfgj-pass-1111')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const wait = () => new Promise((r) => setTimeout(r, 300));

test('a changed switch → one row with from/to/reason; unchanged keys → none; warnings[] carried', async () => {
  const r = await req('PUT', '/api/reports/config', superToken, { site_code_shared_block: '1', exec_view_lang: 'en', reason: 'pilot test' });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.warnings) && r.json.warnings.some((w) => w.key === 'site_code_shared_block'), 'prerequisite warning');
  assert.equal(r.json.site_code_shared_block, '1', 'nothing blocked');
  await wait();
  const h = await req('GET', '/api/reports/config/history?key=site_code_shared_block', superToken);
  assert.equal(h.status, 200);
  assert.equal(h.json.rows.length, 1);
  assert.deepEqual({ key: h.json.rows[0].key, from: h.json.rows[0].from, to: h.json.rows[0].to, reason: h.json.rows[0].reason }, { key: 'site_code_shared_block', from: '0', to: '1', reason: 'pilot test' });
  const all = await req('GET', '/api/reports/config/history', superToken);
  assert.ok(!all.json.rows.some((x) => x.key === 'exec_view_lang'), 'unchanged key not journalled');
  await req('PUT', '/api/reports/config', superToken, { site_code_shared_block: '1' });
  await wait();
  assert.equal((await req('GET', '/api/reports/config/history?key=site_code_shared_block', superToken)).json.rows.length, 1, 're-saving the same value adds nothing');
});

test('a secret never appears in the journal', async () => {
  const r = await req('PUT', '/api/reports/config', superToken, { smtp_pass: 'S3cret-value-xyz' });
  assert.equal(r.status, 200);
  await wait();
  const rdb = require('../reports-db');
  const rows = (await rdb.listSystemLog({ category: 'config' }, { limit: 200 })).rows;
  assert.ok(!JSON.stringify(rows).includes('S3cret-value-xyz'));
  const h = await req('GET', '/api/reports/config/history?key=smtp_pass', superToken);
  assert.deepEqual(h.json.rows.map((x) => x.change), ['set']);
});

test('history is super_admin only', async () => {
  assert.equal((await req('GET', '/api/reports/config/history', viewerToken)).status, 403);
  assert.equal((await req('GET', '/api/reports/config/history')).status, 401);
});
