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
