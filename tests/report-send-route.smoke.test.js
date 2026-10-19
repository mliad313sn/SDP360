'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Task 1 smoke — POST /api/reports/send carries the optional recipient
// SELECTION from the JSON body through to sendCoordinatorReport.
//
// NOTHING HERE MAY TOUCH REAL SMTP OR SPAWN CHROME. Every asserted path
// short-circuits before the mailer/renderPdf stage:
//   - preview=1                       → returns before recipient resolution
//   - a selection naming a foreign     → refused at the selection gate, which
//     address                            sits BEFORE dedup/pdf/mail/log
//   - no auth / bogus type / no site  → rejected at the gate/validation
// The happy SEND path is covered by tests/send-coordinator-recipients.test.js
// with injected deps — do not let this smoke reach a real transport.
//
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
// SQLite-path smoke — force it so a dev box whose .env pins REPORTS_BACKEND=postgres
// doesn't drag the harness onto the (uninitialised) PG adapter. Set BEFORE any
// require of server/reports-db, and before dotenv.
process.env.REPORTS_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'report-send-route-'));
process.env.DASH_USER = process.env.DASH_USER || 'report-send-route-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'report-send-route-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'report-send-route-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset).
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, rdb;

const sentLogCount = () =>
  rdb.db.prepare('SELECT COUNT(*) AS n FROM report_sent_log').get().n;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  rdb = require('../reports-db');
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['super_admin']);   // /api/reports/send is super_admin-gated since 5e2f40e (2026-08-16)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  // HGO with a CONFIRMED coordinator: the safety gate passes, so a rejected
  // selection proves the SELECTION gate fired — not the pre-existing gate.
  const reportConfig = require('../services/reportConfig');
  const reportDirectory = require('../services/reportDirectory');
  await reportConfig.setConfig(rdb.db, { never_send_unconfirmed: '1' }, 'smoke');
  await reportDirectory.upsertRecipient(rdb.db, 'HGO', {
    site_name: 'Hounde',
    coordinator_name: 'Confirmed Person',
    coordinator_email: 'coord@example.invalid',
    coordinator_email_confirmed: 1,
    cc_emails: 'cc1@example.invalid',
    active: 1,
  }, 'smoke');

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
// Teardown order matters — see the long note in reporting-send.smoke.test.js:
// undici pools keep-alive sockets, and --test-force-exit exits while they are
// still closing, tripping a native libuv abort on Node 24 / Windows.
after(async () => {
  try {
    const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (d && d.destroy) await d.destroy();
  } catch {}
  try { server && server.closeAllConnections && server.closeAllConnections(); } catch {}
  try { if (server) await new Promise(r => server.close(r)); } catch {}
  await new Promise(r => setTimeout(r, 150));
});

const authHeaders = () => ({ 'x-report-token': adminToken });
const postJson = (url, body) => fetch(base + url, {
  method: 'POST',
  headers: { ...authHeaders(), 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('preview=1 → 200 {preview,subject} and writes NO sent-log row', async () => {
  const before_ = sentLogCount();
  const res = await fetch(base + '/api/reports/send?type=coordinator&site=HGO&preview=1', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.preview, true, 'the route reports a preview');
  assert.ok(body.subject, 'preview body carries a subject');
  assert.equal(sentLogCount(), before_, 'preview must NOT write a report_sent_log row');
});

// The core of Task 1: the body actually reaches the pipeline. If the route
// dropped `recipients`, this send would fall through to the confirmed
// coordinator and try to MAIL — so a 200 {skipped} here is the proof.
test('a body selection naming a foreign address → 200 {skipped}, nothing sent or logged', async () => {
  const before_ = sentLogCount();
  const res = await postJson('/api/reports/send?type=coordinator&site=HGO',
    { recipients: { to: 'not@allowed.com' } });

  assert.equal(res.status, 200, `expected 200 (not a 500), got ${res.status}`);
  const body = await res.json();
  assert.equal(body.skipped, true, 'the selection was refused');
  assert.match(body.reason || '', /not@allowed\.com/, 'the reason names the offending address');
  assert.match(body.reason || '', /not a confirmed recipient/i, 'the reason names the rule');
  assert.ok(!body.messageId, 'no message was sent');
  assert.equal(sentLogCount(), before_, 'a refused selection writes no report_sent_log row');
});

test('a body selection with a bad CC → 200 {skipped}, nothing sent', async () => {
  const before_ = sentLogCount();
  const res = await postJson('/api/reports/send?type=coordinator&site=HGO',
    { recipients: { to: 'coord@example.invalid', cc: ['nope@else.com'] } });

  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.skipped, true, 'a bad CC poisons the whole selection');
  assert.match(body.reason || '', /nope@else\.com/);
  assert.equal(sentLogCount(), before_, 'nothing logged');
});

test('an EMPTY body still previews — the selection is optional', async () => {
  const res = await postJson('/api/reports/send?type=coordinator&site=HGO&preview=1', {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.preview, true, 'no recipients key → unchanged behaviour');
});

test('WITHOUT auth → 401', async () => {
  const res = await fetch(base + '/api/reports/send?type=coordinator&site=HGO', { method: 'POST' });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

test('type=bogus → 400', async () => {
  const res = await fetch(base + '/api/reports/send?type=bogus&site=HGO', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('no site → 400', async () => {
  const res = await fetch(base + '/api/reports/send?type=coordinator', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});
