'use strict';
// W2-ENGINE (T7) — benchmark of the CPM (full reschedule) and of levelling on generated projects.
//   node tools/ppm/bench-engine.js [--sizes=1000,5000] [--runs=3]
// Prints the median wall time per size. Results recorded in docs/ppm/W2-ENGINE-CONTRACT.md §Performance.
const G = require('./gen-mspdi-golden');
const M = require('../../services/ppm/mspdi');
const E = require('../../services/ppm/scheduleEngine');
const R = require('../../services/ppm/resources');

function fixture(n) {
  const m = G.generateModel(n, 7);
  const { tasks, opts } = M.modelToEngine(m);
  const resources = m.resources.map((r) => ({ id: r.uid, name: r.name, kind: r.type, max_units_pct: r.max_units_pct, calendar_id: r.calendar_uid }));
  const assignments = m.assignments.map((a) => ({ task_id: a.task_uid, resource_id: a.resource_uid, units_pct: a.units_pct, work_hours: a.work_hours, contour: a.contour }));
  return { tasks, opts, resources, assignments };
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function bench(n, runs = 3) {
  const f = fixture(n);
  const cpm = [], lev = [];
  let last = null;
  for (let i = 0; i < runs; i++) {
    let t = process.hrtime.bigint(); E.schedule(f.tasks, f.opts); cpm.push(Number(process.hrtime.bigint() - t) / 1e6);
    t = process.hrtime.bigint();
    last = R.level({ tasks: f.tasks, scheduleOpts: f.opts, assignments: f.assignments, resources: f.resources, calendarSpecOf: (id) => { const tk = f.tasks.find((x) => x.id === id); return tk && tk.calendar_id != null ? f.opts.calendars[tk.calendar_id] : f.opts.calendar; },
      resourceCalendarOf: (r) => E.makeCalendar(r && r.calendar_id != null ? f.opts.calendars[r.calendar_id] : f.opts.calendar), priorityOf: (id) => { const tk = f.tasks.find((x) => x.id === id); return tk ? tk.priority : null; } });
    lev.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return { tasks: n, assignments: f.assignments.length, cpm_ms: Math.round(median(cpm)), leveling_ms: Math.round(median(lev)), leveling_iterations: last.iterations, converged: last.converged, moves: last.moves.length, remaining_overallocations: last.remaining_overallocations.length };
}
module.exports = { bench, fixture };
if (require.main === module) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  for (const n of String(arg('sizes', '1000,5000')).split(',').map(Number)) console.log(JSON.stringify(bench(n, Number(arg('runs', 3)))));
}
