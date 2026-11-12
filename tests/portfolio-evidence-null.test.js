'use strict';
// W1-INTEGRITY / E-NULL-1/2/3 (PPM parity W0, P0, repros R6 R7 R8) — an unknown is UNKNOWN (null), never 0:
// unknown project progress is excluded from the mean with a coverage count, a missing baseline gives a null slip,
// and unknown spend is counted as unknown instead of being added as 0.
const { test } = require('node:test');
const assert = require('node:assert');
const PE = require('../services/portfolioEvidence');
const now = new Date('2026-10-19T00:00:00Z');

test('R6: unknown project progress is excluded from the objective mean, with coverage', () => {
  const o = PE.objectiveView({ id: 1, key: 'o', name: 'O' }, { projects: [{ progress_pct: 100 }, { progress_pct: null }], now });
  assert.equal(o.evidence_pct, 100, 'was 50: the unknown project counted as 0 %');
  assert.equal(o.evidence_source, 'projects');
  assert.equal(o.projects_reporting, 1); assert.equal(o.projects_total, 2);
  const none = PE.objectiveView({ id: 2, key: 'n', name: 'N' }, { projects: [{ progress_pct: null }, { progress_pct: '' }], now });
  assert.equal(none.evidence_pct, null, 'no project reports progress: not measured');
  assert.equal(none.evidence_source, 'none');
  assert.equal(none.projects_reporting, 0); assert.equal(none.projects_total, 2);
  const zero = PE.objectiveView({ id: 3, key: 'z', name: 'Z' }, { projects: [{ progress_pct: 0 }, { progress_pct: 0 }], now });
  assert.equal(zero.evidence_pct, 0, 'a measured 0 stays 0');
});

test('R7: no baseline end → slip null (not "on baseline"), no alert; a measured slip is unchanged', () => {
  const g = PE.ganttRows([{ id: 1, key: 'A', name: 'A', status: 'active', end_date: '2026-12-31' }, { id: 2, key: 'B', name: 'B', status: 'active', end_date: '2026-12-31', baseline_end: '2026-12-31' }, { id: 3, key: 'C', name: 'C', status: 'active', end_date: '2027-01-10', baseline_end: '2026-12-31' }], [], { now });
  assert.equal(g[0].slip_days, null, 'was 0');
  assert.ok(!g[0].alerts.some((x) => /slipped/.test(x)));
  assert.equal(g[1].slip_days, 0, 'on baseline, measured');
  assert.equal(g[2].slip_days, 10);
  const sum = PE.portfolioSummary({ programmes: [{ id: 7, key: 'p', name: 'P' }], objectiveViews: [{ id: 10, programme_id: 7, weight: 1, evidence_pct: null }], gantt: g.map((r) => ({ ...r, objective_id: 10 })), risks: [] });
  assert.equal(sum[0].late_projects, 1, 'only the measured slip counts as late');
});

test('R8: unknown spend is counted as unknown, never added as 0; currencies never mixed', () => {
  const m = PE.moneyRollup([{ currency: 'USD', budget: 100, spent: null }, { currency: 'USD', budget: 50, spent: 20 }]);
  assert.equal(m.budget, 150); assert.equal(m.spent, 20, 'known spend only');
  assert.equal(m.spent_unknown, 1, 'the project with a budget and no spend is flagged');
  assert.equal(m.budget_by_currency.USD.spent_unknown, 1);
  const all = PE.moneyRollup([{ currency: 'USD', budget: 100, spent: null }]);
  assert.equal(all.spent, null, 'no known spend at all → null, not 0'); assert.equal(all.spent_unknown, 1);
  const nob = PE.moneyRollup([{ currency: 'USD', budget: null, spent: 30 }]);
  assert.equal(nob.budget, null, 'no known budget → null'); assert.equal(nob.spent, 30); assert.equal(nob.budget_missing, 1);
  const mix = PE.moneyRollup([{ currency: 'USD', budget: 10, spent: 1 }, { currency: 'XOF', budget: 1000, spent: null }, { budget: null, spent: null }]);
  assert.equal(mix.budget, null); assert.equal(mix.currency_mixed, true); assert.equal(mix.budget_unknown, 1); assert.equal(mix.spent_unknown, 1);
  assert.equal(mix.budget_by_currency.XOF.spent, null);
});
