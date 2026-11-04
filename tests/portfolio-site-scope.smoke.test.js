'use strict';
// A-15 — portfolio site scope over HTTP, in both switch states.
//   portfolio_site_scope_reads   '0' (today) = every session reads every project
//   portfolio_editor_plan_writes '0' (today) = only the committee writes
// Both are PROPOSED access policy; these tests pin today's behaviour AND the switched-on behaviour.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'pf-scope-'));
process.env.DASH_USER = process.env.DASH_USER || 'pfs-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pfs-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'pfs-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, T = {}, P = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 50; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'portfolio_project_sites'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('pfs_pmo', ['viewer', 'committee-member']);
  T.edA = await mk('pfs_eda', ['editor'], A);
  T.viewA = await mk('pfs_viewa', ['viewer'], A);
  T.edB = await mk('pfs_edb', ['editor'], B);
  T.finA = await mk('pfs_fina', ['viewer', 'finance-viewer'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  // fixture: one programme, one objective, a project per site and a group-level one, each with a task
  const prog = (await put('programme', T.pmo, { key: 'pfs-prog', name: 'Scope' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'pfs-o', name: 'O' })).j.id;
  for (const [k, site] of [['A', A], ['B', B], ['G', null]]) {
    P[k] = (await put('project', T.pmo, { objective_id: obj, key: 'PFS-' + k, name: 'Project ' + k, site_id: site, owner: 'nobody', end_date: '2020-01-01', status: 'active' })).j.id;
    P['t' + k] = (await put('task', T.pmo, { project_id: P[k], name: 'task ' + k, owner: 'Kone', start_date: '2027-01-01', end_date: '2027-01-10', allocation_pct: 60 })).j.id;
    await put('risk', T.pmo, { project_id: P[k], title: 'risk ' + k, probability: 3, impact: 3 });
  }
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const pf = async (t) => (await send('GET', '/api/governance/portfolio', t)).j;
const sw = (reads, writes) => cfg.setConfig(rdb.db, { portfolio_site_scope_reads: reads, portfolio_editor_plan_writes: writes }, 'smoke');

test('switches off (today): a viewer of site A sees the project of site B; an editor of A cannot write a task', async () => {
  await sw('0', '0');
  const v = await pf(T.viewA);
  assert.ok(v.projects.some((p) => p.id === P.B), 'today every session reads every project');
  assert.ok(v.tasks.some((x) => x.project_id === P.B));
  assert.deepEqual(v.can_edit_plan_projects, []);
  const r = await put('task', T.edA, { project_id: P.A, name: 'nope' });
  assert.equal(r.status, 403, 'committee only, today');
  assert.equal((await send('DELETE', `/api/governance/portfolio/task/${P.tA}`, T.edA)).status, 403);
  assert.ok((await pf(T.pmo)).can_edit_plan_projects.includes(P.B), 'the committee may edit every plan');
});

test('read switch on: editor of A lists only site A + group-level projects and their children; counts follow', async () => {
  await sw('1', '0');
  const v = await pf(T.edA);
  assert.deepEqual(v.projects.map((p) => p.id).sort(), [P.A, P.G].sort());
  for (const k of ['tasks', 'risks']) assert.ok(v[k].every((x) => x.project_id !== P.B), k);
  assert.ok(v.gantt.every((g) => g.id !== P.B)); assert.ok(v.plans.every((p) => p.project_id !== P.B));
  const s = v.summary.find((x) => x.programme === 'pfs-prog');
  assert.equal(s.projects, 2); assert.equal(s.high_risks, 2, 'hidden project risk not counted');
  assert.equal(v.resource_conflicts.length, 1, 'recomputed from visible tasks (A and G overlap)');
  assert.ok((await pf(T.pmo)).projects.some((p) => p.id === P.B), 'committee still reads all');
});

test('read switch on: history of an invisible project is 404, of a visible one 200', async () => {
  await sw('1', '0');
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.B}/history`, T.finA)).status, 404);
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.A}/history`, T.finA)).status, 200);
  await sw('0', '0');
  assert.equal((await send('GET', `/api/governance/portfolio/project/${P.B}/history`, T.finA)).status, 200, 'switch off = today');
});

test('write switch on: editor of A creates, edits and deletes a task, risk and milestone on site A; site B is PLAN_SCOPE', async () => {
  await sw('0', '1');
  assert.deepEqual((await pf(T.edA)).can_edit_plan_projects, [P.A]);
  for (const [kind, body] of [['task', { name: 'tA2' }], ['risk', { title: 'rA2', probability: 1, impact: 1 }], ['milestone', { name: 'mA2' }], ['deliverable', { name: 'dA2' }]]) {
    const c = await put(kind, T.edA, { ...body, project_id: P.A }); assert.equal(c.status, 200, kind + ' ' + JSON.stringify(c.j));
    const e = await put(kind, T.edA, { id: c.j.id, status: kind === 'risk' ? 'closed' : 'done' }); assert.equal(e.status, 200, kind + ' edit ' + JSON.stringify(e.j));
    assert.equal((await send('DELETE', `/api/governance/portfolio/${kind}/${c.j.id}`, T.edA)).status, 200, kind + ' delete');
    const x = await put(kind, T.edA, { ...body, project_id: P.B }); assert.equal(x.status, 403); assert.equal(x.j.code, 'PLAN_SCOPE');
  }
  assert.equal((await put('task', T.edA, { id: P.tB, name: 'hijack' })).j.code, 'PLAN_SCOPE', 'edit of a row on site B');
  assert.equal((await send('DELETE', `/api/governance/portfolio/task/${P.tB}`, T.edA)).status, 403);
  assert.equal((await put('task', T.edA, { project_id: P.G, name: 'g' })).status, 403, 'group-level plan = committee');
  assert.equal((await put('task', T.viewA, { project_id: P.A, name: 'v' })).status, 403, 'a viewer of the site does not write');
  assert.equal((await put('task', T.edA, { id: 99999999, name: 'x' })).status, 404);
});

test('write switch on: editor of A cannot move a task from project A to project B', async () => {
  await sw('0', '1');
  const r = await put('task', T.edA, { id: P.tA, project_id: P.B });
  assert.equal(r.status, 403); assert.equal(r.j.code, 'PLAN_SCOPE');
  const t = (await pf(T.pmo)).tasks.find((x) => x.id === P.tA); assert.equal(t.project_id, P.A, 'not moved');
});

test('write switch on: projects, stages, money and RFI conversion stay committee-only', async () => {
  await sw('1', '1');
  assert.equal((await put('project', T.edA, { id: P.A, name: 'renamed' })).status, 403);
  assert.equal((await put('project', T.edA, { id: P.A, budget: 1000 })).status, 403);
  assert.equal((await send('POST', `/api/governance/portfolio/project/${P.A}/stage`, T.edA, { to: 'approval' })).status, 403);
  assert.equal((await send('DELETE', `/api/governance/portfolio/project/${P.A}`, T.edA)).status, 403);
  assert.equal((await send('POST', '/api/governance/rfi/1/to-project', T.edA, { objective_id: 1, key: 'x' })).status, 403);
  assert.equal((await send('PUT', `/api/governance/portfolio/project/${P.A}/sites`, T.edA, { site_ids: [B] })).status, 403);
});

test('committee adds site B to project A: editor of B then reads and edits it; the ledger shows sites_edit', async () => {
  await sw('1', '1');
  assert.ok(!(await pf(T.edB)).projects.some((p) => p.id === P.A));
  const r = await send('PUT', `/api/governance/portfolio/project/${P.A}/sites`, T.pmo, { site_ids: [B] });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.deepEqual(r.j.site_ids, [B]);
  const v = await pf(T.edB);
  assert.ok(v.projects.some((p) => p.id === P.A)); assert.ok(v.can_edit_plan_projects.includes(P.A));
  assert.equal((await put('task', T.edB, { project_id: P.A, name: 'from B' })).status, 200);
  const h = (await send('GET', `/api/governance/portfolio/project/${P.A}/history`, T.pmo)).j.events;
  const e = h.find((x) => x.action === 'sites_edit'); assert.ok(e); assert.equal(e.new_value, String(B));
  assert.equal((await send('PUT', '/api/governance/portfolio/project/99999999/sites', T.pmo, { site_ids: [B] })).status, 404);
  assert.equal((await send('PUT', `/api/governance/portfolio/project/${P.A}/sites`, T.pmo, { site_ids: ['x'] })).status, 400);
  await sw('0', '0');
});
