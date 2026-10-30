'use strict';
// G11 — native PPM scheduling rules (pure).
const test = require('node:test');
const assert = require('node:assert');
const S = require('../services/projectSchedule');

test('dependencies: self, unknown, duplicate and cycles are refused; a valid chain passes', () => {
  const items = [{ id: 1 }, { id: 2, depends_on: [1] }, { id: 3, depends_on: [2] }];
  assert.strictEqual(S.dependencyProblem(items, 1, [1]).code, 'DEP_SELF');
  assert.strictEqual(S.dependencyProblem(items, 1, [9]).code, 'DEP_MISSING');
  assert.strictEqual(S.dependencyProblem(items, 3, [2, 2]).code, 'DEP_DUPLICATE');
  assert.strictEqual(S.dependencyProblem(items, 1, [3]).code, 'DEP_CYCLE', '1 → 3 → 2 → 1');
  assert.strictEqual(S.dependencyProblem(items, 3, [1, 2]), null);
  assert.strictEqual(S.dependencyProblem(items, null, [1]), null, 'a new item cannot close a cycle');
});

test('critical path: longest finish-to-start chain, slack of the parallel task', () => {
  const t = [
    { id: 1, start_date: '2027-01-01', end_date: '2027-01-05' },          // 5 d
    { id: 2, depends_on: [1], duration_days: 10 },                        // 10 d
    { id: 3, depends_on: [1], duration_days: 3 },                         // 3 d, slack 7
    { id: 4, depends_on: [2, 3], duration_days: 2 },
  ];
  const cp = S.criticalPath(t);
  assert.strictEqual(cp.length_days, 17);
  assert.deepStrictEqual(cp.path, [1, 2, 4]);
  assert.strictEqual(cp.slack[3], 7);
  assert.strictEqual(S.criticalPath([{ id: 1, depends_on: [2] }, { id: 2, depends_on: [1] }]), null, 'a cycle cannot be scheduled');
});

test('resource conflicts: same person over 100 % on overlapping days; done tasks ignored', () => {
  const t = [
    { id: 1, owner: 'A. Kone', start_date: '2027-02-01', end_date: '2027-02-10', allocation_pct: 60 },
    { id: 2, owner: 'a. kone', start_date: '2027-02-08', end_date: '2027-02-15', allocation_pct: 60 },
    { id: 3, owner: 'B', start_date: '2027-02-01', end_date: '2027-02-28', allocation_pct: 100 },
    { id: 4, owner: 'A. Kone', start_date: '2027-02-01', end_date: '2027-02-28', allocation_pct: 90, status: 'done' },
  ];
  const c = S.resourceConflicts(t);
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual([c[0].from, c[0].to, c[0].peak_pct, c[0].task_ids], ['2027-02-08', '2027-02-10', 120, [1, 2]]);
});

test('variance: baseline vs forecast vs actual, null when not measured', () => {
  assert.deepStrictEqual(S.varianceOf({ baseline_end: '2027-03-01', forecast_end: '2027-03-11' }).finish_variance_days, 10);
  assert.strictEqual(S.varianceOf({ baseline_end: '2027-03-01', actual_end: '2027-02-27' }).finish_variance_days, -2);
  assert.strictEqual(S.varianceOf({ end_date: '2027-03-01' }).finish_variance_days, null);
});

test('stage gates: order, charter, baseline, sponsor, separation of duties, closure checks', () => {
  const p = { stage: 'proposal', owner: 'pm1' };
  assert.strictEqual(S.stageGate(p, 'in_progress', {}).code, 'STAGE_ORDER');
  assert.strictEqual(S.stageGate(p, 'approval', {}).code, 'GATE_CHARTER');
  const a = { stage: 'approval', owner: 'pm1', charter: 'Replace the WAN at two mine sites', sponsor: 'cio' };
  assert.strictEqual(S.stageGate(a, 'in_progress', { username: 'boss' }).code, 'GATE_BASELINE');
  const b = { ...a, start_date: '2027-01-01', end_date: '2027-06-30', baseline_end: '2027-06-30' };
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'pm1' }).code, 'GATE_SOD');
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'boss' }), null);
  assert.strictEqual(S.stageGate({ stage: 'in_progress' }, 'on_hold', {}, {}).code, 'GATE_REASON');
  assert.strictEqual(S.stageGate({ stage: 'in_progress' }, 'closure', {}, { openTasks: 2 }).code, 'GATE_OPEN_TASKS');
  assert.strictEqual(S.stageGate({ stage: 'closure' }, 'closed', {}, { openRisksHigh: 1 }).code, 'GATE_OPEN_RISKS');
  assert.strictEqual(S.stageGate({ stage: 'closed' }, 'in_progress', {}).code, 'STAGE_ORDER');
});

test('owner identity for the approval gate: username, full name or e-mail all count', () => {
  const b = { stage: 'approval', owner: 'Jean Dupont', charter: 'Replace the WAN at two mine sites', sponsor: 'cio', start_date: '2027-01-01', end_date: '2027-06-30', baseline_end: '2027-06-30' };
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'jdupont', full_name: 'Jean Dupont' }).code, 'GATE_SOD');
  assert.strictEqual(S.stageGate({ ...b, owner: 'jean.dupont@example.org' }, 'in_progress', { username: 'jdupont', email: 'Jean.Dupont@example.org' }).code, 'GATE_SOD');
  assert.strictEqual(S.stageGate(b, 'in_progress', { username: 'boss', full_name: 'Awa Traore' }), null);
});
