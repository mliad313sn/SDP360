'use strict';
const fetch = require('./_http-fetch');   // core-http shim — undici keep-alive aborts the process at --test-force-exit on Windows
// A-24 — every submission of a weekly report records an append-only, hash-chained row
// (weekly_report_submissions) with the SHA-256 of its canonical figures; GET /integrity
// compares it with the figures as they stand now. Integrity evidence only, never an approval.
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'a24-integrity-key';
process.env.ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || 'dummy';
process.env.ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || 'dummy';
process.env.ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || 'dummy';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, site, week = 20;
const tok = {};
const H = (t) => ({ 'Content-Type': 'application/json', 'x-report-token': t });
const put = (p, t, body) => fetch(base + p, { method: 'PUT', headers: H(t), body: JSON.stringify(body) });
const get = (p, t) => fetch(base + p, { headers: H(t) });
const KPI = (v) => [{ service: 'WAN1', kpi: 'Availability', target: '98%', status_value: v, status_color: 'green', trend: 'stable' }];

before(async () => {
  const { app } = require('../server');
  rdb = require('../reports-db');
  site = (await rdb.listSites())[0];
  const mk = async (username, roles, site_id) => {
    await rdb.createUser({ username, full_name: username, password: username + '-0000', roles, site_id });
    return (await rdb.login(username, username + '-0000')).token;
  };
  tok.editor = await mk('a24-int-editor', ['editor'], site.id);
  tok.other = await mk('a24-int-other', ['editor'], (await rdb.listSites())[1].id);
  const me = ((await rdb.listUsers()) || []).find(u => u.username === process.env.DASH_USER);
  await rdb.setUserRoles(me.id, ['super_admin']);
  tok.super = (await rdb.login(process.env.DASH_USER, process.env.DASH_PASS)).token;
  await new Promise(r => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch {} });

async function freshReport() {
  const r = await rdb.ensureReport(site.id, 2026, week++);
  await rdb.saveInfraKpis(r.id, KPI('99%'));
  return r.id;
}
const rows = (id) => rdb.db.prepare('SELECT * FROM weekly_report_submissions WHERE report_id=? ORDER BY id').all(id);

test('a submit writes one weekly_report_submissions row with figures_sha256 and a row_hash', async () => {
  const id = await freshReport();
  const r = await put(`/api/reports/${id}/status`, tok.editor, { status: 'submitted' });
  assert.equal(r.status, 200);
  const list = await rows(id);
  assert.equal(list.length, 1);
  assert.match(list[0].figures_sha256, /^[0-9a-f]{64}$/);
  assert.match(list[0].row_hash, /^[0-9a-f]{64}$/);
  assert.equal(Number(list[0].site_id), site.id);
  assert.ok(list[0].submitted_by != null);
  const fig = JSON.parse(list[0].figures_json);
  assert.equal(fig.infra_kpis[0].status_value, '99%');
});

test('UPDATE / DELETE on weekly_report_submissions is rejected by the append-only trigger', async () => {
  const id = await freshReport();
  await put(`/api/reports/${id}/status`, tok.editor, { status: 'submitted' });
  await assert.rejects(rdb.db.prepare("UPDATE weekly_report_submissions SET figures_sha256='x' WHERE report_id=?").run(id));
  await assert.rejects(rdb.db.prepare('DELETE FROM weekly_report_submissions WHERE report_id=?').run(id));
  assert.equal((await rows(id)).length, 1);
});

test('super_admin edit after submission → drift:true; resubmit → drift:false (two rows kept)', async () => {
  const id = await freshReport();
  await put(`/api/reports/${id}/status`, tok.editor, { status: 'submitted' });
  let j = await (await get(`/api/reports/${id}/integrity`, tok.editor)).json();
  assert.equal(j.drift, false);
  assert.equal(j.submitted_hash, j.current_hash);
  assert.ok(j.submitted_at);
  assert.equal(j.submitted_by, 'a24-int-editor');
  assert.equal((await put(`/api/reports/${id}/infra`, tok.super, KPI('80%'))).status, 200);
  j = await (await get(`/api/reports/${id}/integrity`, tok.editor)).json();
  assert.equal(j.drift, true);
  assert.notEqual(j.submitted_hash, j.current_hash);
  assert.equal((await put(`/api/reports/${id}/status`, tok.super, { status: 'submitted' })).status, 200);
  j = await (await get(`/api/reports/${id}/integrity`, tok.editor)).json();
  assert.equal(j.drift, false);
  assert.equal((await rows(id)).length, 2);
});

test('a report submitted before the migration → no submission hash (null), not drift', async () => {
  const id = await freshReport();
  await rdb.updateReportStatus(id, 'submitted', null);   // legacy path: no submissions row
  const j = await (await get(`/api/reports/${id}/integrity`, tok.editor)).json();
  assert.equal(j.submitted_hash, null);
  assert.equal(j.drift, false);
  assert.match(j.current_hash, /^[0-9a-f]{64}$/);
});

test('integrity: banner switch exposed OFF by default; cross-site read 403; unknown 404', async () => {
  const id = await freshReport();
  const j = await (await get(`/api/reports/${id}/integrity`, tok.editor)).json();
  assert.equal(j.drift_banner, false);
  assert.equal(j.revert_policy, 'site_editor');
  assert.equal((await get(`/api/reports/${id}/integrity`, tok.other)).status, 403);
  assert.equal((await get('/api/reports/99999999/integrity', tok.super)).status, 404);
});

test('the chain verifier covers weekly_report_submissions and finds it intact', async () => {
  const ac = require('../services/auditChain');
  assert.ok(ac.TABLES.includes('weekly_report_submissions'));
  const out = await ac.verify(rdb.db);
  const t = out.tables.find(x => x.table === 'weekly_report_submissions');
  assert.equal(t.ok, true);
});
