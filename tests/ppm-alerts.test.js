'use strict';
// A-27 — catalogue rule A11: the pure PPM exception finder (services/ppmAlerts). Fictitious data only.
const test = require('node:test');
const assert = require('node:assert');
const { findExceptions } = require('../services/ppmAlerts');

const TODAY = '2027-02-15';
const P = (o) => ({ id: 1, key: 'P1', name: 'Link', site_id: 3, owner: 'pmo', stage: 'in_progress', status: 'active', start_date: '2027-01-04', end_date: '2027-03-31', baseline_end: '2027-03-31', ...o });
const run = (v, o = {}) => findExceptions({ projects: [P()], tasks: [], milestones: [], ...v }, { today: TODAY, ...o });
const kinds = (r, k) => r.filter((x) => x.kind === k);

test('task_overdue only for end_date < today and not done / cancelled; no end date never fires', () => {
  const r = run({ tasks: [
    { id: 1, project_id: 1, name: 'late', owner: 'a', status: 'todo', end_date: '2027-02-14' },
    { id: 2, project_id: 1, name: 'today', owner: 'a', status: 'todo', end_date: '2027-02-15' },
    { id: 3, project_id: 1, name: 'done', owner: 'a', status: 'done', end_date: '2027-01-01' },
    { id: 4, project_id: 1, name: 'cancelled', owner: 'a', status: 'cancelled', end_date: '2027-01-01' },
    { id: 5, project_id: 1, name: 'no date', owner: 'a', status: 'todo', end_date: null },
    { id: 6, project_id: 1, name: 'garbage', owner: 'a', status: 'todo', end_date: 'soon' },
  ] });
  assert.deepStrictEqual(kinds(r, 'task_overdue').map((x) => x.entity_id), [1]);
  assert.strictEqual(kinds(r, 'task_overdue')[0].owner, 'a');
  assert.strictEqual(kinds(r, 'task_overdue')[0].site_id, 3);
});

test('a closed or cancelled project raises nothing', () => {
  const r = findExceptions({ projects: [P({ stage: 'closed', status: 'done' })], tasks: [{ id: 1, project_id: 1, name: 't', status: 'todo', end_date: '2027-01-01' }], milestones: [] }, { today: TODAY });
  assert.deepStrictEqual(r, []);
});

test('task_blocked respects blockedDays; unknown update date never fires', () => {
  const tasks = [
    { id: 1, project_id: 1, name: 'b6', owner: 'a', status: 'blocked', updated_at: '2027-02-09T10:00:00Z' },
    { id: 2, project_id: 1, name: 'b3', owner: 'a', status: 'blocked', updated_at: new Date('2027-02-12T10:00:00Z') },
    { id: 3, project_id: 1, name: 'b?', owner: 'a', status: 'blocked', updated_at: null },
  ];
  assert.deepStrictEqual(kinds(run({ tasks }), 'task_blocked').map((x) => x.entity_id), [1]);
  assert.deepStrictEqual(kinds(run({ tasks }, { blockedDays: 2 }), 'task_blocked').map((x) => x.entity_id), [1, 2]);
});

test('unowned task / milestone only on in_progress projects', () => {
  const v = { tasks: [{ id: 1, project_id: 1, name: 't', status: 'todo', owner: '' }, { id: 2, project_id: 1, name: 'd', status: 'done', owner: null }],
    milestones: [{ id: 9, project_id: 1, name: 'm', status: 'planned', owner: null }, { id: 8, project_id: 1, name: 'm2', status: 'done', owner: null }] };
  const r = run(v);
  assert.deepStrictEqual(kinds(r, 'unowned_task').map((x) => x.entity_id), [1]);
  assert.deepStrictEqual(kinds(r, 'unowned_milestone').map((x) => x.entity_id), [9]);
  assert.strictEqual(kinds(r, 'unowned_task')[0].owner, 'pmo', 'goes to the project owner');
  const r2 = findExceptions({ projects: [P({ stage: 'approval', status: 'planned' })], ...v }, { today: TODAY });
  assert.strictEqual(kinds(r2, 'unowned_task').length + kinds(r2, 'unowned_milestone').length, 0);
});

test('milestone_overdue: due before today, not done; no date never fires', () => {
  const r = run({ milestones: [
    { id: 1, project_id: 1, name: 'a', owner: 'x', status: 'planned', due_date: '2027-02-01' },
    { id: 2, project_id: 1, name: 'b', owner: 'x', status: 'planned', due_date: '2027-02-01', done_at: '2027-02-01' },
    { id: 3, project_id: 1, name: 'c', owner: 'x', status: 'planned', due_date: null },
  ] });
  assert.deepStrictEqual(kinds(r, 'milestone_overdue').map((x) => x.entity_id), [1]);
});

test('dependency_blocked when a predecessor is late or blocked', () => {
  const r = run({ tasks: [
    { id: 1, project_id: 1, wbs_code: '1', name: 'late', owner: 'a', status: 'in_progress', end_date: '2027-02-10' },
    { id: 2, project_id: 1, wbs_code: '2', name: 'next', owner: 'a', status: 'todo', end_date: '2027-03-01', depends_on: [1] },
    { id: 3, project_id: 1, wbs_code: '3', name: 'fine', owner: 'a', status: 'todo', end_date: '2027-03-10', depends_on: [4] },
    { id: 4, project_id: 1, wbs_code: '4', name: 'ok', owner: 'a', status: 'todo', end_date: '2027-03-05' },
  ] });
  assert.deepStrictEqual(kinds(r, 'dependency_blocked').map((x) => x.entity_id), [2]);
  assert.match(kinds(r, 'dependency_blocked')[0].message, /1 \(late\)/);
});

test('baseline_slip uses varianceOf and the threshold; no baseline → no item', () => {
  assert.deepStrictEqual(kinds(findExceptions({ projects: [P({ forecast_end: '2027-04-11' })] }, { today: TODAY }), 'baseline_slip').length, 1, '11 d > 10');
  assert.strictEqual(kinds(findExceptions({ projects: [P({ forecast_end: '2027-04-10' })] }, { today: TODAY }), 'baseline_slip').length, 0, '10 d is not more than 10');
  assert.strictEqual(kinds(findExceptions({ projects: [P({ forecast_end: '2027-04-10' })] }, { today: TODAY, slipDays: 5 }), 'baseline_slip').length, 1);
  assert.strictEqual(kinds(findExceptions({ projects: [P({ baseline_end: null, forecast_end: '2027-09-10' })] }, { today: TODAY }), 'baseline_slip').length, 0);
});

test('capacity_overload only when a capacity grid is passed', () => {
  assert.strictEqual(kinds(run({}), 'capacity_overload').length, 0);
  const r = run({}, { capacity: [{ owner: 'A. Kone', from: '2027-01-11', to: '2027-01-15', peak_pct: 120, task_ids: [1, 2] }] });
  assert.deepStrictEqual(kinds(r, 'capacity_overload').map((x) => x.key), ['capacity_overload:person:a. kone:2027-01-11']);
  // F-PRODUCT-02: the key does not move with the peak or the end date (dedup in ppm_alert_state stays stable)
  const r2 = run({}, { capacity: [{ owner: ' A. KONE ', from: '2027-01-11', to: '2027-01-20', peak_pct: 160, task_ids: [1, 2, 3] }] });
  assert.deepStrictEqual(kinds(r2, 'capacity_overload').map((x) => x.key), ['capacity_overload:person:a. kone:2027-01-11']);
  assert.match(kinds(r2, 'capacity_overload')[0].message, /160 %/);
});

test('item keys are stable across runs (same data, same keys, same order)', () => {
  const v = { tasks: [{ id: 7, project_id: 1, name: 't', status: 'todo', owner: '', end_date: '2027-01-01' }], milestones: [{ id: 3, project_id: 1, name: 'm', owner: null, due_date: '2027-01-02' }] };
  const a = run(v).map((x) => x.key), b = run(JSON.parse(JSON.stringify(v))).map((x) => x.key);
  assert.deepStrictEqual(a, b);
  assert.ok(a.includes('task_overdue:task:7') && a.includes('unowned_milestone:milestone:3'));
  assert.throws(() => findExceptions({}, {}), /today/);
});
