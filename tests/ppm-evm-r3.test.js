'use strict';
// P11 round 3 (R3-2, R3-4) — pure, hand-computed. ADR docs/ai-decisions/ADR-P11-R3-moves-deleted-projects-dates.md.
const { test } = require('node:test');
const assert = require('node:assert');
const EVM = require('../services/ppm/evm');
const TS = require('../services/ppm/timesheets');

const SD = '2026-03-11';
const live = () => EVM.projectEvm({
  project: { id: 1 }, statusDate: SD,
  tasks: [{ id: 11, status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' }],
  evmFields: { 11: { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 10 } },
  timeEntries: [{ task_id: 11, day: '2026-03-03', hours: 10 }],
});
// a soft-deleted project: no live task, its entries carry their task's rate / currency (as evmStore attaches them)
const hidden = (entries) => EVM.projectEvm({ project: { id: 2 }, tasks: [], statusDate: SD, timeEntries: entries });

test('R3-2: a hidden project contributes its spent money only (BAC / PV / EV 0), flagged', () => {
  const h = hidden([{ task_id: 21, day: '2026-03-03', hours: 30, cost_rate: 10, cost_currency: 'USD', task_deleted: true }, { task_id: 21, day: '2026-03-20', hours: 5, cost_rate: 10, cost_currency: 'USD' }]);
  const contrib = EVM.spentOnlyContribution(h.rollup_input);
  assert.deepStrictEqual(contrib, [{ currency: 'USD', bac: 0, pv: 0, ev: 0, ac: 300, eac_forecast: 300, deleted_project: true }]);   // the 2026-03-20 hours are after the status date
  const pf = EVM.portfolioEvm([{ project_id: 1, programme_id: 7, rollup_input: live().rollup_input }, { project_id: 2, programme_id: 7, rollup_input: contrib }]);
  const usd = pf.currencies[0];
  // live: BAC 1000, PV 800 (8 of 10 working days), EV 500, AC 100; + hidden AC 300 → AC 400, CPI 500/400 = 1.25
  assert.deepStrictEqual([usd.bac, usd.pv, usd.ev, usd.ac, usd.cpi], [1000, 800, 500, 400, 1.25]);
  assert.deepStrictEqual(usd.reasons, ['actuals_on_deleted_projects']);
  assert.strictEqual(usd.deleted_project_contributors, 1);
  assert.deepStrictEqual(pf.programmes[0].currencies[0].reasons, ['actuals_on_deleted_projects']);
  // without the hidden project: no reason, AC 100
  const pf0 = EVM.portfolioEvm([{ project_id: 1, programme_id: 7, rollup_input: live().rollup_input }]);
  assert.strictEqual(pf0.currencies[0].ac, 100); assert.strictEqual(pf0.currencies[0].reasons, undefined);
});

test('R3-2: hidden spent hours with no rate → portfolio AC unknown, never smaller', () => {
  const h = hidden([{ task_id: 21, day: '2026-03-03', hours: 30, cost_rate: null, cost_currency: 'USD' }]);
  const pf = EVM.portfolioEvm([{ project_id: 1, rollup_input: live().rollup_input }, { project_id: 2, rollup_input: EVM.spentOnlyContribution(h.rollup_input) }]);
  assert.strictEqual(pf.currencies[0].ac, null);
  assert.strictEqual(pf.currencies[0].cpi, null);
});

test('R3-2: hidden spent hours in an unknown currency → AC unknown in every currency, flagged', () => {
  const contrib = EVM.spentOnlyContribution([], { currencyUnknown: true });
  const pf = EVM.portfolioEvm([{ project_id: 1, rollup_input: live().rollup_input }, { project_id: 2, rollup_input: contrib }]);
  const usd = pf.currencies[0];
  assert.deepStrictEqual([usd.currency, usd.bac, usd.ev, usd.ac, usd.cpi], ['USD', 1000, 500, null, null]);
  assert.ok(usd.reasons.includes('actuals_currency_unknown') && usd.reasons.includes('actuals_on_deleted_projects'));
});

test('R3-4: a week keeps the hours of a soft-deleted task, flagged', () => {
  const weeks = TS.groupWeeks([
    { person_label: 'Ana', day: '2026-03-03', hours: 10 },
    { person_label: 'Ana', day: '2026-03-04', hours: 20, task_deleted: true },
  ], [{ id: 1, person_key: 'l:ana', week_start: '2026-03-02', status: 'approved', total_hours: 30 }]);
  assert.strictEqual(weeks.length, 1);
  assert.deepStrictEqual([weeks[0].status, weeks[0].hours, weeks[0].total_hours, weeks[0].deleted_task_hours, weeks[0].entries], ['approved', 30, 30, 20, 2]);
  const none = TS.groupWeeks([{ person_label: 'Ana', day: '2026-03-03', hours: 10 }], []);
  assert.strictEqual(none[0].deleted_task_hours, undefined);
});
