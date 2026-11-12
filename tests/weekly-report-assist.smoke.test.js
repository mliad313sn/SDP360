'use strict';
// P4 / B9 — routes/weeklyReportAssist.js through the real app:
//   * infra-auto keeps the site perimeter (editor of another site → 403, own site → 200);
//   * PUT /infra keeps a Meraki/OpManager provenance ONLY when the value equals the snapshot (a typed or forged
//     value is stored 'manual'), and the provenance survives a reload (GET report);
//   * a submitted report stays frozen for its editor (PUT /infra → 403, values unchanged);
//   * /api/value-metrics/weekly-report: median completion from server audit timestamps, % on-time UNKNOWN while the
//     deadline policy is empty, % auto-prefilled from the stored provenance, editor sees only their site.
const _os = require('os'), _fs = require('fs'), _p = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_p.join(_os.tmpdir(), 'wra-'));
process.env.DASH_USER = process.env.DASH_USER || 'wra-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'wra-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'wra-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, tok = {}, siteA, siteB, repA, repB;
function call(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const headers = { 'x-report-token': token || '' };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const rq = http.request(base + path, { method, headers, agent: false }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let j = null; try { j = b ? JSON.parse(b) : null; } catch (_) { j = b; } resolve({ status: res.statusCode, body: j }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}

before(async () => {
  const { app } = require('../server');
  const rdb = require('../reports-db');
  const sites = (await rdb.listSites()) || [];
  siteA = sites[0]; siteB = sites[1];
  repA = (await rdb.ensureReport(siteA.id, 2026, 33)).id;
  repB = (await rdb.ensureReport(siteB.id, 2026, 33)).id;
  const start = (await rdb.getReport(repA)).start_date;
  await rdb.upsertWanSnapshots([{ site_id: siteA.id, uplink: 'wan1', period_type: 'week', period_start: start, period_end: start,
    availability_pct: 99.86, status_color: 'green', trend: 'up', device_serial: 'Q2', network_id: 'N1', data_through: start, collected_at: start + 'T05:20:00Z', source: 'meraki_api', raw_json: null }]);
  const me = ((await rdb.listUsers()) || []).find((u) => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['admin']);
  tok.admin = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  for (const [name, site] of [['wra-edA', siteA], ['wra-edB', siteB]]) {
    await rdb.createUser({ username: name, full_name: name, password: name + '-0000', roles: ['editor'], site_id: site.id });
    tok[name] = (await rdb.login(name, name + '-0000')).token;
  }
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch (_) { /* closed */ } });

test('infra-auto: editor of another site is refused, own-site editor gets the fills', async () => {
  const other = await call('GET', `/api/reports/${repA}/infra-auto`, tok['wra-edB']);
  assert.strictEqual(other.status, 403);
  const own = await call('GET', `/api/reports/${repA}/infra-auto`, tok['wra-edA']);
  assert.strictEqual(own.status, 200);
  assert.ok(own.body.fills.some((f) => f.match === 'wan1' && f.value === '99.9%'));
});

test('PUT infra: auto provenance verified against the snapshot, forged/typed → manual, kept across reload', async () => {
  const r = await call('PUT', `/api/reports/${repA}/infra`, tok['wra-edA'], [
    { service: 'WAN1', kpi: 'a', target: '98%', status_value: '99.9%', status_color: 'green', trend: 'up', value_source: 'meraki', value_data_through: '1999-01-01' },
    { service: 'WAN2', kpi: 'b', target: '98%', status_value: '100%', status_color: 'green', trend: 'stable', value_source: 'meraki' },
    { service: 'LAN', kpi: 'c', target: '99%', status_value: '97%', status_color: 'orange', trend: 'stable', value_source: 'manual' },
    { service: 'Backup', kpi: 'd', target: '100%', status_value: '100%', status_color: 'green', trend: 'stable' },
  ]);
  assert.strictEqual(r.status, 200);
  const rep = await call('GET', `/api/reports/${repA}`, tok['wra-edA']);
  const by = Object.fromEntries(rep.body.infra_kpis.map((k) => [k.service, k]));
  assert.strictEqual(by.WAN1.value_source, 'meraki');
  assert.notStrictEqual(by.WAN1.value_data_through, '1999-01-01', 'data-through comes from the snapshot, never the client');
  assert.strictEqual(by.WAN2.value_source, 'manual', 'no wan2 snapshot → a claimed Meraki value is stored as typed');
  assert.strictEqual(by.LAN.value_source, 'manual');
  assert.strictEqual(by.Backup.value_source, null);
});

test('frozen: a submitted report refuses an infra write from its editor', async () => {
  const s = await call('PUT', `/api/reports/${repA}/status`, tok['wra-edA'], { status: 'submitted' });
  assert.strictEqual(s.status, 200);
  const w = await call('PUT', `/api/reports/${repA}/infra`, tok['wra-edA'], [{ service: 'WAN1', kpi: 'a', target: '98%', status_value: '1%' }]);
  assert.strictEqual(w.status, 403);
  const rep = await call('GET', `/api/reports/${repA}`, tok['wra-edA']);
  assert.ok(rep.body.infra_kpis.some((k) => k.service === 'WAN1' && k.status_value === '99.9%'));
});

test('value metrics: completion time from server timestamps, on-time unknown without a deadline, perimeter applies', async () => {
  const wk = await call('GET', `/api/reports/${repA}`, tok.admin);
  const end = wk.body.end_date;
  const q = `/api/value-metrics/weekly-report?from=${end}&to=${end}`;
  const all = await call('GET', q, tok.admin);
  assert.strictEqual(all.status, 200);
  const a = all.body.timing.reports.find((x) => x.report_id === repA);
  assert.ok(a && a.first_edit_at && a.first_submit_at, 'first edit and first submission read from audit_log');
  assert.ok(Number.isFinite(a.minutes) && a.minutes >= 0);
  assert.strictEqual(a.on_time, null, 'weekly_report_due_days empty → on-time unknown, never false/0');
  assert.strictEqual(all.body.timing.overall.on_time_pct, null);
  assert.strictEqual(all.body.prefill.auto, 1);
  assert.strictEqual(all.body.prefill.measurable, 3, 'WAN1, WAN2, LAN — Backup has no source');
  assert.strictEqual(all.body.prefill.minutes_saved, null, 'no stopwatch baseline → minutes saved unknown');
  const edB = await call('GET', q, tok['wra-edB']);
  assert.ok(edB.body.timing.reports.every((x) => x.site_id === siteB.id), 'editor sees only their site');
  assert.ok(!edB.body.timing.reports.some((x) => x.report_id === repA));
});
