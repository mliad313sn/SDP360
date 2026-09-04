'use strict';
// WAN SLA / ISP chargeback — /api/analytics/wan/sla/* smoke. Boots the app in-process
// (start() is require.main-guarded → no port bind), seeds ONE wan_outages row for an
// UNMAPPED (site_id,sub_site,uplink), and asserts: /sla/config is super_admin ONLY
// (admin 403, super_admin 200 with .tiers.SILVER); PUT /sla/config round-trips; /sla/summary
// returns {circuits,unmapped} and the seeded row surfaces under `unmapped` (availability null,
// never 0); /sla/outages returns {outages}; POST /sla/sync passes the gate then self-skips
// (best-effort, never 500); hostile/missing params never 500. sqlite-pinned. --test-force-exit.
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'wansla-smoke-'));
process.env.ASSETS_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.DASH_USER = process.env.DASH_USER || 'wansla-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wansla-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wansla-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, adminToken, superToken, mgoSiteId;

function _parse(b) { if (!b) return null; try { return JSON.parse(b); } catch { return b; } }
function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY };
    if (token) headers['x-report-token'] = token;
    const req = http.get(base + path, { headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: _parse(b) })); });
    req.on('error', reject);
  });
}
function put(path, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const req = http.request(base + path, { method: 'PUT', headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: _parse(b) })); });
    req.on('error', reject); req.end(JSON.stringify(body || {}));
  });
}
function post(path, token) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const req = http.request(base + path, { method: 'POST', headers },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: _parse(b) })); });
    req.on('error', reject); req.end('{}');
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');

  const mgo = await rdb.getSiteIdByModuleCode('meetings', 'MGO');
  assert.ok(mgo && mgo.site_id, 'MGO resolves to a site_id (meetings namespace)');
  mgoSiteId = mgo.site_id;

  // Seed ONE ISP outage in Aug 2026 for an UNMAPPED (site_id, wan1) — default config has
  // no circuits, so this must surface under `unmapped` on /sla/summary.
  await rdb.upsertWanOutage({
    site_id: mgoSiteId, sub_site: '', uplink: 'wan1', isp: 'TestISP', circuit_id: 'C-1',
    detected_start: '2026-08-15T10:00:00.000Z', restored_end: '2026-08-15T11:00:00.000Z',
    notified_at: '2026-08-15T10:15:00.000Z', duration_s: 3600, attribution: 'isp',
    attribution_reason: 'test', network_id: 'N1', device_serial: 'Q2-XX', source: 'meraki_event', raw_json: null,
  });

  const me = (rdb.listUsers() || []).find((u) => u.username === process.env.DASH_USER);
  assert.ok(me, 'seeded admin user exists');
  rdb.setUserRoles(me.id, ['admin']);
  adminToken = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;

  await rdb.createUser({ username: 'wansla-super', full_name: 'WAN SLA Super', password: 'wansla-super-1111', role: 'super_admin' });
  superToken = (await rdb.login('wansla-super', 'wansla-super-1111')).token;

  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

test('/sla/config is super_admin only — admin 403, super_admin 200 with .tiers.SILVER', async () => {
  const ad = await get('/api/analytics/wan/sla/config', adminToken);
  assert.equal(ad.status, 403, 'admin blocked from SLA config');
  const su = await get('/api/analytics/wan/sla/config', superToken);
  assert.equal(su.status, 200);
  assert.ok(su.body && su.body.tiers && su.body.tiers.SILVER, 'parsed config carries SILVER tier');
});

test('PUT /sla/config (super_admin) → {ok:true} and a later GET reflects it', async () => {
  // circuits left empty so MGO/wan1 stays UNMAPPED regardless of test order.
  const p = await put('/api/analytics/wan/sla/config', { clock_start: 'detection', circuits: [] }, superToken);
  assert.equal(p.status, 200);
  assert.equal(p.body.ok, true);
  const g = await get('/api/analytics/wan/sla/config', superToken);
  assert.equal(g.status, 200);
  assert.equal(g.body.clock_start, 'detection', 'PUT round-trips into the stored config');
});

test('GET /sla/summary → {circuits,unmapped}; seeded unmapped uplink surfaces (availability null, never 0)', async () => {
  const r = await get('/api/analytics/wan/sla/summary?month=2026-08', adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.month, '2026-08');
  assert.ok(Array.isArray(r.body.circuits), 'circuits array');
  assert.ok(Array.isArray(r.body.unmapped), 'unmapped array');
  const um = r.body.unmapped.find((u) => u.site_id === mgoSiteId && u.uplink === 'wan1');
  assert.ok(um, 'seeded (site,wan1) appears under unmapped');
  assert.equal(um.unmapped, true);
  assert.ok(um.site_name, 'unmapped row carries the resolved site name (not just the numeric id)');
  assert.strictEqual(um.availability_pct, null, 'unmapped carries no availability (null, never 0)');
  assert.ok(um.outage_count >= 1, 'outage_count counts the seeded row');
});

test('GET /sla/outages → {outages}', async () => {
  const r = await get('/api/analytics/wan/sla/outages?site=MGO&from=2026-08-01&to=2026-08-31', adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.outages), 'outages array');
  assert.ok(r.body.outages.find((o) => o.site_id === mgoSiteId && o.uplink === 'wan1'), 'seeded outage returned');
});

test('POST /sla/sync — admin session passes the gate then self-skips (best-effort, never 500)', async () => {
  const r = await post('/api/analytics/wan/sla/sync', adminToken);
  assert.notEqual(r.status, 403, 'admin session must NOT get 403 Admin only');
  assert.notEqual(r.status, 500, 'never 500');
  assert.equal(r.status, 200);
  assert.ok(r.body && (r.body.skipped === true || r.body.ok !== undefined), 'unconfigured → {skipped} or {ok}');
  const noTok = await post('/api/analytics/wan/sla/sync', null);
  assert.equal(noTok.status, 401, 'no session → 401 (requireReportSession first)');
});

test('hostile / missing params never 500', async () => {
  const a = await get('/api/analytics/wan/sla/summary?month=NOPE', adminToken);
  assert.equal(a.status, 200);
  assert.ok(Array.isArray(a.body.circuits) && Array.isArray(a.body.unmapped));
  const b = await get('/api/analytics/wan/sla/outages?site=ZZZNOPE&uplink=wan9', adminToken);
  assert.equal(b.status, 200);
  assert.ok(Array.isArray(b.body.outages));
  const c = await get('/api/analytics/wan/sla/export.csv?month=zzz', adminToken);
  assert.equal(c.status, 200);
  assert.ok(typeof c.body === 'string', 'CSV export is text, not JSON');
});

// ── XLSX evidence exports (month GET + "what I see" POST) ─────────────────────
function _bin(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-dash-key': process.env.DASHBOARD_API_KEY, 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const req = http.request(base + path, { method, headers }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], disp: res.headers['content-disposition'], buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end(body == null ? undefined : JSON.stringify(body));
  });
}
test('GET /sla/export.xlsx → workbook with the 3 evidence sheets; seeded outage lands on the real sheet with its site name', async () => {
  const XLSX = require('xlsx');
  const r = await _bin('GET', '/api/analytics/wan/sla/export.xlsx?month=2026-08', adminToken);
  assert.equal(r.status, 200);
  assert.ok(/spreadsheetml/.test(r.type), 'xlsx content-type');
  assert.ok(/wan-sla-outages-2026-08\.xlsx/.test(r.disp), 'filename');
  const wb = XLSX.read(r.buf, { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Coupures 2026-08', 'Résumé site × uplink', 'Chaînes 24h sans durée']);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Coupures 2026-08']);
  const mine = rows.find(x => x.ISP === 'TestISP');
  assert.ok(mine, 'seeded outage present');
  assert.equal(mine['Durée (h:mm)'], '1h00');
  assert.ok(mine.Site && !/^#/.test(mine.Site), 'site NAME resolved (not #id)');
  const sum = XLSX.utils.sheet_to_json(wb.Sheets['Résumé site × uplink']);
  assert.ok(sum.some(x => x.ISP === 'TestISP' && x.Coupures >= 1));
});
test('POST /sla/export-filtered.xlsx → separates closed rows without duration into the 24h-chain sheet', async () => {
  const XLSX = require('xlsx');
  const rows = [
    { site_id: mgoSiteId, sub_site: '', uplink: 'wan1', isp: 'X', circuit_id: '', detected_start: '2026-08-01T10:00:00Z', restored_end: '2026-08-01T10:30:00Z', notified_at: null, duration_s: 1800, attribution: 'isp', attribution_reason: '' },
    { site_id: mgoSiteId, sub_site: '', uplink: 'wan2', isp: '', circuit_id: '', detected_start: '2026-08-01T18:10:00Z', restored_end: '2026-08-02T18:10:00Z', notified_at: null, duration_s: null, attribution: '', attribution_reason: '' },
  ];
  const r = await _bin('POST', '/api/analytics/wan/sla/export-filtered.xlsx', adminToken, { rows, label: '2026-08' });
  assert.equal(r.status, 200);
  const wb = XLSX.read(r.buf, { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['Coupures 2026-08']).length, 1, 'one real outage');
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['Chaînes 24h sans durée']).length, 1, 'one 24h chain row');
  const hostile = await _bin('POST', '/api/analytics/wan/sla/export-filtered.xlsx', adminToken, { rows: 'nope', label: '../x' });
  assert.equal(hostile.status, 200, 'bad body → empty workbook, never 500');
});
