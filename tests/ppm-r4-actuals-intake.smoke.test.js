'use strict';
// P11 round 4 (PPM seat) — over HTTP, hand-computed. Evidence: docs/agent-execution/FIX-15-PPM.md.
//   R4-1: money recorded as ACTUAL budget periods (no time entries) is spent money like logged hours (R3-2): a hard
//         delete of its project / objective / programme is refused 409 HAS_ACTUALS (periods intact, portfolio AC
//         unchanged), and the soft-delete purge keeps such a project soft-deleted and lists it in `skipped`.
//   R4-2: an intake value state never contradicts its field: a value written while the register was off hides the
//         stale state on read.
//   R4-4: a soft-deleted task's hours stay counted (R3-4) and stay listable read-only (flagged task_deleted).
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-r4-'));
process.env.DASH_USER = 'r4-admin'; process.env.DASH_PASS = 'r4-pass-0000'; process.env.DASHBOARD_API_KEY = 'r4-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1'; process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, siteA; const T = {};
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* not json */ } return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const SD = '2026-04-30';
const pfUsd = async () => { const r = await send('GET', `/api/governance/ppm/evm/portfolio?status_date=${SD}`, T.pmo); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return r.j.portfolio.currencies.find((c) => c.currency === 'USD') || null; };
const periods = async (pid) => Number((await rdb.db.prepare(`SELECT COUNT(*) AS n FROM ppm_budget_periods WHERE project_id=? AND kind='actual'`).get(pid)).n);

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { try { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'ppm_budget_periods'").get())) break; } catch (_) { /* pg not ready yet */ } await new Promise((r) => setTimeout(r, 100)); }
  siteA = (await rdb.listSites({ includeInactive: true }))[0].id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('r4_pmo', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
  await sw({ ppm_evm_enabled: '1', ppm_budget_periods_enabled: '1', ppm_time_entries_enabled: '1', soft_delete_enabled: '0' });
});
after(() => server && server.close());

const tree = async (n) => {
  const prog = (await put('programme', T.pmo, { key: `r4-prog-${n}`, name: 'P' + n })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: `r4-o-${n}`, name: 'O' + n })).j.id;
  return { prog, obj };
};
// one task, baseline cost 1000 USD over 2026-03-02..13; 700 USD recorded as an ACTUAL budget period for 2026-03, no hours.
async function projectWithActualPeriod(key, obj) {
  const pid = (await put('project', T.pmo, { objective_id: obj, key, name: key, owner: 'r4_pmo', site_id: siteA, start_date: '2026-03-02' })).j.id;
  const a = (await put('task', T.pmo, { project_id: pid, name: 'A', status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
  assert.strictEqual((await send('PUT', `/api/governance/ppm/task/${a}/evm`, T.pmo, { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 10 })).status, 200);
  const b = await send('PUT', `/api/governance/ppm/project/${pid}/budget-periods`, T.pmo, { period: '2026-03', currency: 'USD', kind: 'actual', amount: 700, reason: 'finance import' });
  assert.strictEqual(b.status, 200, JSON.stringify(b.j));
  return pid;
}

test('R4-1 — hard delete of a project / objective / programme with ACTUAL budget periods is refused 409 HAS_ACTUALS; AC unchanged', async () => {
  const t = await tree(1);
  const P1 = await projectWithActualPeriod('R4-HD', t.obj);
  const ac0 = (await pfUsd()).ac;
  for (const [kind, id] of [['project', P1], ['objective', t.obj], ['programme', t.prog]]) {
    const d = await send('DELETE', `/api/governance/portfolio/${kind}/${id}`, T.pmo);
    assert.strictEqual(d.status, 409, `${kind}: ${JSON.stringify(d.j)}`);
    assert.strictEqual(d.j.code, 'HAS_ACTUALS', kind);
    assert.match(d.j.error || d.j.message || '', /actual budget period/, kind);
  }
  assert.strictEqual(await periods(P1), 1, 'the ACTUAL period is intact');
  assert.strictEqual((await pfUsd()).ac, ac0, 'portfolio AC keeps the spent money');
  // control: a project with only a PLANNED period (no money spent) still hard-deletes
  const P2 = (await put('project', T.pmo, { objective_id: t.obj, key: 'R4-HD-PLAN', name: 'plan', owner: 'r4_pmo', site_id: siteA })).j.id;
  assert.strictEqual((await send('PUT', `/api/governance/ppm/project/${P2}/budget-periods`, T.pmo, { period: '2026-03', currency: 'USD', kind: 'baseline', amount: 500 })).status, 200);
  const ok = await send('DELETE', `/api/governance/portfolio/project/${P2}`, T.pmo);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
  assert.strictEqual(ok.j.soft, false);
});

test('R4-1 — the soft-delete purge keeps a project with ACTUAL budget periods soft-deleted and lists it in skipped', async () => {
  await sw({ soft_delete_enabled: '1' });
  try {
    const t = await tree(2);
    const P3 = await projectWithActualPeriod('R4-PURGE', t.obj);
    const P4 = (await put('project', T.pmo, { objective_id: t.obj, key: 'R4-PURGE-EMPTY', name: 'empty', owner: 'r4_pmo', site_id: siteA })).j.id;
    const ac0 = (await pfUsd()).ac;
    for (const p of [P3, P4]) assert.strictEqual((await send('DELETE', `/api/governance/portfolio/project/${p}`, T.pmo)).j.soft, true);
    const usd = await pfUsd();
    assert.strictEqual(usd.ac, ac0, 'soft delete keeps the spent money');
    assert.ok(usd.reasons.includes('actuals_on_deleted_projects'));
    const st = require('../services/governanceStore').makeGovernanceStore(rdb.pgHandle(), {});
    const r = await st.purgeDeletedPortfolio('2999-01-01T00:00:00Z', { apply: true });
    const sk = r.skipped.find((x) => x.id === `project:${P3}`);
    assert.ok(sk, JSON.stringify(r));
    assert.strictEqual(sk.code, 'HAS_ACTUALS');
    assert.match(sk.reason, /1 actual budget period/);
    assert.ok(!r.skipped.some((x) => x.id === `project:${P4}`), 'a project without spent money is purged');
    assert.strictEqual(await periods(P3), 1, 'the ACTUAL period survives the purge');
    assert.strictEqual((await pfUsd()).ac, ac0, 'portfolio AC unchanged after the purge');
  } finally { await sw({ soft_delete_enabled: '0' }); }
});

test('R4-2 — a value written while the intake register is off hides its stale value state on read', async () => {
  const t = await tree(3);
  await sw({ ppm_intake_register_enabled: '1' });
  try {
    const c = await put('project', T.pmo, { objective_id: t.obj, key: 'R4-VS', name: 'vs', owner: 'r4_pmo', site_id: siteA, value_states: { budget: 'tbc', delivery_lead: 'tbc' } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.j));
    const read = async () => (await send('GET', `/api/governance/portfolio/project/${c.j.id}`, T.pmo)).j.project;
    assert.deepStrictEqual((await read()).value_states, { budget: 'tbc', delivery_lead: 'tbc' });
    await sw({ ppm_intake_register_enabled: '0' });
    assert.strictEqual((await put('project', T.pmo, { id: c.j.id, budget: 5000, currency: 'USD' })).status, 200);
    await sw({ ppm_intake_register_enabled: '1' });
    const p = await read();
    assert.strictEqual(p.budget, 5000);
    assert.deepStrictEqual(p.value_states, { delivery_lead: 'tbc' }, 'the value answers: no "to be confirmed" next to it');
  } finally { await sw({ ppm_intake_register_enabled: '0' }); }
});

test('R4-4 — a soft-deleted task\'s hours stay listable (read-only, flagged); writes keep refusing it', async () => {
  await sw({ soft_delete_enabled: '1', ppm_timesheet_approval_enabled: '1' });
  try {
    const t = await tree(4);
    const pid = (await put('project', T.pmo, { objective_id: t.obj, key: 'R4-TT', name: 'tt', owner: 'r4_pmo', site_id: siteA, start_date: '2026-03-02' })).j.id;
    const task = (await put('task', T.pmo, { project_id: pid, name: 'B', status: 'in_progress', baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
    assert.strictEqual((await send('POST', `/api/governance/ppm/task/${task}/time`, T.pmo, { day: '2026-03-03', hours: 20, person_label: 'Ana' })).status, 200);
    const live = await send('GET', `/api/governance/ppm/task/${task}/time`, T.pmo);
    assert.strictEqual(live.status, 200); assert.strictEqual(live.j.task_deleted, false);
    assert.strictEqual((await send('DELETE', `/api/governance/portfolio/task/${task}`, T.pmo)).status, 200);
    const g = await send('GET', `/api/governance/ppm/task/${task}/time`, T.pmo);
    assert.strictEqual(g.status, 200, JSON.stringify(g.j));
    assert.strictEqual(g.j.task_deleted, true);
    assert.deepStrictEqual(g.j.entries.map((e) => Number(e.hours)), [20]);
    assert.strictEqual(g.j.hours.actual, 20);
    const w = (await send('GET', `/api/governance/ppm/project/${pid}/timesheets`, T.pmo)).j.weeks[0];
    assert.strictEqual(w.deleted_task_hours, g.j.hours.actual, 'the listed hours are the counted deleted-task hours');
    assert.strictEqual((await send('POST', `/api/governance/ppm/task/${task}/time`, T.pmo, { day: '2026-03-04', hours: 1, person_label: 'Ana' })).status, 404, 'no new hours on a deleted task');
    // a deleted project hides its tasks' hours again (the project is gone)
    assert.strictEqual((await send('DELETE', `/api/governance/portfolio/project/${pid}`, T.pmo)).status, 200);
    assert.strictEqual((await send('GET', `/api/governance/ppm/task/${task}/time`, T.pmo)).status, 404);
  } finally { await sw({ soft_delete_enabled: '0', ppm_timesheet_approval_enabled: '0' }); }
});
