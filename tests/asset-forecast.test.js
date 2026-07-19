'use strict';
// Task 0 — the PURE forecast engine services/assetForecast.js.
// Exhaustive unit coverage: investment history, hardware CAPEX forecast,
// software renewal forecast, and coverage-% transparency on every builder.
// asOf is ALWAYS passed explicitly (currentYear derives from it).

const test = require('node:test');
const assert = require('node:assert');

const AF = require('../services/assetForecast');

// The config uses the REAL key `by_type` (resolveForType reads cfg.by_type;
// a `types` key is silently ignored). Desktop is deliberately OUT of by_type so
// it resolves to `default` (36mo). Keys chosen so the fuzzy
// pt.includes(k)||k.includes(pt) match never cross-matches.
const config = {
  default: { method: 'straight_line', useful_life_months: 36, salvage_pct: 0 },
  by_type: {
    Laptop: { method: 'straight_line', useful_life_months: 60, salvage_pct: 0 },
    ServerLike: { method: 'straight_line', useful_life_months: 120, salvage_pct: 0 },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
test('_yearOf: ISO / empty / garbage', () => {
  assert.strictEqual(AF._yearOf('2022-05-01'), 2022);
  assert.strictEqual(AF._yearOf('2024-03-01'), 2024);
  assert.strictEqual(AF._yearOf(''), null);
  assert.strictEqual(AF._yearOf(null), null);
  assert.strictEqual(AF._yearOf('not a date'), null);
});

test('_expiryYearOf: DD Mon YYYY parses (the licence-date trap)', () => {
  assert.strictEqual(AF._expiryYearOf('30 Jun 2027'), 2027);
  assert.strictEqual(AF._expiryYearOf('30 Jun 2024'), 2024);
  assert.strictEqual(AF._expiryYearOf(''), null);
  assert.strictEqual(AF._expiryYearOf('garbage'), null);
});

// ── History ─────────────────────────────────────────────────────────────────
test('buildInvestmentHistory: gap-filled years + cumulative + coverage', () => {
  const assetRows = [
    { acquisition_date: '2022-05-01', purchase_cost: '1,200.00' },
    { acquisition_date: '2024-03-01', purchase_cost: '800.00' },
    { acquisition_date: '', purchase_cost: '500' },        // no_date
    { acquisition_date: '2022-09-01', purchase_cost: '0.00' }, // no_cost
  ];
  const licenceRows = [{ acquisition_date: '2023-01-01', cost: '300' }];
  const out = AF.buildInvestmentHistory(assetRows, licenceRows, 1);

  assert.deepStrictEqual(out.years, [
    { year: 2022, hardware_usd: 1200, software_usd: 0, total_usd: 1200, cumulative_usd: 1200 },
    { year: 2023, hardware_usd: 0, software_usd: 300, total_usd: 300, cumulative_usd: 1500 },
    { year: 2024, hardware_usd: 800, software_usd: 0, total_usd: 800, cumulative_usd: 2300 },
  ]);
  assert.deepStrictEqual(out.coverage.hardware, {
    eligible: 2, total: 4, pct: 50, excluded: { no_date: 1, no_cost: 1 },
  });
  assert.deepStrictEqual(out.coverage.software, {
    eligible: 1, total: 1, pct: 100, excluded: { no_date: 0, no_cost: 0 },
  });
});

test('buildInvestmentHistory: empty input → empty years, zero coverage (no NaN)', () => {
  const out = AF.buildInvestmentHistory([], [], 1);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.coverage.hardware.pct, 0);
  assert.strictEqual(out.coverage.software.pct, 0);
});

test('buildInvestmentHistory: rate applies to summed amount but NOT to eligibility', () => {
  const assetRows = [{ acquisition_date: '2022-01-01', purchase_cost: '1,000,000.00' }];
  const out = AF.buildInvestmentHistory(assetRows, [], 0.00165);
  // eligibility gate is rate-independent → still eligible regardless of rate
  assert.strictEqual(out.coverage.hardware.eligible, 1);
  assert.strictEqual(out.years[0].hardware_usd, Math.round(1000000 * 0.00165)); // 1650
});

// ── Hardware forecast (ONE scenario per call) ───────────────────────────────
test('buildHardwareForecast CALL A — Desktop 36mo, due_now', () => {
  const out = AF.buildHardwareForecast(
    [{ acquisition_date: '2022-01-01', purchase_cost: '1200', product_type: 'Desktop' }],
    { config, rate: 1, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01' });
  assert.strictEqual(out.due_now.count, 1);
  assert.strictEqual(out.due_now.replacement_usd, 1200);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.total_forecast_usd, 1200);
  assert.strictEqual(out.beyond_horizon.count, 0);
});

test('buildHardwareForecast CALL B — Laptop 60mo, in-horizon 2029 w/ uplift', () => {
  const out = AF.buildHardwareForecast(
    [{ acquisition_date: '2024-01-01', purchase_cost: '1000', product_type: 'Laptop' }],
    { config, rate: 1, upliftPct: 0.03, horizonYears: 5, asOf: '2026-07-01' });
  const expected = Math.round(1000 * Math.pow(1.03, 3));
  assert.deepStrictEqual(out.years, [{ year: 2029, replacement_usd: expected, count: 1 }]);
  assert.strictEqual(out.due_now.count, 0);
  assert.strictEqual(out.total_forecast_usd, expected);
  // invariant: total === due_now + Σyears (excludes beyond_horizon)
  assert.strictEqual(
    out.total_forecast_usd,
    out.due_now.replacement_usd + out.years.reduce((s, y) => s + y.replacement_usd, 0));
});

test('buildHardwareForecast CALL C — ServerLike 120mo, beyond horizon', () => {
  const out = AF.buildHardwareForecast(
    [{ acquisition_date: '2025-01-01', purchase_cost: '2000', product_type: 'ServerLike' }],
    { config, rate: 1, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01' });
  assert.strictEqual(out.beyond_horizon.count, 1);
  assert.strictEqual(out.beyond_horizon.usd, 2000);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.total_forecast_usd, 0);
  assert.strictEqual(out.coverage.eligible, 1);
});

test('buildHardwareForecast CALL D — exclusions (no_date, no_cost)', () => {
  const out = AF.buildHardwareForecast(
    [
      { acquisition_date: '', purchase_cost: '900', product_type: 'Desktop' },
      { acquisition_date: '2023-01-01', purchase_cost: '0.00', product_type: 'Desktop' },
    ],
    { config, rate: 1, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01' });
  assert.strictEqual(out.coverage.eligible, 0);
  assert.deepStrictEqual(out.coverage.excluded, { no_date: 1, no_cost: 1, no_life: 0 });
  assert.strictEqual(out.coverage.total, 2);
  assert.strictEqual(out.coverage.pct, 0);
});

test('buildHardwareForecast CALL E — empty input, no NaN', () => {
  const out = AF.buildHardwareForecast([], { config, rate: 1, upliftPct: 0, horizonYears: 5, asOf: '2026-07-01' });
  assert.strictEqual(out.coverage.pct, 0);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.due_now.count, 0);
  assert.strictEqual(out.total_forecast_usd, 0);
});

// ── Software forecast (ONE scenario per call) ───────────────────────────────
const SW = { horizonYears: 5, asOf: '2026-07-01' }; // year slots 2027..2031

test('buildSoftwareForecast S1 — perpetual in-horizon 2027 (DD Mon YYYY)', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2027', cost: '500', license_option: 'Perpetual' }], SW);
  assert.deepStrictEqual(out.years, [{ year: 2027, renewal_usd: 500, count: 1 }]);
  assert.strictEqual(out.due_now.count, 0);
  assert.strictEqual(out.beyond_horizon.count, 0);
  assert.strictEqual(out.recurring_count, 0);
  assert.strictEqual(out.total_forecast_usd, 500);
});

test('buildSoftwareForecast S2 — expired perpetual → due_now', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2024', cost: '400', license_option: 'Perpetual' }], SW);
  assert.strictEqual(out.due_now.renewal_usd, 400);
  assert.strictEqual(out.due_now.count, 1);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.total_forecast_usd, 400);
});

test('buildSoftwareForecast S3 — perpetual beyond horizon', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2035', cost: '700', license_option: 'Perpetual' }], SW);
  assert.strictEqual(out.beyond_horizon.count, 1);
  assert.strictEqual(out.beyond_horizon.usd, 700);
  assert.deepStrictEqual(out.years, []);
  assert.strictEqual(out.due_now.count, 0);
  assert.strictEqual(out.total_forecast_usd, 0);
});

test('buildSoftwareForecast S4 — recurring (Subscription) in-horizon fills every year', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2027', cost: '100', license_option: 'Subscription' }], SW);
  assert.deepStrictEqual(out.years, [
    { year: 2027, renewal_usd: 100, count: 1 },
    { year: 2028, renewal_usd: 100, count: 1 },
    { year: 2029, renewal_usd: 100, count: 1 },
    { year: 2030, renewal_usd: 100, count: 1 },
    { year: 2031, renewal_usd: 100, count: 1 },
  ]);
  assert.strictEqual(out.recurring_count, 1);
  assert.strictEqual(out.beyond_horizon.count, 0);
  assert.strictEqual(out.due_now.count, 0);
  assert.strictEqual(out.total_forecast_usd, 500);
});

test('buildSoftwareForecast S5 — recurring beyond-horizon STILL fills every year (never beyond)', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2035', cost: '150', license_option: 'Subscription' }], SW);
  assert.deepStrictEqual(out.years, [
    { year: 2027, renewal_usd: 150, count: 1 },
    { year: 2028, renewal_usd: 150, count: 1 },
    { year: 2029, renewal_usd: 150, count: 1 },
    { year: 2030, renewal_usd: 150, count: 1 },
    { year: 2031, renewal_usd: 150, count: 1 },
  ]);
  assert.strictEqual(out.beyond_horizon.count, 0);
  assert.strictEqual(out.recurring_count, 1);
  assert.strictEqual(out.total_forecast_usd, 750);
});

test('buildSoftwareForecast S6 — expired recurring → due_now AND every year, no same-year double-count', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2024', cost: '200', license_option: 'Annual' }], SW);
  assert.strictEqual(out.due_now.renewal_usd, 200);
  assert.strictEqual(out.due_now.count, 1);
  assert.deepStrictEqual(out.years, [
    { year: 2027, renewal_usd: 200, count: 1 },
    { year: 2028, renewal_usd: 200, count: 1 },
    { year: 2029, renewal_usd: 200, count: 1 },
    { year: 2030, renewal_usd: 200, count: 1 },
    { year: 2031, renewal_usd: 200, count: 1 },
  ]);
  assert.strictEqual(out.recurring_count, 1);
  assert.strictEqual(out.total_forecast_usd, 1200); // 200 due_now + 5×200
});

test('buildSoftwareForecast S7 — Volume is NOT recurring (single)', () => {
  const out = AF.buildSoftwareForecast([{ expiry_date: '30 Jun 2027', cost: '50', license_option: 'Volume' }], SW);
  assert.deepStrictEqual(out.years, [{ year: 2027, renewal_usd: 50, count: 1 }]);
  assert.strictEqual(out.recurring_count, 0);
  assert.strictEqual(out.total_forecast_usd, 50);
});

test('buildSoftwareForecast S8 — exclusions (no_expiry, no_cost)', () => {
  const out = AF.buildSoftwareForecast([
    { expiry_date: '', cost: '10', license_option: 'Perpetual' },
    { expiry_date: '30 Jun 2027', cost: '0.00', license_option: 'Perpetual' },
  ], SW);
  assert.strictEqual(out.coverage.eligible, 0);
  assert.deepStrictEqual(out.coverage.excluded, { no_expiry: 1, no_cost: 1 });
  assert.strictEqual(out.coverage.total, 2);
  assert.strictEqual(out.coverage.pct, 0);
});
