'use strict';
// A-18b — WAN "% Time Up" calibration is VISIBLE, never silently changed. The default of
// wan_timeup_loss_pct stays '100' (today's production behaviour); /wan/summary says whether the
// effective value is calibrated (present and < 100) so wan.html can show a banner; the CLI
// tools/meraki/check-timeup-calibration.js reports and, only with --apply=<n>, writes the value.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wantimeup-'));
process.env.DASH_USER = process.env.DASH_USER || 'wantimeup-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wantimeup-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wantimeup-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, rdb, reportConfig;

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    http.get(base + path, { headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); })
      .on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  reportConfig = require('../services/reportConfig');
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  const mgo = await rdb.getSiteIdByModuleCode('meetings', 'MGO');
  const today = new Date().toISOString().slice(0, 10);
  await rdb.upsertWanSnapshots([
    { site_id: mgo.site_id, uplink: 'wan1', period_type: 'week', period_start: today, period_end: today,
      availability_pct: 99.5, status_color: 'green', loss_pct_avg: 0.1, latency_ms_avg: 20, jitter_ms_avg: 1,
      device_serial: 'Q2', network_id: 'N1', data_through: today, collected_at: today + 'T05:20:00Z', source: 'meraki_api', raw_json: null },
    { site_id: mgo.site_id, uplink: 'wan2', period_type: 'week', period_start: today, period_end: today,
      availability_pct: 98.1, status_color: 'green', loss_pct_avg: 0.5, latency_ms_avg: 30, jitter_ms_avg: 2,
      device_serial: 'Q2', network_id: 'N1', data_through: today, collected_at: today + 'T04:55:00Z', source: 'meraki_api', raw_json: null },
  ]);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('DEFAULTS.wan_timeup_loss_pct is still "100" (no silent production change); opm_rest_concurrency "1"', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  assert.strictEqual(DEFAULTS.wan_timeup_loss_pct, '100');
  assert.strictEqual(DEFAULTS.opm_rest_concurrency, '1');
});

test('/wan/summary: timeup_calibrated false for "100" and "", true for "5"; timeup_loss_pct mirrors the value', async () => {
  for (const [stored, calibrated, pct] of [['100', false, 100], ['', false, null], ['5', true, 5]]) {
    await reportConfig.setConfig(rdb.db, { wan_timeup_loss_pct: stored }, 'test');
    const r = await get('/api/analytics/wan/summary?period=week', adminToken);
    assert.equal(r.status, 200);
    assert.strictEqual(r.body.timeup_calibrated, calibrated, `stored "${stored}"`);
    assert.strictEqual(r.body.timeup_loss_pct, pct, `stored "${stored}"`);
  }
});

test('/wan/summary: data_as_of = max collected_at; as_of unchanged (today)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const r = await get('/api/analytics/wan/summary?period=week', adminToken);
  assert.equal(r.body.as_of, today);
  assert.equal(r.body.data_as_of, today + 'T05:20:00Z');
});

test('check-timeup-calibration: dry-run writes nothing; --apply=5 stores "5"; invalid value refused', async () => {
  const cli = require('../tools/meraki/check-timeup-calibration');
  await reportConfig.setConfig(rdb.db, { wan_timeup_loss_pct: '100' }, 'test');
  const logs = [];
  const dry = await cli.main({ rdb, argv: [], log: (m) => logs.push(m) });
  assert.deepEqual({ stored: dry.stored, effective: dry.effective, calibrated: dry.calibrated, applied: dry.applied },
    { stored: '100', effective: 100, calibrated: false, applied: false });
  assert.equal(dry.default, '100');
  assert.equal((await reportConfig.getConfig(rdb.db)).wan_timeup_loss_pct, '100', 'dry-run writes nothing');
  assert.ok(logs.some(l => /dry-run/i.test(l)));

  const app = await cli.main({ rdb, argv: ['--apply=5'], log: () => {} });
  assert.equal(app.applied, true);
  assert.equal(app.calibrated, true);
  assert.equal(app.effective, 5);
  assert.equal((await reportConfig.getConfig(rdb.db)).wan_timeup_loss_pct, '5');

  await assert.rejects(() => cli.main({ rdb, argv: ['--apply=abc'], log: () => {} }), /apply/);
  await assert.rejects(() => cli.main({ rdb, argv: ['--apply=0'], log: () => {} }), /apply/);
  assert.equal((await reportConfig.getConfig(rdb.db)).wan_timeup_loss_pct, '5', 'a refused value writes nothing');

  // rollback path documented in the goal
  await cli.main({ rdb, argv: ['--apply=100'], log: () => {} });
  assert.equal((await reportConfig.getConfig(rdb.db)).wan_timeup_loss_pct, '100');
});

test('reports.html: a blank WAN loss threshold is saved blank (not rewritten to "100")', () => {
  const html = _fs.readFileSync(_path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');
  assert.ok(!/wan_timeup_loss_pct:\s*val\('cfg-wan-timeup-loss'\)\s*\|\|\s*'100'/.test(html));
  assert.match(html, /wan_timeup_loss_pct:\s*val\('cfg-wan-timeup-loss'\)\s*,/);
});

test('wan.html renders a banner when timeup_calibrated is false, and shows data_as_of', () => {
  const html = _fs.readFileSync(_path.join(__dirname, '..', 'public', 'wan.html'), 'utf8');
  assert.match(html, /id="wh-calib-banner"/);
  assert.match(html, /timeup_calibrated === false/);
  assert.match(html, /data\.data_as_of/);
});
