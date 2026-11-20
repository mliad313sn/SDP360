'use strict';
// P11 round 3 (PPM seat) — over HTTP, hand-computed. ADR docs/ai-decisions/ADR-P11-R3-moves-deleted-projects-dates.md.
//   R3-1: the committee re-baseline refuses an impossible calendar date (2027-02-30, 2027-13-40) exactly like the
//         ordinary task write (400 DATE_INVALID) and writes no baseline version.
//   R3-2: money already spent stays where it was spent — moving a task that carries logged hours to another project is
//         refused (409 HAS_ACTUALS, the source project's AC unchanged); a soft-deleted project's spent money stays in
//         the portfolio AC, flagged `actuals_on_deleted_projects` (its budget leaves BAC / PV / EV).
//   R3-4: soft-deleting a task does not change a timesheet week total (an approved week included): its hours stay
//         counted, flagged, so the timesheets and the EVM AC agree.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-r3-'));
process.env.DASH_USER = 'r3-admin'; process.env.DASH_PASS = 'r3-pass-0000'; process.env.DASHBOARD_API_KEY = 'r3-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1'; process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, obj, siteA; const T = {};
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* not json */ } return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const SD = '2026-03-11';
const evmOf = async (pid) => { const r = await send('GET', `/api/governance/ppm/project/${pid}/evm?status_date=${SD}`, T.pmo); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return r.j.evm.currencies[0]; };
const pfUsd = async () => { const r = await send('GET', `/api/governance/ppm/evm/portfolio?status_date=${SD}`, T.pmo); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return { usd: r.j.portfolio.currencies.find((c) => c.currency === 'USD'), body: r.j }; };

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_baselines'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  siteA = (await rdb.listSites({ includeInactive: true }))[0].id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('r3_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('r3_cio', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'r3-prog', name: 'P' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'r3-o', name: 'O' })).j.id;
  await sw({ ppm_evm_enabled: '1', ppm_time_entries_enabled: '1' });
});
after(() => server && server.close());

// A: 50 %, B: 0 %, each baseline cost 1000 USD at 10 USD/h over 2026-03-02..13; A logs 10 h, B logs 20 h (2026-03-03).
// → BAC 2000, EV 500, AC 300, CPI 1.6667, EAC 1200.
async function projectWithHours(key, objective = obj) {
  const pid = (await put('project', T.pmo, { objective_id: objective, key, name: key, owner: 'r3_pmo', site_id: siteA, start_date: '2026-03-02' })).j.id;
  const a = (await put('task', T.pmo, { project_id: pid, name: 'A', status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
  const b = (await put('task', T.pmo, { project_id: pid, name: 'B', status: 'in_progress', progress_pct: 0, baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
  for (const t of [a, b]) assert.strictEqual((await send('PUT', `/api/governance/ppm/task/${t}/evm`, T.pmo, { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 10 })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/ppm/task/${a}/time`, T.pmo, { day: '2026-03-03', hours: 10, person_label: 'Ana' })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/ppm/task/${b}/time`, T.pmo, { day: '2026-03-03', hours: 20, person_label: 'Ana' })).status, 200);
  return { pid, a, b };
}

test('R3-1 — re-baseline with an impossible calendar date is refused 400 DATE_INVALID; no version written', async () => {
  await sw({ ppm_baseline_versions: '1', ppm_rebaseline_enabled: '1' });
  const pid = (await put('project', T.pmo, { objective_id: obj, key: 'R3-RB', name: 'bl', owner: 'r3_pmo', site_id: siteA, sponsor: 'CIO', charter: 'Objective, scope and benefits of the witness project', start_date: '2027-01-04', end_date: '2027-03-31', baseline_end: '2027-03-31', budget: 1000, spent: 0, currency: 'USD' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, wbs_code: '1', name: 'S', owner: 'K', start_date: '2027-01-04', end_date: '2027-01-15', baseline_start: '2027-01-04', baseline_end: '2027-01-15', progress_pct: 10, status: 'in_progress' })).j.id;
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' })).status, 200);
  // the ordinary task write refuses these values (reference behaviour)
  const w = await put('task', T.pmo, { id: t1, end_date: '2027-13-40' });
  assert.strictEqual(w.status, 400); assert.strictEqual(w.j.code, 'DATE_INVALID');
  const versions = async () => (await send('GET', `/api/governance/portfolio/project/${pid}/baselines`, T.pmo)).j.versions.length;
  const v0 = await versions();
  const reason = 'Testing impossible calendar dates in a re-baseline';
  const cases = [
    { project: { baseline_end: '2027-02-30' } },
    { project: { baseline_start: '2027-02-29' } },
    { tasks: [{ id: t1, start_date: '2027-13-01', end_date: '2027-13-40' }] },
    { tasks: [{ id: t1, end_date: '2027-04-31' }] },
    { project: { end_date: 'soon' } },
  ];
  for (const c of cases) {
    const r = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, ...c });
    assert.strictEqual(r.status, 400, JSON.stringify(c) + ' ' + JSON.stringify(r.j));
    assert.strictEqual(r.j.code, 'DATE_INVALID', JSON.stringify(c));
  }
  assert.strictEqual(await versions(), v0, 'no baseline version written by a refused re-baseline');
  const g = await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo);
  assert.deepStrictEqual([g.j.project.baseline_end, g.j.tasks.find((t) => t.id === t1).baseline_end], ['2027-03-31', '2027-01-15']);
  // a real date still re-baselines
  const ok = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, project: { baseline_end: '2027-02-28' }, tasks: [{ id: t1, end_date: '2027-01-29' }] });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
});

test('R3-2 — a task with logged hours cannot move to another project (409 HAS_ACTUALS); source AC unchanged', async () => {
  const P3 = await projectWithHours('R3-MV-SRC'), P4 = await projectWithHours('R3-MV-DST');
  const before = await evmOf(P3.pid);
  assert.deepStrictEqual([before.bac, before.ev, before.ac, before.cpi, before.eac], [2000, 500, 300, 1.6667, 1200]);
  const mv = await put('task', T.pmo, { id: P3.b, project_id: P4.pid });
  assert.strictEqual(mv.status, 409, JSON.stringify(mv.j)); assert.strictEqual(mv.j.code, 'HAS_ACTUALS');
  const after = await evmOf(P3.pid), dst = await evmOf(P4.pid);
  assert.deepStrictEqual([after.bac, after.ev, after.ac, after.cpi, after.eac], [2000, 500, 300, 1.6667, 1200]);
  assert.strictEqual(dst.ac, 300, 'the target project does not gain hours spent elsewhere');
  // a task WITHOUT hours still moves
  const c = (await put('task', T.pmo, { project_id: P3.pid, name: 'C', duration_days: 1 })).j.id;
  const okMv = await put('task', T.pmo, { id: c, project_id: P4.pid });
  assert.strictEqual(okMv.status, 200, JSON.stringify(okMv.j));
});

test('R3-2 — a soft-deleted project keeps its spent money in the portfolio AC, flagged actuals_on_deleted_projects', async () => {
  await sw({ soft_delete_enabled: '1' });
  try {
    const progRow = (body, id) => body.portfolio.programmes.find((g) => g.programme_id === id).currencies.find((c) => c.currency === 'USD');
    const prog3 = (await put('programme', T.pmo, { key: 'r3-prog3', name: 'P3' })).j.id;
    const obj3 = (await put('objective', T.pmo, { programme_id: prog3, key: 'r3-o3', name: 'O3' })).j.id;
    const P5 = await projectWithHours('R3-PF-DEL', obj3); await projectWithHours('R3-PF-LIVE', obj3);
    const { usd: pf0, body: b0 } = await pfUsd();
    const g0 = progRow(b0, prog3);
    assert.deepStrictEqual([g0.bac, g0.ev, g0.ac, g0.cpi], [4000, 1000, 600, 1.6667]);
    assert.ok(!(g0.reasons || []).includes('actuals_on_deleted_projects'));
    const d = await send('DELETE', `/api/governance/portfolio/project/${P5.pid}`, T.cio);
    assert.strictEqual(d.status, 200, JSON.stringify(d.j)); assert.strictEqual(d.j.soft, true);
    const { usd: pf1, body: b1 } = await pfUsd();
    const g1 = progRow(b1, prog3);
    // P5 leaves BAC (2000) and EV (500); its 300 spent stays: BAC 2000, EV 500, AC 600, CPI 500/600 = 0.8333
    assert.deepStrictEqual([g1.bac, g1.ev, g1.ac, g1.cpi], [2000, 500, 600, 0.8333]);
    assert.ok(g1.reasons.includes('actuals_on_deleted_projects'), JSON.stringify(g1));
    assert.strictEqual(g1.deleted_project_contributors, 1);
    assert.strictEqual(pf1.ac, pf0.ac, 'the portfolio AC keeps the deleted project\'s spent money');
    assert.ok(pf1.reasons.includes('actuals_on_deleted_projects'));
    const dp = b1.deleted_projects.find((p) => p.project_id === P5.pid);
    assert.ok(dp, 'the deleted project is listed as a contributor of spent money');
    assert.deepStrictEqual(dp.currencies.map((c) => [c.currency, c.ac]), [['USD', 300]]);
    // a project hidden under a soft-deleted objective keeps its spent money too
    const prog2 = (await put('programme', T.pmo, { key: 'r3-prog2', name: 'P2' })).j.id;
    const obj2 = (await put('objective', T.pmo, { programme_id: prog2, key: 'r3-o2', name: 'O2' })).j.id;
    await projectWithHours('R3-PF-OBJ', obj2);
    assert.strictEqual((await send('DELETE', `/api/governance/portfolio/objective/${obj2}`, T.pmo)).status, 200);
    const g2 = progRow((await pfUsd()).body, prog2);
    assert.deepStrictEqual([g2.bac, g2.ev, g2.ac], [0, 0, 300]);
    assert.ok(g2.reasons.includes('actuals_on_deleted_projects'));
  } finally { await sw({ soft_delete_enabled: '0' }); }
});

test('R3-4 — soft-deleting a task does not change an approved week total; timesheets agree with EVM AC', async () => {
  await sw({ soft_delete_enabled: '1', ppm_timesheet_approval_enabled: '1' });
  try {
    const P6 = await projectWithHours('R3-TS');
    const weeks = async () => { const r = await send('GET', `/api/governance/ppm/project/${P6.pid}/timesheets`, T.pmo); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return r.j.weeks; };
    const [w0] = await weeks();
    assert.strictEqual(w0.hours, 30);
    const sub = await send('POST', `/api/governance/ppm/project/${P6.pid}/timesheets/submit`, T.pmo, { week_start: w0.week_start, person_key: w0.person_key });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.j));
    const ap = await send('POST', `/api/governance/ppm/project/${P6.pid}/timesheets/approve`, T.cio, { week_start: w0.week_start, person_key: w0.person_key });
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.j)); assert.strictEqual(ap.j.week.status, 'approved');
    assert.strictEqual((await send('DELETE', `/api/governance/portfolio/task/${P6.b}`, T.pmo)).status, 200);
    const [w1] = await weeks();
    assert.deepStrictEqual([w1.status, w1.hours, w1.total_hours, w1.entries], ['approved', 30, 30, 2]);
    assert.strictEqual(w1.deleted_task_hours, 20, 'the hours of the soft-deleted task are flagged, not dropped');
    const e = await evmOf(P6.pid);
    assert.strictEqual(e.ac, w1.hours * 10, 'timesheet hours × rate = EVM AC');
  } finally { await sw({ soft_delete_enabled: '0', ppm_timesheet_approval_enabled: '0' }); }
});
