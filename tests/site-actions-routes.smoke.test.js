'use strict';
// SP1a — /api/reports/site-actions smoke. Boots the app in-process (start() is
// require.main-guarded → no port bind), seeds one meetings action for a site,
// and asserts the grouped payload + that the meetings reader flows through.
// Backends pinned sqlite. Run with --test-force-exit (top-level cron keeps the
// loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'siteact-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'siteact-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'siteact-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'siteact-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken;

function get(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + path,
      { headers: { 'x-report-token': token, 'x-dash-key': process.env.DASHBOARD_API_KEY } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    req.on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const mdb = require('../meetings-db');

  // Seed one non-closed meetings action for site MGO (created 2026-06-27).
  const db = mdb.getDB();
  const m = db.prepare("INSERT INTO md_meetings (reference, site_code, department, meeting_date, status) VALUES ('MGO_Test_2026-07','MGO','Technical Services','2026-07-01','signed')").run();
  db.prepare("INSERT INTO md_actions (meeting_id, description, owner_it, target_date, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(m.lastInsertRowid, 'Fix VSAT', 'Ousmane', '2026-07-01', 'open', '2026-06-27T00:00:00Z');

  const me = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('200 + three-group shape + the meetings action flows through', async () => {
  const r = await get('/api/reports/site-actions?site=MGO', adminToken);
  assert.equal(r.status, 200);
  assert.ok(r.body.groups && r.body.groups.meetings && r.body.groups.inspection && r.body.groups.report,
    'three theme groups present');
  assert.ok(r.body.groups.meetings.count >= 1, 'seeded meetings action present');
  const item = r.body.groups.meetings.items.find((i) => i.title === 'Fix VSAT');
  assert.ok(item, 'seeded action normalized into the payload');
  assert.equal(item.close.kind, 'inline');
  assert.ok(Number.isInteger(item.action_id) && item.action_id > 0, 'carries a real meetings action id for inline close');
  assert.strictEqual(item.project, null, 'F1: Meridian unconfigured → project badge absent (best-effort degrade, hub not blocked)');
  assert.equal(typeof r.body.totals.open, 'number');
});

test('unknown site → 200 empty groups, not 500', async () => {
  const r = await get('/api/reports/site-actions?site=ZZZ_NOPE', adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.groups.meetings.count, 0);
  assert.equal(r.body.groups.report.count, 0);
  assert.equal(r.body.totals.open, 0);
});
