// tests/depreciation.test.js — Task 0, sub-project Asset Depreciation.
// PURE module: asset book value + annual depreciation schedule for 4 methods,
// plus config parse/resolve. Currency-agnostic (operates on numbers).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  computeDepreciation,
  parseDepreciationConfig,
  resolveForType,
  METHODS,
  DEFAULT_DEPRECIATION_CONFIG,
} = require('../services/depreciation');

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${msg || ''} expected ${actual} within ${tol} of ${expected}`);
const finiteOrNull = (v, msg) =>
  assert.ok(v === null || Number.isFinite(v), `${msg || ''} must be finite or null, got ${v}`);

// ─────────────────────────────────────────────────────────────────────────────
// STRAIGHT LINE — the SDP screenshot case
// cost 2,250,000 · life 36 mo · salvage 0 · acquired 2022-11-21
// monthly rate = 2,250,000 / 36 = 62,500
// ─────────────────────────────────────────────────────────────────────────────
test('straight_line — SDP case: fully depreciated at 36 months', () => {
  const r = computeDepreciation({
    cost: 2250000, salvage: 0, method: 'straight_line',
    usefulLifeMonths: 36, acquisitionDate: '2022-11-21', asOf: '2025-11-21',
  });
  near(r.currentBookValue, 0, 1, 'bookValue@36mo');
  near(r.accumulated, 2250000, 1, 'accumulated@36mo');
  near(r.pctDepreciated, 1, 0.001, 'pctDepreciated@36mo');
});

test('straight_line — SDP case: half-depreciated at 12 months (62,500/mo)', () => {
  const r = computeDepreciation({
    cost: 2250000, salvage: 0, method: 'straight_line',
    usefulLifeMonths: 36, acquisitionDate: '2022-11-21', asOf: '2023-11-21',
  });
  near(r.currentBookValue, 1500000, 1, 'bookValue@12mo');
  near(r.accumulated, 750000, 1, 'accumulated@12mo');
  // implied monthly rate = accumulated / months = 750000 / 12 = 62500
  near(r.accumulated / 12, 62500, 0.01, 'monthly rate');
  // I-1: asOf on a year boundary → currentBookValue equals that year's schedule row
  near(r.currentBookValue, r.schedule[0].bookValue, 0.01, 'I-1 boundary @ year 1');
});

test('straight_line — schedule shape + full-year depreciation', () => {
  const r = computeDepreciation({
    cost: 2250000, salvage: 0, method: 'straight_line',
    usefulLifeMonths: 36, acquisitionDate: '2022-11-21', asOf: '2025-11-21',
  });
  assert.ok(Array.isArray(r.schedule), 'schedule is array');
  assert.strictEqual(r.schedule.length, 3, '3 annual rows for a 36-month life');
  for (const row of r.schedule) {
    assert.ok('year' in row && 'depreciation' in row && 'accumulated' in row && 'bookValue' in row,
      'row shape {year,depreciation,accumulated,bookValue}');
    near(row.depreciation, 750000, 1, 'full-year depreciation = 12 × 62,500');
  }
  near(r.schedule[2].bookValue, 0, 1, 'final year bookValue = salvage');
  near(r.schedule[2].accumulated, 2250000, 1, 'final accumulated = cost');
});

// ─────────────────────────────────────────────────────────────────────────────
// DECLINING BALANCE — 50%/yr, monthly compounding
// cost 1000 · salvage 100 · declinePercent 0.5 · life 24 mo · 12 mo elapsed
// bv(12) = 1000 × (1 − 0.5/12)^12  (floored at salvage 100)
// ─────────────────────────────────────────────────────────────────────────────
test('declining_balance — monthly-compounded book value @ 12 months', () => {
  const expected = 1000 * Math.pow(1 - 0.5 / 12, 12); // ≈ 600.07
  const r = computeDepreciation({
    cost: 1000, salvage: 100, method: 'declining_balance',
    declinePercent: 0.5, usefulLifeMonths: 24, acquisitionDate: '2024-01-01', asOf: '2025-01-01',
  });
  near(r.currentBookValue, expected, 1, 'bv@12mo');
  // I-1: schedule downsamples the SAME bookValueAt → first annual row == currentBookValue@12mo
  near(r.schedule[0].bookValue, expected, 1, 'schedule[0] downsample == bv(12)');
  near(r.schedule[0].bookValue, r.currentBookValue, 0.01, 'I-1 boundary declining');
});

test('declining_balance — never floors below salvage', () => {
  const r = computeDepreciation({
    cost: 1000, salvage: 100, method: 'declining_balance',
    declinePercent: 0.5, usefulLifeMonths: 24, acquisitionDate: '2024-01-01', asOf: '2099-01-01',
  });
  assert.ok(r.currentBookValue >= 100, 'floored at salvage');
  for (const row of r.schedule) assert.ok(row.bookValue >= 100, 'schedule floored at salvage');
});

// ─────────────────────────────────────────────────────────────────────────────
// DOUBLE DECLINING — rate = 2/lifeMonths, monthly compounding
// cost 1000 · salvage 0 · life 24 mo · 12 mo elapsed
// bv(12) = 1000 × (1 − 2/24)^12
// ─────────────────────────────────────────────────────────────────────────────
test('double_declining — monthly-compounded book value @ 12 months', () => {
  const expected = 1000 * Math.pow(1 - 2 / 24, 12); // ≈ 352.02
  const r = computeDepreciation({
    cost: 1000, salvage: 0, method: 'double_declining',
    usefulLifeMonths: 24, acquisitionDate: '2024-01-01', asOf: '2025-01-01',
  });
  near(r.currentBookValue, expected, 1, 'bv@12mo');
  assert.ok(r.currentBookValue >= 0, 'never below salvage 0');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUM OF THE YEARS DIGIT
// cost 1300 · salvage 100 · life 36 mo → n=3, SYD=6, base=1200
// year factors: y1 3/6, y2 2/6, y3 1/6
// ─────────────────────────────────────────────────────────────────────────────
test('sum_of_years — full first year', () => {
  const r = computeDepreciation({
    cost: 1300, salvage: 100, method: 'sum_of_years',
    usefulLifeMonths: 36, acquisitionDate: '2024-01-01', asOf: '2025-01-01',
  });
  // year-1 dep = base × 3/6 = 1200 × 0.5 = 600
  near(r.accumulated, 600, 0.5, 'accumulated @ 12mo');
  near(r.currentBookValue, 700, 0.5, 'bookValue @ 12mo');
});

test('sum_of_years — PARTIAL second year prorated (I-1)', () => {
  const r = computeDepreciation({
    cost: 1300, salvage: 100, method: 'sum_of_years',
    usefulLifeMonths: 36, acquisitionDate: '2024-01-01', asOf: '2025-07-01', // 18 mo
  });
  // full y1 (600) + half of y2 (2/6 × 1200 = 400, ×0.5 = 200) = 800
  near(r.accumulated, 800, 0.5, 'accumulated @ 18mo');
  near(r.currentBookValue, 500, 0.5, 'bookValue @ 18mo');
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARDS — null not NaN; bookValue never negative
// ─────────────────────────────────────────────────────────────────────────────
test('guard — zero useful life → all-null, empty schedule, no NaN', () => {
  const r = computeDepreciation({
    cost: 2250000, salvage: 0, method: 'straight_line',
    usefulLifeMonths: 0, acquisitionDate: '2022-11-21', asOf: '2025-11-21',
  });
  assert.strictEqual(r.currentBookValue, null);
  assert.strictEqual(r.accumulated, null);
  assert.strictEqual(r.pctDepreciated, null);
  assert.deepStrictEqual(r.schedule, []);
  finiteOrNull(r.currentBookValue); finiteOrNull(r.accumulated); finiteOrNull(r.pctDepreciated);
});

test('guard — null cost → all-null', () => {
  const r = computeDepreciation({
    cost: null, salvage: 0, method: 'straight_line',
    usefulLifeMonths: 36, acquisitionDate: '2022-11-21', asOf: '2025-11-21',
  });
  assert.strictEqual(r.currentBookValue, null);
  assert.strictEqual(r.pctDepreciated, null);
  assert.deepStrictEqual(r.schedule, []);
});

test('guard — book value never negative, pctDepreciated bounded, no NaN across methods', () => {
  for (const method of Object.keys(METHODS)) {
    const r = computeDepreciation({
      cost: 1000, salvage: 0, method,
      usefulLifeMonths: 24, acquisitionDate: '2024-01-01', asOf: '2099-01-01',
    });
    assert.ok(r.currentBookValue >= 0, `${method}: bookValue >= 0`);
    finiteOrNull(r.currentBookValue, method);
    finiteOrNull(r.accumulated, method);
    finiteOrNull(r.pctDepreciated, method);
    for (const row of r.schedule) {
      assert.ok(row.bookValue >= 0, `${method}: schedule bookValue >= 0`);
      finiteOrNull(row.depreciation, method);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG parse / resolve
// ─────────────────────────────────────────────────────────────────────────────
test('parseDepreciationConfig — empty → defaults', () => {
  assert.deepStrictEqual(parseDepreciationConfig(''), DEFAULT_DEPRECIATION_CONFIG);
});

test('parseDepreciationConfig — bad JSON → defaults (safe)', () => {
  assert.deepStrictEqual(parseDepreciationConfig('{bad json'), DEFAULT_DEPRECIATION_CONFIG);
  assert.deepStrictEqual(parseDepreciationConfig('null'), DEFAULT_DEPRECIATION_CONFIG);
  assert.deepStrictEqual(parseDepreciationConfig('[]'), DEFAULT_DEPRECIATION_CONFIG);
});

test('parseDepreciationConfig — valid config round-trips', () => {
  const cfg = {
    default: { method: 'straight_line', useful_life_months: 48, salvage_pct: 0 },
    by_type: { Laptop: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0.1 } },
  };
  assert.deepStrictEqual(parseDepreciationConfig(JSON.stringify(cfg)), cfg);
});

test('resolveForType — exact, substring, fallback', () => {
  const cfg = {
    default: { method: 'straight_line', useful_life_months: 48, salvage_pct: 0 },
    by_type: { Laptop: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0.1 } },
  };
  assert.strictEqual(resolveForType(cfg, 'Laptop').useful_life_months, 36, 'exact');
  assert.strictEqual(resolveForType(cfg, 'HP Laptop 840').useful_life_months, 36, 'substring');
  assert.strictEqual(resolveForType(cfg, 'Unknown').useful_life_months, 48, 'fallback to default');
});

test('resolveForType — coalesces missing fields, no undefined/NaN (M-4)', () => {
  const cfg = {
    default: { method: 'straight_line', useful_life_months: 48 },
    by_type: { X: { method: 'straight_line' } },
  };
  const r = resolveForType(cfg, 'X');
  assert.strictEqual(r.salvage_pct, 0, 'salvage_pct coalesced to 0');
  assert.strictEqual(r.useful_life_months, 48, 'useful_life_months coalesced from default');
  for (const [k, v] of Object.entries(r)) {
    assert.ok(!(typeof v === 'number' && Number.isNaN(v)), `resolved.${k} not NaN`);
    // declinePercent may legitimately be undefined (only set for declining_balance)
    if (k !== 'declinePercent') assert.notStrictEqual(v, undefined, `resolved.${k} not undefined`);
  }
});

test('METHODS + DEFAULT_DEPRECIATION_CONFIG exports', () => {
  assert.deepStrictEqual(Object.keys(METHODS).sort(),
    ['declining_balance', 'double_declining', 'straight_line', 'sum_of_years']);
  assert.ok(DEFAULT_DEPRECIATION_CONFIG.default, 'has default');
  assert.ok(DEFAULT_DEPRECIATION_CONFIG.by_type.Laptop, 'has Laptop type');
});
