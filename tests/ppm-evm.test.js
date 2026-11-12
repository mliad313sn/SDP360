'use strict';
// W1-EVM — T5 certification seed: a HAND-COMPUTED reference project. Every expected number below is derived in the
// comments, by hand, from the inputs — never by running the engine. Pure engine (services/ppm/evm.js), no DB.
const test = require('node:test');
const assert = require('node:assert');
const E = require('../services/ppm/evm');

// ── Reference project R (USD), status date Wed 2026-03-11 ─────────────────────────────────────────────────────────
// March 2026 starts on a Sunday. Working days (Mon–Fri):
//   A  baseline Mon 03-02 → Fri 03-06 = 5 wd, cost 1000 → 200/wd.  done, progress 100, % complete.
//      PV(03-11) = 5 × 200 = 1000.  EV = 1000 × 100 % = 1000.  AC = 50 h × 22/h = 1100.
//   B  baseline Mon 03-09 → Fri 03-20 = 10 wd, cost 2000 → 200/wd. in progress, progress 30, method 50/50.
//      PV(03-11) = Mon 9, Tue 10, Wed 11 = 3 × 200 = 600.  EV = 50 % × 2000 = 1000 (50/50 ignores the 30 %).
//      AC = 20 h × 25/h = 500 (an entry on 03-12 is AFTER the status date and does not count).
//   C  baseline Mon 03-23 → Fri 04-03 = 10 wd, cost 1000.  todo, method 0/100.
//      PV(03-11) = 0.  EV = 0.  No time entry → not in the measured AC set.
// Project: BAC = 1000+2000+1000 = 4000 · PV = 1000+600+0 = 1600 · EV = 1000+1000+0 = 2000 · AC = 1100+500 = 1600
//   SV = 2000−1600 = 400 · CV = 2000−1600 = 400 · SPI = 2000/1600 = 1.25 · CPI = 2000/1600 = 1.25
//   EAC (BAC/CPI) = 4000/1.25 = 3200 · ETC = 3200−1600 = 1600 · VAC = 4000−3200 = 800
//   TCPI = (4000−2000)/(4000−1600) = 2000/2400 = 0.8333…
//   EAC AC+(BAC−EV) = 1600+2000 = 3600 · EAC AC+(BAC−EV)/(CPI×SPI) = 1600 + 2000/1.5625 = 1600+1280 = 2880
const SD = '2026-03-11';
const tasks = () => [
  { id: 1, name: 'A', status: 'done', progress_pct: 100, baseline_start: '2026-03-02', baseline_end: '2026-03-06' },
  { id: 2, name: 'B', status: 'in_progress', progress_pct: 30, baseline_start: '2026-03-09', baseline_end: '2026-03-20' },
  { id: 3, name: 'C', status: 'todo', progress_pct: null, baseline_start: '2026-03-23', baseline_end: '2026-04-03' },
];
const fields = () => ({
  1: { baseline_cost: 1000, cost_currency: 'USD', cost_rate: 22, capex_opex: 'capex' },
  2: { baseline_cost: 2000, cost_currency: 'USD', cost_rate: 25, ev_method: '50_50', capex_opex: 'opex' },
  3: { baseline_cost: 1000, cost_currency: 'USD', ev_method: '0_100', capex_opex: 'capex' },
});
const entries = () => [{ task_id: 1, day: '2026-03-04', hours: 50 }, { task_id: 2, day: '2026-03-10', hours: 20 }, { task_id: 2, day: '2026-03-12', hours: 8 }];
const ref = (over = {}) => E.projectEvm({ project: { id: 7 }, tasks: tasks(), evmFields: fields(), timeEntries: entries(), statusDate: SD, ...over });

test('T5 reference project: every indicator matches the hand computation', () => {
  const r = ref();
  assert.equal(r.currencies.length, 1);
  const u = r.currencies[0];
  assert.equal(u.currency, 'USD');
  assert.deepEqual([u.bac, u.pv, u.ev, u.ac], [4000, 1600, 2000, 1600]);
  assert.deepEqual([u.sv, u.cv, u.spi, u.cpi], [400, 400, 1.25, 1.25]);
  assert.deepEqual([u.eac, u.etc, u.vac, u.tcpi], [3200, 1600, 800, 0.8333]);
  assert.deepEqual(u.eac_variants, { bac_over_cpi: 3200, ac_plus_remaining: 3600, ac_plus_remaining_over_cpi_spi: 2880, budget_period_forecast: null });
  assert.equal(u.pct_complete, 0.5);      // 2000 / 4000
  assert.deepEqual(u.sources, { bac: 'task_baseline', pv: 'task_baseline', ev: 'task_progress', ac: 'time_entries' });
  assert.match(r.certification, /non certifié/);
  const t = Object.fromEntries(r.tasks.map((x) => [x.name, x]));
  assert.deepEqual([t.A.pv, t.A.ev, t.A.ac], [1000, 1000, 1100]);
  assert.deepEqual([t.B.pv, t.B.ev, t.B.ac, t.B.hours_to_date], [600, 1000, 500, 20]);
  assert.deepEqual([t.C.pv, t.C.ev, t.C.ac], [0, 0, null]);   // C: no entry → its own AC is unknown, never 0
});

test('PV is time-phased from the baseline, NOT a linear spread of the whole budget (W0 stub counter-example)', () => {
  // Linear spread of BAC 4000 over the project window Mon 03-02 → Fri 04-03 = 25 wd (160/wd); by 03-11 = 8 wd → 1280.
  const linear = 4000 * (8 / 25);
  assert.equal(linear, 1280);
  assert.equal(E.workingDays('2026-03-02', '2026-04-03').length, 25);
  assert.equal(E.workingDays('2026-03-02', '2026-03-11').length, 8);
  const pv = ref().currencies[0].pv;
  assert.equal(pv, 1600, 'the baseline-phased PV (front-loaded tasks A and B) is 1600');
  assert.notEqual(pv, linear);
  // weekend-only window: the cost is spread over its calendar days, never lost
  assert.deepEqual(E.timePhase(100, '2026-03-07', '2026-03-08'), { '2026-03-07': 50, '2026-03-08': 50 });
  assert.equal(E.timePhase(100, '2026-03-10', '2026-03-09'), null, 'inverted window → unknown');
});

test('EV methods: 0/100, 50/50, % complete, physical % complete', () => {
  const t = (o) => ({ status: 'in_progress', progress_pct: 90, ...o });
  assert.equal(E.earnedFraction(t({}), { ev_method: '0_100' }, SD), 0);
  assert.equal(E.earnedFraction(t({ status: 'done' }), { ev_method: '0_100' }, SD), 1);
  assert.equal(E.earnedFraction(t({ status: 'todo', progress_pct: null }), { ev_method: '50_50' }, SD), 0);
  assert.equal(E.earnedFraction(t({}), { ev_method: '50_50' }, SD), 0.5);
  assert.equal(E.earnedFraction(t({ actual_end: '2026-03-10' }), { ev_method: '50_50' }, SD), 1);
  assert.equal(E.earnedFraction(t({}), {}, SD), 0.9, 'default = % complete (today-compatible)');
  assert.equal(E.earnedFraction(t({}), { ev_method: 'physical_pct', physical_pct: 40 }, SD), 0.4, 'physical % ignores the reported 90 %');
  // project: B switched to physical 40 % → EV_B = 800, EV = 1000+800 = 1800
  const f = fields(); f[2] = { ...f[2], ev_method: 'physical_pct', physical_pct: 40 };
  assert.equal(ref({ evmFields: f }).currencies[0].ev, 1800);
  // B switched to % complete 30 % → EV_B = 600, EV = 1600, SPI = 1600/1600 = 1
  const g = fields(); g[2] = { ...g[2], ev_method: 'percent_complete' };
  const u = ref({ evmFields: g }).currencies[0];
  assert.deepEqual([u.ev, u.spi, u.cpi], [1600, 1, 1]);
});

test('unknown is null, never 0 or Infinity', () => {
  // started task with no progress figure → EV unknown → project EV and every EV-based index null
  const ts = tasks(); ts[1] = { ...ts[1], progress_pct: null };
  const f = fields(); f[2] = { ...f[2], ev_method: 'percent_complete' };
  const u = ref({ tasks: ts, evmFields: f }).currencies[0];
  assert.equal(u.ev, null); assert.equal(u.spi, null); assert.equal(u.cpi, null); assert.equal(u.eac, null); assert.equal(u.tcpi, null);
  assert.ok(u.reasons.includes('progress_unknown'));
  // division by zero
  const z = E.indicators({ bac: 100, pv: 0, ev: 0, ac: 0 });
  assert.deepEqual([z.spi, z.cpi, z.eac, z.etc, z.vac], [null, null, null, null, null]);
  assert.equal(E.indicators({ bac: 100, ev: 50, ac: 100 }).tcpi, null, 'BAC − AC = 0 → TCPI null, never Infinity');
  // hours on a task with no rate → AC unknown (not free hours)
  const nr = fields(); delete nr[1].cost_rate;
  const a = ref({ evmFields: nr }).currencies[0];
  assert.equal(a.ac, null); assert.ok(a.reasons.includes('hours_without_rate')); assert.equal(a.cpi, null);
  // no time entry at all → AC unknown
  assert.equal(ref({ timeEntries: [] }).currencies[0].ac, null);
  // an uncosted leaf → task-derived BAC/PV/EV unknown for the project (its share is unknown)
  const uc = fields(); delete uc[3];
  const v = ref({ evmFields: uc }).currencies[0];
  assert.deepEqual([v.bac, v.pv, v.ev], [null, null, null]);
  assert.deepEqual(v.coverage.uncosted_task_ids, [3]);
  // a task with a cost but no baseline dates → PV unknown
  const nd = tasks(); nd[2] = { ...nd[2], baseline_start: null, baseline_end: null };
  assert.equal(ref({ tasks: nd }).currencies[0].pv, null);
  // a cancelled task is out of the earned value entirely
  const cx = tasks(); cx[2] = { ...cx[2], status: 'cancelled' };
  assert.equal(ref({ tasks: cx }).currencies[0].bac, 3000);
});

test('a missing baseline date is filled from the latest baseline version (frozen plan), never from the live plan', () => {
  const ts = tasks(); ts[0] = { ...ts[0], baseline_start: null, baseline_end: null, start_date: '2026-04-01', end_date: '2026-04-30' };
  const payload = { tasks: [{ id: 1, start_date: '2026-03-02', end_date: '2026-03-06', baseline_start: null, baseline_end: null }] };
  assert.equal(ref({ tasks: ts, baselinePayload: payload }).currencies[0].pv, 1600);
  assert.equal(ref({ tasks: ts }).currencies[0].pv, null, 'without a baseline the live plan is NOT used as PV');
});

test('budget periods are the PV of their currency (status month prorated by working days); actual periods are the AC', () => {
  // baseline 2026-03 = 2200, 2026-04 = 1800 → BAC 4000. March 2026 has 22 wd, 8 of them ≤ 03-11 → PV = 2200 × 8/22 = 800.
  // EV = BAC_periods × (task EV / task BAC) = 4000 × 2000/4000 = 2000. Actual 2026-03 = 900 (2026-04 actual ignored) → AC 900.
  // forecast 2026-04 = 2100 → budget-period EAC = 900 + 2100 = 3000.
  const bp = [
    { period: '2026-03', currency: 'USD', kind: 'baseline', amount: 2200 }, { period: '2026-04', currency: 'USD', kind: 'baseline', amount: 1800 },
    { period: '2026-03', currency: 'USD', kind: 'actual', amount: 900 }, { period: '2026-04', currency: 'USD', kind: 'actual', amount: 50 },
    { period: '2026-04', currency: 'USD', kind: 'forecast', amount: 2100 },
  ];
  assert.equal(E.monthFractionTo('2026-03', SD), 8 / 22);
  const u = ref({ budgetPeriods: bp }).currencies[0];
  assert.deepEqual([u.bac, u.pv, u.ev, u.ac], [4000, 800, 2000, 900]);
  assert.deepEqual(u.sources, { bac: 'budget_periods', pv: 'budget_periods', ev: 'task_progress_weighted_by_baseline_cost', ac: 'budget_periods' });
  assert.equal(u.eac_variants.budget_period_forecast, 3000);
  // S-curve: cumulative PV per month from the periods; AC cumulative up to the status month; EV only at the status month
  assert.deepEqual(u.s_curve, [{ period: '2026-03', pv: 2200, ev: 2000, ac: 900, bac: 4000 }, { period: '2026-04', pv: 4000, ev: null, ac: null, bac: 4000 }]);
});

test('S-curve from tasks: PV per month from the phased baselines, AC per month from the entries', () => {
  // March PV: A 1000 + B 2000 + C (03-23..03-31 = 7 wd × 100) 700 = 3700; April: C 3 wd × 100 = 300 → 4000.
  const c = ref().currencies[0].s_curve;
  assert.deepEqual(c, [{ period: '2026-03', pv: 3700, ev: 2000, ac: 1600, bac: 4000 }, { period: '2026-04', pv: 4000, ev: null, ac: null, bac: 4000 }]);
});

test('leaf → summary → project → programme → portfolio, per currency; CapEx/OpEx split', () => {
  const ts = [{ id: 10, name: 'S', status: 'in_progress' }, ...tasks().map((t) => (t.id !== 3 ? { ...t, parent_id: 10 } : t))];
  const r = ref({ tasks: ts });
  const s = r.summaries.find((x) => x.id === 10);
  assert.equal(s.leaves, 2);
  assert.deepEqual([s.currencies[0].bac, s.currencies[0].pv, s.currencies[0].ev, s.currencies[0].ac], [3000, 1600, 2000, 1600]);
  assert.equal(r.currencies[0].bac, 4000, 'the summary is never counted twice');
  const split = r.currencies[0].capex_opex;
  // capex = A + C: BAC 2000, PV 1000, EV 1000, AC 1100 (only A has hours) · opex = B: 2000, 600, 1000, 500
  assert.deepEqual(split.capex, { tasks: 2, bac: 2000, pv: 1000, ev: 1000, ac: 1100 });
  assert.deepEqual(split.opex, { tasks: 1, bac: 2000, pv: 600, ev: 1000, ac: 500 });
  assert.equal(split.unclassified, null);
  // a second project in XOF: one task 03-02..03-13 = 10 wd, cost 500000, 50 % complete, 40 h × 10000/h
  //   PV(03-11) = 8 wd × 50000 = 400000 · EV = 250000 · AC = 400000
  const x = E.projectEvm({ project: { id: 8 }, statusDate: SD,
    tasks: [{ id: 21, status: 'in_progress', progress_pct: 50, baseline_start: '2026-03-02', baseline_end: '2026-03-13' }],
    evmFields: { 21: { baseline_cost: 500000, cost_currency: 'XOF', cost_rate: 10000 } }, timeEntries: [{ task_id: 21, day: '2026-03-03', hours: 40 }] });
  const pf = E.portfolioEvm([{ project_id: 7, programme_id: 1, rollup_input: r.rollup_input }, { project_id: 8, programme_id: 2, rollup_input: x.rollup_input }]);
  assert.deepEqual(pf.currencies.map((c) => [c.currency, c.bac, c.pv, c.ev, c.ac]), [['USD', 4000, 1600, 2000, 1600], ['XOF', 500000, 400000, 250000, 400000]], 'never summed across currencies');
  assert.equal(pf.converted, null, 'no rate table → no converted view');
  assert.deepEqual(pf.programmes.map((p) => [p.programme_id, p.currencies.map((c) => c.currency)]), [[1, ['USD']], [2, ['XOF']]]);
  // converted with an explicit table: XOF × 0.002 → USD: BAC 4000+1000 = 5000, PV 1600+800 = 2400, EV 2000+500 = 2500, AC 1600+800 = 2400
  const cv = E.portfolioEvm([{ project_id: 7, rollup_input: r.rollup_input }, { project_id: 8, rollup_input: x.rollup_input }], { rates: { target: 'USD', rates: { XOF: 0.002 }, as_of: '2026-03-01' } }).converted;
  assert.equal(cv.converted, true);
  assert.deepEqual([cv.bac, cv.pv, cv.ev, cv.ac, cv.spi], [5000, 2400, 2500, 2400, 1.0417]);
  assert.match(cv.certification, /non certifié/);
  const miss = E.portfolioEvm([{ rollup_input: r.rollup_input }, { rollup_input: x.rollup_input }], { rates: { target: 'EUR', rates: { USD: 0.9 } } }).converted;
  assert.equal(miss.bac, null); assert.deepEqual(miss.missing_rates, ['XOF']);
  // portfolio rollup is null as soon as one contributor is unknown
  const unknown = E.portfolioEvm([{ rollup_input: r.rollup_input }, { rollup_input: [{ currency: 'USD', bac: 100, pv: null, ev: 10, ac: 5 }] }]);
  assert.equal(unknown.currencies[0].pv, null); assert.equal(unknown.currencies[0].unknown.pv, 1); assert.equal(unknown.currencies[0].bac, 4100);
});

test('a project without any cost data yields no currency rows (nothing invented)', () => {
  const r = E.projectEvm({ project: { id: 9 }, tasks: tasks(), statusDate: SD });
  assert.deepEqual(r.currencies, []);
  assert.throws(() => E.projectEvm({ tasks: [], statusDate: '11/03/2026' }), /statusDate/);
});
