'use strict';
// A-27 — versioned baselines: the pure rules (services/ppmBaseline). Fictitious data only.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../services/ppmBaseline');

const project = { id: 1, stage: 'in_progress', owner: 'jdoe', start_date: '2027-01-04', end_date: '2027-03-31', baseline_start: '2027-01-04', baseline_end: '2027-03-31', budget: 120000, spent: 30000, currency: 'USD' };
const tasks = [
  { id: 10, wbs_code: '1', name: 'Survey', start_date: '2027-01-04', end_date: '2027-01-15', baseline_start: null, baseline_end: null, duration_days: null, depends_on: [], allocation_pct: 60, owner: 'A' },
  { id: 11, wbs_code: '2', name: 'Order', start_date: '2027-01-18', end_date: '2027-01-29', baseline_start: '2027-01-18', baseline_end: '2027-01-29', depends_on: [10] },
];
const milestones = [{ id: 5, name: 'Go-live', due_date: '2027-03-31', baseline_date: null, status: 'planned' }];

test('snapshotPayload contains dates only (no budget / spent / currency anywhere)', () => {
  const p = B.snapshotPayload(project, tasks, milestones);
  const json = JSON.stringify(p);
  for (const k of ['budget', 'spent', 'currency', 'allocation_pct', 'owner']) assert.ok(!json.includes(`"${k}"`), k);
  assert.deepStrictEqual(p.project, { start_date: '2027-01-04', end_date: '2027-03-31', baseline_start: '2027-01-04', baseline_end: '2027-03-31' });
  assert.deepStrictEqual(p.tasks[1], { id: 11, wbs_code: '2', name: 'Order', start_date: '2027-01-18', end_date: '2027-01-29', baseline_start: '2027-01-18', baseline_end: '2027-01-29', duration_days: null, depends_on: [10] });
  assert.deepStrictEqual(p.milestones, [{ id: 5, name: 'Go-live', due_date: '2027-03-31', baseline_date: null }]);
});

test('diffBaselines gives day shifts per task and null when a side has no date', () => {
  const a = B.snapshotPayload(project, tasks, milestones);
  const b = B.snapshotPayload({ ...project, baseline_end: '2027-04-14' }, [
    { ...tasks[0], start_date: '2027-01-11', end_date: '2027-01-22' },
    { ...tasks[1], baseline_start: '2027-01-25', baseline_end: null, end_date: null },
    { id: 12, name: 'New', start_date: '2027-02-01', end_date: '2027-02-05' },
  ], [{ ...milestones[0], baseline_date: '2027-04-14' }]);
  const d = B.diffBaselines(a, b);
  assert.deepStrictEqual(d.project, { start_shift_days: 0, end_shift_days: 14 });
  const t = new Map(d.tasks.map((x) => [x.id, x]));
  assert.deepStrictEqual([t.get(10).start_shift_days, t.get(10).end_shift_days], [7, 7]);
  assert.deepStrictEqual([t.get(11).start_shift_days, t.get(11).end_shift_days], [7, null], 'a missing end date is not measured, never 0');
  assert.deepStrictEqual([t.get(12).in_a, t.get(12).in_b, t.get(12).end_shift_days], [false, true, null]);
  assert.strictEqual(d.milestones[0].shift_days, 14);
});

test('rebaselineCheck refuses the owner (username, full name or e-mail), a short reason and a wrong stage', () => {
  const p = { ...project, owner: 'Jane Doe' };
  for (const actor of [{ username: 'jane doe' }, { username: 'x', full_name: 'Jane Doe' }]) assert.strictEqual(B.rebaselineCheck(p, actor, 'scope change approved').code, 'GATE_SOD');
  assert.strictEqual(B.rebaselineCheck({ ...project, owner: 'jane@example.test' }, { username: 'jd', email: 'JANE@example.test' }, 'scope change approved').code, 'GATE_SOD');
  assert.strictEqual(B.rebaselineCheck(project, { username: 'cio' }, '123456789').code, 'GATE_REASON');
  assert.strictEqual(B.rebaselineCheck(project, { username: 'cio' }, '   ').code, 'GATE_REASON');
  assert.strictEqual(B.rebaselineCheck({ ...project, stage: 'proposal' }, { username: 'cio' }, 'scope change approved').code, 'STAGE');
  assert.strictEqual(B.rebaselineCheck({ ...project, stage: 'on_hold' }, { username: 'cio' }, '1234567890'), null);
  assert.strictEqual(B.rebaselineCheck(project, { username: 'cio' }, 'vendor delay, committee 2027-02'), null);
});
