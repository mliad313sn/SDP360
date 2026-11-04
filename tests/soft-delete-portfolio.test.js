'use strict';
// A-19c — soft delete for portfolio nodes and meeting cadences (switch soft_delete_enabled, default '0').
const { test } = require('node:test');
const assert = require('node:assert');
const { makeGovernanceStore } = require('../services/governanceStore');
const ops = require('../services/softDeleteOps');

const TABLES = ['meeting_cadences', 'meeting_sessions', 'decisions', 'session_actions', 'ppm_events', 'portfolio_project_sites', 'portfolio_programmes',
  'portfolio_objectives', 'portfolio_projects', 'portfolio_milestones', 'portfolio_deliverables', 'portfolio_risks', 'portfolio_tasks'];
async function fresh() {
  const db = await require('./_pg-fresh').freshStore(TABLES);
  db.runTransaction = (fn) => require('../reports-db').pgHandle().runTransaction(fn);
  const s = makeGovernanceStore(db, { now: () => new Date().toISOString() });
  await s.init();
  return s;
}
async function tree(s, n = 1) {
  const pr = await s.upsertPortfolio('programme', { key: 'p' + n, name: 'P' + n });
  const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'o' + n, name: 'O' + n });
  const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'j' + n, name: 'J' + n, start_date: '2026-01-01', end_date: '2026-06-30', budget: 1000, currency: 'USD' });
  const ms = await s.upsertPortfolio('milestone', { project_id: pj, name: 'M' + n, due_date: '2026-03-01' });
  const dl = await s.upsertPortfolio('deliverable', { project_id: pj, name: 'D' + n });
  const rk = await s.upsertPortfolio('risk', { project_id: pj, title: 'R' + n, probability: 3, impact: 3 });
  const tk = await s.upsertPortfolio('task', { project_id: pj, name: 'T' + n, status: 'todo' });
  const sub = await s.upsertPortfolio('task', { project_id: pj, parent_id: tk, name: 'T' + n + '.1', status: 'todo' });
  return { pr, ob, pj, ms, dl, rk, tk, sub };
}
const count = (pf) => ({ prog: pf.programmes.length, obj: pf.objectives.length, proj: pf.projects.length, ms: pf.milestones.length, dl: pf.deliverables.length, rk: pf.risks.length, tk: pf.tasks.length });

test('switch off: removePortfolio is today\'s hard delete (cascade)', async () => {
  const s = await fresh();
  const t = await tree(s);
  await s.removePortfolio('programme', t.pr);
  assert.deepEqual(count(await s.portfolio()), { prog: 0, obj: 0, proj: 0, ms: 0, dl: 0, rk: 0, tk: 0 });
  assert.equal(await s.getPortfolioTrashRow('programme', t.pr), null, 'row gone');
});

test('deleting a project hides it and its tasks / milestones / deliverables / risks; ledger keeps deleted + restored rows', async () => {
  const s = await fresh();
  const a = await tree(s, 1), b = await tree(s, 2);
  await s.removePortfolio('project', a.pj, { soft: true, user: { id: 5, username: 'x' }, reason: 'duplicate' });
  const pf = await s.portfolio();
  assert.ok(!pf.projects.some((p) => p.id === a.pj) && pf.projects.some((p) => p.id === b.pj));
  for (const k of ['milestones', 'deliverables', 'risks', 'tasks']) assert.ok(!pf[k].some((x) => Number(x.project_id) === a.pj), k);
  assert.equal(await s.projectDetail(a.pj), null);
  assert.equal(await s.getProject(a.pj), null);
  assert.equal(await s.planRow('task', a.tk), null);
  await assert.rejects(() => s.upsertPortfolio('project', { id: a.pj, objective_id: a.ob, key: 'j1', name: 'edit' }), (e) => e.code === 'CONFLICT');
  const row = await s.getPortfolioTrashRow('project', a.pj);
  assert.equal(row.deleted_by, 5); assert.equal(row.delete_reason, 'duplicate');
  assert.ok((await s.listDeletedPortfolio()).some((r) => r.kind === 'project' && r.id === a.pj));
  assert.equal(await s.restorePortfolio('project', a.pj, { user: { id: 1, username: 'admin' } }), true);
  assert.ok((await s.portfolio()).tasks.some((x) => Number(x.id) === a.sub), 'subtree back');
  const ledger = (await s.ppmEvents('project', a.pj)).map((e) => e.action);
  assert.ok(ledger.includes('deleted') && ledger.includes('restored'));
});

test('deleting a programme hides its whole subtree; restoring it brings it back', async () => {
  const s = await fresh();
  const a = await tree(s, 1), b = await tree(s, 2);
  const before = count(await s.portfolio());
  await s.removePortfolio('programme', a.pr, { soft: true });
  const mid = count(await s.portfolio());
  assert.deepEqual(mid, { prog: before.prog - 1, obj: before.obj - 1, proj: before.proj - 1, ms: before.ms - 1, dl: before.dl - 1, rk: before.rk - 1, tk: before.tk - 2 });
  assert.equal(await s.projectDetail(a.pj), null, 'project under a deleted programme reads as missing');
  assert.ok(await s.projectDetail(b.pj));
  await s.restorePortfolio('programme', a.pr);
  assert.deepEqual(count(await s.portfolio()), before);
});

test('deleting a parent task hides its sub-tasks; deleting a single milestone hides only it', async () => {
  const s = await fresh();
  const a = await tree(s, 1);
  await s.removePortfolio('task', a.tk, { soft: true });
  assert.equal((await s.portfolio()).tasks.length, 0, 'child of a deleted task dropped');
  await s.removePortfolio('milestone', a.ms, { soft: true });
  const pf = await s.portfolio();
  assert.equal(pf.milestones.length, 0); assert.equal(pf.deliverables.length, 1); assert.equal(pf.projects.length, 1);
  assert.equal((await s.gateCounts(a.pj)).openTasks, 0, 'gate counts ignore deleted tasks');
});

test('deleting a cadence hides it and its sessions; decisions keep their session link; restore brings them back', async () => {
  const s = await fresh();
  const c = await s.saveCadence({ key: 'cab', name: 'CAB', kind: 'cab' });
  const other = await s.saveCadence({ key: 'grp', name: 'Group', kind: 'group_monthly' });
  const ses = await s.createSession({ cadenceId: c.id, scheduledAt: '2026-10-20T09:00:00Z', agenda: { items: [] }, user: { id: 1 } });
  await s.createSession({ cadenceId: other.id, scheduledAt: '2026-10-21T09:00:00Z', agenda: { items: [] }, user: { id: 1 } });
  await s.addSessionAction(ses.id, { title: 'follow up' });
  const dec = await s.addDecision({ title: 'D', session_id: ses.id });
  assert.equal(await s.removeCadence(c.id, { soft: true, user: { id: 9 }, reason: 'merged' }), true);
  assert.ok(!(await s.listCadences({ includeInactive: true })).some((x) => x.id === c.id));
  assert.equal(await s.getCadence(c.id), null);
  assert.ok(!(await s.listSessions({ limit: 100 })).some((x) => x.cadence_id === c.id), 'sessions hidden');
  assert.equal((await s.listSessions({ limit: 100 })).length, 1);
  assert.equal(await s.getSession(ses.id), null);
  assert.equal((await s.openSessionActions({ cadenceId: c.id })).length, 0);
  assert.equal(Number((await s.getDecision(dec.id)).session_id), ses.id, 'decision keeps its session link');
  await assert.rejects(() => s.saveCadence({ key: 'cab', name: 'again' }), (e) => e.code === 'CONFLICT', 'same key cannot resurrect it');
  assert.equal((await s.getCadenceTrashRow(c.id)).delete_reason, 'merged');
  assert.equal(await s.restoreCadence(c.id), true);
  assert.ok(await s.getSession(ses.id));
  assert.equal((await s.openSessionActions({ cadenceId: c.id })).length, 1);
});

test('switch off: removeCadence stays the hard delete (sessions cascade, decision link set null)', async () => {
  const s = await fresh();
  const c = await s.saveCadence({ key: 'h', name: 'H', kind: 'cab' });
  const ses = await s.createSession({ cadenceId: c.id, scheduledAt: '2026-10-20T09:00:00Z', agenda: { items: [] }, user: { id: 1 } });
  const dec = await s.addDecision({ title: 'D', session_id: ses.id });
  await s.removeCadence(c.id);
  assert.equal(await s.getCadenceTrashRow(c.id), null);
  assert.equal((await s.getDecision(dec.id)).session_id, null);
});

test('purge: portfolio module lists then hard-deletes nodes and cadences past retention', async () => {
  const s = await fresh();
  const a = await tree(s, 1);
  const c = await s.saveCadence({ key: 'pc', name: 'PC', kind: 'cab' });
  await s.removePortfolio('project', a.pj, { soft: true });
  await s.removeCadence(c.id, { soft: true });
  const later = new Date(Date.now() + 40 * 86400000);
  const dry = await ops.purge({ cfg: {}, now: later, modules: ['portfolio'], govStore: s });
  assert.ok(dry.modules.portfolio.ids.includes(`project:${a.pj}`) && dry.modules.portfolio.ids.includes(`cadence:${c.id}`));
  assert.ok(await s.getPortfolioTrashRow('project', a.pj));
  const run = await ops.purge({ apply: true, cfg: {}, now: later, modules: ['portfolio'], govStore: s });
  assert.equal(run.modules.portfolio.purged, 2);
  assert.equal(await s.getPortfolioTrashRow('project', a.pj), null);
  assert.equal(await s.getCadenceTrashRow(c.id), null);
  const trash = await ops.trash({ module: 'portfolio', govStore: s });
  assert.equal(trash.length, 0);
});

// ---- merge with sdp-waves: B-08 benefits and A-27 baselines follow their project ------------------------------
const MERGE_TABLES = [...TABLES, 'portfolio_benefits', 'portfolio_baselines', 'ppm_alert_state'];
async function freshMerge() {
  await require('./_pg-fresh').truncate(MERGE_TABLES);
  return fresh();
}
const pgh = () => require('../reports-db').pgHandle();

test('benefits follow their project: hidden, 409 on edit / realise, out of the due reviews; back on restore', async () => {
  const s = await freshMerge();
  const a = await tree(s, 1);
  const site = await pgh().prepare('SELECT id FROM sites ORDER BY id LIMIT 1').get();
  await pgh().prepare('UPDATE portfolio_projects SET site_id = ? WHERE id = ?').run(Number(site.id), a.pj);
  const bid = await s.upsertPortfolio('benefit', { project_id: a.pj, description: 'Fewer outages', review_date: '2026-01-15', baseline_value: 12, target_value: 4 });
  const due = async () => (await s.dueBenefitReviews({ siteId: Number(site.id), asOf: '2026-06-01' })).map((b) => b.id);
  assert.deepEqual(await due(), [bid]);
  await s.removePortfolio('project', a.pj, { soft: true });
  assert.equal((await s.portfolio()).benefits.length, 0, 'portfolio() hides the benefit');
  assert.deepEqual(await s.listBenefits(a.pj), []);
  assert.equal(await s.getBenefit(bid), null);
  assert.deepEqual(await due(), [], 'dueBenefitReviews excludes the deleted project');
  await assert.rejects(() => s.upsertPortfolio('benefit', { id: bid, description: 'edit' }), (e) => e.code === 'CONFLICT');
  await assert.rejects(() => s.upsertPortfolio('benefit', { project_id: a.pj, description: 'new' }), (e) => e.code === 'CONFLICT');
  await assert.rejects(() => s.upsertPortfolio('task', { project_id: a.pj, name: 'new' }), (e) => e.code === 'CONFLICT');
  await assert.rejects(() => s.recordBenefitRealised(bid, { realised_value: 5, evidence_link: 'https://intranet.example/k' }), (e) => e.code === 'CONFLICT');
  await s.restorePortfolio('project', a.pj);
  assert.equal((await s.portfolio()).benefits.length, 1);
  assert.deepEqual(await due(), [bid]);
});

test('baselines: a deleted project\'s versions are kept but not served; purge skips a baselined project instead of crashing', async () => {
  const s = await freshMerge();
  const a = await tree(s, 1), b = await tree(s, 2);
  await pgh().prepare('INSERT INTO portfolio_baselines (project_id, version, captured_at, payload_json) VALUES (?, 1, ?, ?)').run(a.pj, '2026-01-01T00:00:00Z', '{}');
  assert.equal((await s.listBaselines()).length, 1);
  await s.removePortfolio('project', a.pj, { soft: true });
  await s.removePortfolio('project', b.pj, { soft: true });
  assert.deepEqual(await s.listBaselines(), []);
  assert.deepEqual(await s.listBaselines(a.pj), []);
  await assert.rejects(() => s.rebaseline(a.pj, { reason: 'x'.repeat(30) }, { user: { id: 1 } }), (e) => e.code === 'NOT_FOUND');
  const old = '2000-01-01T00:00:00Z';
  await pgh().prepare('UPDATE portfolio_projects SET deleted_at = ? WHERE id IN (?, ?)').run(old, a.pj, b.pj);
  const r = await s.purgeDeletedPortfolio('2001-01-01T00:00:00Z', { apply: true });
  assert.ok(r.skipped.some((x) => x.id === `project:${a.pj}` && /baseline/.test(x.reason)), JSON.stringify(r.skipped));
  assert.ok(await s.getPortfolioTrashRow('project', a.pj), 'baselined project kept soft-deleted');
  assert.equal(await s.getPortfolioTrashRow('project', b.pj), null, 'the other one is purged');
  assert.equal((await pgh().prepare('SELECT COUNT(*) AS n FROM portfolio_baselines').get()).n * 1, 1, 'append-only history untouched');
});
