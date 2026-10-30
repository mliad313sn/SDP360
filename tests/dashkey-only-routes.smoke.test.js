'use strict';
// Consolidation CG-08 (transplanted from the 1.11 line, WP-M02-003) — the dash key alone (no session)
// reaches ONLY the routes listed below on SDP360 2.0 (route probe, 2026-10-28). Restricting them waits
// on D-15 (inventory of server-to-server key clients); a NEW route answering the key alone fails here.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'dko-'));
for (const k of ['REPORTS_BACKEND', 'ASSETS_BACKEND', 'TRACKER_BACKEND', 'MEETINGS_BACKEND', 'INSPECTION_BACKEND']) process.env[k] = 'sqlite';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASHBOARD_API_KEY = 'dko-key-only';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { collect, concrete } = require('../tools/qa/route-matrix');

const KEY_ONLY_KNOWN = new Set(['GET /api/ping', ...['ticket-volume', 'changes', 'changes-it', 'resolution-by-site',
  'backlog-trend', 'incidents-volume', 'sla-by-category-week', 'sla-violated-by-cat', 'group-count', 'request-volume',
  'sla-by-group', 'cab-compliance', 'major-inc-by-month', 'major-inc-by-cat', 'major-inc-by-site'].map((v) => 'GET /api/data/' + v)]);
let server, base, routes;
before(async () => {
  const { app } = require('../server');
  routes = []; collect(app._router.stack, '', routes);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });
const call = (method, p, headers) => new Promise((resolve) => {
  const r = http.request(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, timeout: 8000 }, (x) => { x.resume(); x.on('end', () => resolve(x.statusCode)); });
  r.on('timeout', () => { r.destroy(); resolve('timeout'); }); r.on('error', () => resolve('error'));
  if (method !== 'GET' && method !== 'DELETE') r.write('{}'); r.end();
});
test('dash key alone reaches only the known legacy routes', async () => {
  const reached = [];
  for (const r of routes) {
    const p = concrete(r.path);
    if (!p || !p.startsWith('/api/') || r.method === 'HEAD') continue;
    const anon = await call(r.method, p, {});
    if (anon !== 401 && anon !== 403) continue;               // public by design — covered elsewhere
    const key = await call(r.method, p, { 'x-dash-key': process.env.DASHBOARD_API_KEY });
    if (key !== 401 && key !== 403) reached.push(`${r.method} ${r.path}`);
  }
  assert.deepEqual(reached.filter((id) => !KEY_ONLY_KNOWN.has(id)), [], 'new routes reachable with only the dash key');
});

test('EX-02 / D-15 evidence: a key-only call is recorded once a day per route and source (no secret stored)', async () => {
  const rdb = require('../reports-db');
  for (let i = 0; i < 3; i++) await call('GET', '/api/ping', { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'user-agent': 'scheduled-task-probe' });
  await new Promise((r) => setTimeout(r, 300));          // logEvent is fire-and-forget
  const rows = (((await rdb.listSystemLog({ action: 'dashkey_call' }, { limit: 50 })) || {}).rows || []).filter((r) => r.target === 'GET /api/ping' && String(r.details || '').includes('scheduled-task-probe'));
  assert.equal(rows.length, 1, 'once per day, not once per call');
  assert.ok(!JSON.stringify(rows[0]).includes(process.env.DASHBOARD_API_KEY), 'the key itself is never logged');
});
