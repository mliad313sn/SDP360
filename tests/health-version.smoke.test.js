'use strict';
// Consolidation P0-E (backlog E0.3) — authenticated runtime version/build endpoint.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'hv-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'hv-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, token;
const get = (p, headers = {}) => new Promise((resolve) => http.get(base + p, { headers }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b })); }));
before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'hv-viewer', full_name: 'V', password: 'hv-viewer-0000', roles: ['viewer'] });
  token = (await rdb.login('hv-viewer', 'hv-viewer-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
test('anonymous is refused', async () => {
  assert.equal((await get('/api/health/version')).status, 401);
});
test('a signed-in viewer gets version = package.json, a build id, node; nothing else', async () => {
  const r = await get('/api/health/version', { 'x-report-token': token });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.version, require('../package.json').version);
  assert.ok(j.build && typeof j.build === 'string');
  assert.match(j.node, /^v\d+/);
  assert.deepEqual(Object.keys(j).sort(), ['build', 'node', 'started_at', 'version']);
});
// F-ARCH-03 — the admin tier also gets the provenance block; a repository checkout has no installed manifest.
test('an admin gets the same four keys plus provenance (source known, artifact unknown in a checkout)', async () => {
  const rdb = require('../reports-db');
  await rdb.createUser({ username: 'hv-admin', full_name: 'A', password: 'hv-admin-0000', roles: ['admin'] });
  const t = (await rdb.login('hv-admin', 'hv-admin-0000')).token;
  const r = await get('/api/health/version', { 'x-report-token': t });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual(Object.keys(j).sort(), ['build', 'node', 'provenance', 'started_at', 'version']);
  assert.deepEqual(Object.keys(j.provenance).sort(), ['artifact', 'consistent', 'sbom', 'source']);
  assert.equal(j.provenance.source.version, require('../package.json').version);
  assert.ok(['git', 'none'].includes(j.provenance.source.commit_source));
  if (!_fs.existsSync(_p.join(__dirname, '..', 'manifest.json'))) {
    assert.equal(j.provenance.artifact, null); assert.equal(j.provenance.consistent, null);
  }
  assert.ok(!r.body.includes(_p.join(__dirname, '..')), 'no install path in the answer');
});
