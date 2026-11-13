'use strict';
// P7 / B4-B5 over HTTP, fictitious data only. Every new action is 404 while its PROPOSED switch is '0' (= today).
//   B4 plan freshness on the project page + the stale-plan exception (stale_plan_days)
//   B5 timesheet week approval — SoD (an entrant / submitter never approves), frozen weeks, cross-site refusal
//   B5 change-request impact simulation BEFORE approval; a request that is not approved never alters the baseline
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-p7b-'));
process.env.DASH_USER = process.env.DASH_USER || 'p7b-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'p7b-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'p7b-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, obj, pid, T = {}, ID = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_timesheet_weeks'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('p7_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('p7_cio', ['viewer', 'committee-member']);
  T.fin = await mk('p7_fin', ['viewer', 'finance-viewer']);
  T.editorA = await mk('p7_editor_a', ['editor'], A);
  T.editorB = await mk('p7_editor_b', ['editor'], B);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'p7-prog', name: 'P7' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'p7-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'P7-1', name: 'Fictitious radio relay', owner: 'p7_owner', sponsor: 'Sponsor', site_id: A, start_date: '2026-11-02', end_date: '2026-11-30',
    charter: 'Replace the fictitious radio relay with a redundant pair and document the failover tests.', baseline_start: '2026-11-02', baseline_end: '2026-11-30' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j, r }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');

test('B4: the project page says when the plan was last updated; stale_plan only with stale_plan_days, unknown never stale', async () => {
  const d = await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo);
  assert.equal(d.status, 200);
  assert.equal(d.j.plan_freshness.plan_updated_days, 0, 'just created');
  assert.match(d.j.plan_freshness.plan_updated_at, /^\d{4}-\d{2}-\d{2}T/);
  // an in_progress project whose plan rows were last touched 60 days ago (no ledger row) — written directly, fictitious
  const H = rdb.pgHandle(); const old = new Date(Date.now() - 60 * 86400000).toISOString();
  await H.prepare(`INSERT INTO portfolio_projects (objective_id, key, name, owner, site_id, stage, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(obj, 'P7-OLD', 'Fictitious stale plan', 'p7_owner', A, 'in_progress', 'green', old, old);
  const oldId = Number((await H.prepare(`SELECT id FROM portfolio_projects WHERE key='P7-OLD'`).get()).id);
  const ex = async () => (await send('GET', '/api/governance/portfolio/exceptions', T.pmo)).j;
  await sw({ stale_plan_days: '' });
  assert.ok(!(await ex()).items.some((x) => x.kind === 'stale_plan'), "'' = off = today");
  await sw({ stale_plan_days: '30' });
  try {
    const e = await ex();
    assert.equal(e.thresholds.stale_plan_days, 30);
    const st = e.items.filter((x) => x.kind === 'stale_plan');
    assert.deepEqual(st.map((x) => x.project_id), [oldId], 'only the old plan; today\'s project is fresh');
    assert.equal((await send('GET', `/api/governance/portfolio/project/${oldId}`, T.pmo)).j.plan_freshness.plan_updated_days, 60);
    // the nightly job sees it too (dry run, nothing sent)
    const run = await require('../tools/governance/ppm-alerts').run({ dryRun: true, log: () => {} });
    assert.ok(run.would_notify.some((w) => w.kind === 'stale_plan' && w.project === 'P7-OLD'));
  } finally { await sw({ stale_plan_days: '' }); }
});

test('B5 timesheets: 404 while off; SoD 403 for the entrant / submitter; submitted and approved weeks frozen; cross-site refused', async () => {
  const tid = (await put('task', T.pmo, { project_id: pid, name: 'Survey', owner: 'Ana', start_date: '2026-11-02', duration_days: 3 })).j.id;
  const url = `/api/governance/ppm/project/${pid}/timesheets`;
  const time = (t, b) => send('POST', `/api/governance/ppm/task/${tid}/time`, t, b);
  await sw({ ppm_time_entries_enabled: '1', ppm_timesheet_approval_enabled: '0' });
  try {
    assert.equal((await send('GET', url, T.pmo)).status, 404, 'switch off = today');
    assert.equal((await send('POST', url + '/submit', T.pmo, { week_start: '2026-11-09', person_key: 'l:ana' })).status, 404);
    assert.equal((await time(T.pmo, { person_label: 'Ana', day: '2026-11-10', hours: 6 })).status, 200);
    await sw({ ppm_timesheet_approval_enabled: '1' });
    const g = await send('GET', url, T.pmo);
    assert.equal(g.status, 200); assert.deepEqual(g.j.weeks.map((w) => [w.week_start, w.person_key, w.hours, w.status, w.i_entered]), [['2026-11-09', 'l:ana', 6, 'draft', true]]);
    const step = (t, a, b) => send('POST', `${url}/${a}`, t, { week_start: '2026-11-11', person_key: 'l:ana', ...(b || {}) });
    const sub = await step(T.pmo, 'submit');
    assert.equal(sub.status, 200, JSON.stringify(sub.j)); assert.equal(sub.j.week.status, 'submitted'); assert.equal(sub.j.week.week_start, '2026-11-09', 'any day of the week addresses it');
    const self = await step(T.pmo, 'approve');
    assert.equal(self.status, 403); assert.equal(self.j.code, 'SELF_REVIEW', 'the person who entered and submitted cannot approve');
    const fz = await time(T.cio, { person_label: 'Ana', day: '2026-11-12', hours: 1 });
    assert.equal(fz.status, 409); assert.equal(fz.j.code, 'WEEK_FROZEN', 'a submitted week is frozen');
    assert.equal((await time(T.cio, { person_label: 'Bob', day: '2026-11-12', hours: 2 })).status, 200, 'another person of the same week is not frozen');
    assert.equal((await step(T.editorB, 'approve')).status, 403, 'committee writes only (editor plan writes off)');
    const ap = await step(T.cio, 'approve');
    assert.equal(ap.status, 200, JSON.stringify(ap.j)); assert.equal(ap.j.week.status, 'approved'); assert.equal(ap.j.week.decided_by, ID.p7_cio);
    const entries = (await send('GET', `/api/governance/ppm/task/${tid}/time`, T.pmo)).j.entries;
    const ana = entries.find((e) => e.person_label === 'Ana');
    const del = await send('DELETE', `/api/governance/ppm/task/${tid}/time/${ana.id}`, T.cio);
    assert.equal(del.status, 409); assert.equal(del.j.code, 'WEEK_FROZEN', 'an approved week is frozen');
    assert.equal((await step(T.cio, 'reject', { note: 'too late to reject' })).j.code, 'TS_ORDER');
    // Bob's week: the cio entered it → cio cannot approve; reject by pmo needs a note, then the week opens again
    const bob = (b) => send('POST', `${url}/${b.a}`, b.t, { week_start: '2026-11-09', person_key: 'l:bob', note: b.note });
    assert.equal((await bob({ a: 'submit', t: T.pmo })).status, 200);
    assert.equal((await bob({ a: 'approve', t: T.cio })).j.code, 'SELF_REVIEW', 'the cio recorded Bob\'s hours');
    assert.equal((await bob({ a: 'reject', t: T.fin, note: 'wrong task for these hours' })).status, 403, 'finance has no plan-write right');
    assert.equal((await bob({ a: 'reject', t: T.pmo, note: 'x' })).j.code, 'SELF_REVIEW', 'the pmo submitted it');
    // cross-site: with site-scoped reads + editor plan writes, a site-B editor never acts on a site-A project
    await sw({ portfolio_site_scope_reads: '1', portfolio_editor_plan_writes: '1' });
    try {
      const xs = await bob({ a: 'reject', t: T.editorB, note: 'not my site at all' });
      assert.ok([403, 404].includes(xs.status), `cross-site refused (${xs.status})`);
      const rj = await bob({ a: 'reject', t: T.editorA, note: 'wrong task for these hours' });
      assert.equal(rj.status, 200, JSON.stringify(rj.j)); assert.equal(rj.j.week.status, 'rejected');
    } finally { await sw({ portfolio_site_scope_reads: '0', portfolio_editor_plan_writes: '0' }); }
    assert.equal((await time(T.cio, { person_label: 'Bob', day: '2026-11-13', hours: 1 })).status, 200, 'a rejected week can be corrected');
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.deepEqual(h.j.events.filter((e) => /^timesheet_/.test(e.action)).map((e) => e.action), ['timesheet_submitted', 'timesheet_approved', 'timesheet_submitted', 'timesheet_rejected']);
    // switch off again: no check, today's behaviour
    await sw({ ppm_timesheet_approval_enabled: '0' });
    assert.equal((await time(T.cio, { person_label: 'Ana', day: '2026-11-12', hours: 1 })).status, 200);
  } finally { await sw({ ppm_time_entries_enabled: '0', ppm_timesheet_approval_enabled: '0' }); }
});

test('B5 change requests: impact simulated before approval (hand-computed), cost under the money rule, unapproved never re-baselines', async () => {
  // project past its approval gate, network 1 → {2, 3} → 4 (Mon–Fri) — see tests/ppm-p7b-pure.test.js for the hand computation
  const p = (await put('project', T.pmo, { objective_id: obj, key: 'P7-2', name: 'Fictitious failover', owner: 'p7_owner', sponsor: 'Sponsor', site_id: A, charter: 'Second WAN link for the fictitious mine, with failover tests and documentation.',
    start_date: '2026-11-02', end_date: '2026-11-12', baseline_start: '2026-11-02', baseline_end: '2026-11-12' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: p, name: 'A', start_date: '2026-11-02', duration_days: 5, effort_hours: 40, allocation_pct: 100 })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: p, name: 'B', duration_days: 3, depends_on: [t1] })).j.id;
  const t3 = (await put('task', T.pmo, { project_id: p, name: 'C', duration_days: 2, effort_hours: 16, allocation_pct: 100, depends_on: [t1] })).j.id;
  const t4 = (await put('task', T.pmo, { project_id: p, name: 'D', duration_days: 1, depends_on: [t2, t3] })).j.id;
  for (const to of ['approval', 'in_progress']) assert.equal((await send('POST', `/api/governance/portfolio/project/${p}/stage`, T.cio, { to })).status, 200);
  await sw({ ppm_evm_enabled: '1' });
  assert.equal((await send('PUT', `/api/governance/ppm/task/${t3}/evm`, T.pmo, { cost_rate: 50, cost_currency: 'USD' })).status, 200);
  await sw({ ppm_evm_enabled: '0' });
  const url = `/api/governance/ppm/project/${p}/changes`;
  const blVersions = async () => (await send('GET', `/api/governance/portfolio/project/${p}/baselines`, T.pmo)).j.versions.length;
  const baselineEnd = async () => (await send('GET', `/api/governance/portfolio/project/${p}`, T.pmo)).j.project.baseline_end;
  await sw({ ppm_change_requests_enabled: '1', ppm_cr_simulation_enabled: '0', ppm_rebaseline_enabled: '1' });
  try {
    const off = await send('POST', url, T.pmo, { title: 'Longer C', reason: 'the carrier needs more time', task_changes: [{ task_id: t3, duration_days: 5 }] });
    assert.equal(off.status, 409); assert.equal(off.j.code, 'SIMULATION_OFF');
    assert.equal((await send('POST', `${url}/1/simulate`, T.pmo, {})).status, 404, 'switch off = 404');
    await sw({ ppm_cr_simulation_enabled: '1' });
    const bad = await send('POST', url, T.pmo, { title: 'Bad', reason: 'a long enough reason', task_changes: [{ task_id: 999999, duration_days: 5 }] });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'UNKNOWN_TASK');
    const c = await send('POST', url, T.pmo, { title: 'Longer C', reason: 'the carrier needs more time', task_changes: [{ task_id: t3, duration_days: 5 }] });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    const s = c.j.change.simulation.schedule;
    assert.deepEqual([s.finish_before, s.finish_after, s.finish_delta_days, s.finish_delta_working_days], ['2026-11-12', '2026-11-16', 4, 2]);
    assert.deepEqual(s.critical_path_before, [t1, t2, t4]); assert.deepEqual(s.critical_path_after, [t1, t3, t4]);
    assert.deepEqual(c.j.change.simulation.cost.by_currency, [{ currency: 'USD', delta: 1200, delta_hours: 24, tasks: 1 }], 'pmo is committee = money reader');
    assert.equal((await send('GET', `/api/governance/portfolio/project/${p}`, T.pmo)).j.tasks.find((t) => t.id === t3).duration_days, 2, 'simulation never writes the plan');
    // a viewer without the money right sees the schedule impact, not the cost
    const ed = await send('GET', url, T.editorA);
    assert.equal(ed.status, 200); const edc = ed.j.changes.find((x) => x.id === c.j.change.id);
    assert.equal(edc.simulation.schedule.finish_delta_days, 4); assert.deepEqual(edc.simulation.cost, { money_hidden: true }); assert.doesNotMatch(JSON.stringify(edc), /1200/);
    // NOT approved → the baseline never moves: apply refused in every pre-approval state
    const cid = c.j.change.id; const step = (t, a, note) => send('POST', `${url}/${cid}/${a}`, t, { note });
    const v0 = await blVersions(), e0 = await baselineEnd();
    assert.equal((await step(T.cio, 'apply')).j.code, 'CR_ORDER', 'proposed cannot be applied');
    assert.equal((await step(T.pmo, 'assess', 'checked with the carrier')).status, 200);
    assert.equal((await step(T.cio, 'apply')).j.code, 'CR_ORDER', 'assessed cannot be applied');
    assert.equal((await step(T.pmo, 'approve')).j.code, 'SELF_REVIEW');
    assert.deepEqual([await blVersions(), await baselineEnd()], [v0, e0], 'no approval = baseline untouched');
    // the plan moves before the decision: approve re-simulates on the CURRENT plan
    assert.equal((await put('task', T.pmo, { id: t2, duration_days: 6 })).status, 200);   // B now ends 11-16 → C at 5 d is no longer the driver alone
    const ap = await step(T.cio, 'approve', 'agreed in the change board');
    assert.equal(ap.status, 200, JSON.stringify(ap.j));
    assert.equal(ap.j.change.simulation.schedule.finish_before, '2026-11-17', 're-simulated on the current plan');
    assert.equal(ap.j.change.simulation.schedule.finish_delta_days, 0, 'with B at 6 d, longer C no longer moves the finish');
    assert.deepEqual([await blVersions(), await baselineEnd()], [v0, e0], 'approved but not applied = baseline untouched');
    // a second request with a real delta: approved + applied → a NEW versioned baseline moved by the simulated delta
    const c2 = (await send('POST', url, T.pmo, { title: 'Longer D', reason: 'commissioning takes longer', task_changes: [{ task_id: t4, duration_days: 3 }] })).j.change;
    assert.equal(c2.simulation.schedule.finish_delta_days, 2, 'D 11-17 → 11-19');
    const s2 = (a, t, note) => send('POST', `${url}/${c2.id}/${a}`, t, { note });
    assert.equal((await s2('assess', T.cio, 'ok')).status, 200);
    assert.equal((await s2('approve', T.cio, 'ok')).status, 200);
    const app = await s2('apply', T.cio);
    assert.equal(app.status, 200, JSON.stringify(app.j)); assert.equal(await blVersions(), v0 + 1);
    assert.equal(await baselineEnd(), '2026-11-14', 'baseline end 11-12 + 2 simulated days');
    const h = await send('GET', `/api/governance/portfolio/project/${p}/history`, T.pmo);
    assert.ok(h.j.events.filter((e) => e.action === 'change_request_simulated').length >= 4);
  } finally { await sw({ ppm_change_requests_enabled: '0', ppm_cr_simulation_enabled: '0', ppm_rebaseline_enabled: '0' }); }
});
