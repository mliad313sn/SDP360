'use strict';
// V1a T8 — /api/analytics/opmanager/* smoke. Boots the app in-process (start() is
// require.main-guarded → no port bind), seeds ONE infra_metric_snapshot for site MGO,
// and asserts: availability fills the 4 families (present → value, absent → {null,'none'},
// NEVER 0); unknown site → 200 empty not 500; coverage degrades to a well-formed empty
// summary (Analytics unconfigured), not 500; auth gate 401 without a token. sqlite-pinned.
// Run with --test-force-exit (top-level cron keeps the loop alive).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'opmroute-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'opmroute-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'opmroute-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'opmroute-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, mgoSiteId;

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    const req = http.get(base + path, { headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    req.on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');

  const mgo = await rdb.getSiteIdByModuleCode('meetings', 'MGO');
  assert.ok(mgo && mgo.site_id, 'MGO resolves to a site_id (meetings namespace)');
  mgoSiteId = mgo.site_id;

  // Seed ONE current-week LAN snapshot for MGO (fresh — collected today).
  const today = new Date().toISOString().slice(0, 10);
  await rdb.upsertInfraSnapshots([{
    site_id: mgoSiteId, period_type: 'week', period_start: today, period_end: today,
    kpi_family: 'lan', metric_name: 'availability', metric_value: 99.4, target_value: 99,
    status_color: 'green', trend: 'up', source: 'analytics_opmanager', source_view: 'V1',
    data_through: today, device_count: 12, included_device_count: 10,
    collected_at: today + 'T05:10:00Z', raw_json: null,
  }]);

  const me = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('availability?site=MGO fills the 4 families — present has value, absent is null/none (NEVER 0)', async () => {
  const r = await get('/api/analytics/opmanager/availability?site=MGO&period=week', adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.site_id, mgoSiteId);
  assert.ok(Array.isArray(r.body.families));
  const fams = Object.fromEntries(r.body.families.map((f) => [f.kpi_family, f]));
  assert.deepEqual(Object.keys(fams).sort(), ['lan', 'servers', 'wan', 'wifi']);

  assert.equal(fams.lan.metric_value, 99.4);
  assert.equal(fams.lan.status_color, 'green');
  assert.equal(fams.lan.target, 99);          // renamed from target_value
  assert.equal(fams.lan.trend, 'up');
  assert.equal(fams.lan.stale, false);         // collected today

  for (const k of ['wifi', 'wan', 'servers']) {
    assert.strictEqual(fams[k].metric_value, null, `${k} absent → null (never 0)`);
    assert.equal(fams[k].status_color, 'none', `${k} absent → status none`);
    assert.notStrictEqual(fams[k].metric_value, 0, `${k} must never be 0 for absence`);
    assert.ok(typeof fams[k].target === 'number', `${k} carries a target from opm_targets`);
  }
});

test('unknown site → 200 empty, not 500', async () => {
  const r = await get('/api/analytics/opmanager/availability?site=ZZZNOPE&period=week', adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.site_id, null);
  assert.deepEqual(r.body.families, []);
});

test('coverage degrades to a well-formed empty summary when Analytics is unconfigured (not 500)', async () => {
  const r = await get('/api/analytics/opmanager/coverage', adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.ok('reason' in r.body);
});

test('auth gate — no token → 401', async () => {
  const r = await get('/api/analytics/opmanager/availability?site=MGO&period=week', null);
  assert.equal(r.status, 401);
});

test('coverage: REST device list when opmanager configured (available:true, source rest)', async () => {
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  // a tiny local OpManager stand-in returning a device envelope
  const devSrv = await new Promise((resolve) => {
    const s = http.createServer((rq, rs) => {
      rs.setHeader('content-type', 'application/json');
      rs.end(JSON.stringify({ listDevices: [
        { name: 'MGO-SW-01', type: 'Meraki MS Series', category: 'Meraki Switch', probeName: 'Mana' },
        { name: 'MGO-UPS-01', type: 'UPS', category: 'UPS', probeName: 'Mana' },
        { name: 'MGO-F/W-01', type: 'Meraki MX Series', category: 'Meraki Security', probeName: 'Mana' },
      ], records: 3 }));
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const devBase = `http://127.0.0.1:${devSrv.address().port}`;
  await reportConfig.setConfig(rdb.db, { opmanager_api_key: 'K', opmanager_base_url: devBase, opmanager_tls_insecure: '0' }, 'test');
  try {
    const r = await get('/api/analytics/opmanager/coverage', adminToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.available, true);
    assert.equal(r.body.source, 'opmanager_rest');
    assert.equal(r.body.total, 3);
    assert.ok(r.body.excluded >= 1, 'UPS excluded');
    assert.ok(r.body.by_family, 'by_family present');
  } finally {
    await reportConfig.setConfig(rdb.db, { opmanager_api_key: '_CLEAR_', opmanager_base_url: '', opmanager_tls_insecure: '1' }, 'test');
    devSrv.close();
  }
});

test('wan summary + trend read wan_link_snapshots (V1b-D)', async () => {
  const rdb = require('../reports-db');
  const today = new Date().toISOString().slice(0, 10);
  await rdb.upsertWanSnapshots([
    { site_id: mgoSiteId, uplink: 'wan1', period_type: 'week', period_start: today, period_end: today,
      availability_pct: 99.86, status_color: 'green', loss_pct_avg: 0.08, latency_ms_avg: 26.1, jitter_ms_avg: 2.17,
      device_serial: 'Q2-AB', network_id: 'N1', data_through: today, collected_at: today + 'T05:20:00Z', source: 'meraki_api', raw_json: null },
    { site_id: mgoSiteId, uplink: 'wan2', period_type: 'week', period_start: today, period_end: today,
      availability_pct: 97.87, status_color: 'orange', loss_pct_avg: 1.79, latency_ms_avg: 33.5, jitter_ms_avg: 6.0,
      device_serial: 'Q2-AB', network_id: 'N1', data_through: today, collected_at: today + 'T05:20:00Z', source: 'meraki_api', raw_json: null },
  ]);

  const sum = await get('/api/analytics/wan/summary?period=week', adminToken);
  assert.equal(sum.status, 200);
  const site = (sum.body.sites || []).find(s => s.site_id === mgoSiteId);
  assert.ok(site, 'seeded site in summary');
  assert.equal(site.uplinks.length, 2);
  assert.ok(site.uplinks.find(u => u.uplink === 'wan1' && u.availability_pct === 99.86));

  const tr = await get('/api/analytics/wan/trend?site=MGO&period=week', adminToken);
  assert.equal(tr.status, 200);
  assert.equal(tr.body.site_id, mgoSiteId);
  const wan1 = (tr.body.series || []).find(s => s.uplink === 'wan1');
  assert.ok(wan1 && wan1.points.length >= 1, 'wan1 trend series present');
});

test('wan trend unknown site → empty, not 500; no token → 401', async () => {
  const r = await get('/api/analytics/wan/trend?site=ZZZNOPE&period=week', adminToken);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.series, []);
  const r2 = await get('/api/analytics/wan/summary?period=week', null);
  assert.equal(r2.status, 401);
});

function post(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const req = http.request(base + path, { method: 'POST', headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    req.on('error', reject); req.end('{}');
  });
}

// The sync routes need requireReportSession BEFORE requireAdmin — without it
// req.reportUser is undefined and requireAdmin 403s "Admin only" for EVERYONE
// (incl. super_admin). A valid admin session must pass the gate (config-gated
// sync then self-skips → 200 {skipped}); no token must be 401, not 403.
test('wan + opmanager sync: admin session passes the gate (not 403); no token → 401', async () => {
  const wan = await post('/api/analytics/wan/sync', adminToken);
  assert.notEqual(wan.status, 403, 'admin session must NOT get 403 Admin only');
  assert.equal(wan.status, 200);
  assert.equal(wan.body.skipped, true, 'meraki unconfigured → self-skips');

  const opm = await post('/api/analytics/opmanager/sync', adminToken);
  assert.notEqual(opm.status, 403, 'admin session must NOT get 403 Admin only');
  assert.equal(opm.status, 200);

  const noTok = await post('/api/analytics/wan/sync', null);
  assert.equal(noTok.status, 401, 'no session → 401 (requireReportSession runs first), not 403');
});
