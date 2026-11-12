'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) over HTTP, fictitious data only: every action is 404 while its PROPOSED switch is
// '0' (= today), then behaves as specified once the switch is '1'. Switches are put back to '0' after each test.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-wb-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmwb-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmwb-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmwb-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, pid, pidB, obj, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_project_members'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('wb_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('wb_cio', ['viewer', 'committee-member']);
  T.fin = await mk('wb_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('wb_viewer', ['viewer'], A);
  T.editorB = await mk('wb_editor_b', ['editor'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'wb-prog', name: 'WB' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'wb-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'WB-1', name: 'Fictitious radio upgrade', owner: 'wb_pmo', site_id: A, start_date: '2026-11-02', end_date: '2027-03-31', budget: 1000, currency: 'USD' })).j.id;
  pidB = (await put('project', T.pmo, { objective_id: obj, key: 'WB-2', name: 'Fictitious site B work', owner: 'wb_pmo', site_id: B, start_date: '2026-11-02', end_date: '2027-03-31' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j, r }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const wbBuf = async (t) => Buffer.from(await (await fetch(base + '/api/governance/portfolio/workbook.xlsx', { headers: { 'x-report-token': t } })).arrayBuffer());
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('R2-WB-04 team: 404 while off and the conflicts are today’s; on: plan-write rule, member allocation fills unknown tasks, ledger row', async () => {
  const url = `/api/governance/ppm/project/${pid}/team`;
  await sw({ ppm_project_team_enabled: '0' });
  for (const n of [1, 2]) assert.equal((await put('task', T.pmo, { project_id: pid, name: 'Survey ' + n, owner: 'Ana', start_date: '2026-11-02', end_date: '2026-11-06', allocation_pct: null })).status, 200);
  assert.equal((await send('GET', url, T.pmo)).status, 404);
  assert.equal((await send('PUT', url, T.pmo, { label: 'Ana', allocation_pct: 60 })).status, 404);
  const before = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
  assert.deepEqual(before.resource_conflicts, [], 'unknown allocations are never summed');
  assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.team, false);
  await sw({ ppm_project_team_enabled: '1' });
  try {
    assert.equal((await send('PUT', url, T.viewer, { label: 'Ana', allocation_pct: 60 })).status, 403, 'plan-write rule (committee while editor writes are off)');
    const bad = await send('PUT', url, T.pmo, { label: 'Ana', allocation_pct: 150 });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'BAD_ALLOCATION');
    const ok = await send('PUT', url, T.pmo, { label: 'Ana', role: 'radio technician', allocation_pct: 60 });
    assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.members.length, 1);
    const g = await send('GET', url, T.viewer); assert.equal(g.status, 200); assert.equal(g.j.members[0].allocation_pct, 60);
    const after = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j;
    assert.deepEqual(after.resource_conflicts.map((c) => [c.owner, c.peak_pct]), [['Ana', 120]], 'two unknown tasks read at the member allocation');
    assert.equal((await send('GET', `/api/governance/ppm/project/${pidB}/team`, T.viewer)).status, 200, 'site scope off: readable');
    await sw({ portfolio_site_scope_reads: '1' });
    assert.equal((await send('GET', `/api/governance/ppm/project/${pidB}/team`, T.viewer)).status, 404, 'another site under the read scope does not exist');
    await sw({ portfolio_site_scope_reads: '0' });
    const mid = ok.j.member.id;
    assert.equal((await send('DELETE', `${url}/${mid}`, T.pmo)).status, 200);
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => /^team_member/.test(e.action)).map((e) => e.action), ['team_member_added', 'team_member_removed']);
    assert.equal((await send('GET', '/api/governance/ppm/features', T.viewer)).j.team, true);
  } finally { await sw({ ppm_project_team_enabled: '0', portfolio_site_scope_reads: '0' }); }
});

test('R2-WB-02 time entries: 404 while off; on: plan-write rule, null vs 0, cross-site 404 under the read scope, workbook parity', async () => {
  await sw({ ppm_time_entries_enabled: '0' });
  const t1 = (await put('task', T.pmo, { project_id: pid, name: 'Cabling', owner: 'Bob', effort_hours: 10 })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, name: 'Labels', owner: 'Bob', effort_hours: 3 })).j.id;
  const t3 = (await put('task', T.pmo, { project_id: pid, name: 'Not started', owner: 'Bob', effort_hours: 5 })).j.id;
  const tB = (await put('task', T.pmo, { project_id: pidB, name: 'Site B task', owner: 'Cy', effort_hours: 2 })).j.id;
  assert.equal((await send('GET', `/api/governance/ppm/task/${t1}/time`, T.pmo)).status, 404);
  assert.equal((await send('POST', `/api/governance/ppm/task/${t1}/time`, T.pmo, { day: '2026-11-03', hours: 4 })).status, 404);
  assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/actual-hours`, T.pmo)).status, 404);
  const XLSX = require('xlsx');
  const wbHead = async () => XLSX.utils.sheet_to_json(XLSX.read(await wbBuf(T.pmo), { type: 'buffer' }).Sheets.Tasks, { defval: null });
  assert.ok(!('actual_hours' in (await wbHead())[0]), 'switch off: today’s Tasks sheet');
  await sw({ ppm_time_entries_enabled: '1' });
  try {
    assert.equal((await send('POST', `/api/governance/ppm/task/${t1}/time`, T.viewer, { day: '2026-11-03', hours: 4 })).status, 403, 'plan-write rule');
    const bad = await send('POST', `/api/governance/ppm/task/${t1}/time`, T.pmo, { day: '2026-11-03', hours: 30 });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'BAD_HOURS');
    for (const h of [6, 5.5]) assert.equal((await send('POST', `/api/governance/ppm/task/${t1}/time`, T.pmo, { day: '2026-11-03', hours: h, person_label: 'Bob' })).status, 200);
    const zero = await send('POST', `/api/governance/ppm/task/${t2}/time`, T.pmo, { day: '2026-11-04', hours: 0 });
    assert.equal(zero.status, 200); assert.equal(zero.j.entry.person_label, 'wb_pmo', 'the recorder by default');
    const ah = await send('GET', `/api/governance/ppm/project/${pid}/actual-hours`, T.viewer);
    assert.equal(ah.status, 200);
    const by = Object.fromEntries(ah.j.hours.map((x) => [x.task_id, x]));
    assert.deepEqual([by[t1].actual, by[t1].variance], [11.5, 1.5]);
    assert.deepEqual([by[t2].actual, by[t2].variance], [0, -3], 'a recorded 0 h is 0');
    assert.deepEqual([by[t3].actual, by[t3].variance], [null, null], 'no entry = unknown, never 0');
    const one = await send('GET', `/api/governance/ppm/task/${t1}/time`, T.viewer);
    assert.equal(one.j.entries.length, 2); assert.equal(one.j.hours.actual, 11.5);
    // workbook parity: the Tasks sheet carries the same actual hours as the screen's API
    const rows = await wbHead();
    const r = (id) => rows.find((x) => x.id === id);
    assert.deepEqual([r(t1).actual_hours, r(t2).actual_hours, r(t3).actual_hours], [11.5, 0, null]);
    // cross-site: under the read scope a task of another site does not exist for the site-A viewer
    assert.equal((await send('GET', `/api/governance/ppm/task/${tB}/time`, T.viewer)).status, 200);
    await sw({ portfolio_site_scope_reads: '1' });
    assert.equal((await send('GET', `/api/governance/ppm/task/${tB}/time`, T.viewer)).status, 404);
    assert.equal((await send('GET', `/api/governance/ppm/project/${pidB}/actual-hours`, T.viewer)).status, 404);
    await sw({ portfolio_site_scope_reads: '0' });
    const eid = one.j.entries[0].id;
    assert.equal((await send('DELETE', `/api/governance/ppm/task/${t1}/time/${eid}`, T.pmo)).status, 200);
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => /^time_entry/.test(e.action)).map((e) => e.action), ['time_entry_added', 'time_entry_added', 'time_entry_added', 'time_entry_removed']);
  } finally { await sw({ ppm_time_entries_enabled: '0', portfolio_site_scope_reads: '0' }); }
});

test('R2-WB-03 workbook budget periods: only for a money reader while ppm_budget_periods_enabled is on, equal to the stored periods', async () => {
  const XLSX = require('xlsx');
  const sheets = async (t) => XLSX.read(await wbBuf(t), { type: 'buffer' });
  await sw({ ppm_budget_periods_enabled: '1' });
  try {
    const url = `/api/governance/ppm/project/${pid}/budget-periods`;
    assert.equal((await send('PUT', url, T.pmo, { period: '2026-11', currency: 'USD', kind: 'actual', amount: 12000 })).status, 200);
    assert.equal((await send('PUT', url, T.pmo, { period: '2026-11', currency: 'XOF', kind: 'actual', amount: 1500000 })).status, 200);
    const screen = (await send('GET', url, T.fin)).j.view;
    const wb = await sheets(T.fin);
    assert.ok(wb.SheetNames.includes('Budget periods'));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Budget periods'], { defval: null }).filter((r) => r.project === 'WB-1');
    for (const c of screen.currencies) for (const p of c.periods) assert.equal(rows.find((r) => r.currency === c.currency && r.period === p.period && r.kind === 'actual').amount, p.actual, `${c.currency} ${p.period} = screen`);
    assert.deepEqual(rows.map((r) => r.currency).sort(), ['USD', 'XOF']);
    assert.ok(!(await sheets(T.viewer)).SheetNames.includes('Budget periods'), 'no money reader: no sheet');
    await sw({ ppm_budget_periods_enabled: '0' });
    assert.ok(!(await sheets(T.fin)).SheetNames.includes('Budget periods'), 'switch off: today’s workbook');
  } finally { await sw({ ppm_budget_periods_enabled: '0' }); }
});

test('R2-WB-01 change requests: 404 while off; on: author ≠ approver, illegal steps refused, apply → baseline version + ledger, money rule, workbook sheet', async () => {
  // a project past its approval gate (owner wb_owner; the committee members are not the owner)
  const p3 = (await put('project', T.pmo, { objective_id: obj, key: 'WB-3', name: 'Fictitious failover', owner: 'wb_owner', sponsor: 'Sponsor', site_id: A, charter: 'Second WAN link for the fictitious mine, with failover tests and documentation.',
    start_date: '2026-11-02', end_date: '2027-02-26', baseline_start: '2026-11-02', baseline_end: '2027-02-26' })).j.id;
  for (const to of ['approval', 'in_progress']) { const r = await send('POST', `/api/governance/portfolio/project/${p3}/stage`, T.cio, { to }); assert.equal(r.status, 200, JSON.stringify(r.j)); }
  const url = `/api/governance/ppm/project/${p3}/changes`;
  await sw({ ppm_change_requests_enabled: '0' });
  assert.equal((await send('GET', url, T.pmo)).status, 404);
  assert.equal((await send('POST', url, T.pmo, { title: 'x', reason: 'a long enough reason' })).status, 404);
  await sw({ ppm_change_requests_enabled: '1', ppm_rebaseline_enabled: '0' });
  try {
    assert.equal((await send('POST', url, T.viewer, { title: 'x', reason: 'a long enough reason' })).status, 403, 'plan-write rule');
    const c = await send('POST', url, T.pmo, { title: 'Add site B to the scope', reason: 'site B asked for the same failover', impact_dates_days: 14, impact_budget: 2500, currency: 'USD' });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    const cid = c.j.change.id; const step = (t, a, note) => send('POST', `${url}/${cid}/${a}`, t, { note });
    assert.equal((await step(T.cio, 'approve')).j.code, 'CR_ORDER', 'proposed cannot jump to approved');
    assert.equal((await step(T.viewer, 'assess')).status, 403);
    assert.equal((await step(T.pmo, 'assess', 'impact checked with the carrier')).status, 200);
    const self = await step(T.pmo, 'approve');
    assert.equal(self.status, 403); assert.equal(self.j.code, 'SELF_REVIEW');
    assert.equal((await step(T.cio, 'approve', 'agreed in the change board')).status, 200);
    const off = await step(T.cio, 'apply');
    assert.equal(off.status, 409); assert.equal(off.j.code, 'REBASELINE_OFF', 'a dates impact needs the committee re-baseline');
    await sw({ ppm_rebaseline_enabled: '1' });
    const ap = await step(T.cio, 'apply');
    assert.equal(ap.status, 200, JSON.stringify(ap.j)); assert.equal(ap.j.change.status, 'applied'); assert.ok(ap.j.change.applied_baseline_version >= 1);
    const bl = await send('GET', `/api/governance/portfolio/project/${p3}/baselines`, T.pmo);
    const v = bl.j.versions.find((x) => x.version === ap.j.change.applied_baseline_version);
    assert.equal(v.payload.project.baseline_end, '2027-03-12', '+14 days on the baseline end'); assert.match(v.reason, /Change request #/);
    assert.equal((await step(T.cio, 'apply')).j.code, 'CR_ORDER', 'applied once');
    const h = await send('GET', `/api/governance/portfolio/project/${p3}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => /^change_request_|^rebaseline$/.test(e.action)).map((e) => e.action), ['change_request_proposed', 'change_request_assessed', 'change_request_approved', 'rebaseline', 'change_request_applied']);
    // money rule
    const vw = await send('GET', url, T.viewer);
    assert.equal(vw.status, 200); assert.equal(vw.j.money_hidden, true); assert.doesNotMatch(JSON.stringify(vw.j.changes), /2500/);
    assert.equal((await send('POST', url, T.viewer, { title: 'x', reason: 'a long enough reason', impact_budget: 5, currency: 'USD' })).status, 403);
    assert.match(JSON.stringify((await send('GET', url, T.fin)).j.changes), /2500/);
    // a change without dates impact applies without a baseline; withdraw by the author
    const c2 = (await send('POST', url, T.pmo, { title: 'Rename the deliverable', reason: 'naming aligned with the site' })).j.change.id;
    assert.equal((await send('POST', `${url}/${c2}/withdraw`, T.pmo, { note: 'not needed after all' })).j.change.status, 'withdrawn');
    // workbook sheet
    const XLSX = require('xlsx');
    const rows = (t) => wbBuf(t).then((b) => XLSX.utils.sheet_to_json(XLSX.read(b, { type: 'buffer' }).Sheets.Changes, { defval: null }));
    const fin = (await rows(T.fin)).filter((r) => r.project === 'WB-3');
    assert.deepEqual(fin.map((r) => [r.status, r.impact_dates_days, r.impact_budget, r.currency]), [['applied', 14, 2500, 'USD'], ['withdrawn', null, null, null]]);
    assert.ok(!('impact_budget' in (await rows(T.viewer))[0]), 'no money column for a non-money reader');
  } finally { await sw({ ppm_change_requests_enabled: '0', ppm_rebaseline_enabled: '0' }); }
  const XLSX = require('xlsx');
  assert.ok(!XLSX.read(await wbBuf(T.fin), { type: 'buffer' }).SheetNames.includes('Changes'), 'switch off: no sheet');
});
