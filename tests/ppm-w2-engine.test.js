'use strict';
// W2-ENGINE (PPM parity W2, T2 / T6) — pure engine additions with HAND-COMPUTED fixtures: lag units (working days,
// elapsed days, % of the predecessor), leads, deadlines with negative float, levelling delay, calendars on the site
// holiday calendar, contours, rate tables A–E, assignment cost, over-allocation and levelling with explanations,
// baseline slots. Calendar: Mon–Fri; 2027-01-04 is a Monday.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/scheduleEngine');
const CAL = require('../services/ppm/calendars');
const R = require('../services/ppm/resources');
const SL = require('../services/ppm/baselineSlots');

const by = (res) => Object.fromEntries(res.tasks.map((t) => [t.id, t]));

test('lag units: working days, elapsed days, % of the predecessor and leads — hand-computed', () => {
  const L = (id, type, lag, lag_unit) => ({ id, type, lag, lag_unit });
  const tasks = [
    { id: 1, duration_days: 5 },                                                                      // A Mon 04 → Fri 08
    { id: 2, duration_days: 1, depends_on: [1], dependency_links: [L(1, 'FS', 2, 'ed')] },             // Sat 09 + 2 = Mon 11
    { id: 3, duration_days: 1, depends_on: [1], dependency_links: [L(1, 'FS', 3, 'ed')] },             // Sat 09 + 3 = Tue 12
    { id: 4, duration_days: 1, depends_on: [1], dependency_links: [L(1, 'FS', 2)] },                   // 2 working days → Wed 13
    { id: 5, duration_days: 1, depends_on: [1], dependency_links: [L(1, 'SS', 40, '%')] },             // 40 % × 5 d = 2 → Wed 06
    { id: 6, duration_days: 2, depends_on: [1], dependency_links: [L(1, 'FF', 1, 'ed')] },             // finish ≥ Sun 10 → ends Mon 11, starts Fri 08
    { id: 7, duration_days: 1, depends_on: [1], dependency_links: [L(1, 'FS', -1)] },                  // lead 1 working day → Fri 08
    { id: 8, duration_days: 2, depends_on: [1], dependency_links: [L(1, 'SF', 3, 'ed')] },             // finish ≥ Thu 07 00:00 → ends Wed 06, starts Tue 05
  ];
  const r = E.schedule(tasks, { anchor: '2027-01-04' });
  const t = by(r);
  assert.deepStrictEqual([t[1].es_date, t[1].ef_date], ['2027-01-04', '2027-01-08']);
  assert.strictEqual(t[2].es_date, '2027-01-11');
  assert.strictEqual(t[3].es_date, '2027-01-12');
  assert.strictEqual(t[4].es_date, '2027-01-13');
  assert.strictEqual(t[5].es_date, '2027-01-06');
  assert.deepStrictEqual([t[6].es_date, t[6].ef_date], ['2027-01-08', '2027-01-11']);
  assert.strictEqual(t[7].es_date, '2027-01-08');
  assert.deepStrictEqual([t[8].es_date, t[8].ef_date], ['2027-01-05', '2027-01-06']);
  assert.deepStrictEqual(t[2].driver, { type: 'link', from: 1, link_type: 'FS', lag: 2, lag_unit: 'ed' });
  const l5 = r.links.find((l) => l.to === 5);
  assert.deepStrictEqual(l5, { from: 1, to: 5, type: 'SS', lag: 40, lag_unit: '%', lag_working_days: 2 });
  assert.strictEqual(r.links.find((l) => l.to === 2).lag_working_days, null);
  // backward pass through an elapsed lag: A drives task 4 (the latest finish, Wed 13) → A is critical, float 0
  assert.strictEqual(t[1].total_float, 0);
  assert.strictEqual(t[4].critical, true);
  // task 2 (Mon 11) can wait until Wed 13: 2 working days of float; its free float to the project end is 2 as well
  assert.strictEqual(t[2].total_float, 2);
  assert.strictEqual(t[2].free_float, 2);
});

test('elapsed lag crosses a weekend and a holiday on the successor calendar; % lag of a summary predecessor', () => {
  const cal = { holidays: ['2027-01-11'] };   // Monday 11 is a holiday
  const r = E.schedule([
    { id: 1, duration_days: 5 },
    { id: 2, duration_days: 1, depends_on: [1], dependency_links: [{ id: 1, type: 'FS', lag: 2, lag_unit: 'ed' }] },   // Mon 11 holiday → Tue 12
    { id: 10, name: 'summary' }, { id: 11, parent_id: 10, duration_days: 4 },                                           // summary Mon 04 → Thu 07 (4 d)
    { id: 3, duration_days: 1, depends_on: [10], dependency_links: [{ id: 10, type: 'SS', lag: 50, lag_unit: '%' }] },  // 50 % × 4 = 2 → Wed 06
  ], { anchor: '2027-01-04', calendar: cal });
  const t = by(r);
  assert.strictEqual(t[2].es_date, '2027-01-12');
  assert.strictEqual(t[3].es_date, '2027-01-06');
});

test('deadlines: negative float reported per task and in deadlines_missed; a met deadline has positive slack', () => {
  const r = E.schedule([
    { id: 1, duration_days: 5 },
    { id: 2, duration_days: 3, depends_on: [1], deadline: '2027-01-12' },   // Mon 11 → Wed 13, deadline Tue 12 → 1 day late
    { id: 3, duration_days: 1, deadline: '2027-01-08' },                    // Mon 04, deadline Fri 08 → 4 working days of slack
  ], { anchor: '2027-01-04' });
  const t = by(r);
  assert.strictEqual(t[2].deadline_slack_days, -1);
  assert.strictEqual(t[2].deadline_missed, true);
  assert.strictEqual(t[2].negative_float, true);
  assert.strictEqual(t[2].total_float, -1);
  assert.strictEqual(t[3].deadline_slack_days, 4);
  assert.strictEqual(t[3].deadline_missed, false);
  assert.deepStrictEqual(r.deadlines_missed, [{ id: 2, deadline: '2027-01-12', finish: '2027-01-13', late_days: 1 }]);
  assert.ok(r.warnings.some((w) => w.code === 'DEADLINE_MISSED' && w.task_id === 2));
  // A drives task 2, so A carries the negative float too
  assert.strictEqual(t[1].total_float, -1);
});

test('levelling delay: added after every network requirement, successors follow; an override map wins', () => {
  const tasks = [{ id: 1, duration_days: 5 }, { id: 2, duration_days: 1, depends_on: [1], leveling_delay_days: 2 }, { id: 3, duration_days: 1, depends_on: [2] }];
  const t = by(E.schedule(tasks, { anchor: '2027-01-04' }));
  assert.strictEqual(t[2].es_date, '2027-01-13');   // Mon 11 + 2 working days
  assert.strictEqual(t[2].leveling_delay_days, 2);
  assert.strictEqual(t[2].driver.type, 'leveling_delay');
  assert.strictEqual(t[3].es_date, '2027-01-14');
  const o = by(E.schedule(tasks, { anchor: '2027-01-04', levelingDelays: { 2: 0 } }));
  assert.strictEqual(o[2].es_date, '2027-01-11');
  assert.strictEqual(o[2].leveling_delay_days, null);
});

test('the 8 constraints still hold with typed lags (T2 cross-check on one network)', () => {
  const base = (extra) => E.schedule([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 2, depends_on: [1], dependency_links: [{ id: 1, type: 'FS', lag: 1, lag_unit: 'ed' }], ...extra }], { anchor: '2027-01-04', deadline: '2027-01-29' });
  // A Mon 04 → Wed 06; FS +1 ed → Thu 07 + 1 = Fri 08 (boundary Thu 07 + 1 day)
  assert.strictEqual(by(base({}))[2].es_date, '2027-01-08');
  assert.strictEqual(by(base({ constraint_type: 'SNET', constraint_date: '2027-01-13' }))[2].es_date, '2027-01-13');
  assert.strictEqual(by(base({ constraint_type: 'FNET', constraint_date: '2027-01-15' }))[2].ef_date, '2027-01-15');
  assert.strictEqual(by(base({ constraint_type: 'MSO', constraint_date: '2027-01-18' }))[2].es_date, '2027-01-18');
  assert.strictEqual(by(base({ constraint_type: 'MFO', constraint_date: '2027-01-19' }))[2].ef_date, '2027-01-19');
  assert.strictEqual(by(base({ constraint_type: 'ALAP' }))[2].ef_date, '2027-01-11');   // it is the last task: ALAP = its early finish (a deadline only tightens)
  assert.strictEqual(by(base({ constraint_type: 'SNLT', constraint_date: '2027-01-07' }))[2].total_float, -1);   // must start by Thu 07, network says Fri 08
  assert.strictEqual(by(base({ constraint_type: 'FNLT', constraint_date: '2027-01-08' }))[2].total_float, -1);   // finishes Mon 11 instead of Fri 08
  assert.strictEqual(by(base({ constraint_type: 'ASAP' }))[2].es_date, '2027-01-08');
});

test('calendars: base chain, site holidays (site + platform), exceptions override holidays, loop cut', () => {
  const ctx = {
    calendars: [
      { id: 1, name: 'Std', workdays: '[1,2,3,4,5]', hours_per_day: 8, use_site_holidays: 1, site_id: null },
      { id: 2, name: 'Mine', base_calendar_id: 1, workdays: '[1,2,3,4,5,6]', use_site_holidays: 1, site_id: 7 },
      { id: 3, name: 'Loop A', base_calendar_id: 4 }, { id: 4, name: 'Loop B', base_calendar_id: 3, workdays: [1, 2, 3] },
    ],
    exceptions: [
      { id: 1, calendar_id: 1, day_from: '2027-01-15', day_to: '2027-01-15', working: 0 },
      { id: 2, calendar_id: 2, day_from: '2027-01-15', day_to: '2027-01-15', working: 1 },      // the mine works that day
      { id: 3, calendar_id: 2, day_from: '2027-01-01', day_to: '2027-01-01', working: 1 },      // and on the platform holiday
    ],
    siteHolidays: [{ site_id: null, day: '2027-01-01' }, { site_id: 7, day: '2027-01-18' }, { site_id: 9, day: '2027-01-19' }, { site_id: 7, day: '2027-01-20', removed_at: 'x' }],
  };
  const std = CAL.resolveCalendar(1, ctx);
  assert.deepStrictEqual(std.holidays, ['2027-01-01']);
  assert.deepStrictEqual(std.exceptions, [{ date: '2027-01-15', working: false }]);
  const mine = CAL.resolveCalendar(2, ctx);
  assert.deepStrictEqual(mine.workdays, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(mine.hours_per_day, 8);   // inherited
  assert.deepStrictEqual(mine.holidays, ['2027-01-01', '2027-01-18']);
  assert.deepStrictEqual(mine.exceptions, [{ date: '2027-01-01', working: true }, { date: '2027-01-15', working: true }]);
  const cal = E.makeCalendar(CAL.specOf(mine));
  assert.strictEqual(cal.isWork(E.toDay('2027-01-01')), true);   // exception beats the holiday
  assert.strictEqual(cal.isWork(E.toDay('2027-01-18')), false);
  assert.strictEqual(cal.isWork(E.toDay('2027-01-16')), true);   // Saturday on the 6-day week
  assert.strictEqual(CAL.resolveCalendar(3, ctx).loop, true);
  assert.strictEqual(CAL.resolveCalendar(99, ctx), null);
  // effective calendar per task: task calendar > primary resource calendar > project calendar > default
  const ec = CAL.engineCalendars({ tasks: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], projectCalendarId: 1, taskFields: { 1: { calendar_id: 2 }, 4: { ignore_resource_calendar: 1 } },
    assignments: [{ task_id: 2, resource_id: 5, units_pct: 50 }, { task_id: 2, resource_id: 6, units_pct: 100 }, { task_id: 4, resource_id: 6, units_pct: 100 }],
    resources: [{ id: 5, kind: 'work', calendar_id: 1 }, { id: 6, kind: 'work', calendar_id: 2 }], calendarsCtx: ctx });
  assert.deepStrictEqual(ec.effective[1], { calendar_id: 2, source: 'task' });
  assert.deepStrictEqual(ec.effective[2], { calendar_id: 2, source: 'resource', resource_id: 6 });   // the highest units
  assert.deepStrictEqual(ec.effective[3], { calendar_id: 1, source: 'project' });
  assert.deepStrictEqual(ec.effective[4], { calendar_id: 1, source: 'project' });
  assert.ok(ec.calendars[2] && ec.calendar);
});

test('contours: weights per tenth, work split in whole minutes adds up exactly', () => {
  for (const c of R.CONTOUR_NAMES) for (const D of [1, 3, 7, 10, 23]) {
    const parts = R.spread(13.3, R.contourWeights(c, D));
    assert.strictEqual(Math.round(parts.reduce((a, b) => a + b, 0) * 60), 798, `${c} × ${D}`);
  }
  assert.deepStrictEqual(R.contourWeights('bell', 10), [10, 20, 40, 80, 100, 100, 80, 40, 20, 10]);
  assert.deepStrictEqual(R.contourWeights('back_loaded', 5), [15, 50, 75, 100, 100]);   // midpoints of 5 days → tenths 1,3,5,7,9
  const turtle = R.spread(80, R.contourWeights('turtle', 10));
  assert.deepStrictEqual(turtle.map((h) => Math.round(h * 100) / 100), [2.85, 5.72, 8.57, 11.43, 11.43, 11.43, 11.43, 8.57, 5.72, 2.85]);
});

test('rate tables A–E with effective dates, cost per use, material and cost resources; unknown rate ⇒ null cost', () => {
  const rates = [
    { resource_id: 1, rate_table: 'A', effective_from: '1984-01-01', standard_rate: 50, cost_per_use: 10, currency: 'USD' },
    { resource_id: 1, rate_table: 'A', effective_from: '2027-01-06', standard_rate: 60, currency: 'USD' },
    { resource_id: 1, rate_table: 'B', effective_from: '1984-01-01', standard_rate: 70, currency: 'USD' },
    { resource_id: 2, rate_table: 'A', effective_from: '1984-01-01', standard_rate: 3, cost_per_use: 5, currency: 'XOF' },
  ];
  assert.strictEqual(R.rateAt(rates, 1, 'A', '2027-01-05').standard_rate, 50);
  assert.strictEqual(R.rateAt(rates, 1, 'A', '2027-01-06').standard_rate, 60);
  assert.strictEqual(R.rateAt(rates, 1, 'C', '2027-01-06'), null);
  const cal = E.makeCalendar(null);
  const row = { id: 9, es_date: '2027-01-04', ef_date: '2027-01-06', duration_days: 3 };
  const tp = R.timephase({ task_id: 9, resource_id: 1, units_pct: 100 }, row, cal);
  assert.deepStrictEqual(tp.days, [{ day: '2027-01-04', hours: 8 }, { day: '2027-01-05', hours: 8 }, { day: '2027-01-06', hours: 8 }]);
  assert.strictEqual(tp.work_source, 'units');
  // Mon 50 × 8 + Tue 50 × 8 + Wed 60 × 8 + 10 per use = 1290
  assert.deepStrictEqual(R.assignmentCost({ resource_id: 1, rate_table: 'A' }, { kind: 'work' }, rates, tp, '2027-01-04'), { by_currency: { USD: 1290 }, unknown_reason: null });
  assert.deepStrictEqual(R.assignmentCost({ resource_id: 1, rate_table: 'B' }, { kind: 'work' }, rates, tp, '2027-01-04').by_currency, { USD: 1680 });
  assert.deepStrictEqual(R.assignmentCost({ resource_id: 1, rate_table: 'C' }, { kind: 'work' }, rates, tp, '2027-01-04'), { by_currency: null, unknown_reason: 'no rate in table C' });
  assert.deepStrictEqual(R.assignmentCost({ resource_id: 2, units_pct: 40, rate_table: 'A' }, { kind: 'material' }, rates, null, '2027-01-04').by_currency, { XOF: 125 });
  assert.deepStrictEqual(R.assignmentCost({ resource_id: 3, cost_amount: 900, cost_currency: 'EUR' }, { kind: 'cost' }, rates, null, '2027-01-04').by_currency, { EUR: 900 });
  assert.strictEqual(R.assignmentCost({ resource_id: 3 }, { kind: 'cost' }, rates, null, '2027-01-04').by_currency, null);
  // unknown work (no units, no work) ⇒ null hours, null cost — never 0
  const tp0 = R.timephase({ task_id: 9, resource_id: 1 }, row, cal);
  assert.strictEqual(tp0.work_hours, null);
  assert.strictEqual(R.assignmentCost({ resource_id: 1, rate_table: 'A' }, { kind: 'work' }, rates, tp0, '2027-01-04').by_currency, null);
});

const pool = [{ id: 9, name: 'Ana', kind: 'work', max_units_pct: 100 }];
const lv = (tasks, assignments, pri = {}, extra = {}) => R.level({ tasks, scheduleOpts: { anchor: '2027-01-04' }, assignments, resources: extra.resources || pool, calendarSpecOf: () => null, resourceCalendarOf: () => E.makeCalendar(null), priorityOf: (id) => pri[id], ...extra });

test('over-allocation detection and levelling (T6): priority wins, every move explained, links followed', () => {
  const tasks = [{ id: 1, name: 'A', duration_days: 2 }, { id: 2, name: 'B', duration_days: 3 }, { id: 3, name: 'C', duration_days: 1, depends_on: [2] }];
  const asg = [{ task_id: 1, resource_id: 9, units_pct: 100 }, { task_id: 2, resource_id: 9, units_pct: 100 }];
  const sched = E.schedule(tasks, { anchor: '2027-01-04' });
  const loads = R.resourceLoads({ schedule: sched, assignments: asg, resources: pool, calendarOf: () => E.makeCalendar(null), resourceCalendarOf: () => E.makeCalendar(null) });
  assert.deepStrictEqual(loads.overallocations.map((o) => [o.day, o.load_hours, o.capacity_hours, o.task_ids]), [['2027-01-04', 16, 8, [1, 2]], ['2027-01-05', 16, 8, [1, 2]]]);
  const out = lv(tasks, asg, { 1: 600, 2: 500 });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.delays, { 2: 2 });
  assert.strictEqual(out.moves.length, 1);
  const m = out.moves[0];
  assert.deepStrictEqual([m.task_id, m.from_start, m.to_start, m.to_finish, m.added_delay_days], [2, '2027-01-04', '2027-01-06', '2027-01-08', 2]);
  assert.strictEqual(m.reasons[0].rule, 'lower priority (500) than task #1 (600)');
  assert.deepStrictEqual([m.reasons[0].resource_name, m.reasons[0].day, m.reasons[0].load_hours, m.reasons[0].capacity_hours], ['Ana', '2027-01-04', 16, 8]);
  assert.deepStrictEqual(out.pushed, [{ task_id: 3, from_start: '2027-01-07', to_start: '2027-01-11', reason: 'a predecessor was delayed by levelling (links and constraints respected)' }]);
  assert.deepStrictEqual(out.remaining_overallocations, []);
  // same priority: the task with MORE float waits
  const tasks2 = [{ id: 1, duration_days: 2 }, { id: 2, duration_days: 2 }, { id: 3, duration_days: 4, depends_on: [1] }];
  const out2 = lv(tasks2, asg, {});
  assert.deepStrictEqual(out2.delays, { 2: 2 });
  assert.match(out2.moves[0].reasons[0].rule, /^same priority and start, more total float/);
});

test('levelling never moves a do-not-level, manual, started or MSO task; an impossible demand is reported, not moved', () => {
  const asg = [{ task_id: 1, resource_id: 9, units_pct: 100 }, { task_id: 2, resource_id: 9, units_pct: 100 }];
  const pin = lv([{ id: 1, duration_days: 2 }, { id: 2, duration_days: 2 }], asg, { 1: 1000, 2: 1000 });
  assert.deepStrictEqual(pin.delays, {});
  assert.strictEqual(pin.remaining_overallocations.length, 2);
  const started = lv([{ id: 1, duration_days: 2 }, { id: 2, duration_days: 2, progress_pct: 10 }], asg, { 1: 900, 2: 100 });
  assert.deepStrictEqual(started.delays, {});   // task 2 is started: kept; task 1 already placed first
  const big = lv([{ id: 1, duration_days: 2 }], [{ task_id: 1, resource_id: 9, units_pct: 150 }]);
  assert.deepStrictEqual(big.delays, {});
  assert.strictEqual(big.unresolved.length, 1);
  assert.match(big.unresolved[0].reason, /exceeds the resource's max units/);
  // an existing (stored) delay is kept unless clearExisting
  const kept = lv([{ id: 1, duration_days: 1, leveling_delay_days: 3 }], [{ task_id: 1, resource_id: 9, units_pct: 50 }]);
  assert.deepStrictEqual(kept.delays, {});
  const cleared = lv([{ id: 1, duration_days: 1, leveling_delay_days: 3 }], [{ task_id: 1, resource_id: 9, units_pct: 50 }], {}, { clearExisting: true });
  assert.deepStrictEqual(cleared.delays, { 1: 0 });
});

test('baseline slots: names, validation, payload (interim = dates only), variance, cost stripped', () => {
  assert.strictEqual(SL.slotName('baseline', 0), 'Baseline');
  assert.strictEqual(SL.slotName('baseline', 10), 'Baseline10');
  assert.strictEqual(SL.slotName('interim', 3), 'Interim3');
  assert.strictEqual(SL.slotProblem('baseline', 11), 'a baseline slot is 0 (Baseline) to 10 (Baseline10)');
  assert.strictEqual(SL.slotProblem('interim', 0), 'an interim plan slot is 1 to 10');
  assert.strictEqual(SL.slotProblem('other', 1), 'kind must be baseline | interim');
  assert.strictEqual(SL.slotProblem('baseline', 0), null);
  const s1 = E.schedule([{ id: 1, duration_days: 2, effort_hours: 16 }], { anchor: '2027-01-04' });
  const p = SL.slotPayload('baseline', s1, { tasks: [{ id: 1, name: 'A', effort_hours: 16 }], costByTask: { 1: { USD: 100 } } });
  assert.deepStrictEqual(p.tasks[0], { id: 1, name: 'A', wbs_code: null, summary: false, start: '2027-01-04', finish: '2027-01-05', duration_days: 2, work_hours: 16, cost: { USD: 100 } });
  assert.deepStrictEqual(Object.keys(SL.slotPayload('interim', s1, { tasks: [] }).tasks[0]), ['id', 'name', 'wbs_code', 'summary', 'start', 'finish']);
  const s2 = E.schedule([{ id: 1, duration_days: 4, effort_hours: 24 }], { anchor: '2027-01-05' });
  const v = SL.slotVariance(p, SL.slotPayload('baseline', s2, { tasks: [{ id: 1, effort_hours: 24 }] }));
  assert.deepStrictEqual(v.tasks[0], { id: 1, in_slot: true, in_current: true, start_variance_days: 1, finish_variance_days: 3, work_variance_hours: 8 });
  assert.strictEqual(v.project_finish_variance_days, 3);
  assert.strictEqual('cost' in SL.stripCost(p).tasks[0], false);
});
