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

// W1-ENGINE: durations are WORKING days (default Mon–Fri). Task 1 runs Fri 01-01 → Tue 01-05 = 3 working days
// (it was 5 calendar days: the calendar-day count was defect R4 / B8 of the W0 matrix), so the chain is 3+10+2 = 15.
// The 24/7 (elapsed) calendar gives back the calendar-day figure 17.
test('critical path: longest finish-to-start chain, slack of the parallel task', () => {
  const t = [
    { id: 1, start_date: '2027-01-01', end_date: '2027-01-05' },          // Fri → Tue = 3 working days
    { id: 2, depends_on: [1], duration_days: 10 },                        // 10 d
    { id: 3, depends_on: [1], duration_days: 3 },                         // 3 d, slack 7
    { id: 4, depends_on: [2, 3], duration_days: 2 },
  ];
  const cp = S.criticalPath(t);
  assert.strictEqual(cp.length_days, 15);
  assert.strictEqual(S.criticalPath(t, { calendar: { elapsed: true } }).length_days, 17, '24/7 calendar = calendar days');
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

// A-14 — a structured (JSON) charter is gated on its CONTENT, not on the length of its JSON text.
test('charterText: a JSON charter with empty fields is empty, so the approval gate refuses GATE_CHARTER', () => {
  const empty = JSON.stringify({ objective: '', scope_in: '', scope_out: '', benefits: '', success: '', constraints: '' });
  assert.ok(empty.length > 20, 'the JSON text alone would pass a length check');
  assert.strictEqual(S.charterText(empty), '');
  const p = { stage: 'proposal', owner: 'x', charter: empty };
  assert.strictEqual(S.stageGate(p, 'approval', { username: 'y' }).code, 'GATE_CHARTER');
});

test('charterText: JSON with objective+scope+benefits passes; a plain-text charter is unchanged', () => {
  const c = JSON.stringify({ objective: 'Two WAN links per mine', scope_in: 'Houndé', benefits: 'no mill stop on an ISP cut' });
  assert.strictEqual(S.charterText(c), 'Two WAN links per mine Houndé no mill stop on an ISP cut');
  assert.strictEqual(S.stageGate({ stage: 'proposal', owner: 'x', charter: c }, 'approval', { username: 'y' }), null);
  const plain = 'Second ISP link at Houndé to stop the mill reporting outages';
  assert.strictEqual(S.charterText(plain), plain);
  assert.strictEqual(S.charterText(null), '');
  assert.strictEqual(S.charterText('[1,2]'), '[1,2]', 'a JSON array is not a structured charter');
  assert.strictEqual(S.stageGate({ stage: 'proposal', owner: 'x', charter: 'short' }, 'approval', { username: 'y' }).code, 'GATE_CHARTER');
});

test('scheduleView: anchors es/ef to the project start; critical flags equal the critical path; slack per task', () => {
  const t = [
    { id: 1, start_date: '2027-01-01', end_date: '2027-01-05' },
    { id: 2, depends_on: [1], duration_days: 10 },
    { id: 3, depends_on: [1], duration_days: 3 },
    { id: 4, depends_on: [2, 3], duration_days: 2 },
  ];
  // W1-ENGINE: working days; task 1's entered start (Fri 01-01) is a start-no-earlier-than, the project start (Mon 01-04)
  // is later so it wins; 3 working days → 01-04..01-06 (old expectations counted calendar days from day 0 — defect R1/R4).
  const v = S.scheduleView(t, { anchor: '2027-01-04' });
  const cp = S.criticalPath(t, { anchor: '2027-01-04' });
  assert.strictEqual(v.anchor, '2027-01-04');
  assert.strictEqual(v.length_days, 15);
  assert.deepStrictEqual(v.tasks.filter((x) => x.critical).map((x) => x.id), cp.path);
  const by = Object.fromEntries(v.tasks.map((x) => [x.id, x]));
  assert.deepStrictEqual([by[1].es, by[1].ef, by[1].es_date, by[1].ef_date], [0, 3, '2027-01-04', '2027-01-06']);
  assert.deepStrictEqual([by[2].es, by[2].es_date, by[2].ef_date], [3, '2027-01-07', '2027-01-20'], 'ef_date is the last working day of the task');
  assert.strictEqual(by[3].slack, 7);
  assert.strictEqual(by[3].critical, false);
  assert.strictEqual(by[1].duration_days, 3);
  assert.ok('finish_variance_days' in by[1].variance);
});

test('scheduleView: a task without dates or duration is flagged assumed_duration, never reported as 0 days', () => {
  const v = S.scheduleView([{ id: 1, name: 'a' }, { id: 2, depends_on: [1], start_date: '2027-02-01' }], { anchor: '2027-02-01' });
  const by = Object.fromEntries(v.tasks.map((x) => [x.id, x]));
  assert.strictEqual(by[1].assumed_duration, true);
  assert.strictEqual(by[1].duration_days, null, 'unknown, not 0');
  assert.strictEqual(by[1].ef - by[1].es, 1, 'the critical path counts it as 1 day');
  assert.strictEqual(by[2].assumed_duration, true, 'a start without an end is still not a duration');
  assert.strictEqual(S.scheduleView([{ id: 5, duration_days: 3 }], {}).tasks[0].assumed_duration, false);
});

test('scheduleView: no anchor available → dates null, relative days kept; earliest task start is the fallback', () => {
  const v = S.scheduleView([{ id: 1, duration_days: 4 }, { id: 2, depends_on: [1], duration_days: 2 }], { anchor: null });
  assert.strictEqual(v.anchor, null);
  assert.ok(v.tasks.every((x) => x.es_date === null && x.ef_date === null));
  assert.deepStrictEqual(v.tasks.map((x) => [x.es, x.ef]), [[0, 4], [4, 6]]);
  const w = S.scheduleView([{ id: 1, start_date: '2027-03-10', end_date: '2027-03-11' }, { id: 2, start_date: '2027-03-02', end_date: '2027-03-03' }], {});
  assert.strictEqual(w.anchor, '2027-03-02');
  assert.strictEqual(S.scheduleView([], { anchor: '2027-01-01' }).tasks.length, 0);
  assert.strictEqual(S.scheduleView([{ id: 1, depends_on: [2] }, { id: 2, depends_on: [1] }], {}), null, 'a cycle cannot be scheduled');
});
