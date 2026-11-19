'use strict';
// P11 qualification F1 — one extreme task value must not take the portfolio down.
//   (a) the write is refused (400 INVALID, reason DURATION_RANGE / DATE_RANGE / LAG_RANGE) — bounds in planIntegrity
//   (b) a row already stored out of range (legacy / direct SQL) leaves the portfolio and the other projects readable:
//       the failing project's plan reads as unknown with a reason, never a 500 for everyone.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-bounds-'));
process.env.DASH_USER = 'pb-admin'; process.env.DASH_PASS = 'pb-pass-0000'; process.env.DASHBOARD_API_KEY = 'pb-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1'; process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

let server, base, rdb; const T = {}; let pid, pid2;
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { /* not json */ } return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);

before(async () => {
  const { app } = require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db');
  const siteA = (await rdb.listSites({ includeInactive: true }))[0].id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('pb_pmo', ['viewer', 'committee-member']);
  T.viewer = await mk('pb_viewer', ['viewer'], siteA);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); }); base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'pb-prog', name: 'P' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'pb-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'PB-1', name: 'healthy', owner: 'pb_pmo', site_id: siteA, start_date: '2027-01-04' })).j.id;
  pid2 = (await put('project', T.pmo, { objective_id: obj, key: 'PB-2', name: 'poisoned', owner: 'pb_pmo', site_id: siteA, start_date: '2027-01-04' })).j.id;
  assert.strictEqual((await put('task', T.pmo, { project_id: pid, name: 'ok', duration_days: 2 })).status, 200);
});
after(() => server && server.close());

test('F1a — an out-of-range task value is refused at write (400 INVALID with its reason)', async () => {
  const cases = [
    [{ project_id: pid2, name: 'typo', duration_days: 5000000 }, 'DURATION_RANGE'],
    [{ project_id: pid2, name: 'neg', duration_days: -3 }, 'DURATION_RANGE'],
    [{ project_id: pid2, name: 'far', start_date: '9999-06-01', duration_days: 1 }, 'DATE_RANGE'],
    [{ project_id: pid2, name: 'old', start_date: '1969-12-29', duration_days: 1 }, 'DATE_RANGE'],
    [{ project_id: pid2, name: 'dl', duration_days: 1, deadline: '9999-01-01' }, 'DATE_RANGE'],
    [{ project_id: pid2, name: 'cd', duration_days: 1, constraint_type: 'SNET', constraint_date: '2999-01-01' }, 'DATE_RANGE'],
  ];
  for (const [body, reason] of cases) {
    const r = await put('task', T.pmo, body);
    assert.strictEqual(r.status, 400, JSON.stringify(body) + ' → ' + r.status);
    assert.strictEqual(r.j.code, reason, JSON.stringify(r.j));
  }
  const okA = await put('task', T.pmo, { project_id: pid2, name: 'a', duration_days: 36500 });
  assert.strictEqual(okA.status, 200, 'the bound itself is accepted');
  const lag = await put('task', T.pmo, { project_id: pid2, name: 'lag', duration_days: 1, depends_on: [okA.j.id], dependency_links: [{ id: okA.j.id, type: 'FS', lag: 5000000 }] });
  assert.strictEqual(lag.status, 400); assert.strictEqual(lag.j.code, 'LAG_RANGE');
  const p = await put('project', T.pmo, { id: pid2, finish_deadline: '9999-01-01' });
  assert.strictEqual(p.status, 400); assert.strictEqual(p.j.code, 'DATE_RANGE');
  // clean the accepted bound so it does not slow the next test
  await rdb.pgHandle().prepare('DELETE FROM portfolio_tasks WHERE id=?').run(okA.j.id);
});

test('F1b — a stored out-of-range task makes ITS plan unknown, the portfolio and the other project stay readable', async () => {
  const bad = await put('task', T.pmo, { project_id: pid2, name: 'legacy', duration_days: 1 });
  assert.strictEqual(bad.status, 200);
  // a row written before the bound existed (or by SQL): bypasses the write check
  await rdb.pgHandle().prepare('UPDATE portfolio_tasks SET duration_days=5000000 WHERE id=?').run(bad.j.id);
  for (const t of [T.viewer, T.pmo]) {
    const r = await send('GET', '/api/governance/portfolio', t);
    assert.strictEqual(r.status, 200, 'portfolio must stay readable: ' + JSON.stringify(r.j).slice(0, 200));
    const healthy = r.j.plans.find((x) => x.project_id === pid), poisoned = r.j.plans.find((x) => x.project_id === pid2);
    assert.ok(Array.isArray(healthy.critical_path) && healthy.critical_path.length, 'healthy project still scheduled');
    assert.strictEqual(healthy.schedule_error, undefined);
    assert.strictEqual(poisoned.critical_path, null, 'unknown, never an empty or zero path');
    assert.strictEqual(poisoned.critical_length_days, null);
    assert.strictEqual(poisoned.schedule_error.code, 'SCHEDULE_RANGE');
  }
  const p1 = await send('GET', '/api/governance/portfolio/project/' + pid, T.pmo);
  assert.strictEqual(p1.status, 200); assert.ok(p1.j.plan);
  const p2 = await send('GET', '/api/governance/portfolio/project/' + pid2, T.pmo);
  assert.strictEqual(p2.status, 200, 'the page that lets the PM fix the task must open');
  assert.strictEqual(p2.j.plan, null);
  assert.strictEqual(p2.j.plan_error.code, 'SCHEDULE_RANGE');
  // the PM can now repair the task through the normal write path
  const fix = await put('task', T.pmo, { id: bad.j.id, duration_days: 5 });
  assert.strictEqual(fix.status, 200);
  const after2 = await send('GET', '/api/governance/portfolio/project/' + pid2, T.pmo);
  assert.ok(after2.j.plan && !after2.j.plan_error);
});

test('F1 — planIntegrity.rangeProblem bounds (pure)', () => {
  const PI = require('../services/ppm/planIntegrity');
  assert.deepStrictEqual(PI.RANGE, { minYear: 1970, maxYear: 2200, maxDurationDays: 36500, maxLagAbs: 36500 });
  assert.strictEqual(PI.rangeProblem('task', { start_date: '2200-12-31', duration_days: 36500 }), null);
  assert.strictEqual(PI.rangeProblem('task', { start_date: '1970-01-01', duration_days: 0 }), null);
  assert.strictEqual(PI.rangeProblem('task', { end_date: '2201-01-01' }).code, 'DATE_RANGE');
  assert.strictEqual(PI.rangeProblem('task', { constraint_date: '1969-12-31' }).code, 'DATE_RANGE');
  assert.strictEqual(PI.rangeProblem('task', { duration_days: 36501 }).code, 'DURATION_RANGE');
  assert.strictEqual(PI.rangeProblem('task', { duration_days: 'abc' }).code, 'DURATION_RANGE');
  assert.strictEqual(PI.rangeProblem('task', { dependency_links: '[{"id":1,"type":"FS","lag":-40000}]' }).code, 'LAG_RANGE');
  assert.strictEqual(PI.rangeProblem('milestone', { due_date: '9999-01-01' }).code, 'DATE_RANGE');
  assert.strictEqual(PI.rangeProblem('project', { finish_deadline: '2300-01-01' }).code, 'DATE_RANGE');
  assert.strictEqual(PI.rangeProblem('task', {}), null, 'nothing changed = nothing checked');
});

test('F1 — engine range error is typed; the guarded reads report unknown with a reason', () => {
  const SCH = require('../services/projectSchedule');
  const tasks = [{ id: 1, duration_days: 5000000 }];
  let err; try { SCH.criticalPath(tasks, { anchor: '2027-01-04' }); } catch (e) { err = e; }
  assert.ok(err); assert.strictEqual(err.code, 'SCHEDULE_RANGE'); assert.strictEqual(err.status, 422); assert.strictEqual(err.expose, true);
  const r = SCH.criticalPathSafe(tasks, { anchor: '2027-01-04' });
  assert.strictEqual(r.result, null); assert.strictEqual(r.error.code, 'SCHEDULE_RANGE');
  const ok = SCH.scheduleViewSafe([{ id: 1, duration_days: 3 }], { anchor: '2027-01-04' });
  assert.ok(ok.result && ok.result.length_days === 3); assert.strictEqual(ok.error, null);
  const cyc = SCH.criticalPathSafe([{ id: 1, duration_days: 1, depends_on: [2] }, { id: 2, duration_days: 1, depends_on: [1] }], {});
  assert.strictEqual(cyc.result, null); assert.strictEqual(cyc.error, null, 'a cycle keeps its own (pre-existing) signal');
});
