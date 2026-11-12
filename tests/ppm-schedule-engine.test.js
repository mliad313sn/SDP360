'use strict';
// W1-ENGINE — the date-based scheduling engine (services/ppm/scheduleEngine.js). Every expected date below was computed
// BY HAND on a Mon–Fri calendar (week of Mon 2027-01-04: 04 Mon 05 Tue 06 Wed 07 Thu 08 Fri, 11 Mon … 15 Fri, 18 Mon …).
const test = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/scheduleEngine');
const S = require('../services/projectSchedule');

const A0 = '2027-01-04';
const run = (tasks, opts = {}) => E.schedule(tasks, { anchor: A0, ...opts });
const by = (r) => Object.fromEntries(r.tasks.map((t) => [t.id, t]));
const span = (t) => [t.es_date, t.ef_date];

test('calendar: working-day arithmetic, holidays, working exceptions, elapsed', () => {
  const c = E.makeCalendar(null);
  const d = E.toDay;
  assert.strictEqual(c.countBetween(d('2027-01-04'), d('2027-01-10')), 5, 'Mon → Sun = 5 working days');
  assert.strictEqual(E.isoOf(c.dayOf(c.ord(d('2027-01-09')))), '2027-01-11', 'a Saturday start snaps to Monday');
  const h = E.makeCalendar({ holidays: ['2027-01-05'] });
  assert.strictEqual(h.countBetween(d('2027-01-04'), d('2027-01-08')), 4, 'the Tuesday holiday is not worked');
  const x = E.makeCalendar({ exceptions: [{ date: '2027-01-09', working: true }] });
  assert.strictEqual(x.countBetween(d('2027-01-04'), d('2027-01-10')), 6, 'a working Saturday counts');
  const el = E.makeCalendar({ elapsed: true });
  assert.strictEqual(el.countBetween(d('2027-01-04'), d('2027-01-10')), 7);
  const me = E.makeCalendar({ workdays: [7, 1, 2, 3, 4] });   // Sunday–Thursday week
  assert.strictEqual(me.isWork(d('2027-01-08')), false, 'Friday off');
  assert.strictEqual(me.isWork(d('2027-01-10')), true, 'Sunday worked');
});

test('forward/backward pass on dates: ES/EF/LS/LF, total and free float', () => {
  // A 3 d → C 2 d ; B 1 d → C. A Mon–Wed, B Mon, C Thu–Fri. B can slip 2 days.
  const r = run([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 1 }, { id: 3, duration_days: 2, depends_on: [1, 2] }]);
  const t = by(r);
  assert.deepStrictEqual(span(t[1]), ['2027-01-04', '2027-01-06']);
  assert.deepStrictEqual(span(t[3]), ['2027-01-07', '2027-01-08']);
  assert.deepStrictEqual([t[2].ls_date, t[2].lf_date, t[2].total_float, t[2].free_float], ['2027-01-06', '2027-01-06', 2, 2]);
  assert.deepStrictEqual([t[1].total_float, t[1].free_float, t[1].critical], [0, 0, true]);
  assert.deepStrictEqual(r.critical_path, [1, 3]);
  assert.strictEqual(r.project_finish, '2027-01-08');
  assert.strictEqual(r.length_days, 5);
});

test('weekends and holidays: a 2-day task from a Friday finishes Monday, its successor starts Tuesday (R4)', () => {
  const t = by(E.schedule([{ id: 1, start_date: '2026-11-13', duration_days: 2 }, { id: 2, depends_on: [1], duration_days: 1 }], {}));
  assert.deepStrictEqual(span(t[1]), ['2026-11-13', '2026-11-16']);
  assert.deepStrictEqual(span(t[2]), ['2026-11-17', '2026-11-17']);
  const h = by(run([{ id: 1, duration_days: 3 }], { calendar: { holidays: ['2027-01-05'] } }));
  assert.deepStrictEqual(span(h[1]), ['2027-01-04', '2027-01-07'], 'Mon, (Tue holiday), Wed, Thu');
  const el = by(run([{ id: 1, start_date: '2027-01-08', duration_days: 3, elapsed: true }, { id: 2, depends_on: [1], duration_days: 1 }]));
  assert.deepStrictEqual(span(el[1]), ['2027-01-08', '2027-01-10'], 'an elapsed task runs Fri, Sat, Sun');
  assert.deepStrictEqual(span(el[2]), ['2027-01-11', '2027-01-11'], 'its working-calendar successor starts Monday');
});

test('link types FS / SS / FF / SF with lag and lead (working days)', () => {
  const two = (link) => by(run([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 2, depends_on: [1], dependency_links: [{ id: 1, ...link }] }]))[2];
  assert.deepStrictEqual(span(two({ type: 'FS', lag: 2 })), ['2027-01-11', '2027-01-12'], 'FS+2: Thu, Fri skipped → Mon');
  assert.deepStrictEqual(span(two({ type: 'FS', lag: -1 })), ['2027-01-06', '2027-01-07'], 'FS−1 (lead): overlaps Wed');
  assert.deepStrictEqual(span(two({ type: 'SS', lag: 1 })), ['2027-01-05', '2027-01-06'], 'SS+1');
  assert.deepStrictEqual(span(two({ type: 'FF', lag: 0 })), ['2027-01-05', '2027-01-06'], 'FF: finishes with A on Wed');
  assert.deepStrictEqual(span(two({ type: 'SF', lag: 4 })), ['2027-01-06', '2027-01-07'], 'SF+4: finish ≥ A start + 4');
  assert.deepStrictEqual(span(two({ type: 'SF', lag: 0 })), ['2027-01-04', '2027-01-05'], 'SF+0 cannot start before the project');
  // a link object as a JSON string (as stored) works the same
  const j = by(run([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 2, depends_on: [1], dependency_links: JSON.stringify([{ id: 1, type: 'SS', lag: 1 }]) }]))[2];
  assert.deepStrictEqual(span(j), ['2027-01-05', '2027-01-06']);
  // backward pass through an SS link: A 3 d, B SS+1 2 d, C 5 d parallel → project 5 d (Mon–Fri)
  const r = by(run([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 2, depends_on: [1], dependency_links: [{ id: 1, type: 'SS', lag: 1 }] }, { id: 3, duration_days: 5 }]));
  assert.strictEqual(r[2].total_float, 2, 'B may finish Fri: LS Thu − ES Tue = 2');
  assert.strictEqual(r[1].total_float, 2, 'A: B.LS − 1 bounds A.LS (Wed) − Mon = 2');
});

test('negative float: project deadline and task deadline breached', () => {
  const tasks = [{ id: 1, duration_days: 5 }, { id: 2, duration_days: 5, depends_on: [1] }];
  const p = by(run(tasks, { deadline: '2027-01-13' }));     // finishes Fri 15, deadline Wed 13
  assert.deepStrictEqual([p[1].total_float, p[2].total_float, p[2].negative_float, p[2].critical], [-2, -2, true, true]);
  const later = by(run(tasks, { deadline: '2027-02-26' }));
  assert.strictEqual(later[2].total_float, 0, 'a later deadline does not create float');
  const d = by(run([{ id: 1, duration_days: 5, deadline: '2027-01-06' }, { id: 2, duration_days: 5, depends_on: [1] }]));
  assert.deepStrictEqual([d[1].total_float, d[2].total_float], [-2, 0], 'task 1 must finish Wed, ends Fri');
});

test('constraints: SNET (entered start on an auto task), FNET, MSO, MFO, SNLT, FNLT, ALAP', () => {
  const snet = by(run([{ id: 1, duration_days: 5 }, { id: 2, duration_days: 1, depends_on: [1], start_date: '2027-01-13' }]))[2];
  assert.deepStrictEqual([...span(snet), snet.driver.type], ['2027-01-13', '2027-01-13', 'entered_start']);
  const pushed = by(run([{ id: 1, duration_days: 5 }, { id: 2, duration_days: 1, depends_on: [1], start_date: '2027-01-05' }]))[2];
  assert.deepStrictEqual([...span(pushed), pushed.driver.type, pushed.computed], ['2027-01-11', '2027-01-11', 'link', true], 'a predecessor pushes an auto task past its entered start');
  const fnet = by(run([{ id: 1, duration_days: 2, constraint_type: 'FNET', constraint_date: '2027-01-08' }]))[1];
  assert.deepStrictEqual(span(fnet), ['2027-01-07', '2027-01-08']);
  const mfo = by(run([{ id: 1, duration_days: 5 }, { id: 2, duration_days: 5, depends_on: [1], constraint_type: 'MFO', constraint_date: '2027-01-22' }]));
  assert.deepStrictEqual([...span(mfo[2]), mfo[1].total_float, mfo[2].total_float], ['2027-01-18', '2027-01-22', 5, 0]);
  const mso = run([{ id: 1, duration_days: 5 }, { id: 2, duration_days: 5, depends_on: [1], constraint_type: 'MSO', constraint_date: '2027-01-06' }]);
  const m = by(mso);
  assert.deepStrictEqual(span(m[2]), ['2027-01-06', '2027-01-12'], 'a must-start-on holds against its predecessor');
  assert.strictEqual(m[1].total_float, -3, 'the predecessor must finish before Wed: 3 days late');
  assert.ok(mso.warnings.some((w) => w.code === 'LINK_VIOLATED' && w.task_id === 2));
  const snlt = by(run([{ id: 1, duration_days: 3, constraint_type: 'SNLT', constraint_date: A0 }, { id: 2, duration_days: 10 }]))[1];
  assert.strictEqual(snlt.total_float, 0, 'start-no-later-than Mon removes its 7 days of float');
  const fnlt = by(run([{ id: 1, duration_days: 3, constraint_type: 'FNLT', constraint_date: '2027-01-05' }, { id: 2, duration_days: 10 }]))[1];
  assert.strictEqual(fnlt.total_float, -1, 'must finish by Tue, needs Wed');
  const alap = by(run([{ id: 1, duration_days: 2, constraint_type: 'ALAP' }, { id: 2, duration_days: 1, depends_on: [1] }, { id: 3, duration_days: 6 }]));
  assert.deepStrictEqual(span(alap[1]), ['2027-01-07', '2027-01-08'], 'as late as possible: Thu–Fri');
  assert.deepStrictEqual(span(alap[2]), ['2027-01-11', '2027-01-11'], 'its successor follows the late dates');
  const bad = run([{ id: 1, duration_days: 2, constraint_type: 'MSO' }]);
  assert.ok(bad.warnings.some((w) => w.code === 'CONSTRAINT_NO_DATE'));
});

test('manual vs auto: a manual task keeps its entered dates even when a predecessor ends later', () => {
  const r = run([{ id: 1, duration_days: 5 }, { id: 2, schedule_mode: 'manual', start_date: '2027-01-05', end_date: '2027-01-06', depends_on: [1] }]);
  const t = by(r);
  assert.deepStrictEqual([...span(t[2]), t[2].mode, t[2].computed], ['2027-01-05', '2027-01-06', 'manual', false]);
  assert.ok(r.warnings.some((w) => w.code === 'LINK_VIOLATED' && w.task_id === 2));
  const sat = by(run([{ id: 1, schedule_mode: 'manual', start_date: '2027-01-09', end_date: '2027-01-10' }]))[1];
  assert.deepStrictEqual(span(sat), ['2027-01-09', '2027-01-10'], 'manual dates are not snapped to working days');
  const act = by(run([{ id: 1, duration_days: 5, actual_start: '2027-01-05', actual_end: '2027-01-12' }, { id: 2, duration_days: 1, depends_on: [1] }]));
  assert.deepStrictEqual([...span(act[1]), act[1].driver.type], ['2027-01-05', '2027-01-12', 'actual']);
  assert.deepStrictEqual(span(act[2]), ['2027-01-13', '2027-01-13'], 'successors follow the actual finish');
  const st = by(run([{ id: 1, duration_days: 2 }, { id: 2, duration_days: 2, progress_pct: 50 }], { statusDate: '2027-01-11' }));
  assert.deepStrictEqual([span(st[1]), span(st[2])], [['2027-01-11', '2027-01-12'], ['2027-01-04', '2027-01-05']], 'with a status date, unstarted work moves after it');
});

test('summary tasks: dates and work roll up, links to / from a summary, R2 regression', () => {
  // R2 — parent 10 (30 d entered) with children 11 (2 d) → 12 (3 d): the parent is NOT a scheduled node
  const r2 = run([{ id: 10, duration_days: 30 }, { id: 11, parent_id: 10, duration_days: 2 }, { id: 12, parent_id: 10, duration_days: 3, depends_on: [11] }]);
  const t2 = by(r2);
  assert.deepStrictEqual(r2.critical_path, [11, 12]);
  assert.deepStrictEqual([t2[10].summary, ...span(t2[10]), t2[10].duration_days], [true, '2027-01-04', '2027-01-08', 5]);
  assert.deepStrictEqual([t2[11].total_float, t2[12].total_float], [0, 0]);
  assert.ok(r2.warnings.some((w) => w.code === 'SUMMARY_DURATION_IGNORED' && w.task_id === 10));
  // X 3 d → summary S {c1 2 d → c2 2 d} → Y 1 d
  const r = run([
    { id: 1, duration_days: 3 },
    { id: 5, depends_on: [1], effort_hours: 50 },
    { id: 6, parent_id: 5, duration_days: 2, effort_hours: 10, progress_pct: 50 },
    { id: 7, parent_id: 5, duration_days: 2, effort_hours: 30, progress_pct: 0, depends_on: [6] },
    { id: 8, duration_days: 1, depends_on: [5] },
  ]);
  const t = by(r);
  assert.deepStrictEqual(span(t[6]), ['2027-01-07', '2027-01-08'], 'a link to the summary moves its children');
  assert.deepStrictEqual(span(t[5]), ['2027-01-07', '2027-01-12']);
  assert.deepStrictEqual(span(t[8]), ['2027-01-13', '2027-01-13'], 'a link from the summary waits for its last child');
  assert.deepStrictEqual(r.critical_path, [1, 6, 7, 8]);
  assert.deepStrictEqual([t[5].rollup.work_hours, t[5].rollup.progress_pct, t[5].rollup.progress_basis], [40, 12.5, 'work']);
  assert.ok(r.warnings.some((w) => w.code === 'WBS_100_RULE' && w.task_id === 5), '10 + 30 h ≠ 50 h');
  // a link between a child and its own parent is ignored (the hierarchy orders them), not a cycle
  const self = run([{ id: 1 }, { id: 2, parent_id: 1, duration_days: 2, depends_on: [1] }]);
  assert.ok(self && self.warnings.some((w) => w.code === 'LINK_HIERARCHY_IGNORED'));
});

test('work-weighted % complete: unknown child % ⇒ null, never 0; duration fallback', () => {
  assert.deepStrictEqual(E.rollupProgress([{ effort_hours: 10, progress_pct: 100 }, { effort_hours: 30, progress_pct: 0 }]), { progress_pct: 25, basis: 'work' });
  assert.deepStrictEqual(E.rollupProgress([{ effort_hours: 10, progress_pct: 100 }, { effort_hours: 30, progress_pct: null }]), { progress_pct: null, basis: 'unknown_child' });
  assert.deepStrictEqual(E.rollupProgress([{ progress_pct: 100, _duration: 1 }, { progress_pct: 0, _duration: 3 }]), { progress_pct: 25, basis: 'duration' });
  assert.deepStrictEqual(E.rollupProgress([{ progress_pct: 100 }, { progress_pct: 0 }]), { progress_pct: null, basis: 'unknown_weight' });
});

test('0-day milestones stay 0 days (R5) and sit at the end of their predecessor', () => {
  const r = run([{ id: 1, duration_days: 3 }, { id: 2, duration_days: 0, depends_on: [1] }, { id: 3, duration_days: 1, depends_on: [2] }]);
  const t = by(r);
  assert.deepStrictEqual([t[2].milestone, t[2].duration_days, t[2].assumed_duration, t[2].ef - t[2].es], [true, 0, false, 0]);
  assert.deepStrictEqual(span(t[2]), ['2027-01-06', '2027-01-06'], 'the milestone is dated when its predecessor finishes');
  assert.deepStrictEqual(span(t[3]), ['2027-01-07', '2027-01-07']);
  const start = by(run([{ id: 1, duration_days: 0 }]))[1];
  assert.deepStrictEqual(span(start), [A0, A0], 'a milestone with no predecessor sits on the project start');
  const sv = S.scheduleView([{ id: 1, duration_days: 0 }], { anchor: A0 }).tasks[0];
  assert.deepStrictEqual([sv.duration_days, sv.assumed_duration, sv.ef - sv.es], [0, false, 0], 'R5 through scheduleView');
});

test('critical = total float ≤ 0 and near-critical threshold; same flags in criticalPath and scheduleView', () => {
  const tasks = [{ id: 1, duration_days: 3 }, { id: 2, duration_days: 1 }, { id: 3, duration_days: 2, depends_on: [1, 2] }];
  const r = by(run(tasks, { nearCriticalDays: 2 }));
  assert.deepStrictEqual([r[2].critical, r[2].near_critical], [false, true]);
  const v = S.scheduleView(tasks, { anchor: A0 }), cp = S.criticalPath(tasks, { anchor: A0 });
  assert.deepStrictEqual(v.tasks.filter((x) => x.critical).map((x) => x.id), cp.path);
  // two parallel critical chains are both reported
  const two = run([{ id: 1, duration_days: 2 }, { id: 2, duration_days: 2 }]);
  assert.deepStrictEqual(two.critical_path, [1, 2]);
  assert.strictEqual(run([{ id: 1, depends_on: [2] }, { id: 2, depends_on: [1] }]), null, 'a cycle cannot be scheduled');
});

test('R1 regression: entered dates drive the critical path; grid and Gantt read one date set', () => {
  // task 1 Thu 01-01 → Sat 01-10, task 2 Sun 03-01 → Thu 03-05, no dependency: the project ends with task 2
  const v = S.scheduleView([{ id: 1, start_date: '2026-01-01', end_date: '2026-01-10' }, { id: 2, start_date: '2026-03-01', end_date: '2026-03-05' }], { anchor: '2026-01-01' });
  const t = by(v);
  assert.strictEqual(t[2].es_date, '2026-03-02', 'task 2 starts in March (Sunday entered → Monday), not on day 0');
  assert.strictEqual(t[2].ef_date, '2026-03-05');
  assert.strictEqual(t[2].critical, true);
  assert.strictEqual(t[1].critical, false, 'task 1 ends in January: it is not critical');
  assert.deepStrictEqual(v.critical_path, [2]);
  assert.strictEqual(v.project_finish, '2026-03-05');
});

test('task types × effort-driven: W = D × U × 8 h kept (3 × 2 matrix + single-field edits)', () => {
  const base = { duration_days: 5, allocation_pct: 100, effort_hours: 40 };
  const R = (type, ed, patch, changed) => E.recalc({ ...base, task_type: type, effort_driven: ed, ...patch }, changed);
  // fixed units
  assert.strictEqual(R('fixed_units', 1, { duration_days: 10 }, 'duration').effort_hours, 80);
  assert.strictEqual(R('fixed_units', 1, { effort_hours: 80 }, 'work').duration_days, 10);
  assert.strictEqual(R('fixed_units', 1, { allocation_pct: 50 }, 'units').duration_days, 10);
  assert.strictEqual(R('fixed_units', 1, { allocation_pct: 200 }, 'resources').duration_days, 2.5, 'effort-driven: work kept, duration shrinks');
  assert.strictEqual(R('fixed_units', 0, { allocation_pct: 200 }, 'resources').effort_hours, 80, 'not effort-driven: duration kept, work grows');
  // fixed duration
  assert.strictEqual(R('fixed_duration', 1, { duration_days: 10 }, 'duration').effort_hours, 80);
  assert.strictEqual(R('fixed_duration', 1, { effort_hours: 80 }, 'work').allocation_pct, 200);
  assert.strictEqual(R('fixed_duration', 1, { allocation_pct: 50 }, 'units').effort_hours, 20);
  assert.strictEqual(R('fixed_duration', 1, { allocation_pct: 200 }, 'resources').allocation_pct, 100, 'effort-driven: W and D kept, units spread back');
  assert.strictEqual(R('fixed_duration', 0, { allocation_pct: 200 }, 'resources').effort_hours, 80);
  // fixed work (always effort-driven)
  assert.strictEqual(R('fixed_work', 1, { duration_days: 10 }, 'duration').allocation_pct, 50);
  assert.strictEqual(R('fixed_work', 1, { effort_hours: 80 }, 'work').duration_days, 10);
  assert.strictEqual(R('fixed_work', 1, { allocation_pct: 50 }, 'units').duration_days, 10);
  assert.strictEqual(R('fixed_work', 0, { allocation_pct: 200 }, 'resources').duration_days, 2.5, 'fixed work ignores effort-driven OFF');
  for (const type of E.TASK_TYPES) for (const ed of [0, 1]) for (const ch of ['duration', 'work', 'units', 'resources']) {
    const out = R(type, ed, ch === 'duration' ? { duration_days: 8 } : ch === 'work' ? { effort_hours: 24 } : { allocation_pct: 50 }, ch);
    assert.strictEqual(E.workInvariant(out), true, `${type} ed=${ed} ${ch} keeps W = D × U`);
  }
  assert.ok(E.recalc({ task_type: 'fixed_units', duration_days: 5 }, 'duration').problem, 'unknown units: nothing invented');
  // a task with a type and no duration gets its duration from work: 40 h at 50 % = 10 days
  const t = by(run([{ id: 1, task_type: 'fixed_work', effort_hours: 40, allocation_pct: 50 }]))[1];
  assert.deepStrictEqual([t.duration_days, t.duration_source, ...span(t)], [10, 'work', '2027-01-04', '2027-01-15']);
});

test('benchmark: 10 000 tasks fully rescheduled in under 1 s', () => {
  const tasks = [];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 1; i <= 10000; i++) {
    const deps = [];
    if (i > 1) { deps.push(i - 1 - Math.floor(rnd() * Math.min(i - 1, 40))); if (i > 50 && rnd() < 0.5) deps.push(i - 1 - Math.floor(rnd() * 49)); }
    tasks.push({ id: i, duration_days: 1 + Math.floor(rnd() * 5), depends_on: [...new Set(deps)], parent_id: (i - 1) % 100 === 0 ? null : i - ((i - 1) % 100) });   // 100 summaries of 99 children
  }
  E.schedule(tasks.slice(0, 50), { anchor: A0 });   // warm the calendar
  const t0 = process.hrtime.bigint();
  const r = E.schedule(tasks, { anchor: A0 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(r, 'scheduled');
  assert.strictEqual(r.tasks.length, 10000);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});
