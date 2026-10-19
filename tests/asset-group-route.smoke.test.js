'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// Task 4 smoke — POST /api/reports/asset-group/send.
//
// The route is a THIN wrapper over tools/reports/send-asset-group.main(),
// mirroring POST /api/reports/scoreboard/send and /weekly/send. It deliberately
// does NOT go through POST /api/reports/send: that route hardcodes
// sendCoordinatorReport, so whitelisting 'asset_group' in its SEND_TYPES would
// compose a MONTHLY coordinator report, mail it, and log it under
// report_type='asset_group' — wrong content + poisoned dedup lane.
//
// NOTHING HERE MAY TOUCH REAL SMTP. Every asserted path short-circuits at the
// ARM GATE (asset_group_send_enabled defaults to '0'), which sits BEFORE the
// directory read, the digest, mail, and the sent-log row. The armed path is
// covered by tests/send-asset-group-cli.test.js with injected deps — do not let
// this smoke reach a real transport.
//
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
// SQLite-path smoke — force it so a dev box whose .env pins REPORTS_BACKEND=postgres
// doesn't drag the harness onto the (uninitialised) PG adapter. Set BEFORE any
// require of server/reports-db, and before dotenv.
process.env.REPORTS_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'asset-group-route-'));
process.env.DASH_USER = process.env.DASH_USER || 'asset-group-route-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'asset-group-route-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'asset-group-route-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset).
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, viewerToken, rdb;

const sentLogCount = () =>
  rdb.db.prepare('SELECT COUNT(*) AS n FROM report_sent_log').get().n;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  rdb = require('../reports-db');
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['super_admin']);   // the routes under test are super_admin-gated (admin settings → super_admin since 5e2f40e / 2026-08-16; IT Review → executive since 7162ac7)
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  // A NON-admin session — proves requireAdmin is on the route, not just
  // requireReportSession. A viewer holds a perfectly valid session token.
  const VU = 'asset-group-route-viewer', VP = 'asset-group-route-viewer-0000';
  if (!(rdb.listUsers() || []).some(u => u.username === VU)) {
    rdb.createUser({ username: VU, full_name: 'Route Viewer', password: VP, role: 'viewer', roles: ['viewer'] });
  }
  const vsess = await rdb.login(VU, VP);
  assert.ok(vsess && vsess.token, 'viewer logged in');
  viewerToken = vsess.token;

  // Explicitly DISARMED — the arm gate must be the thing that stops the run,
  // and it must stop it before any directory / SMTP work.
  const reportConfig = require('../services/reportConfig');
  await reportConfig.setConfig(rdb.db, { asset_group_send_enabled: '0' }, 'smoke');

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

const post = (url, token) => fetch(base + url, {
  method: 'POST',
  headers: token ? { 'x-report-token': token } : {},
});

test('preview=1 with an admin session → 200 (never a 500)', async () => {
  const res = await post('/api/reports/asset-group/send?preview=1', adminToken);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
});

test('WITHOUT a session → 401 or 403', async () => {
  const res = await post('/api/reports/asset-group/send?preview=1', null);
  assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
});

test('a NON-admin session → 403', async () => {
  const res = await post('/api/reports/asset-group/send?preview=1', viewerToken);
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});

// The safety property: disarmed is a clean, explicit refusal — not a crash,
// and not a silent success. It must also write NOTHING to the sent log.
test('disarmed config → 200 {sent:0, reason:"disabled"} and NO sent-log row', async () => {
  const before_ = sentLogCount();
  const res = await post('/api/reports/asset-group/send?preview=0', adminToken);
  assert.equal(res.status, 200, `expected 200 (not a 500), got ${res.status}`);
  const body = await res.json();
  assert.equal(body.sent, 0, 'a disarmed run sends nothing');
  assert.equal(body.reason, 'disabled', 'the reason names the arm gate');
  assert.equal(sentLogCount(), before_, 'a disarmed run writes no report_sent_log row');
});
