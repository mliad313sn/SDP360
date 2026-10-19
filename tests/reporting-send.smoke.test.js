'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Task 8 smoke — POST /api/reports/send (coordinator) + preview / safety gate / validation.
// Boots the express app IN-PROCESS (start() is guarded → no port bind).
//
// NOTHING HERE MAY TOUCH REAL SMTP OR SPAWN CHROME. Every asserted path
// short-circuits before the mailer/renderPdf stage:
//   - preview=1                      → returns before recipient resolution
//   - unconfirmed + never_send=1     → skipped at the safety gate
//   - no auth / bogus type           → rejected at the gate/validation
// If a future assertion needs the SEND path, inject stubs via sendCoordinator's
// `deps` param — do not let this smoke reach a real transport.
//
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
// SQLite-path smoke — force it so a dev box whose .env pins REPORTS_BACKEND=postgres
// doesn't drag the harness onto the (uninitialised) PG adapter. Set BEFORE any
// require of server/reports-db, and before dotenv (which never overrides an
// already-set process.env var).
process.env.REPORTS_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'reporting-send-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'reporting-send-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'reporting-send-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'reporting-send-key';
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

  // Safety-gate fixture: HGO has a coordinator email that is NOT confirmed,
  // and the config keeps the never-send-unconfirmed rule ON (it is the
  // default, but pin it explicitly — this test is ABOUT that rule).
  const reportConfig = require('../services/reportConfig');
  const reportDirectory = require('../services/reportDirectory');
  await reportConfig.setConfig(rdb.db, { never_send_unconfirmed: '1' }, 'smoke');
  await reportDirectory.upsertRecipient(rdb.db, 'HGO', {
    site_name: 'Hounde',
    coordinator_name: 'Unconfirmed Person',
    coordinator_email: 'unconfirmed@example.invalid',
    coordinator_email_confirmed: 0,
    active: 1,
  }, 'smoke');

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
// Teardown is deliberate — a bare `server.close()` here fails the FILE while
// every assertion passes. fetch() (undici) pools its sockets keep-alive, so
// neither side drops them when the last test ends; --test-force-exit then calls
// process.exit() while those TCPSocketWraps are still closing, tripping a native
// libuv abort (`!(handle->flags & UV_HANDLE_CLOSING)`, win/async.c) on Node 24 /
// Windows. Bisected to "boot the app + one fetch" — it is not specific to these
// routes; reporting-routes.smoke.test.js only escapes it by running long enough
// for the sockets to drain first.
// Order: client agent → server-held connections → listener → a short settle
// (measured: 0ms crashed 6/6, 50ms crashed 0/6; 150ms for margin).
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

test('POST /api/reports/send?preview=1 (admin) → 200 {subject,html} and writes NO sent-log row', async () => {
  const before_ = sentLogCount();
  const res = await fetch(base + '/api/reports/send?type=coordinator&site=HGO&preview=1', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok(body.subject, 'preview body carries a subject');
  assert.ok(body.html && /<html/i.test(body.html), 'preview body carries the full html document');
  assert.equal(sentLogCount(), before_, 'preview must NOT write a report_sent_log row');
});

test('POST /api/reports/send with an UNCONFIRMED recipient → 200 {skipped} and sends nothing', async () => {
  const before_ = sentLogCount();
  const res = await fetch(base + '/api/reports/send?type=coordinator&site=HGO', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.skipped, true, 'safety gate skipped the send');
  assert.match(body.reason || '', /unconfirmed|no confirmed recipient/i, 'reason names the safety gate');
  assert.ok(!body.messageId, 'no message was sent');
  // The gate fires BEFORE the send, so no outcome row is recorded either.
  assert.equal(sentLogCount(), before_, 'a gated send writes no report_sent_log row');
});

// ── the unresolvable-site gate ───────────────────────────────────────────────
// Regression: sendCoordinatorReport validated only that `site` was non-empty. An
// unmapped/typo'd code degraded silently at EVERY reader (siteReport's _safe()
// zeroes each failed block; getSiteMonthlyMeetingSummary answers available:true
// with zeroed kpis for a well-formed-but-unknown code) and those zeros score
// 50/AMBER — a fabricated report. With a CONFIRMED address on file it was SENT.
// The recipients site_code field is free text, so a typo was all it took.
//
// This is a deps-injected unit test, per this file's header: it must prove the
// SITE guard fires, which means the recipient has to be confirmed — i.e. the
// unfixed code would have gone all the way to the mailer. Every edge is stubbed
// and asserted un-called, so nothing can reach SMTP or Chrome.
test('an unresolvable site code → {skipped} — no compose, no mail, no sent-log row', async () => {
  const { sendCoordinatorReport } = require('../services/sendCoordinator');
  const called = [];
  const before_ = sentLogCount();

  const out = await sendCoordinatorReport({
    db: rdb.db, site: 'ZZZ-TYPO', period: '2026-07', kind: 'weekly',
    cfg: { never_send_unconfirmed: '1' },
    deps: {
      // site_module_codes has no 'ZZZ-TYPO' → the guard must fire here.
      reportsDb: { getSiteIdByModuleCode: async () => null },
      // A CONFIRMED recipient: proves the SITE guard skipped, not the safety gate.
      reportDirectory: {
        listRecipients: async () => [{ site_code: 'ZZZ-TYPO', coordinator_email: 'real@example.invalid', coordinator_email_confirmed: 1, cc_emails: '' }],
        resolveFromRows: () => ({ to: 'real@example.invalid', cc: [] }),
      },
      siteReportData: async () => { called.push('compose-data'); return {}; },
      composeCoordinator: () => { called.push('compose-doc'); return { subject: 's', htmlBody: 'b', fullHtml: '<html>' }; },
      renderPdf: async () => { called.push('pdf'); return { ok: false, reason: 'stub' }; },
      buildMailer: () => ({ send: async () => { called.push('MAIL'); return { ok: true, messageId: 'x' }; } }),
      reportSentLog: {
        alreadySentToday: async () => { called.push('dedup'); return false; },
        record: async () => { called.push('LOG'); },
      },
    },
  });

  assert.equal(out.skipped, true, 'an unresolvable site must fail CLOSED, not compose a 50/AMBER fiction');
  assert.match(out.reason || '', /no meetings module code/i, 'reason names the unresolved site');
  assert.ok(!out.ok && !out.messageId, 'nothing was sent');
  assert.deepStrictEqual(called, [], `must skip BEFORE compose/pdf/mail/log — reached: ${called.join(', ')}`);
  assert.equal(sentLogCount(), before_, 'an unresolvable site writes no report_sent_log row');
});

test('a RESOLVABLE site still composes — the guard is not a blanket refusal', async () => {
  const { sendCoordinatorReport } = require('../services/sendCoordinator');
  const out = await sendCoordinatorReport({
    db: rdb.db, site: 'HGO', period: '2026-07', kind: 'weekly', preview: true,
    deps: { reportsDb: { getSiteIdByModuleCode: async () => ({ site_id: 1, name: 'Hounde', zoho_group: 'G' }) } },
  });
  assert.ok(out.preview, 'a resolvable site reaches the compose stage');
  assert.ok(out.subject, 'and produces a subject');
});

test('POST /api/reports/send WITHOUT auth → 401', async () => {
  const res = await fetch(base + '/api/reports/send?type=coordinator&site=HGO', { method: 'POST' });
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

test('POST /api/reports/send?type=bogus (admin) → 400', async () => {
  const res = await fetch(base + '/api/reports/send?type=bogus&site=HGO', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('POST /api/reports/send with no site (admin) → 400', async () => {
  const res = await fetch(base + '/api/reports/send?type=coordinator', {
    method: 'POST', headers: authHeaders(),
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});
