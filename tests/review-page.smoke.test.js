'use strict';
// Sub-project 3B-2b Task 2 smoke — GET /api/reports/review-data + the
// /it-review.html page route.
//
// Boots the express app IN-PROCESS (start() is guarded → no port bind).
// Run with --test-force-exit (top-level cron + startup setTimeout keep the loop alive).
//
// Harness copied from tests/reporting-routes.smoke.test.js. The backend pins must
// be set BEFORE any require of server/*-db, and before dotenv (which never
// overrides an already-set process.env var) — otherwise a dev box whose .env pins
// *_BACKEND=postgres drags this harness onto the uninitialised PG adapter.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
// ⚠️ loadReviewData reads BOTH the meetings AND inspection handles
// (services/reviewData.js:114-115) — without this pin the inspection side hits
// the un-inited pg adapter and every review-data request 500s.
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'review-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'review-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'review-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'review-smoke-key';
// server.js has a top-level REQUIRED_ENV presence check (process.exit(1) if unset).
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken;

before(async () => {
  const { app } = require('../server');        // start() guarded → no port bind
  const rdb = require('../reports-db');
  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  const sess = await rdb.login(process.env.DASH_USER, process.env.DASH_PASS);
  assert.ok(sess && sess.token, 'login seeded admin + returned a token');
  adminToken = sess.token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
// ⚠️ The settle window is load-bearing on Windows, not politeness.
// server.js schedules native async work at boot (the _rawCache disk load +
// its background refresh). With --test-force-exit, node calls process.exit()
// the moment the last test resolves — if that work is still in flight the
// process dies with STATUS_STACK_BUFFER_OVERRUN (0xC0000409), reported as a
// file-level 'test failed' with EVERY subtest green, which is maximally
// confusing. Empirically: <25ms → crashes every run, >=75ms → clean; 250ms is
// margin for a loaded box. reporting-routes.smoke.test.js only escapes this by
// running long enough to settle by accident, not by design.
after(async () => {
  try { server && server.close(); } catch {}
  await new Promise(r => setTimeout(r, 250));
});

const authHeaders = () => ({ 'x-report-token': adminToken });

test('GET /api/reports/review-data (authed) → 200 with the panel keys', async () => {
  const res = await fetch(base + '/api/reports/review-data', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  for (const k of ['leaderboard', 'sbRows', 'kpis', 'isDashboard']) {
    assert.ok(k in body, `body carries the '${k}' panel key`);
  }
  assert.ok(Array.isArray(body.kpis), 'kpis is an array the template can loop');
});

test('?view=scoreboard flips the view gates', async () => {
  const res = await fetch(base + '/api/reports/review-data?view=scoreboard', { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.isScoreboard, true, 'isScoreboard true');
  assert.strictEqual(body.isDashboard, false, 'isDashboard false');
});

test('?view=../../etc falls back to dashboard — the whitelist holds, no throw', async () => {
  const res = await fetch(base + '/api/reports/review-data?view=' + encodeURIComponent('../../etc'), { headers: authHeaders() });
  assert.equal(res.status, 200, 'a hostile view param must not 500');
  const body = await res.json();
  assert.strictEqual(body.isDashboard, true, 'fell back to the default view');
});

test('?asOf=garbage falls back to today → 200, not 500', async () => {
  const res = await fetch(base + '/api/reports/review-data?asOf=garbage', { headers: authHeaders() });
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert.ok('kpis' in body, 'still returns a usable payload');
});

test('GET /api/reports/review-data WITHOUT auth → 401', async () => {
  const res = await fetch(base + '/api/reports/review-data');
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
});

// ── the page route ───────────────────────────────────────────────────────────
// Task 2 owns the ROUTE; public/it-review.html is Task 3's deliverable. These two
// tests split accordingly: the wiring is asserted now (and is fully testable
// now), while the 200 assertion auto-activates the moment Task 3 lands rather
// than being faked green or deferred to a checklist.

test('GET /it-review.html is WIRED — the route exists (not a 404 fallthrough)', async () => {
  const res = await fetch(base + '/it-review.html');
  assert.notEqual(res.status, 404,
    'a 404 means the app.get route is missing and express.static fell through');
});

test('GET /it-review.html → 200, text/html', async (t) => {
  const page = _path.join(__dirname, '..', 'public', 'it-review.html');
  if (!_fs.existsSync(page)) {
    // Not a silent pass: the route is proven wired by the test above; this
    // asserts the served payload, which needs Task 3's markup to exist.
    return t.skip('public/it-review.html lands in Task 3 — route wiring asserted above');
  }
  const res = await fetch(base + '/it-review.html');
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.match(res.headers.get('content-type') || '', /text\/html/);
});
