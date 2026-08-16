'use strict';
// V1b-C Task 2 — GET /api/reports/:id/infra-auto. Boots the app in-process, creates a report
// for a site, seeds a wan + infra snapshot at the report's Zoho week, and asserts the fills.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'infraauto-'));
process.env.ASSETS_BACKEND = 'sqlite'; process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite'; process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'infraauto-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'infraauto-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'infraauto-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, reportId, noSnapReportId;

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    http.get(base + path, { headers }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null })); }).on('error', reject);
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');

  const site = (rdb.listSites() || [])[0];
  assert.ok(site, 'a seeded site exists');

  // V1b-E T6a — a sub-site network for this site so infra-auto emits its tokens list.
  await rdb.setWanSubsiteNetworks([{ site_id: site.id, sub_site: 'FETEKRO', network: 'Explo Fetekro' }]);

  // a report WITH snapshots
  const rep = rdb.ensureReport(site.id, 2026, 32);
  reportId = rep.id;
  const full = await rdb.getReport(reportId);
  const start = full.start_date;
  await rdb.upsertWanSnapshots([{
    site_id: site.id, uplink: 'wan1', period_type: 'week', period_start: start, period_end: start,
    availability_pct: 99.86, status_color: 'green', trend: 'up', device_serial: 'Q2-AB', network_id: 'N1',
    data_through: start, collected_at: start + 'T05:20:00Z', source: 'meraki_api', raw_json: null,
  }]);
  await rdb.upsertInfraSnapshots([{
    site_id: site.id, period_type: 'week', period_start: start, period_end: start,
    kpi_family: 'lan', metric_name: 'availability', metric_value: 98, target_value: 99,
    status_color: 'orange', trend: null, source: 'opmanager_rest', data_through: start,
    device_count: 2, included_device_count: 2, collected_at: start + 'T05:10:00Z', basis: 'recent', raw_json: null,
  }]);

  // a report WITHOUT snapshots (different week)
  noSnapReportId = rdb.ensureReport(site.id, 2026, 20).id;

  const me = (rdb.listUsers() || []).find(u => u.username === process.env.DASH_USER);
  rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('report with snapshots → wan1 + lan fills', async () => {
  const r = await get(`/api/reports/${reportId}/infra-auto`, adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.fills));
  const by = Object.fromEntries(r.body.fills.map(f => [f.match, f]));
  assert.ok(by.wan1, 'wan1 fill present');
  assert.equal(by.wan1.value, '99.9%');
  assert.equal(by.wan1.source, 'meraki');
  assert.ok(by.lan, 'lan fill present');
  assert.equal(by.lan.value, '98%');
  assert.equal(by.lan.basis, 'recent');
  assert.equal(by.lan.source, 'opmanager');
});

test('report without snapshots → empty fills, not 500', async () => {
  const r = await get(`/api/reports/${noSnapReportId}/infra-auto`, adminToken);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.fills, []);
});

test('unknown report → 404 with empty fills, not 500', async () => {
  const r = await get('/api/reports/99999999/infra-auto', adminToken);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body.fills, []);
});

test('no token → 401', async () => {
  const r = await get(`/api/reports/${reportId}/infra-auto`, null);
  assert.equal(r.status, 401);
});

test('infra-auto payload carries the site tokens list', async () => {
  const r = await get(`/api/reports/${reportId}/infra-auto`, adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.tokens), 'tokens is an array');
  assert.ok(r.body.tokens.includes('FETEKRO'), 'tokens includes the configured sub-site');
});
