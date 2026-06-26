'use strict';
// sqlite-mode route smoke — boots the express app IN-PROCESS (no port bind via the guarded start())
// and asserts the hot-path routes return 200 + sane JSON. Proves the 4D-wiring-1 async conversion
// doesn't break the live sqlite path. Run with --test-force-exit (top-level cron + a 30s startup
// setTimeout keep the loop alive). REPORTS_BACKEND unset → sqlite default.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'smoke-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset) — supply dummy
// ZOHO_* creds; they're never used (the smoke makes no Zoho call).
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, headers;

// Full request_records row template (sqlite @named writers need every column present).
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  site:null, tech_group:null, mode:null, impact:null, ...o });

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  // Seed a few request_records rows (recent) so the DB-backed routes return data instead of
  // falling through to the (dummy-cred) Zoho path and 500-ing.
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const C = `${ym}-05 09:00:00`;
  await rdb.upsertRequestBatch([
    _req({request_id:'SM1',display_id:'#SM1',created_time:C,pending_status:0,overdue_status:0,responded_time:`${ym}-05 10:00:00`,first_response_overdue:'false',mode:'Email',tech_group:'Hounde IT Agents',site:'Hounde'}),
    _req({request_id:'SM2',display_id:'#SM2',created_time:C,pending_status:0,overdue_status:1,responded_time:`${ym}-05 10:00:00`,first_response_overdue:'true',mode:'Web',tech_group:'Hounde IT Agents',site:'Hounde'}),
    _req({request_id:'SM3',display_id:'#SM3',created_time:C,pending_status:1,overdue_status:0,mode:'Phone',tech_group:'Hounde IT Agents',site:'Hounde'}),
  ]);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  headers = { 'X-Dash-Key': process.env.DASHBOARD_API_KEY, 'x-report-token': sess.token };
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

const ROUTES = [
  '/api/sync/status',
  '/api/metrics/requests',
  '/api/data/sla-trend',
  '/api/requests?limit=5',
  '/api/data/submission-channels',
  '/api/data/requests-raw',
  // 4D-wiring-2 cold-path routes (report builder + config + presets)
  '/api/reports',
  '/api/reports/sites',
  '/api/reports/departments',
  '/api/dashboard/presets?scope=tickets',
  '/api/risk-register-config/aliases',   // 4B-RR (requireReportSession-only → admin can hit)
];
for (const path of ROUTES) {
  test(`smoke 200: ${path}`, async () => {
    const res = await fetch(base + path, { headers });
    assert.equal(res.status, 200, `${path} → ${res.status}`);
    const body = await res.json();
    assert.ok(body && (Array.isArray(body) || typeof body === 'object'), `${path} JSON shape`);
  });
}
