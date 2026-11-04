'use strict';
// A-27 — versioned baselines, the re-baseline gate, the portfolio deck / workbook and the exceptions endpoint
// over HTTP, in both switch states (fictitious data only). PROPOSED switches, all '0' = today:
//   ppm_baseline_versions  '0' = the approval gate writes no version row
//   ppm_rebaseline_enabled '0' = POST …/rebaseline is 404
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-bl-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmbl-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmbl-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmbl-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const XLSX = require('xlsx');
let server, base, rdb, cfg, A, B, obj, T = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_baselines'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('bl_pmo', ['viewer', 'committee-member']);
  T.cio = await mk('bl_cio', ['viewer', 'committee-member']);
  T.viewer = await mk('bl_viewer', ['viewer'], A);
  T.edA = await mk('bl_eda', ['editor'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'bl-prog', name: 'Baselines' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'bl-o', name: 'O' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
/** A project owned by bl_pmo, with two tasks (one without a baseline), taken to the approval stage. */
async function approvedProject(key, site = A) {
  const pid = (await put('project', T.pmo, { objective_id: obj, key, name: key, owner: 'bl_pmo', site_id: site, sponsor: 'CIO', charter: 'Objective, scope and benefits of the witness project', start_date: '2027-01-04', end_date: '2027-03-31', baseline_end: '2027-03-31', budget: 120000, spent: 1000, currency: 'USD' })).j.id;
  const t1 = (await put('task', T.pmo, { project_id: pid, wbs_code: '1', name: 'Survey', owner: 'Kone', start_date: '2027-01-04', end_date: '2027-01-15' })).j.id;
  const t2 = (await put('task', T.pmo, { project_id: pid, wbs_code: '2', name: 'Order', owner: 'Kone', start_date: '2027-01-18', end_date: '2027-01-29', baseline_start: '2027-01-11', baseline_end: '2027-01-22' })).j.id;
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.pmo, { to: 'approval' })).status, 200);
  return { pid, t1, t2 };
}
const versions = async (pid, t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${pid}/baselines`, t)).j;
const ledger = async (pid) => (await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo)).j.events;

test('ppm_baseline_versions 0 (today): approval → in_progress writes no baseline row', async () => {
  await sw({ ppm_baseline_versions: '0', ppm_rebaseline_enabled: '0' });
  const { pid, t1 } = await approvedProject('BL-OFF');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' })).status, 200);
  const v = await versions(pid);
  assert.deepEqual(v.versions, []); assert.equal(v.capture_enabled, false);
  assert.ok(!(await ledger(pid)).some((e) => e.action === 'baseline_captured'));
  assert.equal(v.current.tasks.find((t) => t.id === t1).baseline_end, null, 'task baselines untouched');
});

test('switch on: approval → in_progress writes version 1, fills empty task baselines only; ledger baseline_captured', async () => {
  await sw({ ppm_baseline_versions: '1' });
  const { pid, t1, t2 } = await approvedProject('BL-ON');
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' })).status, 200);
  const v = await versions(pid);
  assert.deepEqual(v.versions.map((x) => x.version), [1]);
  const tasks = new Map(v.versions[0].payload.tasks.map((t) => [t.id, t]));
  assert.deepEqual([tasks.get(t1).baseline_start, tasks.get(t1).baseline_end], ['2027-01-04', '2027-01-15'], 'empty baseline filled from the plan');
  assert.deepEqual([tasks.get(t2).baseline_start, tasks.get(t2).baseline_end], ['2027-01-11', '2027-01-22'], 'an entered baseline is kept');
  assert.ok(!JSON.stringify(v.versions[0].payload).includes('budget'), 'dates only');
  assert.ok((await ledger(pid)).some((e) => e.action === 'baseline_captured' && e.new_value === '1'));
});

test('re-baseline: 404 while off; on: owner refused GATE_SOD, another member writes version 2; ordinary edit still frozen', async () => {
  await sw({ ppm_baseline_versions: '1', ppm_rebaseline_enabled: '0' });
  const { pid, t1 } = await approvedProject('BL-RB');
  await send('POST', `/api/governance/portfolio/project/${pid}/stage`, T.cio, { to: 'in_progress' });
  const body = { reason: 'vendor lead time, committee 2027-02', project: { baseline_end: '2027-04-30' }, tasks: [{ id: t1, start_date: '2027-01-11', end_date: '2027-01-22' }] };
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, body)).status, 404);
  await sw({ ppm_rebaseline_enabled: '1' });
  assert.equal((await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.viewer, body)).status, 403);
  const own = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.pmo, body);
  assert.equal(own.status, 409); assert.equal(own.j.code, 'GATE_SOD');
  const short = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, { ...body, reason: 'too short' });
  assert.equal(short.j.code, 'GATE_REASON');
  const ok = await send('POST', `/api/governance/portfolio/project/${pid}/rebaseline`, T.cio, body);
  assert.equal(ok.status, 200, JSON.stringify(ok.j)); assert.equal(ok.j.version, 2);
  const v = await versions(pid);
  assert.deepEqual(v.versions.map((x) => [x.version, x.approved_by_name]), [[1, null], [2, 'bl_cio']]);
  assert.equal(v.current.project.baseline_end, '2027-04-30');
  assert.equal(v.versions[1].diff_vs_current.project.end_shift_days, 0);
  assert.equal(v.versions[0].diff_vs_current.project.end_shift_days, 30);
  assert.deepEqual(v.versions[0].diff_vs_current.tasks.find((t) => t.id === t1).end_shift_days, 7);
  const ev = (await ledger(pid)).find((e) => e.action === 'rebaseline');
  assert.deepEqual([ev.old_value, ev.new_value, ev.actor], ['2027-03-31', '2027-04-30', 'bl_cio']);
  const fr = await put('project', T.pmo, { id: pid, baseline_end: '2027-06-30' });
  assert.equal(fr.status, 409); assert.equal(fr.j.code, 'BASELINE_FROZEN');
  const proposal = (await put('project', T.pmo, { objective_id: obj, key: 'BL-PROP', name: 'p', owner: 'bl_pmo' })).j.id;
  assert.equal((await send('POST', `/api/governance/portfolio/project/${proposal}/rebaseline`, T.cio, body)).j.code, 'STAGE');
});

test('portfolio_baselines rows cannot be updated or deleted (append-only)', async () => {
  let up = false, del = false;
  try { await rdb.db.prepare("UPDATE portfolio_baselines SET reason='x'").run(); } catch (_) { up = true; }
  try { await rdb.db.prepare('DELETE FROM portfolio_baselines').run(); } catch (_) { del = true; }
  assert.ok(up && del);
  assert.ok(Number((await rdb.db.prepare('SELECT COUNT(*) AS n FROM portfolio_baselines').get()).n) >= 3);
});

test('deck.pptx and workbook.xlsx: committee gets amounts, a viewer gets no budget / spent anywhere', async () => {
  const bin = async (p, t) => { const r = await fetch(base + p, { headers: { 'x-report-token': t } }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
  const deck = await bin('/api/governance/portfolio/deck.pptx', T.pmo);
  assert.equal(deck.status, 200); assert.equal(deck.buf.slice(0, 2).toString('latin1'), 'PK');
  const wbC = XLSX.read((await bin('/api/governance/portfolio/workbook.xlsx', T.pmo)).buf, { type: 'buffer' });
  assert.deepEqual(wbC.SheetNames, ['Projects', 'Tasks', 'Milestones', 'RAID', 'Baselines', 'Exceptions', 'Benefits']);
  assert.ok(XLSX.utils.sheet_to_json(wbC.Sheets.Projects).some((r) => r.budget === 120000));
  const w = await bin('/api/governance/portfolio/workbook.xlsx', T.viewer);
  assert.equal(w.status, 200);
  const wbV = XLSX.read(w.buf, { type: 'buffer' });
  for (const n of wbV.SheetNames) { const csv = XLSX.utils.sheet_to_csv(wbV.Sheets[n]); assert.ok(!/budget|spent|120000/.test(csv), n); }
  assert.equal((await bin('/api/governance/portfolio/deck.pptx', T.viewer)).status, 200);
});

test('exceptions: a site editor sees only the projects of their sites when the A-15 read scope is on', async () => {
  const late = (await put('project', T.pmo, { objective_id: obj, key: 'BL-B', name: 'B late', site_id: B, owner: 'nobody', status: 'active' })).j.id;
  await put('task', T.pmo, { project_id: late, name: 'late task', owner: 'x', status: 'todo', end_date: '2020-01-01' });
  const lateA = (await put('project', T.pmo, { objective_id: obj, key: 'BL-A', name: 'A late', site_id: A, owner: 'nobody', status: 'active' })).j.id;
  await put('task', T.pmo, { project_id: lateA, name: 'late task A', owner: 'x', status: 'todo', end_date: '2020-01-01' });
  const items = async (t) => (await send('GET', '/api/governance/portfolio/exceptions', t)).j.items.map((i) => i.project_id);
  await sw({ portfolio_site_scope_reads: '0' });
  assert.ok((await items(T.edA)).includes(late), 'today every session reads every project');
  await sw({ portfolio_site_scope_reads: '1' });
  const mine = await items(T.edA);
  assert.ok(mine.includes(lateA) && !mine.includes(late));
  assert.ok((await items(T.pmo)).includes(late), 'the committee sees all');
  assert.equal((await send('GET', `/api/governance/portfolio/project/${late}/baselines`, T.edA)).status, 404);
  const r = (await send('GET', '/api/governance/portfolio/exceptions', T.pmo)).j;
  assert.equal(r.alerts_armed, false);
  await sw({ portfolio_site_scope_reads: '0' });
});
