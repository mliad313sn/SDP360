'use strict';
// C-18 (G38 G40 G50 · A02 A03 A09) — the access store on PostgreSQL: template versions are immutable once
// published, a new template version never touches active grants, approval writes user_roles/user_sites through
// rdb.updateUser + an identity log, ending a grant removes only what no other source holds, the expiry pass
// ends expired grants and activates approved ones on their start day, and the request history is hash-chained.
const { test, before } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const { makeAccessStore } = require('../services/accessStore');

let clock = '2026-11-04T09:00:00.000Z';
const H = () => rdb.pgHandle();
const store = makeAccessStore({ prepare: (s) => H().prepare(s), runTransaction: (fn) => H().runTransaction(fn) }, rdb, { now: () => clock });
const ID = {}; let site1, site2;
const user = async (id) => (await rdb.listUsers()).find((u) => Number(u.id) === Number(id));

before(async () => {
  const sites = await rdb.listSites({ includeInactive: true });
  site1 = Number(sites[0].id); site2 = Number(sites[1].id);
  const mk = async (k, roles, site) => { await rdb.createUser({ username: 'ax_' + k, full_name: 'AX ' + k, password: 'ax_' + k + 'pass1234', roles, site_id: site }); ID[k] = Number((await H().prepare('SELECT id FROM users WHERE username=?').get('ax_' + k)).id); };
  await mk('subject', ['editor', 'audit-viewer'], site1);
  await mk('lead', ['editor'], site1);
  await mk('super', ['super_admin']);
  await mk('super2', ['super_admin']);
});

test('templates: draft editable, published immutable (store AND database trigger), retire hides it', async () => {
  const tid = await store.createTemplate({ key: 'finance-reader', title_en: 'Finance reader', title_fr: 'Lecteur finance' }, { actorId: ID.super });
  const v1 = await store.addVersion(tid, { roles: ['finance-viewer'], max_days: 90 }, { actorId: ID.super });
  await store.updateDraft(v1, { roles: ['finance-viewer', 'audit-viewer'], max_days: 90 });
  await store.publish(v1, { actorId: ID.super });
  await assert.rejects(store.updateDraft(v1, { roles: ['admin'] }), /immutable/);
  await assert.rejects(H().prepare("UPDATE access_template_versions SET payload = '{}' WHERE id = ?").run(v1), /immutable/);
  await assert.rejects(H().prepare('DELETE FROM access_template_versions WHERE id = ?').run(v1), /immutable/);
  await assert.rejects(store.addVersion(tid, { roles: ['super_admin'] }, { actorId: ID.super }), /super_admin/);
  const pub = await store.listTemplates();
  assert.equal(pub.find((x) => x.key === 'finance-reader').current.id, v1);
  ID.v1 = v1; ID.tid = tid;
});

test('request → self/deputy decisions refused → approval activates through updateUser, logged with request id', async () => {
  const rid = await store.createRequest({ subject_user_id: ID.subject, template_version_id: ID.v1, roles: ['finance-viewer'], site_ids: [site2], valid_from: '2026-11-04', valid_to: '2026-11-30', justification: 'Monthly finance close for the site' }, { actorId: ID.lead });
  await assert.rejects(store.createRequest({ subject_user_id: ID.subject, roles: ['finance-viewer'], valid_to: '2026-11-20', justification: 'duplicate pending one' }, { actorId: ID.lead }), /pending request/);
  await assert.rejects(store.decide(rid, 'approve', { id: ID.subject }, { isApprover: true }), /your own access/);
  await assert.rejects(store.decide(rid, 'approve', { id: ID.lead }, { isApprover: true }), /you filed/);
  await H().prepare('INSERT INTO deputies (user_id, deputy_id, start_date, end_date, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(ID.lead, ID.super2, '2026-11-01', '2026-11-30', 'leave cover', clock);
  await assert.rejects(store.decide(rid, 'approve', { id: ID.super2 }, { isApprover: true }), /deputy/);
  assert.deepEqual((await store.approvalsFor({ id: ID.super2 })).map((r) => r.id).filter((x) => x === rid), []);
  assert.ok((await store.approvalsFor({ id: ID.super })).some((r) => r.id === rid));
  const logs = []; const orig = rdb.logEvent; rdb.logEvent = (e) => { logs.push(e); };
  try { assert.equal((await store.decide(rid, 'approve', { id: ID.super }, { isApprover: true, reason: 'ok' })).status, 'ACTIVE'); } finally { rdb.logEvent = orig; }
  const u = await user(ID.subject);
  assert.ok(u.roles.includes('finance-viewer') && u.roles.includes('editor') && u.roles.includes('audit-viewer'));
  assert.ok(u.extra_site_ids.includes(site2)); assert.equal(Number(u.site_id), site1);
  const idl = logs.find((e) => e.category === 'identity');
  assert.equal(idl.details.request_id, rid); assert.equal(idl.details.valid_to, '2026-11-30'); assert.ok(idl.details.grant_ids.length === 2, 'one role + one site');
  const g = await store.liveGrants(ID.subject);
  assert.equal(g.find((x) => x.role === 'finance-viewer').held_before, false);
  assert.deepEqual((await store.events(rid)).map((e) => e.action), ['requested', 'approve', 'activated']);
  const chain = await require('../services/auditChain').verify(H());
  assert.equal(chain.tables.find((x) => x.table === 'access_request_events').ok, true);
  await assert.rejects(H().prepare('DELETE FROM access_request_events WHERE request_id = ?').run(rid));
  ID.rid = rid;
});

test('a new template version never changes an active grant', async () => {
  const v2 = await store.addVersion(ID.tid, { roles: ['dashboard-publisher'], max_days: 30 }, { actorId: ID.super });
  await store.publish(v2, { actorId: ID.super });
  const g = await store.liveGrants(ID.subject);
  assert.ok(g.every((x) => x.role !== 'dashboard-publisher'));
  assert.ok(g.filter((x) => x.role).every((x) => Number(x.template_version_id) === ID.v1));
  assert.ok(!(await user(ID.subject)).roles.includes('dashboard-publisher'));
});

test('revoke ends the grants and removes only what no other source holds', async () => {
  await assert.rejects(store.decide(ID.rid, 'revoke', { id: ID.lead }, { isApprover: false, reason: 'not needed' }), /super_admin/);
  assert.equal((await store.decide(ID.rid, 'revoke', { id: ID.super }, { isApprover: true, reason: 'no longer needed' })).status, 'REVOKED');
  const u = await user(ID.subject);
  assert.ok(!u.roles.includes('finance-viewer'), 'granted role removed');
  assert.ok(u.roles.includes('audit-viewer') && u.roles.includes('editor'), 'roles held before stay');
  assert.ok(!u.extra_site_ids.includes(site2), 'granted site removed');
  assert.deepEqual(await store.liveGrantRoles(ID.subject), []);
});

test('expiry pass: future approval activates on its day, an elapsed grant ends', async () => {
  const rid = await store.createRequest({ subject_user_id: ID.subject, roles: ['report-author'], valid_from: '2026-11-10', valid_to: '2026-11-12', justification: 'deck for the month review' }, { actorId: ID.lead });
  assert.equal((await store.decide(rid, 'approve', { id: ID.super }, { isApprover: true })).status, 'APPROVED');
  assert.ok(!(await user(ID.subject)).roles.includes('report-author'), 'not before its start');
  clock = '2026-11-10T03:50:00.000Z';
  assert.deepEqual(await store.runExpiry(), { activated: 1, expired: 0, rows: 1 });
  assert.ok((await user(ID.subject)).roles.includes('report-author'));
  clock = '2026-11-13T03:50:00.000Z';
  assert.deepEqual(await store.runExpiry(), { activated: 0, expired: 1, rows: 1 });
  assert.ok(!(await user(ID.subject)).roles.includes('report-author'));
  assert.equal((await store.getRequest(rid)).status, 'EXPIRED');
  assert.equal(await store.hasApproved(ID.subject, 'report-author'), false);
  clock = '2026-11-04T09:00:00.000Z';
});

test('a role already held before the grant is never removed when the grant ends; retire hides a template', async () => {
  const rid = await store.createRequest({ subject_user_id: ID.subject, roles: ['audit-viewer'], valid_to: '2026-11-20', justification: 'formalise an existing access' }, { actorId: ID.lead });
  await store.decide(rid, 'approve', { id: ID.super }, { isApprover: true });
  assert.equal((await store.liveGrants(ID.subject)).find((g) => g.role === 'audit-viewer').held_before, true);
  await store.decide(rid, 'revoke', { id: ID.super }, { isApprover: true, reason: 'test revoke' });
  assert.ok((await user(ID.subject)).roles.includes('audit-viewer'), 'legacy-direct source kept');
  await store.retire(ID.tid, { actorId: ID.super });
  assert.ok(!(await store.listTemplates()).some((x) => x.key === 'finance-reader'));
  assert.ok((await store.listTemplates({ includeDrafts: true })).some((x) => x.key === 'finance-reader'));
  await assert.rejects(store.createRequest({ subject_user_id: ID.subject, template_version_id: ID.v1, valid_to: '2026-11-20', justification: 'from a retired template' }, { actorId: ID.lead }), /not published/);
});
