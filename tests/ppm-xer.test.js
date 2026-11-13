'use strict';
// W4-CONNECTORS — Primavera P6 XER import / export (pure, fictitious fixture only): the tables map onto the plan model
// (WBS → summary tasks, activities, typed links with lags in days, constraints, priorities, calendars with exceptions),
// the round trip is a fixed point, the file re-schedules with the native engine, and hostile input is refused.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const X = require('../services/ppm/xer');
const M = require('../services/ppm/mspdi');
const E = require('../services/ppm/scheduleEngine');
const FIX = fs.readFileSync(path.join(__dirname, 'fixtures', 'ppm', 'fictitious-p6.xer'), 'utf8');

test('XER → model: WBS as summary tasks, activities, links, constraints, priorities, calendars', () => {
  const { model, warnings } = X.fromXer(FIX);
  assert.strictEqual(model.name, 'Fictitious P6 project');
  assert.strictEqual(model.start_date, '2027-01-04');
  assert.strictEqual(model.currency_code, 'USD');
  assert.strictEqual(model.calendar_uid, 10);
  assert.deepStrictEqual(model.tasks.map((t) => [t.wbs, t.outline_level, t.summary]), [
    ['A0010', 1, false], ['DES', 1, true], ['A1000', 2, false], ['A1010', 2, false], ['BLD', 1, true], ['A2010', 2, false], ['A9999', 2, false], ['BLD.SITE', 2, true], ['A2000', 3, false]]);
  const by = Object.fromEntries(model.tasks.map((t) => [t.wbs, t]));
  assert.strictEqual(by.A1000.duration_days, 5);
  assert.strictEqual(by.A2000.duration_days, 5, 'hours ÷ the activity calendar day length (10 h)');
  assert.strictEqual(by.A0010.milestone, true); assert.strictEqual(by.A0010.percent_complete, 100, 'TK_Complete without a % = 100');
  assert.strictEqual(by.A1000.percent_complete, 40);
  assert.strictEqual(by.A1000.priority, 700); assert.strictEqual(by.A2000.priority, 900); assert.strictEqual(by.A2010.priority, 300);
  assert.deepStrictEqual([by.A1010.constraint_type, by.A1010.constraint_date], ['SNET', '2027-01-11']);
  assert.deepStrictEqual([by.A2010.constraint_type, by.A2010.constraint_date], ['FNLT', '2027-02-26']);
  assert.deepStrictEqual(by.A1010.predecessors, [{ uid: by.A1000.uid, type: 'FS', lag: 1, lag_unit: 'd' }]);
  assert.deepStrictEqual(by.A2000.predecessors, [{ uid: by.A1010.uid, type: 'SS', lag: 0.4, lag_unit: 'd' }]);
  assert.ok(by.A2010.predecessors.some((p) => p.type === 'SF' && p.lag === -1));
  const cal = model.calendars.find((c) => c.uid === 10);
  assert.deepStrictEqual(cal.workdays, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(cal.exceptions, [{ from: '2027-01-11', to: '2027-01-12', working: false, name: null }, { from: '2027-01-15', to: '2027-01-15', working: true, name: null }]);
  assert.deepStrictEqual(model.calendars.find((c) => c.uid === 11).base_uid, 10);
  assert.ok(warnings.some((w) => w.code === 'CALENDAR_DAY_LENGTH'));
});

test('round trip: fromXer(toXer(m)) deep-equals m and toXer is a fixed point (golden)', () => {
  const { model } = X.fromXer(FIX);
  const a = X.toXer(model);
  const back = X.fromXer(a.xer).model;
  assert.deepStrictEqual(back, model);
  assert.strictEqual(X.toXer(back).xer, a.xer);
  assert.ok(/^ERMHDR\t/.test(a.xer) && a.xer.trimEnd().endsWith('%E'));
});

test('the imported plan schedules with the native engine (holidays of the file calendar respected)', () => {
  const { model } = X.fromXer(FIX);
  const { tasks, opts } = M.modelToEngine(model);
  const s = E.schedule(tasks, opts);
  assert.ok(s, 'no cycle');
  const row = (code) => s.tasks.find((t) => t.id === model.tasks.find((x) => x.wbs === code).uid);
  assert.strictEqual(row('A1000').es_date, '2027-01-04');
  assert.strictEqual(row('A1010').es_date, '2027-01-14', 'A1000 ends Fri 08; Mon 11 / Tue 12 are calendar holidays; the 1-day lag takes Wed 13');
});

test('export of an MSPDI-shaped model: resources / baselines / summary links are warned, not silently lost', () => {
  const m = M.normalizeModel({ name: 'x', start_date: '2027-01-04', tasks: [
    { uid: 1, name: 'S', outline_level: 1, summary: true, predecessors: [{ uid: 3 }] },
    { uid: 2, name: 'a', outline_level: 2, duration_days: 2, predecessors: [{ uid: 1 }], baselines: [{ number: 0, start: '2027-01-04' }] },
    { uid: 3, name: 'b', outline_level: 2, duration_days: 1, deadline: '2027-02-01', predecessors: [{ uid: 2, lag: 3, lag_unit: '%' }] }],
    resources: [{ uid: 1, name: 'R' }] });
  const { xer, warnings } = X.toXer(m);
  const codes = warnings.map((w) => w.code).sort();
  for (const c of ['BASELINES_NOT_CARRIED', 'DEADLINE_DROPPED', 'LAG_PERCENT_DROPPED', 'LINK_TO_SUMMARY_DROPPED', 'RESOURCES_NOT_CARRIED', 'SUMMARY_LINK_DROPPED']) assert.ok(codes.includes(c), c);
  const back = X.fromXer(xer).model;
  assert.deepStrictEqual(back.tasks.map((t) => [t.name, t.summary]), [['S', true], ['a', false], ['b', false]]);
  assert.strictEqual(back.tasks.find((t) => t.name === 'b').predecessors[0].lag, 0);
});

test('hostile / malformed input is refused with a clear error', () => {
  assert.throws(() => X.fromXer('<Project/>'), /not an XER file/);
  assert.throws(() => X.fromXer('ERMHDR\t19\n%R\tx\n'), /%R before/);
  assert.throws(() => X.fromXer('ERMHDR\t19\n%T\tTASK\n%F\ttask_id\n%E\n'), /no PROJECT/);
  const deep = 'ERMHDR\t19\n%T\tPROJECT\n%F\tproj_id\tclndr_id\n%R\t1\t1\n%T\tCALENDAR\n%F\tclndr_id\tclndr_data\n%R\t1\t' + '(0||a()('.repeat(40) + '\n%E\n';
  const r = X.fromXer(deep);
  assert.ok(r.warnings.some((w) => w.code === 'CALENDAR_DATA'));
});
