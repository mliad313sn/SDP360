'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Force the sqlite backends: these suites boot the app against throwaway sqlite DBs and must stay
// green regardless of the dev .env (which points prod-like *_BACKEND=postgres).
for (const k of ['REPORTS_BACKEND','ASSETS_BACKEND','TRACKER_BACKEND','MEETINGS_BACKEND','INSPECTION_BACKEND']) process.env[k] = 'sqlite';
// Task 6 smoke — public Executive View endpoints + admin editorial write.
// Boots the express app IN-PROCESS (start() is guarded → no port bind) and asserts:
//   • GET /api/exec/summary → 200 WITHOUT X-Dash-Key (genuinely public), aggregates-only (no PII).
//   • PUT /api/exec/editorial without auth → 401/403; with admin x-report-token → 200 + persists.
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'exec-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'exec-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'exec-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'exec-smoke-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset) — supply dummy
// ZOHO_* creds; they're never used (this smoke makes no Zoho call).
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, apiKey;

// Full request_records row template (sqlite @named writers need every column present).
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  site:null, tech_group:null, mode:null, impact:null, template:null, ...o });

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  apiKey = process.env.DASHBOARD_API_KEY;
  // Seed a few request_records rows (recent) so the summary readers return data instead of
  // falling through to the (dummy-cred) Zoho path.
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const C = `${ym}-05 09:00:00`;
  await rdb.upsertRequestBatch([
    _req({request_id:'EX1',display_id:'#EX1',created_time:C,pending_status:0,overdue_status:0,resolved_time:`${ym}-05 11:00:00`,responded_time:`${ym}-05 10:00:00`,first_response_overdue:'false',mode:'Email',tech_group:'Hounde IT Agents',site:'Hounde'}),
    _req({request_id:'EX2',display_id:'#EX2',created_time:C,pending_status:1,overdue_status:1,responded_time:`${ym}-05 10:00:00`,first_response_overdue:'true',mode:'Web',tech_group:'Hounde IT Agents',site:'Hounde'}),
  ]);
  // The default-admin seed only sets the legacy users.role column; grant the
  // 'admin' role in the user_roles table so requireAdmin (which reads via
  // userHasRole → user_roles) recognises the account.
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['super_admin']);   // the routes under test are super_admin-gated (admin settings → super_admin since 5e2f40e / 2026-08-16; IT Review → executive since 7162ac7)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  assert.ok(((sess.user && sess.user.roles) || []).includes('super_admin'), 'session carries super_admin role');
  adminToken = sess.token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('GET /api/exec/summary is PUBLIC (200 without X-Dash-Key) and aggregates-only', async () => {
  const res = await fetch(base + '/api/exec/summary'); // NO auth headers at all
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.ok(body && typeof body === 'object', 'JSON object body');
  assert.ok('status' in body, 'body has status');
  assert.ok('kpis' in body, 'body has kpis');
  // PII discipline: no ticket-level identifiers leak into the public payload.
  assert.ok(!/subject/i.test(text), 'no "subject" in public payload');
  assert.ok(!/requester/i.test(text), 'no "requester" in public payload');
  assert.ok(!/technician/i.test(text), 'no "technician" in public payload');
});

test('PUT /api/exec/editorial rejects unauthenticated writes', async () => {
  const res = await fetch(base + '/api/exec/editorial?period=2026-06', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ highlights: ['sneaky'], focus: [] }),
  });
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

test('PUT /api/exec/editorial persists for an admin and reflects on read', async () => {
  const highlights = ['Fleet SLA held above target', 'Zero P1 incidents this month'];
  const res = await fetch(base + '/api/exec/editorial?period=2026-06', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-report-token': adminToken },
    body: JSON.stringify({ highlights, focus: [{ title: 'Network resilience' }] }),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const saved = await res.json();
  assert.deepEqual(saved.highlights, highlights, 'response echoes saved highlights');

  // Reflected on a subsequent read via the db reader.
  const rdb = require('../reports-db');
  const stored = rdb.getExecEditorial('2026-06');
  assert.deepEqual(stored.highlights, highlights, 'persisted highlights readable');
  assert.equal(stored.focus.length, 1, 'persisted one focus area');
});
