'use strict';
// G11 / G12 / G13 / G14 (EX-05 witness case, fictitious data) — one project through the native PPM over HTTP:
// RFI → triage (history kept) → project with lineage (at most one) → WBS tasks with dependencies (cycle refused) →
// stage gates (charter, sponsor, baseline, owner cannot approve) → baseline frozen → financial edits with before/after
// → amounts hidden from a viewer → resource over-allocation → closure blocked by open work → closed.
// Then the Roadmap Manager → portfolio migration APPLY path, and its repeat refused.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-smoke-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppm-smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppm-smoke-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppm-smoke-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, hounde, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_tasks'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('pp_pmo', ['viewer', 'committee-member']);        // committee: triage + plan
  T.cio = await mk('pp_cio', ['viewer', 'committee-member']);        // approver (not the owner)
  T.fin = await mk('pp_fin', ['viewer', 'finance-viewer']);
  T.viewer = await mk('pp_viewer', ['viewer'], hounde);
  T.super = await mk('pp_super', ['super_admin']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);

test('witness project end to end (fictitious figures only)', async () => {
  // RFI → triage, history kept
  const rfi = (await send('POST', '/api/governance/rfi', T.viewer, { kind: 'integration', title: 'WAN redundancy at Houndé', problem: 'single ISP link; outages stop the mill reporting' })).j.rfi;
  assert.equal((await send('POST', `/api/governance/rfi/${rfi.id}/to-project`, T.pmo, { objective_id: 1, key: 'x' })).status, 409, 'a submitted request is not a project yet');
  await send('PUT', `/api/governance/rfi/${rfi.id}`, T.pmo, { status: 'triaged' });
  await send('PUT', `/api/governance/rfi/${rfi.id}`, T.pmo, { status: 'accepted', decision: 'go — committee 2026-11' });
  const prog = (await put('programme', T.pmo, { key: 'wit-net', name: 'Network resilience' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'wit-o1', name: 'Two links per mine' })).j.id;
  const conv = await send('POST', `/api/governance/rfi/${rfi.id}/to-project`, T.pmo, { objective_id: obj, key: 'WIT-1', owner: 'pp_pmo' });
  assert.equal(conv.status, 200, JSON.stringify(conv.j)); const pid = conv.j.project_id;
  assert.equal((await send('POST', `/api/governance/rfi/${rfi.id}/to-project`, T.pmo, { objective_id: obj, key: 'WIT-2' })).status, 409, 'at most one project per request');
  const rh = (await send('GET', `/api/governance/portfolio/rfi/${rfi.id}/history`, T.pmo)).j.events;
  assert.deepEqual(rh.map(e => e.action + ':' + (e.new_value || '')), ['triage:triaged', 'triage:accepted', 'to_project:' + pid]);
  assert.equal(rh[1].note, 'go — committee 2026-11');

  // WBS with dependencies
  const t1 = (await put('task', T.pmo, { project_id: pid, wbs_code: '1', name: 'Survey', owner: 'A. Kone', start_date: '2027-01-04', end_date: '2027-01-15', allocation_pct: 60 })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, wbs_code: '2', name: 'Order second link', owner: 'A. Kone', start_date: '2027-01-11', end_date: '2027-01-22', allocation_pct: 60, depends_on: [t1] })).j.id;
  const t3 = (await put('task', T.pmo, { project_id: pid, wbs_code: '3', name: 'Cut-over', owner: 'B. Sow', duration_days: 2, depends_on: [t2] })).j.id;
  const cyc = await put('task', T.pmo, { id: t1, depends_on: [t3] });
  assert.equal(cyc.status, 400); assert.equal(cyc.j.code, 'DEP_CYCLE');
  assert.equal((await put('task', T.pmo, { project_id: pid, name: 'x', depends_on: [999999] })).j.code, 'DEP_MISSING');

  // owner identity: the full name counts as well as the username
  const own = await put('project', T.pmo, { objective_id: obj, key: 'WIT-SOD', name: 'sod', owner: 'pp_cio', charter: 'Owner identity check for the approval gate', sponsor: 'CIO', start_date: '2027-01-01', end_date: '2027-02-01', baseline_end: '2027-02-01' });
  await send('POST', `/api/governance/portfolio/project/${own.j.id}/stage`, T.pmo, { to: 'approval' });
  assert.equal((await send('POST', `/api/governance/portfolio/project/${own.j.id}/stage`, T.cio, { to: 'in_progress' })).j.code, 'GATE_SOD');

  // stage gates
  let st = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' });
  assert.equal(st.status, 200, 'the charter was carried over from the request problem');
  await put('project', T.pmo, { id: pid, sponsor: 'CIO', start_date: '2027-01-04', end_date: '2027-03-31', baseline_end: '2027-03-31', budget: 120000, currency: 'USD', spend_type: 'capex', reason: 'business case v1' });
  st = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'in_progress' });
  assert.equal(st.status, 409); assert.equal(st.j.code, 'GATE_SOD', 'the owner cannot approve their own project');
  st = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' });
  assert.equal(st.status, 200); assert.equal(st.j.project.stage, 'in_progress');
  const sw = await put('project', T.cio, { id: pid, owner: 'pp_cio' });
  assert.equal(sw.status, 409); assert.equal(sw.j.code, 'ROLES_FROZEN', 'the owner cannot be swapped around an approval');
  const stt = await put('project', T.pmo, { id: pid, status: 'done' });
  assert.equal(stt.j.code, 'STATUS_BY_STAGE', 'status only moves through a gate');
  const fr = await put('project', T.pmo, { id: pid, baseline_end: '2027-05-31' });
  assert.equal(fr.status, 409); assert.equal(fr.j.code, 'BASELINE_FROZEN');
  await put('project', T.pmo, { id: pid, spent: 30000, reason: 'PO-123 first invoice' });

  // finance history, money visibility
  const ph = (await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.fin)).j.events;
  const spent = ph.find(e => e.field === 'spent'); assert.deepEqual([spent.old_value, Number(spent.new_value), spent.note], [null, 30000, 'PO-123 first invoice']);
  assert.ok(ph.some(e => e.action === 'stage' && e.new_value === 'in_progress' && e.actor === 'pp_cio'));
  assert.equal((await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.viewer)).status, 403);
  assert.equal((await send('GET', `/api/governance/portfolio/rfi/${rfi.id}/history`, T.fin)).status, 403, 'finance reads money, not request decisions');
  const vv = (await send('GET', '/api/governance/portfolio', T.viewer)).j; const vp = vv.projects.find(p => p.id === pid);
  assert.equal(vv.money_hidden, true); assert.equal(vp.budget, undefined);
  const vf = (await send('GET', '/api/governance/portfolio', T.fin)).j; assert.equal(vf.projects.find(p => p.id === pid).budget, 120000);
  assert.equal(vf.summary.find(s => s.programme === 'wit-net').currency, 'USD');

  // plan: critical path + over-allocation of A. Kone on 11–15 Jan (60 % + 60 %)
  const plan = vf.plans.find(p => p.project_id === pid); assert.deepEqual(plan.critical_path, [t1, t2, t3]);
  const rc = vf.resource_conflicts.find(c => c.owner === 'A. Kone'); assert.deepEqual([rc.from, rc.to, rc.peak_pct], ['2027-01-11', '2027-01-15', 120]);

  // closure: blocked by open work, then closed
  st = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'closure' });
  assert.equal(st.j.code, 'GATE_OPEN_TASKS');
  for (const id of [t1, t2, t3]) await put('task', T.pmo, { id, status: 'done' });
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'closure' })).status, 200);
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'closed' })).j.project.status, 'done');
  let refused = false; try { await rdb.db.prepare("UPDATE ppm_events SET note='x'").run(); } catch (_) { refused = true; }
  assert.ok(refused, 'the PPM ledger is append-only');
});

test('two currencies are never added together', async () => {
  const prog = (await put('programme', T.pmo, { key: 'wit-cur', name: 'Currency check' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'wit-cur-o', name: 'o' })).j.id;
  await put('project', T.pmo, { objective_id: obj, key: 'WC-1', name: 'a', budget: 100, currency: 'USD' });
  await put('project', T.pmo, { objective_id: obj, key: 'WC-2', name: 'b', budget: 55000, currency: 'XOF' });
  await put('project', T.pmo, { objective_id: obj, key: 'WC-3', name: 'c' });
  assert.equal((await put('project', T.pmo, { objective_id: obj, key: 'WC-4', name: 'd', currency: 'dollars' })).status, 400);
  const s = (await send('GET', '/api/governance/portfolio', T.fin)).j.summary.find(x => x.programme === 'wit-cur');
  assert.equal(s.budget, null); assert.equal(s.currency_mixed, true); assert.equal(s.budget_by_currency.XOF.budget, 55000); assert.equal(s.budget_unknown, 1);
});

test('G13: roadmap → portfolio migration apply path, then a repeat is refused', async () => {
  const me = (await rdb.db.prepare("SELECT id FROM users WHERE username='pp_super'").get()).id;
  await rdb.getRoadmap(me);   // lazy-seeds the four objectives
  const dry = (await send('POST', '/api/governance/roadmap-migration', T.super, {})).j; assert.equal(dry.dry_run, true);
  const ap = await send('POST', '/api/governance/roadmap-migration?apply=1', T.super, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.j));
  const pf = (await send('GET', '/api/governance/portfolio', T.super)).j;
  assert.ok(pf.programmes.some(p => p.key === 'itsm-roadmap'));
  assert.equal(pf.objectives.filter(o => o.programme_id === pf.programmes.find(p => p.key === 'itsm-roadmap').id).length, dry.plan.objectives.length);
  assert.equal((await send('POST', '/api/governance/roadmap-migration?apply=1', T.super, {})).status, 409, 'migration is not applied twice');
});

// ---- A-14 — the project page API (fictitious figures only) ------------------------------------------------------
const getP = (id, t) => send('GET', `/api/governance/portfolio/project/${id}`, t);
async function a14Fixture(tag) {
  const prog = (await put('programme', T.pmo, { key: 'a14-' + tag, name: 'Project page ' + tag })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'a14-o-' + tag, name: 'o' })).j.id;
  return obj;
}

test('A-14: GET /portfolio/project/:id — tasks, RAID, plan with critical flags, allowed stages with refusals; money hidden for a viewer', async () => {
  const obj = await a14Fixture('get');
  const charter = JSON.stringify({ objective: '', scope_in: '', scope_out: '', benefits: '' });
  const pid = (await put('project', T.pmo, { objective_id: obj, key: 'A14-1', name: 'Page check', owner: 'pp_pmo', start_date: '2027-01-04', end_date: '2027-02-26', budget: 5000, currency: 'USD', charter })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, wbs_code: '1', name: 'Design', duration_days: 5, progress_pct: 40, effort_hours: 24 })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, wbs_code: '2', name: 'Build', duration_days: 10, depends_on: [t1] })).j.id;
  const t3 = (await put('task', T.pmo, { project_id: pid, wbs_code: '3', name: 'Docs', depends_on: [t1] })).j.id;
  assert.equal((await put('risk', T.pmo, { project_id: pid, title: 'ISP delay', probability: 3, impact: 2 })).status, 200);
  assert.equal((await put('risk', T.pmo, { project_id: pid, title: 'Survey done late', kind: 'issue', probability: 2, impact: 2 })).status, 200);
  assert.equal((await put('milestone', T.pmo, { project_id: pid, name: 'Go-live', due_date: '2027-02-26', owner: 'B. Sow' })).status, 200);

  const r = await getP(pid, T.pmo); assert.equal(r.status, 200, JSON.stringify(r.j));
  const v = r.j;
  assert.equal(v.project.id, pid); assert.equal(v.project.budget, 5000); assert.equal(v.can_gate, true); assert.equal(v.can_edit_plan, true);
  assert.deepEqual(v.tasks.map((x) => x.id), [t1, t2, t3]);
  assert.equal(v.tasks[0].progress_pct, 40); assert.equal(v.tasks[0].effort_hours, 24);
  assert.equal(v.milestones[0].owner, 'B. Sow');
  assert.deepEqual(v.risks.map((x) => x.kind).sort(), ['issue', 'risk']);
  assert.equal(v.plan.anchor, '2027-01-04');
  const pt = Object.fromEntries(v.plan.tasks.map((x) => [x.id, x]));
  assert.equal(pt[t1].critical, true); assert.equal(pt[t2].critical, true); assert.equal(pt[t3].critical, false);
  assert.equal(pt[t3].assumed_duration, true); assert.equal(pt[t3].duration_days, null);
  assert.equal(pt[t2].es_date, '2027-01-09');
  assert.deepEqual(v.allowed_stages.map((s) => s.to), ['approval']);
  assert.equal(v.allowed_stages[0].refusal.code, 'GATE_CHARTER', 'a JSON charter of empty fields does not pass approval');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' })).j.code, 'GATE_CHARTER');

  const vv = (await getP(pid, T.viewer)).j;
  assert.equal(vv.money_hidden, true); assert.equal(vv.project.budget, undefined); assert.equal(vv.can_gate, false); assert.equal(vv.can_edit_plan, false); assert.equal(vv.can_see_history, false);
  assert.equal((await getP(9999999, T.pmo)).status, 404);
  assert.equal((await getP('abc', T.pmo)).status, 404);
  // the specific sub-paths still answer (route order)
  assert.equal((await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo)).status, 200);
});

test('A-14: the owner sees GATE_SOD for in_progress in allowed_stages and the POST is refused 409', async () => {
  const obj = await a14Fixture('sod');
  const charter = JSON.stringify({ objective: 'Replace the core switch at the mine', benefits: 'fewer outages' });
  const pid = (await put('project', T.pmo, { objective_id: obj, key: 'A14-SOD', name: 'sod', owner: 'pp_pmo', sponsor: 'CIO', charter, start_date: '2027-01-01', end_date: '2027-03-01', baseline_end: '2027-03-01' })).j.id;
  const g0 = (await getP(pid, T.pmo)).j.allowed_stages; assert.equal(g0[0].refusal, null, 'a filled JSON charter passes');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' })).status, 200);
  const g = (await getP(pid, T.pmo)).j.allowed_stages;
  assert.deepEqual(g.map((s) => s.to), ['in_progress', 'proposal']);
  assert.equal(g[0].refusal.code, 'GATE_SOD');
  assert.equal((await getP(pid, T.cio)).j.allowed_stages[0].refusal, null, 'another committee member may approve');
  const st = await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'in_progress' });
  assert.equal(st.status, 409); assert.equal(st.j.code, 'GATE_SOD');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' })).status, 200);
  const h = (await getP(pid, T.cio)).j.allowed_stages.find((s) => s.to === 'on_hold');
  assert.equal(h.needs_reason, true); assert.equal(h.refusal, null, 'the dry run assumes the reason typed at the move');
});

test('A-14: RAID kinds and task fields are validated; only an open high RISK blocks closed (today rule)', async () => {
  const obj = await a14Fixture('raid');
  const pid = (await put('project', T.pmo, { objective_id: obj, key: 'A14-R', name: 'raid', owner: 'pp_pmo', sponsor: 'CIO', charter: 'A plain-text charter long enough to pass', start_date: '2027-01-01', end_date: '2027-03-01', baseline_end: '2027-03-01' })).j.id;
  assert.equal((await put('risk', T.pmo, { project_id: pid, title: 'a', kind: 'assumption', probability: 1, impact: 1 })).status, 200);
  const bad = await put('risk', T.pmo, { project_id: pid, title: 'b', kind: 'dependency', probability: 1, impact: 1 });
  assert.equal(bad.status, 400);
  assert.equal((await put('task', T.pmo, { project_id: pid, name: 'x', progress_pct: 101 })).status, 400);
  assert.equal((await put('task', T.pmo, { project_id: pid, name: 'x', effort_hours: -1 })).status, 400);
  assert.equal((await put('task', T.pmo, { project_id: pid, name: 'x', progress_pct: 100, effort_hours: 0, status: 'done' })).status, 200);
  const iss = (await put('risk', T.pmo, { project_id: pid, title: 'Vendor late', kind: 'issue', probability: 3, impact: 3 })).j.id;
  for (const [to, t] of [['approval', T.pmo], ['in_progress', T.cio], ['closure', T.cio]]) assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, t, { to })).status, 200, to);
  const rk = (await put('risk', T.pmo, { project_id: pid, title: 'Data loss', probability: 3, impact: 3 })).j.id;
  assert.equal((await getP(pid, T.cio)).j.allowed_stages.find((s) => s.to === 'closed').refusal.code, 'GATE_OPEN_RISKS');
  await put('risk', T.pmo, { id: rk, status: 'closed' });
  assert.equal((await getP(pid, T.cio)).j.allowed_stages.find((s) => s.to === 'closed').refusal, null, 'the open high issue does not count');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'closed' })).status, 200);
  assert.ok(iss);
});

test('A-14: RFI accepted → to-project → project page → a second conversion is 409 with project_id', async () => {
  const obj = await a14Fixture('rfi');
  const rfi = (await send('POST', '/api/governance/rfi', T.viewer, { kind: 'ux', title: 'Field form offline', problem: 'the form is lost when the network drops at the pit' })).j.rfi;
  await send('PUT', `/api/governance/rfi/${rfi.id}`, T.pmo, { status: 'accepted' });
  const c = await send('POST', `/api/governance/rfi/${rfi.id}/to-project`, T.pmo, { objective_id: obj, key: 'A14-RFI', owner: 'pp_pmo' });
  assert.equal(c.status, 200); const pid = c.j.project_id;
  const v = (await getP(pid, T.pmo)).j; assert.equal(v.project.rfi_id, rfi.id); assert.equal(v.project.key, 'A14-RFI');
  const again = await send('POST', `/api/governance/rfi/${rfi.id}/to-project`, T.pmo, { objective_id: obj, key: 'A14-RFI2' });
  assert.equal(again.status, 409); assert.equal(again.j.project_id, pid);
});
