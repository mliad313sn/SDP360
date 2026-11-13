'use strict';
// W2-UI — the pure half of the interactive Gantt v2 (public/lib/ganttCore.js): working-day maths, zoom scales,
// layout + virtual window, drag → dates, link creation rules (server refusal codes), inline editing, undo / redo,
// companion views, and the layout timing on 1,000 / 5,000 tasks.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../public/lib/ganttCore');

const cal = G.makeCal();
test('working days: Mon–Fri default, add / count / snap, holidays honoured', () => {
  const mon = G.toDay('2026-11-09');                      // a Monday
  assert.equal(G.isoWeekday(mon), 1);
  assert.equal(G.fromDay(cal.add(mon, 4)), '2026-11-13'); // Friday
  assert.equal(G.fromDay(cal.add(mon, 5)), '2026-11-16'); // next Monday, weekend skipped
  assert.equal(G.fromDay(cal.add(mon, -1)), '2026-11-06');
  assert.equal(cal.count(mon, G.toDay('2026-11-15')), 5);
  assert.equal(G.fromDay(cal.snapForward(G.toDay('2026-11-14'))), '2026-11-16');
  assert.equal(G.fromDay(cal.snapBack(G.toDay('2026-11-15'))), '2026-11-13');
  const h = G.makeCal({ holidays: ['2026-11-11'] });
  assert.equal(G.fromDay(h.add(mon, 4)), '2026-11-16');
  assert.equal(h.count(mon, G.toDay('2026-11-13')), 4);
  // long span path agrees with the day-by-day path
  const a = G.toDay('2020-01-01'), b = G.toDay('2035-06-30');
  let slow = 0; for (let d = a; d <= b; d++) if (h.isWork(d)) slow++;
  assert.equal(h.count(a, b), slow);
  assert.equal(G.toDay('2026-02-30'), null, 'not a calendar date');
});

test('zoom scales: day → week → month → quarter, clamped at the ends; ticks cover the span', () => {
  assert.deepEqual(G.ZOOMS, ['day', 'week', 'month', 'quarter']);
  assert.equal(G.zoom('day', -1), 'day'); assert.equal(G.zoom('day', 1), 'week'); assert.equal(G.zoom('quarter', 1), 'quarter');
  assert.ok(G.SCALES.day.pxPerDay > G.SCALES.week.pxPerDay && G.SCALES.week.pxPerDay > G.SCALES.month.pxPerDay && G.SCALES.month.pxPerDay > G.SCALES.quarter.pxPerDay);
  const t = G.ticks('month', G.toDay('2026-01-15'), G.toDay('2026-06-10'));
  assert.deepEqual(t.minor.map((x) => x.label), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
  assert.deepEqual(t.major.map((x) => x.label), ['Q1 2026', 'Q2 2026']);
  const w = G.ticks('week', G.toDay('2026-11-11'), G.toDay('2026-11-20'));
  assert.equal(G.fromDay(w.minor[0].day), '2026-11-09', 'weeks start on Monday');
  const fr = G.ticks('month', G.toDay('2026-01-01'), G.toDay('2026-01-31'), { months: ['janv.'] });
  assert.equal(fr.minor[0].label, 'janv.');
});

const TASKS = [
  { id: 1, name: 'A', wbs_code: '1', start_date: '2026-11-09', end_date: '2026-11-13', duration_days: 5, progress_pct: 50, baseline_start: '2026-11-02', baseline_end: '2026-11-06', depends_on: [], version: 3 },
  { id: 2, name: 'B', wbs_code: '2', start_date: '2026-11-16', end_date: '2026-11-17', duration_days: 2, depends_on: [1], dependency_links: [{ id: 1, type: 'SS', lag: 2 }], version: 1 },
  { id: 3, name: 'M', wbs_code: '3', start_date: '2026-11-18', end_date: '2026-11-18', duration_days: 0, depends_on: [2], parent_id: null },
  { id: 4, name: 'child', parent_id: 1, depends_on: [] },
];
const PLAN = { tasks: [{ id: 1, es_date: '2026-11-09', ef_date: '2026-11-13', critical: true }, { id: 2, es_date: '2026-11-16', ef_date: '2026-11-17', computed: true }, { id: 3, es_date: '2026-11-18', ef_date: '2026-11-18', milestone: true }, { id: 4 }] };

test('rowsFrom + layout: scheduled dates drive bars; baseline, milestone, progress, critical, today; null dates draw nothing', () => {
  const rows = G.rowsFrom(TASKS, PLAN);
  assert.equal(rows[1].preds[0].type, 'SS'); assert.equal(rows[1].preds[0].lag, 2);
  assert.equal(rows[3].start, null, 'a task the engine did not date is not drawn (no invented date)');
  const L = G.layout(rows, { scale: 'day', rowH: 20, today: '2026-11-12' });
  const a = L.bars[0];
  assert.equal(a.x1 - a.x0, 5 * 30); assert.equal(a.progressW, 75); assert.equal(a.critical, true);
  assert.equal(a.baseline.x1 - a.baseline.x0, 5 * 30);
  assert.equal(L.bars[2].milestone, true); assert.equal(L.bars[2].x0, L.bars[2].x1);
  assert.equal(L.bars[3].x0, null);
  assert.equal(L.bars[1].y, 20); assert.equal(L.height, 80);
  assert.ok(L.todayX > a.x0 && L.todayX < a.x1);
  assert.equal(G.fromDay(L.xToDay(a.x0 + 1)), '2026-11-09');
  const p = G.linkPath(L, { from: 1, to: 2, type: 'FS' });
  assert.match(p, /^M\d/);
  assert.equal(G.linkPath(L, { from: 1, to: 4, type: 'FS' }), null);
  assert.equal(G.links(rows).length, 2);
});

test('visibleWindow: only the rows in view + overscan, spacers keep the scroll height', () => {
  const w = G.visibleWindow({ scrollTop: 2600, viewport: 520, rowH: 26, count: 5000, overscan: 5 });
  assert.equal(w.start, 95); assert.equal(w.end, 126);
  assert.equal(w.top + (w.end - w.start) * 26 + w.bottom, 5000 * 26);
  assert.deepEqual(G.visibleWindow({ scrollTop: 0, viewport: 100, rowH: 26, count: 0 }), { start: 0, end: 0, top: 0, bottom: 0 });
});

test('dragDates: move keeps the working-day duration; resize moves the end; weekends snapped; milestones do not resize', () => {
  const bar = { start: '2026-11-09', end: '2026-11-13', milestone: false };
  assert.equal(G.dragDates(bar, 10, 'day', 'move', cal), null, 'less than half a day = no change');
  assert.deepEqual(G.dragDates(bar, 30 * 5, 'day', 'move', cal), { start_date: '2026-11-16', end_date: '2026-11-20', duration_days: 5 });
  assert.deepEqual(G.dragDates(bar, 30 * 2, 'day', 'move', cal), { start_date: '2026-11-11', end_date: '2026-11-17', duration_days: 5 }, 'spans a weekend');
  assert.deepEqual(G.dragDates(bar, 30 * 5, 'day', 'move', cal).duration_days, 5);
  assert.equal(G.dragDates(bar, -30 * 2, 'day', 'move', cal).start_date, '2026-11-06', 'left onto Saturday snaps back to Friday');
  assert.deepEqual(G.dragDates(bar, 30, 'day', 'resize', cal), { start_date: '2026-11-09', end_date: '2026-11-16', duration_days: 6 }, 'Sat → Mon');
  assert.deepEqual(G.dragDates(bar, -30 * 10, 'day', 'resize', cal), { start_date: '2026-11-09', end_date: '2026-11-09', duration_days: 1 });
  assert.equal(G.dragDates({ start: '2026-11-18', end: '2026-11-18', milestone: true }, 60, 'day', 'resize', cal), null);
  assert.deepEqual(G.dragDates({ start: '2026-11-18', end: '2026-11-18', milestone: true }, 30, 'day', 'move', cal), { start_date: '2026-11-19', end_date: '2026-11-19', duration_days: 0 });
  assert.equal(G.dragDates(bar, 70, 'week', 'move', cal).start_date, '2026-11-16', '7 days at week zoom');
});

test('canLink: same refusal codes as the server — self, missing, duplicate, hierarchy, cycle; linkPatch FS / typed', () => {
  assert.equal(G.canLink(TASKS, 1, 1).code, 'DEP_SELF');
  assert.equal(G.canLink(TASKS, 1, 99).code, 'DEP_MISSING');
  assert.equal(G.canLink(TASKS, 1, 2).code, 'DEP_DUPLICATE');
  assert.equal(G.canLink(TASKS, 1, 4).code, 'DEPENDS_ON_HIERARCHY');
  assert.equal(G.canLink(TASKS, 3, 1).code, 'DEP_CYCLE');
  assert.equal(G.canLink(TASKS, 4, 3).ok, true);
  assert.deepEqual(G.linkPatch(TASKS[2], 4, 'FS', 0, { typed: false }), { depends_on: [2, 4] });
  assert.equal(G.linkPatch(TASKS[2], 4, 'SS', 0, { typed: false }), null, 'without typed links only FS');
  assert.deepEqual(G.linkPatch(TASKS[1], 4, 'FF', -1, { typed: true }), { depends_on: [1, 4], dependency_links: [{ id: 1, type: 'SS', lag: 2 }, { id: 4, type: 'FF', lag: -1 }] });
});

test('inline editing: name, duration, start, predecessors, % complete — validation codes, no-op returns null', () => {
  const t = TASKS[0];
  assert.equal(G.editCell(t, 'name', '  ').error, 'NAME_REQUIRED');
  assert.deepEqual(G.editCell(t, 'name', 'A2').patch, { name: 'A2' });
  assert.equal(G.editCell(t, 'name', 'A').patch, null);
  assert.deepEqual(G.editCell(t, 'duration', '3').patch, { duration_days: 3, end_date: '2026-11-11' });
  assert.deepEqual(G.editCell(t, 'duration', '0').patch, { duration_days: 0, end_date: '2026-11-09' });
  assert.equal(G.editCell(t, 'duration', '-1').error, 'DURATION_INVALID');
  assert.equal(G.editCell(t, 'duration', '1.5').error, 'DURATION_INVALID');
  assert.deepEqual(G.editCell(t, 'start', '2026-11-14').patch, { start_date: '2026-11-16', end_date: '2026-11-20' }, 'Saturday snaps to Monday, duration kept');
  assert.equal(G.editCell(t, 'start', '2026-13-01').error, 'DATE_INVALID');
  assert.deepEqual(G.editCell(t, 'progress', '80').patch, { progress_pct: 80 });
  assert.equal(G.editCell(t, 'progress', '101').error, 'PROGRESS_INVALID');
  assert.deepEqual(G.editCell(t, 'progress', '').patch, { progress_pct: null }, 'empty = unknown, never 0');
  assert.equal(G.formatPredecessors(TASKS[1]), '1SS+2');
  assert.equal(G.editCell(TASKS[1], 'predecessors', '1SS+2', { typed: true }).patch, null);
  assert.equal(G.editCell(TASKS[2], 'predecessors', '2SS', { typed: false }).error, 'PRED_INVALID');
  assert.deepEqual(G.editCell(TASKS[2], 'predecessors', '2, 4', { typed: false, tasks: TASKS }).patch, { depends_on: [2, 4] });
  assert.equal(G.editCell(TASKS[0], 'predecessors', '3', { tasks: TASKS }).error, 'DEP_CYCLE');
  assert.equal(G.editCell(TASKS[0], 'predecessors', '1').error, 'DEP_SELF');
  assert.equal(G.editCell(TASKS[0], 'predecessors', '2,2').error, 'DEP_DUPLICATE');
  assert.equal(G.editCell(TASKS[0], 'owner', 'x').error, 'FIELD_NOT_EDITABLE');
});

test('undo / redo: commands carry the inverse; a new command clears redo; a failed replay is dropped; bounded', () => {
  const h = G.createHistory(3);
  const c1 = G.command('move', TASKS[0], { start_date: '2026-11-16', end_date: '2026-11-20' });
  assert.deepEqual(c1.backward[0].fields, { start_date: '2026-11-09', end_date: '2026-11-13' });
  const c2 = G.command('link', TASKS[2], { depends_on: [2, 4] });
  assert.deepEqual(c2.backward[0].fields, { depends_on: [2] });
  h.push(c1); h.push(c2);
  assert.equal(h.undo(), c2); assert.equal(h.canRedo(), true);
  assert.equal(h.redo(), c2); assert.equal(h.undo(), c2);
  h.push(c1); assert.equal(h.canRedo(), false, 'new command clears redo');
  h.drop(c1); assert.equal(h.size().undo, 1);
  for (let i = 0; i < 5; i++) h.push(G.command('x', TASKS[0], { name: 'n' + i }));
  assert.equal(h.size().undo, 3);
  assert.equal(G.createHistory().undo(), null);
});

test('companion views: task / resource usage spread effort on working days (unknown never 0), graph peaks, network ranks', () => {
  const tasks = [
    { id: 1, name: 'A', owner: 'Ana', start_date: '2026-11-09', end_date: '2026-11-13', effort_hours: 40, allocation_pct: 60, depends_on: [] },
    { id: 2, name: 'B', owner: 'ana ', start_date: '2026-11-12', end_date: '2026-11-18', effort_hours: null, allocation_pct: 60, depends_on: [1] },
    { id: 3, name: 'C', owner: null, start_date: '2026-11-16', end_date: '2026-11-16', effort_hours: 8, allocation_pct: null, depends_on: [1, 2] },
  ];
  const rows = G.rowsFrom(tasks, null);
  const ps = G.periods('week', '2026-11-09', '2026-11-22');
  assert.equal(ps.length, 2);
  const tu = G.taskUsage(rows, tasks, { periods: ps });
  assert.deepEqual(tu[0].cells, [40, 0]); assert.equal(tu[1].unknown, true); assert.deepEqual(tu[1].cells, [null, null]);
  const ru = G.resourceUsage(rows, tasks, { periods: ps });
  assert.equal(ru[0].owner, 'Ana'); assert.deepEqual(ru[0].cells, [40, 0]); assert.equal(ru[0].unknown_tasks, 1);
  assert.equal(ru[ru.length - 1].unassigned, true);
  const rg = G.resourceGraph(rows, tasks, { periods: ps });
  assert.equal(rg[0].cells[0].peak_pct, 120); assert.equal(rg[0].cells[0].over, true);
  assert.equal(rg[1].cells[1].peak_pct, null, 'no allocation known → null, not 0'); assert.equal(rg[1].cells[1].unknown, 1);
  const net = G.networkLayout(rows);
  assert.deepEqual(net.nodes.map((n) => n.col), [0, 1, 2]); assert.equal(net.edges.length, 3); assert.equal(net.cyclic, false);
});

function bigPlan(n) {
  const tasks = [], plan = { tasks: [] }, base = G.toDay('2026-01-05');
  for (let i = 1; i <= n; i++) {
    const s = cal.add(base, (i * 3) % 400), e = cal.add(s, i % 7);
    tasks.push({ id: i, name: 'Task ' + i, wbs_code: String(i), depends_on: i > 1 ? [i - 1] : [], duration_days: (i % 7) + 1, progress_pct: i % 100, baseline_start: G.fromDay(s), baseline_end: G.fromDay(e) });
    plan.tasks.push({ id: i, es_date: G.fromDay(s), ef_date: G.fromDay(e), critical: i % 5 === 0 });
  }
  return { tasks, plan };
}
for (const n of [1000, 5000]) {
  test(`performance: rowsFrom + layout + window + visible links on ${n} tasks stay within budget`, () => {
    const { tasks, plan } = bigPlan(n);
    const t0 = process.hrtime.bigint();
    const rows = G.rowsFrom(tasks, plan);
    const L = G.layout(rows, { scale: 'week', today: '2026-06-01' });
    const w = G.visibleWindow({ scrollTop: L.height / 2, viewport: 600, rowH: L.rowH, count: rows.length });
    let paths = 0; for (let i = w.start; i < w.end; i++) rows[i].preds.forEach((p) => { if (G.linkPath(L, { from: p.id, to: rows[i].id, type: p.type })) paths++; });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(L.bars.length, n); assert.ok(w.end - w.start < 50, 'only a window of rows is rendered'); assert.ok(paths > 0);
    assert.ok(ms < (n === 5000 ? 800 : 300), `layout took ${ms.toFixed(1)} ms`);
    console.log(`# ${n} tasks: layout pipeline ${ms.toFixed(1)} ms, window ${w.end - w.start} rows`);
  });
}
