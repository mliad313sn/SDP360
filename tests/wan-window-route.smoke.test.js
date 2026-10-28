'use strict';
// /api/analytics/wan/summary window alignment — boots the app in-process (start() is
// require.main-guarded → no port bind), seeds a week + month wan snapshot for MGO wan1, arms the
// poller heartbeat (wan_poll_last_run) with an old first-run so the denominator isn't clamped, then
// asserts the returned `window` mirrors merakiWindow(period): days = 1/7/30, to = start of today
// (UTC), and 'day' still returns the site structure (from the week snapshot). sqlite-pinned.
// Run with --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wanwin-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'wanwin-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wanwin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wanwin-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { merakiWindow } = require('../services/wanWindow');

let base, token;
function _parse(b) { if (!b) return null; try { return JSON.parse(b); } catch { return b; } }
function get(path) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    const req = http.get(base + path, { headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: _parse(b) })); });
    req.on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');

  const mgo = await rdb.getSiteIdByModuleCode('meetings', 'MGO');
  assert.ok(mgo && mgo.site_id, 'MGO resolves to a site_id');
  const sid = mgo.site_id;

  // week + month snapshots so latestPerSite yields a site for every period (day borrows week).
  await rdb.upsertWanSnapshots([
    { site_id: sid, sub_site: '', uplink: 'wan1', period_type: 'week', period_start: '2026-08-11', period_end: '2026-08-17', availability_pct: 99, status_color: 'green', source: 'test' },
    { site_id: sid, sub_site: '', uplink: 'wan1', period_type: 'month', period_start: '2026-08-01', period_end: '2026-08-31', availability_pct: 99, status_color: 'green', source: 'test' },
  ]);
  // Arm the poller heartbeat; first-run far in the past so the window start is NOT clamped.
  await reportConfig.setConfig(rdb.db, { wan_poll_last_run: '2026-08-01T00:00:00.000Z', wan_poll_first_run: '2020-01-01T00:00:00.000Z' }, 'test');

  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  (await rdb.setUserRoles(me.id, ['admin']));
  token = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  await new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => { base = 'http://127.0.0.1:' + s.address().port; resolve(); }); });
});

for (const period of ['day', 'week', 'month']) {
  test(`summary window mirrors merakiWindow('${period}')`, async () => {
    const r = await get('/api/analytics/wan/summary?period=' + period);
    assert.equal(r.status, 200);
    assert.equal(r.body.poll_active, true, 'poller armed');
    assert.ok(Array.isArray(r.body.sites) && r.body.sites.length >= 1, 'at least one site (structure)');
    const w = merakiWindow(period, Date.now());
    assert.ok(r.body.window, 'window present');
    assert.equal(r.body.window.days, w.days);
    assert.equal(r.body.window.to, w.toISO, 'window ends at start-of-today (UTC), i.e. yesterday complete');
    // PRIMARY = the snapshot's loss<100 "% Time Up" (99), preserved — NOT overwritten by the
    // event-based figure; the event value (no outage seeded → 100) becomes the secondary.
    const u = r.body.sites[0].uplinks[0];
    assert.equal(u.availability_pct, 99, '% Time Up = snapshot value, preserved as primary');
    assert.equal(u.avail_event_pct, 100, 'event-based (no outage) → secondary avail_event_pct');
    assert.equal(u.basis, 'timeup');
  });
}

test("bogus period falls back to week (days=7), never 500", async () => {
  const r = await get('/api/analytics/wan/summary?period=bogus');
  assert.equal(r.status, 200);
  assert.equal(r.body.window.days, 7);
});
