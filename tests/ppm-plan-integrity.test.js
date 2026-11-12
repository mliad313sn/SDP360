'use strict';
// W1-INTEGRITY / A-INT-1 (PPM parity W0, P0, repro R3) — a task/project/milestone write must refuse a self-parent, a
// parent loop, a parent from another project, a task depending on its own parent/sub-task, a non-date string and an
// end before its start. Legacy bad rows must not crash the reads, and a read-only report lists them.
const { test } = require('node:test');
const assert = require('node:assert');
const PI = require('../services/ppm/planIntegrity');
const { makeGovernanceStore } = require('../services/governanceStore');
const TABLES = ['portfolio_programmes', 'portfolio_objectives', 'portfolio_projects', 'portfolio_milestones', 'portfolio_tasks', 'ppm_events'];

async function fresh() {
  const h = await require('./_pg-fresh').freshStore(TABLES.filter((t) => t !== 'ppm_events'));
  const rdb = require('../reports-db');
  const s = makeGovernanceStore({ prepare: h.prepare, runTransaction: (fn) => rdb.pgHandle().runTransaction(fn) }, { isPg: true });
  const pr = await s.upsertPortfolio('programme', { key: 'ip', name: 'P' });
  const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'io', name: 'O' });
  const p1 = await s.upsertPortfolio('project', { objective_id: ob, key: 'ij1', name: 'J1' });
  const p2 = await s.upsertPortfolio('project', { objective_id: ob, key: 'ij2', name: 'J2' });
  return { s, h, p1, p2 };
}
const reason = (code) => (e) => e && e.code === 'INVALID' && e.reason === code;

test('pure: real calendar dates only; end before start refused, same day allowed', () => {
  assert.equal(PI.isValidDate('2026-02-28'), true);
  assert.equal(PI.isValidDate('2026-02-30'), false);
  assert.equal(PI.isValidDate('2024-02-29'), true);
  assert.equal(PI.isValidDate('2026-11-12T10:00:00.000Z'), true);
  for (const bad of ['soon', '31/12/2026', '2026-13-01', '2026-1-1', '']) assert.equal(PI.isValidDate(bad), false, bad);
  assert.equal(PI.dateProblem('task', { start_date: 'tomorrow' }).code, 'DATE_INVALID');
  assert.equal(PI.dateProblem('task', { start_date: '2026-03-10', end_date: '2026-03-01' }).code, 'DATE_ORDER');
  assert.equal(PI.dateProblem('task', { start_date: '2026-03-10', end_date: '2026-03-10' }), null, 'a 0-day item');
  assert.equal(PI.dateProblem('task', { end_date: '2026-03-01' }, { start_date: '2026-03-10' }).code, 'DATE_ORDER', 'merged with the stored row');
  assert.equal(PI.dateProblem('task', { status: 'done' }, { start_date: '2026-03-10', end_date: '2026-03-01' }), null, 'an unrelated edit of a legacy row passes');
  assert.equal(PI.dateProblem('milestone', { due_date: '2026-02-31' }).code, 'DATE_INVALID');
});

test('pure: hierarchy — self, unknown, other project, loop, depends on parent (R3) or sub-task', () => {
  const rows = [{ id: 10, project_id: 1, parent_id: null }, { id: 11, project_id: 1, parent_id: 10 }, { id: 12, project_id: 1, parent_id: 11 }, { id: 20, project_id: 2, parent_id: null }];
  assert.equal(PI.hierarchyProblem({ id: 10, project_id: 1, parent_id: 10 }, rows).code, 'PARENT_SELF');
  assert.equal(PI.hierarchyProblem({ id: 10, project_id: 1, parent_id: 99 }, rows).code, 'PARENT_NOT_FOUND');
  assert.equal(PI.hierarchyProblem({ id: 11, project_id: 1, parent_id: 20 }, rows).code, 'PARENT_OTHER_PROJECT');
  assert.equal(PI.hierarchyProblem({ id: 10, project_id: 1, parent_id: 12 }, rows).code, 'PARENT_CYCLE');
  assert.equal(PI.hierarchyProblem({ id: 11, project_id: 1, parent_id: 10, depends_on: [10] }, rows).code, 'DEPENDS_ON_HIERARCHY', 'R3: child on its parent');
  assert.equal(PI.hierarchyProblem({ id: 12, project_id: 1, parent_id: 11, depends_on: [10] }, rows).code, 'DEPENDS_ON_HIERARCHY', 'on a grand-parent');
  assert.equal(PI.hierarchyProblem({ id: 10, project_id: 1, parent_id: null, depends_on: [12] }, rows).code, 'DEPENDS_ON_HIERARCHY', 'a summary on its sub-task');
  assert.equal(PI.hierarchyProblem({ id: null, project_id: 1, parent_id: 11, depends_on: [10] }, rows).code, 'DEPENDS_ON_HIERARCHY', 'a new task too');
  assert.equal(PI.hierarchyProblem({ id: 12, project_id: 1, parent_id: 10, depends_on: [] }, rows), null, 'moving under the grand-parent is fine');
});

test('store: task writes refused with a readable 400 code (INVALID + reason); nothing is stored', async () => {
  const { s, p1, p2 } = await fresh();
  const a = await s.upsertPortfolio('task', { project_id: p1, name: 'A' });
  const b = await s.upsertPortfolio('task', { project_id: p1, name: 'B', parent_id: a });
  const c = await s.upsertPortfolio('task', { project_id: p1, name: 'C', parent_id: b });
  const x = await s.upsertPortfolio('task', { project_id: p2, name: 'X' });
  await assert.rejects(() => s.upsertPortfolio('task', { id: a, parent_id: a }), reason('PARENT_SELF'));
  await assert.rejects(() => s.upsertPortfolio('task', { id: a, parent_id: c }), reason('PARENT_CYCLE'));
  await assert.rejects(() => s.upsertPortfolio('task', { id: b, parent_id: x }), reason('PARENT_OTHER_PROJECT'));
  await assert.rejects(() => s.upsertPortfolio('task', { project_id: p1, name: 'N', parent_id: x }), reason('PARENT_OTHER_PROJECT'));
  await assert.rejects(() => s.upsertPortfolio('task', { id: b, depends_on: [a] }), reason('DEPENDS_ON_HIERARCHY'));
  await assert.rejects(() => s.upsertPortfolio('task', { id: a, start_date: 'next week' }), reason('DATE_INVALID'));
  await assert.rejects(() => s.upsertPortfolio('task', { id: a, start_date: '2026-05-10', end_date: '2026-05-01' }), reason('DATE_ORDER'));
  await assert.rejects(() => s.upsertPortfolio('project', { id: p1, start_date: '2026-05-10', end_date: '2026-05-01' }), reason('DATE_ORDER'));
  await assert.rejects(() => s.upsertPortfolio('project', { id: p1, baseline_end: '2026-02-30' }), reason('DATE_INVALID'));
  await assert.rejects(() => s.upsertPortfolio('milestone', { project_id: p1, name: 'M', due_date: '30/06/2026' }), reason('DATE_INVALID'));
  const pf = await s.projectDetail(p1);
  const byId = Object.fromEntries(pf.tasks.map((t) => [t.id, t]));
  assert.equal(byId[a].parent_id, null); assert.equal(byId[b].parent_id, a); assert.deepEqual(byId[b].depends_on, []); assert.equal(byId[a].start_date, null);
  assert.equal(pf.milestones.length, 0);
  // a valid write still passes
  assert.equal(await s.upsertPortfolio('task', { id: c, parent_id: a, start_date: '2026-05-01', end_date: '2026-05-01' }), c);
});

test('legacy bad rows: reads do not crash, unrelated edits pass, the read-only report lists every offence', async () => {
  const { s, h, p1 } = await fresh();
  const a = await s.upsertPortfolio('task', { project_id: p1, name: 'A' });
  const b = await s.upsertPortfolio('task', { project_id: p1, name: 'B', parent_id: a });
  // forge a parent loop + a bad date + a link to the parent directly in SQL (what a pre-fix write could leave)
  await h.prepare('UPDATE portfolio_tasks SET parent_id=? WHERE id=?').run(b, a);
  await h.prepare("UPDATE portfolio_tasks SET start_date='someday', depends_on='[" + a + "]' WHERE id=?").run(b);
  await h.prepare("UPDATE portfolio_projects SET start_date='2026-06-01', end_date='2026-01-01' WHERE id=?").run(p1);
  const d = await s.projectDetail(p1); assert.ok(d, 'the project still reads');
  await s.portfolio();
  assert.equal(await s.upsertPortfolio('task', { id: b, status: 'in_progress' }), b, 'a status edit of a legacy row passes');
  const { Client } = require('pg'); const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    const before = await c.query('SELECT COUNT(*)::int AS n, MAX(updated_at) AS u FROM portfolio_tasks');
    const r = await require('../tools/pg/ppm-integrity-report').collect(c);
    const codes = r.issues.map((i) => `${i.entity}:${i.id}:${i.code}`);
    assert.ok(codes.includes(`task:${a}:PARENT_CYCLE`), codes.join(' | '));
    assert.ok(codes.includes(`task:${b}:DATE_INVALID`));
    assert.ok(codes.includes(`task:${b}:DEPENDS_ON_HIERARCHY`));
    assert.ok(codes.includes(`project:${p1}:DATE_ORDER`));
    assert.match(require('../tools/pg/ppm-integrity-report').format(r), /Nothing was written/);
    const after = await c.query('SELECT COUNT(*)::int AS n, MAX(updated_at) AS u FROM portfolio_tasks');
    assert.deepEqual(after.rows, before.rows, 'the report writes nothing');
  } finally { await c.end(); }
});
