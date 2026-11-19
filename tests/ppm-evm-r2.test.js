'use strict';
// P11 round 2 (PPM seat) — pure, hand-computed checks of services/ppm/evm.
//   R2-1: hours logged on a task that is no longer in the plan (soft-deleted, or hidden under a soft-deleted parent)
//         stay in AC with the reason `actuals_on_deleted_tasks`; never a silently smaller AC.
//   R2-2: earned-value time-phasing is computed per month, so a very long baseline window costs months, not days —
//         one EVM read can never block the server for seconds. ADR docs/ai-decisions/ADR-P11-R2-evm-deleted-and-bounds.md.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/evm');

const SD = '2026-03-11';
const leaf = (id, extra) => ({ id, status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13', ...extra });
const usd = (rate, cost) => ({ baseline_cost: cost, cost_currency: 'USD', cost_rate: rate });

test('R2-1 — entries of a task absent from the plan stay in AC (300, CPI 500/300), with a reason', () => {
  // live task A: BAC 1000, 50 % → EV 500; 10 h × 10 = 100. Deleted task B (not in `tasks`): 20 h × 10 = 200 → AC 300.
  const r = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1)], evmFields: { 1: usd(10, 1000) },
    timeEntries: [{ task_id: 1, day: '2026-03-03', hours: 10 }, { task_id: 2, day: '2026-03-03', hours: 20, task_deleted: true, cost_rate: '10', cost_currency: 'USD' }],
    statusDate: SD }).currencies[0];
  assert.strictEqual(r.bac, 1000);
  assert.strictEqual(r.ev, 500);
  assert.strictEqual(r.ac, 300, 'AC = 100 + 200');
  assert.strictEqual(r.cpi, Math.round((500 / 300) * 10000) / 10000);
  assert.strictEqual(r.eac, Math.round((1000 / (500 / 300)) * 100) / 100, 'EAC = 600 (not 200)');
  assert.ok(r.reasons.includes('actuals_on_deleted_tasks'), JSON.stringify(r.reasons));
  const jan = r.s_curve.find((p) => p.period === '2026-03');
  assert.strictEqual(jan.ac, 300, 'the S-curve carries the same spent money');
});

test('R2-1 — an absent task with no known rate / currency makes AC unknown, never smaller', () => {
  const noRate = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1)], evmFields: { 1: usd(10, 1000) },
    timeEntries: [{ task_id: 1, day: '2026-03-03', hours: 10 }, { task_id: 2, day: '2026-03-03', hours: 20, cost_currency: 'USD' }], statusDate: SD }).currencies[0];
  assert.strictEqual(noRate.ac, null); assert.strictEqual(noRate.cpi, null);
  assert.ok(noRate.reasons.includes('hours_without_rate'));
  assert.ok(noRate.reasons.includes('actuals_on_deleted_tasks'));
  const noCur = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1)], evmFields: { 1: usd(10, 1000) },
    timeEntries: [{ task_id: 1, day: '2026-03-03', hours: 10 }, { task_id: 2, day: '2026-03-03', hours: 20 }], statusDate: SD }).currencies[0];
  assert.strictEqual(noCur.ac, null, 'no currency: the money cannot be placed, so no smaller figure is shown');
  assert.ok(noCur.reasons.includes('actuals_currency_unknown'));
});

test('R2-2 — month-level phasing keeps PV exact (hand-computed)', () => {
  // 2026-03-02 (Mon) .. 2026-03-13 (Fri) = 10 working days; status 2026-03-11 (Wed) → 8 done → PV = 1000 × 8/10 = 800
  const r = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1)], evmFields: { 1: usd(10, 1000) }, statusDate: SD }).currencies[0];
  assert.strictEqual(r.pv, 800);
  // a window across a month boundary: 2026-03-30 (Mon) .. 2026-04-03 (Fri), 5 days, 2 in March → S-curve 400 / 1000
  const r2 = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1, { baseline_start: '2026-03-30', baseline_end: '2026-04-03' })], evmFields: { 1: usd(10, 1000) }, statusDate: '2026-04-30' }).currencies[0];
  assert.deepStrictEqual(r2.s_curve.map((p) => [p.period, p.pv]), [['2026-03', 400], ['2026-04', 1000]]);
  // weekend-only window spreads over calendar days (a cost is never lost)
  const r3 = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1, { baseline_start: '2026-03-07', baseline_end: '2026-03-08' })], evmFields: { 1: usd(10, 100) }, statusDate: '2026-03-07' }).currencies[0];
  assert.strictEqual(r3.pv, 50);
});

test('R2-2 — a baseline to the 2200 bound: 20 tasks EVM in well under a second', () => {
  const tasks = [], fields = {};
  for (let i = 1; i <= 20; i++) { tasks.push(leaf(i, { baseline_start: '1970-01-05', baseline_end: '2200-12-31' })); fields[i] = usd(10, 1000); }
  const t0 = Date.now();
  const r = E.projectEvm({ project: { id: 1 }, tasks, evmFields: fields, statusDate: '2027-02-01' }).currencies[0];
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.strictEqual(r.bac, 20000);
  assert.ok(r.pv > 0 && r.pv < 20000);
});

test('R2-2 — a legacy row at year 9999 (stored before the bounds) stays bounded: < 1 s, S-curve capped and flagged', () => {
  const tasks = [], fields = {};
  for (let i = 1; i <= 5; i++) { tasks.push(leaf(i, { baseline_start: '2027-01-04', baseline_end: '9999-12-31' })); fields[i] = usd(10, 1000); }
  const t0 = Date.now();
  const r = E.projectEvm({ project: { id: 1 }, tasks, evmFields: fields, statusDate: '2027-02-01' }).currencies[0];
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `took ${ms} ms`);
  assert.strictEqual(r.bac, 5000);
  assert.ok(r.s_curve.length <= E.MAX_CURVE_MONTHS, `S-curve ${r.s_curve.length} points`);
  assert.ok(r.s_curve.some((p) => p.period === '2027-02'), 'the status month is always in the curve');
  assert.ok(r.reasons.includes('s_curve_truncated'), JSON.stringify(r.reasons));
});
