'use strict';
// W1-ENGINE — migration 091: the scheduling fields round-trip through the governance store (PostgreSQL) and reach the
// engine; NULL fields = today's behaviour.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeGovernanceStore } = require('../services/governanceStore');
const S = require('../services/projectSchedule');

async function fresh() { const s = makeGovernanceStore((await require('./_pg-fresh').freshStore(['portfolio_programmes', 'portfolio_objectives', 'portfolio_projects', 'portfolio_tasks'])), { now: () => '2026-11-12T10:00:00.000Z' }); await s.init(); return s; }

test('091 fields round-trip: mode, constraint, deadline, task type, effort-driven, link types; project finish deadline', async () => {
  const s = await fresh();
  const pr = await s.upsertPortfolio('programme', { key: 'w1p', name: 'P' });
  const ob = await s.upsertPortfolio('objective', { programme_id: pr, key: 'w1o', name: 'O' });
  const pj = await s.upsertPortfolio('project', { objective_id: ob, key: 'w1j', name: 'J', start_date: '2027-01-04', finish_deadline: '2027-01-13' });
  const a = await s.upsertPortfolio('task', { project_id: pj, name: 'A', duration_days: 3 });
  const b = await s.upsertPortfolio('task', { project_id: pj, name: 'B', duration_days: 2, depends_on: [a], dependency_links: [{ id: a, type: 'ss', lag: '1' }],
    schedule_mode: 'auto', constraint_type: 'snet', constraint_date: '2027-01-05', deadline: '2027-01-12', task_type: 'fixed_work', effort_driven: true });
  const d = await s.projectDetail(pj);
  const tb = d.tasks.find((t) => t.id === b);
  assert.deepStrictEqual(tb.dependency_links, [{ id: a, type: 'SS', lag: 1 }]);
  assert.deepStrictEqual([tb.schedule_mode, tb.constraint_type, tb.constraint_date, tb.deadline, tb.task_type, tb.effort_driven], ['auto', 'SNET', '2027-01-05', '2027-01-12', 'fixed_work', 1]);
  assert.strictEqual(d.project.finish_deadline, '2027-01-13');
  const ta = d.tasks.find((t) => t.id === a);
  assert.deepStrictEqual([ta.schedule_mode, ta.dependency_links, ta.effort_driven], [null, null, null], 'absent = today');
  const v = S.scheduleView(d.tasks, { anchor: d.project.start_date, deadline: d.project.finish_deadline });
  const vb = v.tasks.find((t) => t.id === b);
  assert.deepStrictEqual([vb.es_date, vb.ef_date], ['2027-01-05', '2027-01-06'], 'SS+1 from A (Mon) → Tue');
  await assert.rejects(() => s.upsertPortfolio('task', { id: b, schedule_mode: 'sometimes' }), /schedule_mode must be/);
  await assert.rejects(() => s.upsertPortfolio('task', { id: b, dependency_links: [{ id: a, type: 'XX' }] }), /link type/);
  await assert.rejects(() => s.upsertPortfolio('task', { id: b, deadline: '12/01/2027' }), /YYYY-MM-DD/);
});
