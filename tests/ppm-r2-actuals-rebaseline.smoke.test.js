'use strict';
// P11 round 2 (PPM seat) — over HTTP, hand-computed.
//   R2-1: deleting a task that carries logged hours must not take that spent money out of EVM actual cost.
//         A HARD delete of such a task (or of a project above it) is refused 409 HAS_ACTUALS (the FK would cascade the
//         hours away); a SOFT delete keeps the hours in AC, flagged `actuals_on_deleted_tasks`.
//   R2-2: the committee re-baseline applies the same date bounds as the ordinary write (400 DATE_RANGE), and an EVM
//         read over a far baseline (a legacy row) answers well under a second.
// ADR docs/ai-decisions/ADR-P11-R2-evm-deleted-and-bounds.md.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-r2-'));
process.env.DASH_USER = 'r2-admin'; process.env.DASH_PASS = 'r2-pass-0000'; process.env.DASHBOARD_API_KEY = 'r2-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1'; process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb, cfg, obj, siteA; const T = {};
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* not json */ } return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const evmOf = async (pid) => { const r = await send('GET', `/api/governance/ppm/project/${pid}/evm?status_date=2026-03-11`, T.pmo); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); return r.j.evm.currencies[0]; };

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_baselines'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  siteA = (await rdb.listSites({ includeInactive: true }))[0].id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('r2_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('r2_cio', ['viewer', 'committee-member']);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'r2-prog', name: 'P' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'r2-o', name: 'O' })).j.id;
  await sw({ ppm_evm_enabled: '1', ppm_time_entries_enabled: '1' });
});
after(() => server && server.close());

async function projectWithHours(key) {
  const pid = (await put('project', T.pmo, { objective_id: obj, key, name: key, owner: 'r2_pmo', site_id: siteA, start_date: '2026-03-02' })).j.id;
  const a = (await put('task', T.pmo, { project_id: pid, name: 'A', status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
  const b = (await put('task', T.pmo, { project_id: pid, name: 'B', status: 'in_progress', progress_pct: 0, baseline_start: '2026-03-02', baseline_end: '2026-03-13' })).j.id;
  for (const t of [a, b]) assert.strictEqual((await send('PUT', `/api/governance/ppm/task/${t}/evm`, T.pmo, { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 10 })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/ppm/task/${a}/time`, T.pmo, { day: '2026-03-03', hours: 10, person_label: 'Ana' })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/ppm/task/${b}/time`, T.pmo, { day: '2026-03-03', hours: 20, person_label: 'Ana' })).status, 200);
  return { pid, a, b };
}

test('R2-1 — hard delete of a task with logged hours is refused (409 HAS_ACTUALS); AC unchanged', async () => {
  await sw({ soft_delete_enabled: '0' });
  const { pid, b } = await projectWithHours('R2-HARD');
  const before = await evmOf(pid);
  assert.deepStrictEqual([before.bac, before.ev, before.ac, before.cpi, before.eac], [2000, 500, 300, 1.6667, 1200]);
  const d = await send('DELETE', `/api/governance/portfolio/task/${b}`, T.pmo);
  assert.strictEqual(d.status, 409, JSON.stringify(d.j));
  assert.strictEqual(d.j.code, 'HAS_ACTUALS');
  const pd = await send('DELETE', `/api/governance/portfolio/project/${pid}`, T.cio);
  assert.strictEqual(pd.status, 409, 'a project whose tasks carry hours cannot be hard-deleted either');
  const after = await evmOf(pid);
  assert.strictEqual(after.ac, 300);
  // a task without hours is still deleted as before
  const c = (await put('task', T.pmo, { project_id: pid, name: 'C', duration_days: 1 })).j.id;
  assert.strictEqual((await send('DELETE', `/api/governance/portfolio/task/${c}`, T.pmo)).status, 200);
});

test('R2-1 — soft delete keeps the hours in AC with reason actuals_on_deleted_tasks', async () => {
  await sw({ soft_delete_enabled: '1' });
  try {
    const { pid, b } = await projectWithHours('R2-SOFT');
    const d = await send('DELETE', `/api/governance/portfolio/task/${b}`, T.pmo);
    assert.strictEqual(d.status, 200, JSON.stringify(d.j)); assert.strictEqual(d.j.soft, true);
    const after = await evmOf(pid);
    // B leaves BAC (no work ahead) but its 20 h × 10 = 200 stay spent: BAC 1000, EV 500, AC 300, CPI 1.6667, EAC 600
    assert.deepStrictEqual([after.bac, after.ev, after.ac, after.cpi, after.eac], [1000, 500, 300, 1.6667, 600]);
    assert.ok(after.reasons.includes('actuals_on_deleted_tasks'), JSON.stringify(after.reasons));
  } finally { await sw({ soft_delete_enabled: '0' }); }
});

test('R2-2 — re-baseline beyond the bounds is refused (400 DATE_RANGE); a far legacy baseline reads in < 1 s', async () => {
  await sw({ ppm_baseline_versions: '1', ppm_rebaseline_enabled: '1' });
  const pid = (await put('project', T.pmo, { objective_id: obj, key: 'R2-BL', name: 'bl', owner: 'r2_pmo', site_id: siteA, sponsor: 'CIO', charter: 'Objective, scope and benefits of the witness project', start_date: '2027-01-04', end_date: '2027-03-31', baseline_end: '2027-03-31', budget: 1000, spent: 0, currency: 'USD' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, wbs_code: '1', name: 'S', owner: 'K', start_date: '2027-01-04', end_date: '2027-01-15', progress_pct: 10, status: 'in_progress' })).j.id;
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' })).status, 200);
  assert.strictEqual((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' })).status, 200);
  const reason = 'Typo test of a far baseline end for the review';
  const rbP = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, project: { baseline_end: '9999-12-31' } });
  assert.strictEqual(rbP.status, 400, JSON.stringify(rbP.j)); assert.strictEqual(rbP.j.code, 'DATE_RANGE');
  const rbT = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, tasks: [{ id: t1, start_date: '2027-01-04', end_date: '9999-12-31' }] });
  assert.strictEqual(rbT.status, 400, JSON.stringify(rbT.j)); assert.strictEqual(rbT.j.code, 'DATE_RANGE');
  const rbO = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, tasks: [{ id: t1, start_date: '2027-02-04', end_date: '2027-01-04' }] });
  assert.strictEqual(rbO.status, 400, 'a task baseline end before its start is refused'); assert.strictEqual(rbO.j.code, 'DATE_ORDER');
  const ok = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { reason, project: { baseline_end: '2200-12-31' }, tasks: [{ id: t1, start_date: '2027-01-04', end_date: '2200-12-31' }] });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
  assert.strictEqual((await send('PUT', `/api/governance/ppm/task/${t1}/evm`, T.pmo, { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 10 })).status, 200);
  // a legacy out-of-bounds row (stored before the bounds / by SQL) must not block the server either
  await rdb.db.prepare('UPDATE portfolio_tasks SET baseline_end = ? WHERE id = ?').run('9999-12-31', t1);
  for (const p of [`/api/governance/ppm/project/${pid}/evm?status_date=2027-02-01`, '/api/governance/ppm/evm/portfolio?status_date=2027-02-01']) {
    const t0 = Date.now(); const r = await send('GET', p, T.pmo); const ms = Date.now() - t0;
    assert.strictEqual(r.status, 200, p + ' ' + JSON.stringify(r.j));
    assert.ok(ms < 1000, `${p} took ${ms} ms`);
  }
});
