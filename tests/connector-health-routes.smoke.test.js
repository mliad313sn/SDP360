'use strict';
// P4 / A2 — Connector Health through the real app: admin-only page data, an INJECTED connector failure (a failed
// run recorded by the sync runner) surfaces as error/unknown and never as 0 or green, fix tasks are idempotent and
// perimeter-bound, and the weekly-report "—" path opens a task for the editor's own site only.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'ch-'));
process.env.DASH_USER = process.env.DASH_USER || 'ch-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ch-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ch-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, tok = {}, siteA, siteB;
function call(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const headers = { 'x-report-token': token || '' };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const rq = http.request(base + path, { method, headers, agent: false }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let j = null; try { j = b ? JSON.parse(b) : null; } catch (_) { j = b; } resolve({ status: res.statusCode, body: j }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  siteA = sites[0]; siteB = sites[1];
  await require('../services/reportConfig').setConfig(rdb.db, { meraki_api_key: 'test-key-not-real', meraki_org_id: '1' }, 'test');
  // injected failure: the runner recorded a FAILED meraki.wan run (no successful run ever)
  const sync = require('../services/sync'); await sync.ensureReady(); const store = sync.getStore();
  const t0 = Date.now() - 5000; const id = await store.startRun('meraki.wan', t0, null);
  await store.finishRun(id, { finished_at: t0 + 1500, status: 'error', attempts: 3, error: 'connect ETIMEDOUT 10.0.0.1:443' });
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['admin']);
  tok.admin = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await rdb.createUser({ username: 'ch-ed', full_name: 'ch-ed', password: 'ch-ed-0000', roles: ['editor'], site_id: siteA.id });
  tok.ed = (await rdb.login('ch-ed', 'ch-ed-0000')).token;
  await rdb.createUser({ username: 'ch-view', full_name: 'ch-view', password: 'ch-view-0000', roles: ['viewer'], site_id: siteA.id });
  tok.view = (await rdb.login('ch-view', 'ch-view-0000')).token;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch (_) { /* closed */ } });

test('admin only: editor 403, no session 401', async () => {
  assert.strictEqual((await call('GET', '/api/connector-health', tok.ed)).status, 403);
  assert.strictEqual((await call('GET', '/api/connector-health', '')).status, 401);
  const page = await call('GET', '/connector-health.html', '');
  assert.strictEqual(page.status, 200);
});

test('injected Meraki failure surfaces as error with a plain cause; nothing reads 0 or ok without a measure', async () => {
  const r = await call('GET', '/api/connector-health', tok.admin);
  assert.strictEqual(r.status, 200);
  const m = r.body.connectors.find((c) => c.id === 'meraki');
  assert.strictEqual(m.state, 'error');
  assert.match(m.cause, /did not answer in time/);
  assert.strictEqual(m.last_success, null);
  assert.strictEqual(m.last_run_ms, 1500, 'last run duration from the runner started/finished stamps');
  assert.strictEqual(m.config.api_key, 'db');
  assert.match(m.config.runtime_source, /report_config/);
  assert.ok(m.coverage.pct !== 0 || m.coverage.expected > 0, 'a 0 % is only shown when sites were expected');
  const cloud = r.body.connectors.find((c) => c.id === 'sdp_cloud');
  assert.strictEqual(cloud.state, 'disarmed');
  for (const c of r.body.connectors) assert.notStrictEqual(c.state, 'ok', c.id + ' cannot be ok on an empty database');
  const v = await call('GET', '/api/value-metrics/connectors', tok.admin);
  assert.strictEqual(v.status, 200);
  assert.strictEqual(v.body.connectors_ok_pct, 0, 'measured: 0 of the armed connectors are ok');
});

test('fix tasks: editor opens one for their site (idempotent), not for another site; viewer refused; admin closes', async () => {
  const body = { connector: 'opmanager', site_id: siteA.id, scope: 'lan', cause: 'LAN availability unknown on the weekly report' };
  const a = await call('POST', '/api/connector-health/fix-tasks', tok.ed, body);
  assert.strictEqual(a.status, 201);
  assert.strictEqual(a.body.task.owner_role, 'Infrastructure owner', 'owner from the connector register, not the client');
  const again = await call('POST', '/api/connector-health/fix-tasks', tok.ed, { ...body, owner_role: 'me' });
  assert.strictEqual(again.status, 200); assert.strictEqual(again.body.task.id, a.body.task.id);
  assert.strictEqual((await call('POST', '/api/connector-health/fix-tasks', tok.ed, { ...body, site_id: siteB.id })).status, 403);
  assert.strictEqual((await call('POST', '/api/connector-health/fix-tasks', tok.view, body)).status, 403);
  assert.strictEqual((await call('POST', '/api/connector-health/fix-tasks', tok.admin, { connector: 'pronto', cause: 'x' })).status, 400);
  const list = await call('GET', '/api/connector-health/fix-tasks', tok.ed);
  assert.ok(list.body.tasks.every((t) => t.site_id === siteA.id));
  assert.strictEqual((await call('POST', `/api/connector-health/fix-tasks/${a.body.task.id}/close`, tok.ed, { status: 'done' })).status, 403, 'not the assigned owner');
  assert.strictEqual((await call('POST', `/api/connector-health/fix-tasks/${a.body.task.id}/close`, tok.admin, { status: 'dismissed' })).status, 400, 'dismiss needs a reason');
  const c = await call('POST', `/api/connector-health/fix-tasks/${a.body.task.id}/close`, tok.admin, { status: 'done', note: 'mapped' });
  assert.strictEqual(c.status, 200); assert.ok(c.body.task.closed_at);
  const h = await call('GET', '/api/connector-health', tok.admin);
  assert.strictEqual(h.body.connectors.find((x) => x.id === 'opmanager').open_tasks, 0);
});
