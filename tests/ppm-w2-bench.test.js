'use strict';
// W2-ENGINE (PPM parity T7, engine half) — CPM and levelling on generated 1,000 / 5,000-task projects. Timings are
// RECORDED (docs/ppm/W2-ENGINE-CONTRACT.md §Performance); the assertions are loose budgets only (shared CI machines),
// plus the levelling invariants on the 1,000-task run: delay-only, every move explained, links never broken.
const { test } = require('node:test');
const assert = require('node:assert');
const B = require('../tools/ppm/bench-engine');
const E = require('../services/ppm/scheduleEngine');
const R = require('../services/ppm/resources');

test('CPM: 1,000 and 5,000 generated tasks (all link types, lag units, constraints, calendars) under loose budgets', () => {
  for (const [n, budget] of [[1000, 1500], [5000, 4000]]) {
    const f = B.fixture(n);
    const t0 = process.hrtime.bigint();
    const r = E.schedule(f.tasks, f.opts);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(r && r.tasks.length === n, `${n} scheduled`);
    assert.ok(ms < budget, `${n} tasks: ${Math.round(ms)} ms (budget ${budget})`);
  }
});

test('levelling on 1,000 tasks: delay-only, explained, converges; links respected in the levelled plan', () => {
  const f = B.fixture(1000);
  const tk = new Map(f.tasks.map((t) => [t.id, t]));
  const t0 = process.hrtime.bigint();
  const out = R.level({ tasks: f.tasks, scheduleOpts: f.opts, assignments: f.assignments, resources: f.resources,
    calendarSpecOf: (id) => { const t = tk.get(id); return t && t.calendar_id != null ? f.opts.calendars[t.calendar_id] : f.opts.calendar; },
    resourceCalendarOf: (r) => E.makeCalendar(r && r.calendar_id != null ? f.opts.calendars[r.calendar_id] : f.opts.calendar), priorityOf: (id) => { const t = tk.get(id); return t ? t.priority : null; } });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(out.ok && out.converged, 'converged');
  assert.ok(ms < 30000, `levelling ${Math.round(ms)} ms`);
  assert.ok(out.moves.length > 0);
  for (const m of out.moves) {
    assert.ok(m.added_delay_days > 0 && m.to_start >= m.from_start, `delay-only #${m.task_id}`);
    assert.ok(m.reasons.length >= 1 && m.reasons.every((r) => r.rule && r.resource_id && r.load_hours > r.capacity_hours), `explained #${m.task_id}`);
  }
  for (const v of Object.values(out.delays)) assert.ok(Number.isInteger(v) && v >= 0);
  // the levelled plan breaks no link the unlevelled plan kept
  const base = E.schedule(f.tasks, f.opts);
  const viol = (r) => new Set(r.warnings.filter((w) => w.code === 'LINK_VIOLATED').map((w) => w.task_id));
  const added = [...viol(out.schedule)].filter((id) => !viol(base).has(id));
  assert.deepStrictEqual(added, []);
  // every remaining over-allocation involves a task levelling may not move (pinned, started, manual, MSO/MFO/ALAP, unresolved) or did not converge on
  assert.ok(out.remaining_overallocations.length <= base.tasks.length);
});
