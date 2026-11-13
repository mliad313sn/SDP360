'use strict';
// PPM parity W4 (enterprise) over HTTP, fictitious data only: per-project roles (role × route matrix), client read-only
// without amounts, comments with @mentions restricted to the readers of the project, append-only comments, and every
// switch '0' = today (404 / unchanged rights). Switches are put back to '0' after each test.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-w4-'));
process.env.DASH_USER = process.env.DASH_USER || 'ppmw4-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'ppmw4-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'ppmw4-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, A, B, pid, pid2, T = {}, ID = {}, M = {}, task = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ppm_project_members' AND column_name = 'ppm_role'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const sites = await rdb.listSites({ includeInactive: true });
  A = sites.find((s) => /hounde/i.test(s.name)).id; B = sites.find((s) => /mana/i.test(s.name)).id;
  const mk = async (u, roles, site) => { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: site }); ID[u] = Number(((await rdb.listUsers()) || []).find((x) => x.username === u).id); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('w4_pmo', ['viewer', 'committee-member']);
  T.pm = await mk('w4_pm', ['viewer'], B);
  T.sched = await mk('w4_sched', ['viewer'], B);
  T.rm = await mk('w4_rm', ['viewer'], B);
  T.contrib = await mk('w4_contrib', ['viewer'], B);
  T.client = await mk('w4_client', ['viewer', 'finance-viewer'], B);
  T.outsider = await mk('w4_outsider', ['viewer'], B);
  T.editorA = await mk('w4_editor_a', ['editor'], A);
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  const prog = (await put('programme', T.pmo, { key: 'w4-prog', name: 'W4' })).j.id;
  const obj = (await put('objective', T.pmo, { programme_id: prog, key: 'w4-o', name: 'O' })).j.id;
  pid = (await put('project', T.pmo, { objective_id: obj, key: 'W4-1', name: 'Fictitious network refresh', owner: 'w4_pmo', site_id: A, start_date: '2026-11-02', end_date: '2027-03-31', budget: 5000, currency: 'USD' })).j.id;
  pid2 = (await put('project', T.pmo, { objective_id: obj, key: 'W4-2', name: 'Fictitious other project', owner: 'w4_pmo', site_id: A })).j.id;
  task.mine = (await put('task', T.pmo, { project_id: pid, name: 'Cabling', owner: 'w4_contrib', start_date: '2026-11-02', end_date: '2026-11-20' })).j.id;
  task.other = (await put('task', T.pmo, { project_id: pid, name: 'Survey', owner: 'someone else', start_date: '2026-11-02', end_date: '2026-11-06' })).j.id;
  await sw({ ppm_project_team_enabled: '1' });
  for (const [u, role] of [['w4_pm', 'pm'], ['w4_sched', 'scheduler'], ['w4_rm', 'resource_manager'], ['w4_contrib', 'contributor'], ['w4_client', 'client']]) {
    const r = await send('PUT', `/api/governance/ppm/project/${pid}/team`, T.pmo, { label: u, user_id: ID[u] });
    M[role] = r.j.member.id;
  }
  await sw({ ppm_project_team_enabled: '0' });
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (patch) => cfg.setConfig(rdb.db, patch, 'smoke');
const OFF = { ppm_project_roles_enabled: '0', ppm_comments_enabled: '0', ppm_project_team_enabled: '0', portfolio_site_scope_reads: '0', notifications_stop: '0' };
const assignAll = async () => { for (const role of Object.keys(M)) { const r = await send('PUT', `/api/governance/ppm/project/${pid}/roles/${M[role]}`, T.pmo, { ppm_role: role }); assert.equal(r.status, 200, JSON.stringify(r.j)); } };

test('switches off (today): roles + comments 404, features say off, the column means nothing (viewers cannot write)', async () => {
  await sw(OFF);
  assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/roles`, T.pmo)).status, 404);
  assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/roles/${M.pm}`, T.pmo, { ppm_role: 'pm' })).status, 404);
  assert.equal((await send('GET', `/api/governance/ppm/project/${pid}/comments`, T.pmo)).status, 404);
  assert.equal((await send('POST', `/api/governance/ppm/project/${pid}/comments`, T.pmo, { body: 'hi' })).status, 404);
  const f = (await send('GET', '/api/governance/ppm/features', T.pm)).j;
  for (const k of ['project_roles', 'comments', 'agile_board', 'roadmap_nnl', 'offline_edit']) assert.equal(f[k], false, k);
  // even with a role stored directly, the switch off keeps today's rule
  await rdb.db.prepare('UPDATE ppm_project_members SET ppm_role=? WHERE id=?').run('pm', M.pm);
  assert.equal((await put('task', T.pm, { project_id: pid, name: 'x' })).status, 403);
  const d = (await send('GET', `/api/governance/portfolio/project/${pid}`, T.client)).j;
  assert.equal(d.project.budget, 5000, 'today: a finance-viewer reads amounts');
  assert.ok(!('project_role' in d));
  await rdb.db.prepare('UPDATE ppm_project_members SET ppm_role=NULL WHERE id=?').run(M.pm);
});

test('role assignment: committee or the project pm; a member without account cannot hold a role; ledger row', async () => {
  await sw({ ...OFF, ppm_project_roles_enabled: '1', ppm_project_team_enabled: '1' });
  try {
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/roles/${M.pm}`, T.sched, { ppm_role: 'pm' })).status, 403, 'not committee, no pm role');
    const bad = await send('PUT', `/api/governance/ppm/project/${pid}/roles/${M.pm}`, T.pmo, { ppm_role: 'owner' });
    assert.equal(bad.status, 400); assert.equal(bad.j.code, 'BAD_ROLE');
    const ext = (await send('PUT', `/api/governance/ppm/project/${pid}/team`, T.pmo, { label: 'External auditor' })).j.member.id;
    const na = await send('PUT', `/api/governance/ppm/project/${pid}/roles/${ext}`, T.pmo, { ppm_role: 'client' });
    assert.equal(na.status, 409); assert.equal(na.j.code, 'NO_ACCOUNT');
    await assignAll();
    const g = await send('GET', `/api/governance/ppm/project/${pid}/roles`, T.pm);
    assert.equal(g.status, 200); assert.equal(g.j.my_role, 'pm'); assert.equal(g.j.can_assign, true);
    assert.ok(g.j.members.every((m) => !('username' in m) && !('email' in m)), 'display names only');
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/roles/${M.client}`, T.pm, { ppm_role: 'client' })).status, 200, 'the pm assigns');
    const h = await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.pmo);
    assert.ok(h.j.events.some((e) => e.action === 'project_role_set' && e.new_value === 'scheduler'));
  } finally { await sw(OFF); }
});

test('role × route matrix (server-side): pm / scheduler / resource manager / contributor / client', async () => {
  await sw({ ...OFF, ppm_project_roles_enabled: '1', ppm_project_team_enabled: '1' });
  try {
    await assignAll();
    const cur = async (id) => (await send('GET', `/api/governance/portfolio/project/${pid}`, T.pmo)).j.tasks.find((t) => t.id === id);
    // pm — the whole plan, even with editor writes off and outside the project's site
    const pmTask = await put('task', T.pm, { project_id: pid, name: 'PM task' }); assert.equal(pmTask.status, 200, JSON.stringify(pmTask.j));
    assert.equal((await put('risk', T.pm, { project_id: pid, title: 'Vendor delay', probability: 2, impact: 2 })).status, 200);
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/team`, T.pm, { label: 'New member' })).status, 200, 'pm manages the team');
    const del = await send('DELETE', `/api/governance/portfolio/task/${pmTask.j.id}`, T.pm); assert.equal(del.status, 200, JSON.stringify(del.j));
    // pm on project 1 only: project 2 keeps today's rule
    assert.equal((await put('task', T.pm, { project_id: pid2, name: 'elsewhere' })).status, 403);
    // scheduler — tasks / milestones yes; risk / team no
    const ms = await put('milestone', T.sched, { project_id: pid, name: 'Go-live', due_date: '2027-03-01' }); assert.equal(ms.status, 200, JSON.stringify(ms.j));
    assert.equal((await put('task', T.sched, { id: task.other, end_date: '2026-11-07' })).status, 200);
    const sr = await put('risk', T.sched, { project_id: pid, title: 'no' }); assert.equal(sr.status, 403); assert.equal(sr.j.code, 'ROLE_SCOPE');
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/team`, T.sched, { label: 'x' })).j.code, 'ROLE_SCOPE');
    // resource manager — owner / allocation / effort only, the team
    assert.equal((await put('task', T.rm, { id: task.other, allocation_pct: 50, effort_hours: 12 })).status, 200);
    const rf = await put('task', T.rm, { id: task.other, end_date: '2026-11-30' }); assert.equal(rf.status, 403); assert.equal(rf.j.code, 'FIELD_SCOPE');
    assert.equal((await put('task', T.rm, { project_id: pid, name: 'new' })).j.code, 'ROLE_SCOPE');
    assert.equal((await send('PUT', `/api/governance/ppm/project/${pid}/team`, T.rm, { label: 'Contractor', allocation_pct: 20 })).status, 200);
    // contributor — progress of their own task, with the row version (409 when stale)
    const mine = await cur(task.mine);
    assert.equal((await put('task', T.contrib, { id: task.mine, status: 'in_progress', progress_pct: 30, version: mine.version })).status, 200);
    const stale = await put('task', T.contrib, { id: task.mine, progress_pct: 40, version: mine.version }); assert.equal(stale.status, 409); assert.equal(stale.j.code, 'STALE_VERSION');
    assert.equal((await put('task', T.contrib, { id: task.other, progress_pct: 10 })).j.code, 'OWN_TASK_ONLY');
    assert.equal((await put('task', T.contrib, { id: task.mine, name: 'renamed' })).j.code, 'FIELD_SCOPE');
    assert.equal((await send('DELETE', `/api/governance/portfolio/task/${task.mine}`, T.contrib)).j.code, 'OWN_TASK_ONLY');
    // client — nothing, even though the account holds finance-viewer
    for (const r of [await put('task', T.client, { id: task.mine, progress_pct: 99 }), await put('task', T.client, { project_id: pid, name: 'x' })]) { assert.equal(r.status, 403); assert.equal(r.j.code, 'CLIENT_READ_ONLY'); }
    // a role never moves an item into another project unless pm of both
    assert.equal((await put('task', T.sched, { id: task.other, project_id: pid2 })).j.code, 'ROLE_SCOPE');
    // the committee keeps today's rights
    assert.equal((await put('task', T.pmo, { id: task.other, name: 'Survey (committee)' })).status, 200);
  } finally { await sw(OFF); }
});

test('client: reads the project (even outside the site scope) and never an amount', async () => {
  await sw({ ...OFF, ppm_project_roles_enabled: '1', ppm_project_team_enabled: '1', portfolio_site_scope_reads: '1' });
  try {
    await assignAll();
    const d = await send('GET', `/api/governance/portfolio/project/${pid}`, T.client);
    assert.equal(d.status, 200, 'a role member reads a project outside their site');
    assert.equal(d.j.project_role, 'client'); assert.equal(d.j.money_hidden, true); assert.equal(d.j.project.budget, undefined); assert.equal(d.j.can_edit_plan, false);
    const pf = await send('GET', '/api/governance/portfolio', T.client);
    assert.equal(pf.j.money_hidden, true, 'no amount anywhere in the portfolio for a client');
    assert.equal((await send('GET', `/api/governance/portfolio/project/${pid}/history`, T.client)).status, 403, 'the ledger carries amounts');
    assert.equal((await send('GET', `/api/governance/portfolio/project/${pid}`, T.outsider)).status, 404, 'no role: the site scope still hides it');
    const p = await send('GET', `/api/governance/portfolio/project/${pid}`, T.pm);
    assert.equal(p.j.project_role, 'pm'); assert.equal(p.j.can_edit_plan, true);
  } finally { await sw(OFF); }
});

test('comments: readers post, a client reads only, @mentions reach readers only, in-app notice unless notifications_stop', async () => {
  await sw({ ...OFF, ppm_comments_enabled: '1', ppm_project_roles_enabled: '1', ppm_project_team_enabled: '1', portfolio_site_scope_reads: '1' });
  try {
    await assignAll();
    const url = `/api/governance/ppm/project/${pid}/comments`;
    const notes = async (u) => (await rdb.db.prepare("SELECT * FROM notifications WHERE user_id=? AND source_kind='ppm_comment'").all(ID[u])).length;
    const c = await send('POST', url, T.pmo, { body: 'Kick-off done — @w4_contrib please update @W4_OUTSIDER and @nobody', task_id: task.mine });
    assert.equal(c.status, 200, JSON.stringify(c.j));
    assert.deepEqual(c.j.comment.mentions.map((m) => m.id), [ID.w4_contrib], 'the role member reads the project');
    assert.deepEqual(c.j.unresolved.sort(), ['nobody', 'w4_outsider'], 'out of perimeter looks like unknown');
    assert.equal(c.j.notified, 1); assert.equal(await notes('w4_contrib'), 1); assert.equal(await notes('w4_outsider'), 0);
    assert.equal((await send('POST', url, T.outsider, { body: 'hello' })).status, 404, 'a non-reader cannot comment');
    const cl = await send('POST', url, T.client, { body: 'can I?' }); assert.equal(cl.status, 403); assert.equal(cl.j.code, 'CLIENT_READ_ONLY');
    assert.equal((await send('GET', url, T.client)).j.comments.length, 1, 'the client reads');
    assert.equal((await send('POST', url, T.contrib, { body: '   ' })).j.code, 'BODY_REQUIRED');
    assert.equal((await send('POST', url, T.contrib, { body: 'x', task_id: 999999 })).status, 404);
    await sw({ notifications_stop: '1' });
    const s = await send('POST', url, T.contrib, { body: 'thanks @w4_pmo' });
    assert.equal(s.j.notified, 0); assert.deepEqual(s.j.comment.mentions.map((m) => m.id), [ID.w4_pmo]);
    const byTask = await send('GET', `${url}?task_id=${task.mine}`, T.pm);
    assert.equal(byTask.j.comments.length, 1);
    await assert.rejects(rdb.db.prepare('UPDATE ppm_comments SET body=? WHERE id=?').run('edited', c.j.comment.id), /append-only/);
  } finally { await sw(OFF); }
});
