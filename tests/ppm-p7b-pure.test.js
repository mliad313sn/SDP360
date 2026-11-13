'use strict';
// P7 / B4-B5 — pure rules: timesheet weeks + SoD, change-request impact simulation on a HAND-COMPUTED network,
// plan freshness and the stale-plan exception. No database.
const { test } = require('node:test');
const assert = require('node:assert');
const TS = require('../services/ppm/timesheets');
const SIM = require('../services/ppm/crSimulation');
const FR = require('../services/ppm/planFreshness');
const { findExceptions } = require('../services/ppmAlerts');
const WBP = require('../public/lib/ppmWorkbench');

test('timesheets: ISO week (Monday, UTC), person key, grouping (unknown hours stay null)', () => {
  assert.equal(TS.weekStart('2026-11-12'), '2026-11-09');   // Thursday → Monday
  assert.equal(TS.weekStart('2026-11-15'), '2026-11-09');   // Sunday belongs to the week that started Monday
  assert.equal(TS.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(TS.weekStart('2026-02-30'), null);
  assert.equal(TS.personKey({ person_user_id: 7, person_label: 'Ana' }), 'u:7');
  assert.equal(TS.personKey({ person_label: '  Ana   Diallo ' }), 'l:ana diallo');
  const g = TS.groupWeeks([
    { task_id: 1, person_label: 'Ana', day: '2026-11-09', hours: 4, created_by: 3 },
    { task_id: 2, person_label: 'ana', day: '2026-11-11', hours: 0, created_by: 5 },
    { task_id: 1, person_label: 'Bob', person_user_id: 9, day: '2026-11-16', hours: 2, created_by: 3 },
  ], [{ id: 11, person_key: 'l:ana', week_start: '2026-11-09', status: 'submitted', submitted_by: 4 }]);
  assert.equal(g.length, 2);
  assert.deepEqual([g[0].person_key, g[0].hours, g[0].entries, g[0].status, g[0].week_id], ['l:ana', 4, 2, 'submitted', 11]);
  assert.deepEqual(g[0].entrants.sort(), [3, 5]);
  assert.deepEqual(g[1].entrants.sort(), [3, 9], 'the person whose hours they are counts as an entrant');
  assert.equal(g[1].status, 'draft', 'no stored row = draft');
});

test('timesheets SoD: the approver is never an entrant, the submitter, nor someone without the plan-write right', () => {
  const wk = { status: 'submitted', entries: 2, entrants: [3, 5], submitted_by: 4 };
  for (const id of [3, 4, 5]) assert.equal(TS.tsTransition(wk, 'approve', { id, canDecide: true }).code, 'SELF_REVIEW', `user ${id}`);
  assert.equal(TS.tsTransition(wk, 'approve', { id: 8, canDecide: false }).code, 'DECIDER_ONLY');
  assert.equal(TS.tsTransition(wk, 'approve', { id: 8, canDecide: true }), null);
  assert.equal(TS.tsTransition(wk, 'reject', { id: 8, canDecide: true }, 'short').code, 'NOTE_REQUIRED');
  assert.equal(TS.tsTransition(wk, 'reject', { id: 8, canDecide: true }, 'hours on the wrong task'), null);
  assert.equal(TS.tsTransition({ ...wk, status: 'approved' }, 'approve', { id: 8, canDecide: true }).code, 'TS_ORDER');
  assert.equal(TS.tsTransition({ status: 'draft', entries: 0 }, 'submit', { id: 3, canPlanWrite: true }).code, 'EMPTY_WEEK');
  assert.equal(TS.tsTransition({ status: 'rejected', entries: 1 }, 'submit', { id: 3, canPlanWrite: true }), null, 'a rejected week may be submitted again');
  assert.equal(TS.tsTransition(wk, 'recall', { id: 5 }).code, 'SUBMITTER_ONLY');
  assert.equal(TS.tsTransition(wk, 'recall', { id: 4 }), null);
  assert.ok(TS.isFrozen('approved') && TS.isFrozen('submitted') && !TS.isFrozen('rejected') && !TS.isFrozen('draft'));
  // the page mirror never offers approve to an entrant
  assert.deepEqual(WBP.tsSteps({ status: 'submitted', i_entered: true, submitted_by: 4 }, { me: 4, canEdit: true }), ['recall']);
  assert.deepEqual(WBP.tsSteps({ status: 'submitted', i_entered: false, submitted_by: 4 }, { me: 8, canEdit: true }), ['approve', 'reject']);
});

// Hand-computed network, Mon–Fri calendar, project start Mon 2026-11-02:
//   1 (5 d) 11-02→11-06 · 2 after 1 (3 d) 11-09→11-11 · 3 after 1 (2 d) 11-09→11-10 · 4 after 2,3 (1 d) 11-12.
//   Finish 11-12, critical 1-2-4 (task 3 has 1 d float). Change: task 3 → 5 d ⇒ 3 = 11-09→11-13, 4 = Mon 11-16,
//   finish +4 calendar d / +2 working d, critical becomes 1-3-4. Cost: 3 is fixed units 100 % ⇒ W 16 h → 40 h,
//   Δ 24 h × 50 USD = 1 200 USD.
const NET = [
  { id: 1, start_date: '2026-11-02', duration_days: 5, effort_hours: 40, allocation_pct: 100 },
  { id: 2, depends_on: [1], duration_days: 3 },
  { id: 3, depends_on: [1], duration_days: 2, effort_hours: 16, allocation_pct: 100 },
  { id: 4, depends_on: [2, 3], duration_days: 1 },
];
test('CR simulation: schedule + cost impact equal the hand-computed values; the plan is not touched', () => {
  const copy = JSON.parse(JSON.stringify(NET));
  const r = SIM.simulate({ tasks: NET, changes: [{ task_id: 3, duration_days: 5 }], project: { start_date: '2026-11-02', finish_deadline: '2026-11-13' }, evmFields: { 3: { cost_rate: 50, cost_currency: 'USD' } } });
  assert.equal(r.ok, true);
  assert.deepEqual([r.schedule.finish_before, r.schedule.finish_after, r.schedule.finish_delta_days, r.schedule.finish_delta_working_days], ['2026-11-12', '2026-11-16', 4, 2]);
  assert.deepEqual(r.schedule.critical_path_before, [1, 2, 4]);
  assert.deepEqual(r.schedule.critical_path_after, [1, 3, 4]);
  assert.deepEqual(r.schedule.newly_critical, [3]);
  assert.equal(r.schedule.deadline_breached_after, true);
  assert.deepEqual(r.cost.by_currency, [{ currency: 'USD', delta: 1200, delta_hours: 24, tasks: 1 }]);
  assert.deepEqual(NET, copy, 'pure: the input plan is unchanged');
  assert.equal(SIM.effectiveDatesImpact({ impact_dates_days: null, simulation: r }), 4);
  assert.equal(SIM.effectiveDatesImpact({ impact_dates_days: 7, simulation: r }), 7, 'a typed impact wins');
});

test('CR simulation: unknown cost stays null (no rate / unknown effort), a cycle is refused, bad changes are 400', () => {
  const r = SIM.simulate({ tasks: NET, changes: [{ task_id: 3, effort_hours: 20 }, { task_id: 2, duration_days: 4 }], project: { start_date: '2026-11-02' }, evmFields: {} });
  assert.equal(r.cost.status, 'partly_unknown');
  assert.deepEqual(r.cost.by_currency, []);
  assert.deepEqual(r.cost.unknown.map((u) => [u.task_id, u.reason]), [[3, 'no_hourly_rate'], [2, 'effort_unknown']]);
  const only = SIM.simulate({ tasks: NET, changes: [{ task_id: 4, start_date: '2026-11-20' }], project: { start_date: '2026-11-02' } });
  assert.equal(only.cost.status, 'no_effort_change', 'no effort touched: no cost delta is claimed');
  const cyc = SIM.simulate({ tasks: NET, changes: [{ task_id: 1, depends_on: [4] }], project: {} });
  assert.deepEqual([cyc.ok, cyc.reason], [false, 'CYCLE']);
  assert.throws(() => SIM.normaliseTaskChanges([{ task_id: 99, duration_days: 1 }], [1, 2]), (e) => e.reason === 'UNKNOWN_TASK');
  assert.throws(() => SIM.normaliseTaskChanges([{ task_id: 1, name: 'x' }], [1, 2]), (e) => e.reason === 'BAD_TASK_CHANGES');
  assert.deepEqual(SIM.normaliseTaskChanges([{ task_id: 1, duration_days: '3' }], [1]), [{ task_id: 1, duration_days: 3 }]);
  assert.deepEqual(WBP.parseChangeLines('3 duration=5 depends=1,2\n\n4 effort=10'), [{ task_id: 3, duration_days: 5, depends_on: [1, 2] }, { task_id: 4, effort_hours: 10 }]);
  assert.ok(WBP.parseChangeLines('x duration=1').error);
});

test('plan freshness: whole days, null = unknown (never 0); stale_plan only with a threshold and a known date', () => {
  assert.deepEqual(FR.freshness(null, '2026-11-13'), { plan_updated_at: null, plan_updated_days: null });
  assert.equal(FR.freshness('2026-11-10T22:00:00.000Z', '2026-11-13').plan_updated_days, 3);
  assert.equal(FR.freshness('2026-11-13T08:00:00.000Z', '2026-11-13T23:00:00Z').plan_updated_days, 0);
  assert.equal(WBP.freshnessText({ plan_updated_days: null }), '—');
  assert.equal(WBP.freshnessText({ plan_updated_days: 0 }), 'Plan updated today');
  const view = { projects: [
    { id: 1, key: 'P1', stage: 'in_progress', status: 'green', owner: 'Ana' },
    { id: 2, key: 'P2', stage: 'in_progress', status: 'green' },
    { id: 3, key: 'P3', stage: 'proposal', status: 'green' },
    { id: 4, key: 'P4', stage: 'in_progress', status: 'green' },
  ] };
  const planUpdated = { 1: '2026-10-01T10:00:00Z', 2: '2026-11-10T10:00:00Z', 3: '2026-09-01T10:00:00Z', 4: null };
  const kinds = (o) => findExceptions(view, { today: '2026-11-13', ...o }).filter((x) => x.kind === 'stale_plan');
  assert.deepEqual(kinds({ planUpdated }), [], 'no threshold = off = today');
  assert.deepEqual(kinds({ planUpdated, staleDays: '' }), []);
  const s = kinds({ planUpdated, staleDays: 30 });
  assert.deepEqual(s.map((x) => x.project_id), [1], 'only the in_progress project older than 30 d; unknown date never stale; a proposal not nudged');
  assert.match(s[0].message, /not updated for 43 d/);
  assert.equal(s[0].owner, 'Ana');
});
