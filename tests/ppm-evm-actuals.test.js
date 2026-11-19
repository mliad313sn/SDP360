'use strict';
// P11 qualification F2 — money already spent stays in actual cost (AC). Hand-computed, pure (services/ppm/evm).
//   Model chosen (ADR docs/ai-decisions/ADR-P11-F2-evm-actual-cost.md): a cancelled task leaves BAC / PV / EV (no budget,
//   no work ahead) but its costed hours stay in AC; hours booked on a summary task (or on a task that later gained
//   sub-tasks) roll into AC at the summary's own rate — the summary's budget is never added. Each case is named by a
//   reason code so the figure is explainable; an unknown rate / currency / hours makes AC unknown (null), never 0.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/evm');

const SD = '2026-02-01';
const leaf = (id, extra) => ({ id, status: 'in_progress', progress_pct: 50, baseline_start: '2026-01-05', baseline_end: '2026-01-30', ...extra });
const usd = (rate, cost) => ({ baseline_cost: cost == null ? undefined : cost, cost_currency: 'USD', cost_rate: rate });

test('F2 — hours on a CANCELLED task stay in AC (CPI 1.0, not 5.0)', () => {
  // task 1: BAC 1000, 50 % → EV 500; 10 h × 10 = 100. Task 2 cancelled: BAC/EV out, but 40 h × 10 = 400 were spent.
  const r = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1), leaf(2, { status: 'cancelled', progress_pct: 0 })],
    evmFields: { 1: usd(10, 1000), 2: usd(10, 1000) },
    timeEntries: [{ task_id: 1, day: '2026-01-10', hours: 10 }, { task_id: 2, day: '2026-01-10', hours: 40 }], statusDate: SD }).currencies[0];
  assert.strictEqual(r.bac, 1000, 'the cancelled task carries no budget');
  assert.strictEqual(r.ev, 500);
  assert.strictEqual(r.ac, 500, 'AC = 100 + 400');
  assert.strictEqual(r.cpi, 1);
  assert.ok(r.reasons.includes('actuals_on_cancelled_tasks'), JSON.stringify(r.reasons));
});

test('F2 — hours on a SUMMARY task roll into AC at the summary rate', () => {
  // leaf 11: BAC 1000, 50 % → EV 500, 1 h × 10 = 10; summary 10: 100 h × 10 = 1000 → AC 1010, CPI 500/1010.
  const r = E.projectEvm({ project: { id: 1 }, tasks: [{ id: 10, status: 'in_progress' }, leaf(11, { parent_id: 10 })],
    evmFields: { 10: usd(10), 11: usd(10, 1000) },
    timeEntries: [{ task_id: 10, day: '2026-01-10', hours: 100 }, { task_id: 11, day: '2026-01-10', hours: 1 }], statusDate: SD }).currencies[0];
  assert.strictEqual(r.bac, 1000, 'the summary has no budget of its own added');
  assert.strictEqual(r.ac, 1010);
  assert.strictEqual(r.cpi, Math.round((500 / 1010) * 10000) / 10000);
  assert.ok(r.reasons.includes('actuals_on_summary_tasks'));
});

test('F2 — unknown rate, currency or hours on such a task makes AC unknown, never a smaller number', () => {
  const base = { project: { id: 1 }, statusDate: SD };
  const noRate = E.projectEvm({ ...base, tasks: [leaf(1), leaf(2, { status: 'cancelled' })], evmFields: { 1: usd(10, 1000), 2: { cost_currency: 'USD' } },
    timeEntries: [{ task_id: 1, day: '2026-01-10', hours: 10 }, { task_id: 2, day: '2026-01-10', hours: 40 }] }).currencies[0];
  assert.strictEqual(noRate.ac, null); assert.strictEqual(noRate.cpi, null); assert.ok(noRate.reasons.includes('hours_without_rate'));
  const noCur = E.projectEvm({ ...base, tasks: [{ id: 10 }, leaf(11, { parent_id: 10 })], evmFields: { 10: { cost_rate: 10 }, 11: usd(10, 1000) },
    timeEntries: [{ task_id: 10, day: '2026-01-10', hours: 5 }, { task_id: 11, day: '2026-01-10', hours: 1 }] }).currencies[0];
  assert.strictEqual(noCur.ac, null); assert.ok(noCur.reasons.includes('actuals_currency_unknown'));
  const nullHours = E.projectEvm({ ...base, tasks: [leaf(1)], evmFields: { 1: usd(10, 1000) }, timeEntries: [{ task_id: 1, day: '2026-01-10', hours: null }] }).currencies[0];
  assert.strictEqual(nullHours.ac, null, 'an entry of unknown hours is not 0 h'); assert.ok(nullHours.reasons.includes('hours_unknown'));
});

test('F2 — S-curve AC and the capex/opex split include the same spent money', () => {
  const r = E.projectEvm({ project: { id: 1 }, tasks: [leaf(1), leaf(2, { status: 'cancelled' })],
    evmFields: { 1: { ...usd(10, 1000), capex_opex: 'opex' }, 2: { ...usd(10, 1000), capex_opex: 'opex' } },
    timeEntries: [{ task_id: 1, day: '2026-01-10', hours: 10 }, { task_id: 2, day: '2026-01-12', hours: 40 }], statusDate: SD }).currencies[0];
  const jan = r.s_curve.find((p) => p.period === '2026-01');
  assert.strictEqual(jan.ac, 500);
  assert.strictEqual(r.capex_opex.opex.ac, 500);
});
