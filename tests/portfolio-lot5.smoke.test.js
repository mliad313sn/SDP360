'use strict';
// PORTFOLIO LOT 5 over HTTP, fictitious data only. Four PROPOSED switches, all '0' = today:
//   ppm_extended_lifecycle_enabled · ppm_review_workflow_enabled · ppm_field_audit_enabled · ppm_business_case_freeze_enabled
// Proves: switch OFF = today (routes 404, six stages, no field_edit rows, sponsor may still approve); every new gate
// refuses its negative case; field audit = one ledger row per changed field + created_by / updated_by; the review
// workflow refuses self-approval (same account, identity skeleton, unknown provenance — fail closed) and accepts an
// independent approver with a named journal; frozen business-case fields answer 409 without an approved change request.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ppm-l5-'));
process.env.DASH_USER = process.env.DASH_USER || 'l5-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'l5-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'l5-key';
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.AI_PROVIDER = 'off';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let server, base, rdb, cfg, obj; const T = {}, U = {};

before(async () => {
  const { app } = require('../server');
  await require('../server').seedStores();
  rdb = require('../reports-db'); cfg = require('../services/reportConfig');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'portfolio_projects' AND column_name = 'created_by'").get())) break; await new Promise(r => setTimeout(r, 100)); }
  const mk = async (u, roles, full) => { const r = await rdb.createUser({ username: u, full_name: full || u, password: u + 'pass1234', roles }); U[u] = Number(r && (r.id != null ? r.id : r)); return (await rdb.login(u, u + 'pass1234')).token; };
  T.pmo = await mk('l5_pmo', ['viewer', 'committee-member'], 'Pat Office');
  T.exec = await mk('l5_exec', ['viewer', 'committee-member'], 'Eve Exec');
  T.fresh = await mk('l5_fresh', ['viewer', 'committee-member'], 'Fred Fresh');
  T.sponsor = await mk('l5_sponsor', ['viewer', 'committee-member'], 'Sam Sponsor');
  T.viewer = await mk('l5_viewer', ['viewer'], 'Vic Viewer');
  T.owner = await mk('l5_owner', ['viewer'], 'Olivia Owner');
  for (const n of Object.keys(U)) if (!Number.isInteger(U[n]) || !U[n]) U[n] = Number((await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(n)).id);
  // the identity journal names who created l5_exec (an account that is NOT the requester) — so its provenance is known
  const admin = await rdb.db.prepare('SELECT id FROM users WHERE username=?').get(process.env.DASH_USER);
  await rdb.db.prepare(`INSERT INTO system_log (ts, category, action, actor, actor_id, target, details) VALUES (?, 'identity', 'user_created', ?, ?, 'l5_exec', ?)`).run(new Date().toISOString(), process.env.DASH_USER, admin ? Number(admin.id) : 1, JSON.stringify({ after: { roles: ['viewer', 'committee-member'] } }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
  await sw({ ppm_extended_lifecycle_enabled: '0', ppm_review_workflow_enabled: '0', ppm_field_audit_enabled: '0', ppm_business_case_freeze_enabled: '0', ppm_gate_checklist_enabled: '0' });
  const prog = (await put('programme', T.pmo, { key: 'l5-prog', name: 'L5' })).j.id;
  obj = (await put('objective', T.pmo, { programme_id: prog, key: 'l5-o', name: 'O' })).j.id;
});
after(() => server && server.close());
const send = async (m, p, t, body) => { const r = await fetch(base + p, { method: m, headers: Object.assign({ 'x-report-token': t }, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch (_) {} return { status: r.status, j, txt }; };
const put = (k, t, b) => send('PUT', '/api/governance/portfolio/' + k, t, b);
const sw = (o) => cfg.setConfig(rdb.db, o, 'smoke');
const stage = (id, t, to, note) => send('POST', `/api/governance/portfolio/project/${id}/stage`, t, { to, note });
const detail = async (id, t = T.pmo) => (await send('GET', `/api/governance/portfolio/project/${id}`, t)).j;
const events = async (id, action) => (await rdb.db.prepare(`SELECT field, old_value, new_value, actor_id FROM ppm_events WHERE entity='project' AND entity_id=? AND action=? ORDER BY id`).all(id, action));
const CHARTER = 'Objective, scope and benefits of the project, long enough.';
const proj = (key, extra = {}) => ({ objective_id: obj, key, name: 'Project ' + key, owner: 'l5_owner', sponsor: 'Sam Sponsor', charter: CHARTER, start_date: '2027-03-01', end_date: '2027-09-30', baseline_end: '2027-09-30', ...extra });

test('all four switches off (= today): routes 404, six stages, no field audit, sponsor may still approve', async () => {
  const id = (await put('project', T.pmo, proj('L5-OFF'))).j.id;
  for (const p of [`/api/governance/portfolio/project/${id}/review`, '/api/governance/portfolio/roles-catalogue']) assert.equal((await send('GET', p, T.pmo)).status, 404, p);
  assert.equal((await send('POST', `/api/governance/portfolio/project/${id}/review/assign`, T.pmo, { step: 'general', user_id: U.l5_exec })).status, 404);
  const d = await detail(id);
  assert.deepStrictEqual(d.stages, ['proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed']);
  assert.equal(d.project.stage, 'proposal');
  assert.equal((await put('project', T.pmo, { id, name: 'Renamed today' })).status, 200);
  assert.equal((await events(id, 'field_edit')).length, 0);
  const row = await rdb.db.prepare('SELECT created_by, updated_by FROM portfolio_projects WHERE id=?').get(id);
  assert.equal(row.created_by, null); assert.equal(row.updated_by, null);
  assert.equal((await stage(id, T.pmo, 'approval')).status, 200);
  assert.equal((await stage(id, T.sponsor, 'in_progress')).status, 200, 'today: only the owner is barred');
  assert.equal((await put('project', T.pmo, { id, charter: CHARTER + ' changed after approval' })).status, 200, 'no freeze today');
  const f = (await send('GET', '/api/governance/ppm/features', T.pmo)).j;
  for (const k of ['extended_lifecycle', 'review_workflow', 'field_audit', 'business_case_freeze']) assert.equal(f[k], false, k);
});

test('field audit on: one ledger row per changed field (old → new) + created_by / updated_by', async () => {
  await sw({ ppm_field_audit_enabled: '1' });
  const id = (await put('project', T.pmo, proj('L5-FA'))).j.id;
  const row = await rdb.db.prepare('SELECT created_by, updated_by FROM portfolio_projects WHERE id=?').get(id);
  assert.equal(Number(row.created_by), U.l5_pmo); assert.equal(Number(row.updated_by), U.l5_pmo);
  assert.equal((await put('project', T.exec, { id, name: 'Renamed', end_date: '2027-10-31', start_date: '2027-03-01' })).status, 200);
  const fe = await events(id, 'field_edit');
  assert.deepStrictEqual(fe.map((e) => e.field).sort(), ['end_date', 'name'], 'unchanged start_date not logged');
  const n = fe.find((e) => e.field === 'name');
  assert.equal(n.old_value, 'Project L5-FA'); assert.equal(n.new_value, 'Renamed'); assert.equal(Number(n.actor_id), U.l5_exec);
  assert.equal(Number((await rdb.db.prepare('SELECT updated_by FROM portfolio_projects WHERE id=?').get(id)).updated_by), U.l5_exec);
  assert.equal((await put('project', T.exec, { id, owner: 'someone else' })).status, 200);
  assert.equal((await events(id, 'field_edit')).filter((e) => e.field === 'owner').length, 0, 'owner keeps its own role_edit row');
  assert.equal((await events(id, 'role_edit')).length, 1);
  await sw({ ppm_field_audit_enabled: '0' });
});

let ext;
test('extended lifecycle on: new project is an idea; every new gate refuses its negative case; SoD sponsor', async () => {
  await sw({ ppm_extended_lifecycle_enabled: '1' });
  ext = (await put('project', T.pmo, proj('L5-EXT'))).j.id;
  const d = await detail(ext);
  assert.equal(d.project.stage, 'idea'); assert.ok(d.stages.includes('benefits_review'));
  assert.equal((await stage(ext, T.pmo, 'approval')).j.code, 'STAGE_ORDER');
  assert.equal((await stage(ext, T.pmo, 'rejected')).j.code, 'GATE_REASON');
  assert.equal((await stage(ext, T.pmo, 'assessment')).status, 200);
  assert.equal((await stage(ext, T.pmo, 'proposal')).status, 200);
  assert.equal((await stage(ext, T.pmo, 'approval')).status, 200);
  assert.equal((await stage(ext, T.sponsor, 'in_progress')).j.code, 'GATE_SOD_SPONSOR');
  assert.equal((await stage(ext, T.sponsor, 'deferred', 'next budget cycle please')).j.code, 'GATE_SOD_SPONSOR');
  assert.equal((await stage(ext, T.exec, 'in_progress')).status, 200);
  const task = (await put('task', T.pmo, { project_id: ext, name: 'Cut-over', start_date: '2027-03-01', end_date: '2027-03-05' })).j.id;
  assert.equal((await stage(ext, T.pmo, 'handover')).j.code, 'GATE_OPEN_TASKS');
  assert.equal((await put('task', T.pmo, { id: task, status: 'done' })).status, 200);
  assert.equal((await stage(ext, T.pmo, 'handover')).status, 200);
  assert.equal((await stage(ext, T.pmo, 'in_progress')).j.code, 'GATE_REASON', 'a backward move needs a reason');
  assert.equal((await stage(ext, T.pmo, 'benefits_review')).status, 200);
  const row = await rdb.db.prepare('SELECT stage, status FROM portfolio_projects WHERE id=?').get(ext);
  assert.equal(row.stage, 'benefits_review'); assert.equal(row.status, 'active');
  const dd = await detail(ext);
  assert.deepStrictEqual(dd.allowed_stages.map((g) => g.to).sort(), ['closure', 'handover']);
  assert.equal(dd.allowed_stages.find((g) => g.to === 'handover').needs_reason, true);
});

test('gate checklists: an extended stage is a gate only while the lifecycle switch is on', async () => {
  await sw({ ppm_gate_checklist_enabled: '1' });
  const body = { items: [{ key: 'runbook', label: 'Operations runbook', kind: 'artifact' }], approvers: [{ role: 'committee-member' }], rule: 'all' };
  assert.equal((await send('PUT', `/api/governance/ppm/project/${ext}/gates/handover`, T.pmo, body)).status, 200);
  await sw({ ppm_extended_lifecycle_enabled: '0' });
  assert.equal((await send('PUT', `/api/governance/ppm/project/${ext}/gates/handover`, T.pmo, body)).j.code, 'STAGE_UNKNOWN');
  const g = (await send('GET', `/api/governance/ppm/project/${ext}/gates`, T.pmo)).j;
  assert.equal(g.gates.length, 6);
  await sw({ ppm_extended_lifecycle_enabled: '1' });
  assert.equal((await send('GET', `/api/governance/ppm/project/${ext}/gates`, T.pmo)).j.gates.length, 13);
  await sw({ ppm_gate_checklist_enabled: '0' });
});

let rv;
test('review workflow: reviewers, information requests, return for correction', async () => {
  await sw({ ppm_review_workflow_enabled: '1', ppm_extended_lifecycle_enabled: '0' });
  rv = (await put('project', T.pmo, proj('L5-RV'))).j.id;
  assert.equal((await stage(rv, T.pmo, 'approval')).status, 200);
  const r0 = (await send('GET', `/api/governance/portfolio/project/${rv}/review`, T.pmo)).j;
  assert.equal(r0.requester.name, 'l5_pmo'); assert.equal(r0.steps.length, 6); assert.equal(r0.proposed, true);
  assert.equal((await send('GET', '/api/governance/portfolio/roles-catalogue', T.viewer)).status, 200);
  const A = (b, t = T.pmo) => send('POST', `/api/governance/portfolio/project/${rv}/review/assign`, t, b);
  assert.equal((await A({ step: 'budget_review', user_id: U.l5_owner })).j.code, 'REVIEWER_NOT_INDEPENDENT', 'the owner cannot review');
  assert.equal((await A({ step: 'budget_review', user_id: U.l5_pmo })).j.code, 'REVIEWER_NOT_INDEPENDENT', 'the requester cannot review');
  assert.equal((await A({ step: 'budget_review', user_id: U.l5_viewer }, T.viewer)).status, 403);
  assert.equal((await A({ step: 'nonsense', user_id: U.l5_viewer })).status, 400);
  assert.equal((await A({ step: 'budget_review', user_id: U.l5_viewer })).status, 200);
  const Q = (b, t) => send('POST', `/api/governance/portfolio/project/${rv}/review/request-info`, t, b);
  assert.equal((await Q({ step: 'budget_review', question: 'Which cost centre carries the licences?' }, T.owner)).j.code, 'NOT_A_REVIEWER');
  const q = await Q({ step: 'budget_review', question: 'Which cost centre carries the licences?' }, T.viewer);
  assert.equal(q.status, 200, q.txt); const reqId = q.j.review.requests[0].id;
  const R = (b, t) => send('POST', `/api/governance/portfolio/project/${rv}/review/respond`, t, b);
  assert.equal((await R({ request_id: reqId, answer: 'CC-4410' }, T.viewer)).j.code, 'OWNER_ONLY');
  assert.equal((await R({ request_id: reqId, answer: 'CC-4410' }, T.owner)).status, 200);
  assert.equal((await R({ request_id: reqId, answer: 'again' }, T.owner)).j.code, 'ALREADY_ANSWERED');
  assert.equal((await R({ request_id: 999999, answer: 'nothing' }, T.owner)).status, 404);
  const ret = (b, t = T.pmo) => send('POST', `/api/governance/portfolio/project/${rv}/review/return`, t, b);
  assert.equal((await ret({ reason: 'short' })).status, 400);
  const rr = await ret({ reason: 'budget split per year is missing' });
  assert.equal(rr.status, 200, rr.txt); assert.equal(rr.j.stage, 'proposal'); assert.equal(rr.j.review.returns.length, 1);
  assert.equal((await ret({ reason: 'budget split per year is missing' })).j.code, 'NOT_UNDER_REVIEW');
});

test('review workflow: self-approval refused (same account, skeleton, unknown provenance); independent approver passes', async () => {
  assert.equal((await stage(rv, T.pmo, 'approval')).status, 200);   // l5_pmo resubmits = the requester
  const self = await stage(rv, T.pmo, 'in_progress');
  assert.equal(self.status, 409); assert.equal(self.j.code, 'SELF_APPROVAL');
  const dry = (await detail(rv)).allowed_stages.find((g) => g.to === 'in_progress');
  assert.equal(dry.refusal.code, 'SELF_APPROVAL', 'the dry run shows it too');
  const fresh = await stage(rv, T.fresh, 'in_progress');
  assert.equal(fresh.j.code, 'APPROVER_NOT_INDEPENDENT', 'a fresh account with no named creator: provenance unknown, refused');
  assert.equal((await stage(rv, T.sponsor, 'rejected', 'not aligned with strategy')).j.code, 'GATE_SOD_SPONSOR');
  const ok = await stage(rv, T.exec, 'in_progress');
  assert.equal(ok.status, 200, ok.txt);
});

test('review workflow: an approval sign-off is refused to the requester; a project with no recorded requester is refused', async () => {
  await sw({ ppm_gate_checklist_enabled: '1' });
  const id = (await put('project', T.pmo, proj('L5-SO'))).j.id;
  assert.equal((await stage(id, T.pmo, 'approval')).status, 200);
  assert.equal((await send('PUT', `/api/governance/ppm/project/${id}/gates/in_progress`, T.pmo, { items: [{ key: 'ok', label: 'Confirmed', kind: 'check' }], approvers: [{ role: 'committee-member' }, { role: 'committee-member' }], rule: 'all' })).status, 200);
  const so = await send('POST', `/api/governance/ppm/project/${id}/gates/in_progress/signoff`, T.pmo, { decision: 'approve' });
  assert.equal(so.status, 403); assert.equal(so.j.code, 'SELF_APPROVAL');
  assert.equal((await send('POST', `/api/governance/ppm/project/${id}/gates/in_progress/signoff`, T.exec, { decision: 'approve' })).status, 200);
  // a legacy project placed in approval without any recorded move or creator: fail closed
  const legacy = (await put('project', T.pmo, proj('L5-LEG'))).j.id;
  await rdb.db.prepare(`UPDATE portfolio_projects SET stage='approval', created_by=NULL WHERE id=?`).run(legacy);
  assert.equal((await stage(legacy, T.exec, 'in_progress')).j.code, 'REVIEW_REQUESTER_UNKNOWN');
  await sw({ ppm_gate_checklist_enabled: '0', ppm_review_workflow_enabled: '0' });
});

test('business-case freeze: 409 after approval without an approved change request; fine before approval', async () => {
  await sw({ ppm_business_case_freeze_enabled: '1' });
  const id = (await put('project', T.pmo, proj('L5-FZ', { budget: 1000, currency: 'USD' }))).j.id;
  assert.equal((await put('project', T.pmo, { id, charter: CHARTER + ' v2' })).status, 200, 'draft: free');
  assert.equal((await stage(id, T.pmo, 'approval')).status, 200);
  assert.equal((await stage(id, T.exec, 'in_progress')).status, 200);
  const fz = await put('project', T.pmo, { id, charter: CHARTER + ' v3', budget: 2000 });
  assert.equal(fz.status, 409); assert.equal(fz.j.code, 'BUSINESS_CASE_FROZEN');
  assert.equal((await put('project', T.pmo, { id, name: 'Renamed is fine' })).status, 200, 'other fields stay editable');
  assert.equal((await put('project', T.pmo, { id, budget: 1000 })).status, 200, 'same value is not a change');
  const cr = await rdb.db.prepare(`INSERT INTO ppm_change_requests (project_id, title, reason, status, created_at) VALUES (?, 'Scope extension', 'add a site', 'proposed', ?) RETURNING id`).get(id, new Date().toISOString());
  assert.equal((await put('project', T.pmo, { id, budget: 2000, change_request_id: Number(cr.id) })).j.code, 'BUSINESS_CASE_FROZEN', 'a proposed CR is not enough');
  await rdb.db.prepare(`UPDATE ppm_change_requests SET status='approved' WHERE id=?`).run(Number(cr.id));
  assert.equal((await put('project', T.pmo, { id, budget: 2000, change_request_id: Number(cr.id) })).status, 200);
  assert.equal((await events(id, 'business_case_change')).length, 1);
  await sw({ ppm_business_case_freeze_enabled: '0' });
});
