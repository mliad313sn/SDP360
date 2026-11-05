'use strict';
// AMDEC 2026-11-05 — agent-executed scenario campaign ("UAT simulée", NOT user acceptance).
// End-to-end workflows of the multi-site organisation models over the HTTP API (seeded multinational world).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const W = require('./_uat-world');

let ctx, w, U, S, R, c;
before(async () => { ctx = await W.boot(); w = await W.seedWorld(ctx); ({ users: U, S, reports: R, call: c } = w); });
after(async () => { if (ctx) await ctx.close(); });

test('WF-01 multi-site editor submits the Ity report (another country); it freezes; a Sabodala-only editor cannot touch it', async () => {
  const id = R.Ity;
  assert.notEqual((await c('PUT', `/api/reports/${id}/lights`, U.ms3.token, [])).status, 403);
  const s = await c('PUT', `/api/reports/${id}/status`, U.ms3.token, { status: 'submitted' });
  assert.equal(s.status, 200, s.text);
  assert.equal((await c('PUT', `/api/reports/${id}/lights`, U.ms3.token, [])).status, 403, 'a submitted report is frozen');
  assert.equal((await c('PUT', `/api/reports/${id}/status`, U.edSGO.token, { status: 'draft' })).status, 403);
  const back = await c('PUT', `/api/reports/${id}/status`, U.ms3.token, { status: 'draft' });
  assert.equal(back.status, 200, 'an editor of the report\'s site reverts it (2026-10-02 rule): ' + back.text);
});

test('WF-02 shared desk PV: a transfer to the helpdesk needs a justification and a numeric SDP ticket', async () => {
  const s = await c('POST', '/api/meetings/save', U.desk.token, { state: {
    header: { site_code: 'ABJ', department: 'finance', meeting_date: '2026-09-15', status: 'draft' },
    issues: [{ ord: 1, title: 'Printer queue lost every Monday', category: 'HW', severity: 'MEDIUM', status: 'open' }],
  } });
  assert.equal(s.status, 200, s.text);
  const pv = (await c('GET', '/api/meetings/' + s.j.id, U.desk.token)).j;
  const iid = pv.issues[0].id;
  const up = (b) => c('POST', `/api/meetings/issues/${iid}/update`, U.desk.token, b);
  assert.equal((await up({ status_change: 'helpdesk_ticket', body: '' })).status, 400, 'no note');
  assert.equal((await up({ status_change: 'helpdesk_ticket', body: 'Sent to the desk', helpdesk_ticket: 'INC-12' })).status, 400, 'ticket must be digits');
  const ok = await up({ status_change: 'helpdesk_ticket', body: 'Sent to the desk', helpdesk_ticket: '312345' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await c('POST', `/api/meetings/issues/${iid}/update`, U.edSGO.token, { body: 'cross-site comment' })).status, 403);
});

test('WF-03 Site Actions hub follows the account\'s sites (ms3: SMI yes, MGO no; desk: DKR yes, SGO no)', async () => {
  assert.equal((await c('GET', '/api/reports/site-actions?site=SMI', U.ms3.token)).status, 200);
  assert.equal((await c('GET', '/api/reports/site-actions?site=MGO', U.ms3.token)).status, 403);
  assert.equal((await c('GET', '/api/reports/site-actions?site=DKR', U.desk.token)).status, 200);
  assert.equal((await c('GET', '/api/reports/site-actions?site=SGO', U.desk.token)).status, 403);
});

test('WF-04 exports stay inside the account\'s sites (meetings Excel for the shared desk)', async () => {
  await c('POST', '/api/meetings/save', U.desk.token, { state: { header: { site_code: 'DKR', department: 'hr', meeting_date: '2026-09-16', status: 'draft' } } });
  await c('POST', '/api/meetings/save', U.central.token, { state: { header: { site_code: 'SGO', department: 'mine', meeting_date: '2026-09-16', status: 'draft' } } });
  const r = await c('GET', '/api/meetings/export.xlsx', U.desk.token);
  assert.equal(r.status, 200, r.text.slice(0, 200));
  const XLSX = require('xlsx');
  const sites = XLSX.utils.sheet_to_json(XLSX.read(r.buf, { type: 'buffer' }).Sheets.Meetings).map((m) => m.site_code);
  assert.ok(sites.length >= 1 && sites.every((s) => ['DKR', 'ABJ', 'OUA'].includes(s)), sites.join(','));
});

test('WF-05 report list scale: a central account sees at most 20 report cards on the page, but the API returns every report (limit AM-09)', async () => {
  for (let wk = 30; wk <= 36; wk++) for (const n of ['Sabodala', 'Hounde', 'Dakar']) await ctx.rdb.ensureReport(S[n].id, 2026, wk);
  const all = await c('GET', '/api/reports', U.central.token);
  assert.ok(all.j.length > 20, String(all.j.length));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'reports.html'), 'utf8');
  assert.match(src, /reports\.slice\(0, 20\)/, 'the page still caps the list at 20 cards (no paging) — follow-up FU-05');
});

test('WF-06 report list cards escape the site name and week label (AM-13)', () => {
  const { fnSource } = require('./_fn-source');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'reports.html'), 'utf8');
  const body = fnSource(src, 'loadReportList');
  assert.match(body, /\$\{esc\(r\.site_name\)\}/);
  assert.match(body, /\$\{esc\(r\.week_label\)\}/);
  assert.doesNotMatch(body, /\$\{r\.site_name\}/);
});

test('NE-01 emergency access (C-22): time-boxed site grant to the Massawa editor during a Sabodala outage, logged, reviewed by another super_admin, ended at its hour', async () => {
  const cfg = require('../services/reportConfig'), rdb = ctx.rdb;
  const body = { subject_user_id: U.edMAS.id, site_ids: [S.Sabodala.id], hours: 8, reason: 'UAT: Sabodala coordinator absent during a WAN outage' };
  assert.equal((await c('POST', '/api/access/emergencies', U.sa.token, body)).status, 404, 'off by default (emergency_access_enabled = 0)');
  await cfg.setConfig(rdb.db, { emergency_access_enabled: '1' }, 'test');
  try {
    assert.equal((await c('GET', '/api/reports/' + R.Sabodala, U.edMAS.token)).status, 403, 'before the grant');
    assert.equal((await c('POST', '/api/access/emergencies', U.central.token, body)).status, 403, 'the admin tier does not grant emergencies');
    assert.match((await c('POST', '/api/access/emergencies', U.sa.token, { ...body, hours: 30 })).text, /at most 24 h/);
    assert.match((await c('POST', '/api/access/emergencies', U.sa.token, { ...body, subject_user_id: U.sa.id })).text, /themselves/);
    const g = await c('POST', '/api/access/emergencies', U.sa.token, body);
    assert.equal(g.status, 201, g.text);
    const tok = (await rdb.login(U.edMAS.username, U.edMAS.password)).token;
    assert.equal((await c('GET', '/api/reports/' + R.Sabodala, tok)).status, 200, 'the granted site is readable during the window');
    assert.equal((await c('GET', '/api/reports/' + R.Hounde, tok)).status, 403, 'and only that site');
    const logs = await rdb.db.prepare("SELECT risk FROM system_log WHERE action = 'access_emergency_granted'").all();
    assert.ok(logs.length && logs.every((l) => Number(l.risk) === 1), 'logged as a risk event');
    const rv = { outcome: 'justified', notes: 'outage confirmed' };
    assert.match((await c('POST', `/api/access/emergencies/${g.j.id}/review`, U.sa.token, rv)).text, /granted the emergency access/, 'the granter cannot review');
    assert.equal((await c('POST', `/api/access/emergencies/${g.j.id}/review`, U.sa2.token, rv)).status, 200);
    const { makeEmergencyStore } = require('../services/emergencyAccessStore');
    const { makeAccessStore } = require('../services/accessStore');
    const later = new Date(Date.now() + 9 * 3600e3).toISOString();
    const h = { prepare: (sql) => rdb.pgHandle().prepare(sql), runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) };
    assert.ok((await makeEmergencyStore(h, rdb, makeAccessStore(h, rdb, { now: () => later }), { now: () => later }).expireDue({})).ended >= 1);
    const tok2 = (await rdb.login(U.edMAS.username, U.edMAS.password)).token;
    assert.equal((await c('GET', '/api/reports/' + R.Sabodala, tok2)).status, 403, 'the hour ends the grant');
    assert.equal((await c('GET', '/api/reports/' + R.Massawa, tok2)).status, 200, 'own site untouched');
  } finally { await cfg.setConfig(rdb.db, { emergency_access_enabled: '0' }, 'test'); }
});

test('NE-02 KPI committee (C-31): a member in Côte d\'Ivoire drafts and proposes; she cannot adopt; a member in the UK adopts with a reference; non-members refused', async () => {
  const rdb = ctx.rdb, E = require('../services/kpiPolicyEngine'), KEY = 'helpdesk.resolution_sla_pct';
  for (let i = 0; i < 60 && !(await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'kpi_policies'").get()); i++) await new Promise((r) => setTimeout(r, 100));
  const def = JSON.parse(JSON.stringify(E.IMPORTED_DEFINITIONS[KEY][1].definition));
  def.denominator.push({ block: 'field_not_in', field: 'request_status', values: ['Cancelled'] });
  const draft = { metric_key: KEY, title: 'UAT cancelled tickets out', definition: def, rationale: 'UAT: a cancelled ticket was never served' };
  for (const k of ['edSGO', 'central', 'exec']) assert.equal((await c('POST', '/api/kpi-policies', U[k].token, draft)).status, 403, k + ' is not the committee');
  const d = await c('POST', '/api/kpi-policies', U.kpiCI.token, draft);
  assert.equal(d.status, 201, d.text);
  assert.equal((await c('POST', `/api/kpi-policies/${d.j.id}/propose`, U.kpiGB.token)).status, 403, 'only the author proposes');
  assert.equal((await c('POST', `/api/kpi-policies/${d.j.id}/propose`, U.kpiCI.token)).status, 200);
  const self = await c('POST', `/api/kpi-policies/${d.j.id}/decide`, U.kpiCI.token, { decision: 'adopt', committee_ref: 'UAT-KPI-01' });
  assert.equal(self.status, 403); assert.match(self.text, /separation of duties/);
  assert.equal((await c('POST', `/api/kpi-policies/${d.j.id}/decide`, U.sa.token, { decision: 'adopt' })).status, 400, 'a committee reference is required');
  const ad = await c('POST', `/api/kpi-policies/${d.j.id}/decide`, U.kpiGB.token, { decision: 'adopt', committee_ref: 'UAT-KPI-01 §2', effective_from: '2026-08-01' });
  assert.equal(ad.status, 200, ad.text);
  const p = (await c('GET', `/api/kpi-policies/${d.j.id}`, U.viewer.token)).j;
  assert.deepStrictEqual([p.policy.status, p.policy.adopted_by], ['adopted', U.kpiGB.id]);
  assert.equal((await c('PUT', `/api/kpi-policies/${d.j.id}`, U.kpiGB.token, { title: 'changed' })).status, 409, 'adopted = immutable');
  assert.equal(String((await require('../services/reportConfig').getConfig(rdb.db)).kpi_policy_enforced), '0', 'screens stay on today\'s rule');
});
