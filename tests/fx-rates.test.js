'use strict';
// B8 — dated FX rates, pure: the rate of a day, reproducible conversion naming the rate used, never a silent cross-currency sum.
const { test } = require('node:test');
const assert = require('node:assert');
const FX = require('../services/fxRates');

const RATES = [
  { id: 1, currency: 'XOF', effective_from: '2026-01-01', rate: 0.0016, source: 'BCEAO' },
  { id: 2, currency: 'XOF', effective_from: '2026-07-01', rate: 0.00165, source: 'BCEAO' },
  { id: 3, currency: 'EUR', effective_from: '2026-01-01', rate: 1.08, source: 'ECB' },
  { id: 4, currency: 'EUR', effective_from: '2026-09-01', rate: 1.10, source: 'ECB', retired_at: '2026-09-02T00:00:00Z' },
];

test('rateOn: latest non-retired rate effective on that day; USD is the base; none → null', () => {
  assert.equal(FX.rateOn(RATES, 'XOF', '2026-06-30').id, 1);
  assert.equal(FX.rateOn(RATES, 'XOF', '2026-07-01').id, 2);
  assert.equal(FX.rateOn(RATES, 'EUR', '2026-10-01').id, 3, 'a retired rate is never used');
  assert.equal(FX.rateOn(RATES, 'USD', '2026-10-01').rate, 1);
  assert.equal(FX.rateOn(RATES, 'XOF', '2025-12-31'), null);
});

test('convert: names both rates + date; reproducible; missing rate → null value, never 0', () => {
  const a = FX.convert(1000000, 'XOF', 'USD', '2026-08-15', RATES);
  assert.equal(a.value, 1650); assert.equal(a.from_rate.id, 2); assert.equal(a.to_rate.currency, 'USD');
  assert.match(a.basis, /XOF→USD @ 0\.00165.*2026-07-01.*BCEAO/);
  assert.deepEqual(FX.convert(1000000, 'XOF', 'USD', '2026-08-15', RATES), a, 'same inputs, same output');
  const e = FX.convert(1000000, 'XOF', 'EUR', '2026-08-15', RATES);
  assert.equal(e.value, 1527.78); assert.equal(e.to_rate.id, 3);
  const m = FX.convert(100, 'XOF', 'USD', '2025-01-01', RATES);
  assert.equal(m.value, null); assert.deepEqual(m.missing, ['XOF']);
  assert.equal(FX.convert(100, 'USD', 'USD', '2025-01-01', RATES).value, 100);
});

test('convertTotals: per-currency totals stay; a converted total exists only when every currency converts', () => {
  const t = FX.convertTotals([{ currency: 'XOF', amount: 1000000 }, { currency: 'EUR', amount: 100 }], 'USD', '2026-08-15', RATES);
  assert.deepEqual(t.by_currency.map((x) => x.currency), ['XOF', 'EUR']);
  assert.equal(t.converted_total, 1758); assert.equal(t.rates_used.length, 2);
  const u = FX.convertTotals([{ currency: 'XOF', amount: 1 }, { currency: 'GBP', amount: 1 }], 'USD', '2026-08-15', RATES);
  assert.equal(u.converted_total, null); assert.deepEqual(u.missing, ['GBP']);
});

test('validateRate: XOF / EUR only, ISO day, positive rate, a source', () => {
  assert.equal(FX.validateRate({ currency: 'XOF', effective_from: '2026-11-01', rate: 0.0017, source: 'BCEAO' }), null);
  assert.ok(FX.validateRate({ currency: 'USD', effective_from: '2026-11-01', rate: 1, source: 'x' }));
  assert.ok(FX.validateRate({ currency: 'GBP', effective_from: '2026-11-01', rate: 1.2, source: 'x' }));
  assert.ok(FX.validateRate({ currency: 'XOF', effective_from: '01/11/2026', rate: 0.0017, source: 'x' }));
  assert.ok(FX.validateRate({ currency: 'XOF', effective_from: '2026-11-01', rate: 0, source: 'x' }));
  assert.ok(FX.validateRate({ currency: 'XOF', effective_from: '2026-11-01', rate: 0.0017, source: '' }));
});

test('displayCurrency: user preference, else the site currency, else USD', () => {
  assert.equal(FX.displayCurrency({ pref: 'EUR', siteCurrency: 'XOF' }), 'EUR');
  assert.equal(FX.displayCurrency({ pref: null, siteCurrency: 'XOF' }), 'XOF');
  assert.equal(FX.displayCurrency({ pref: null, siteCurrency: 'GBP' }), 'USD', 'an unsupported site currency falls back to USD');
  assert.equal(FX.displayCurrency({}), 'USD');
});
