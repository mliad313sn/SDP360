'use strict';
// A-26 — per-site currency resolution (asset_site_currency / asset_currency_rates).
// PURE module; an empty map means "today": every asset site is XOF at xof_usd_rate.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../services/currency');

test('resolveSiteCurrency folds case and accents', () => {
  const map = C.parseCurrencyMap('{"HOUNDE":"xof","London":"GBP"}');
  assert.strictEqual(C.resolveSiteCurrency('Houndé', map), 'XOF');
  assert.strictEqual(C.resolveSiteCurrency('  hounde ', map), 'XOF');
  assert.strictEqual(C.resolveSiteCurrency('LONDON', map), 'GBP');
});

test('unmapped site: null without "*", the default with "*"', () => {
  assert.strictEqual(C.resolveSiteCurrency('LONDON', C.parseCurrencyMap('{"MANA":"XOF"}')), null);
  assert.strictEqual(C.resolveSiteCurrency('LONDON', C.parseCurrencyMap('{"MANA":"XOF","*":"XOF"}')), 'XOF');
  assert.strictEqual(C.resolveSiteCurrency(null, C.parseCurrencyMap('{"MANA":"XOF"}')), null);
});

test('invalid / blank map → {} (legacy behaviour), never throws', () => {
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    assert.deepStrictEqual(C.parseCurrencyMap('{not json'), {});
    assert.deepStrictEqual(C.parseCurrencyMap('["XOF"]'), {});
    assert.ok(warned >= 2);
  } finally { console.warn = warn; }
  assert.deepStrictEqual(C.parseCurrencyMap(''), {});
  assert.deepStrictEqual(C.parseCurrencyMap(null), {});
});

test('parseRates defaults to {XOF: xofRate, USD: 1}; bad entries ignored; never 1 for XOF by accident', () => {
  assert.deepStrictEqual(C.parseRates('', 0.00165), { XOF: 0.00165, USD: 1 });
  assert.deepStrictEqual(C.parseRates('{"gbp":1.27,"EUR":0,"JPY":"x"}', 0.00165), { XOF: 0.00165, USD: 1, GBP: 1.27 });
  assert.deepStrictEqual(C.parseRates('nope', 0.002), { XOF: 0.002, USD: 1 });
});

test('moneyContext: empty map = legacy single rate; map set = per-site rate or null', () => {
  const legacy = C.moneyContext({ rate: 0.00165 });
  assert.strictEqual(legacy.active, false);
  assert.strictEqual(legacy.rateOf('LONDON'), 0.00165);
  const ctx = C.moneyContext({ rate: 0.00165, currencyMap: '{"MANA":"XOF"}', rates: '' });
  assert.strictEqual(ctx.active, true);
  assert.strictEqual(ctx.rateOf('MANA'), 0.00165);
  assert.strictEqual(ctx.rateOf('LONDON'), null);
  assert.strictEqual(ctx.currencyOf('LONDON'), null);
});

test('optsFromConfig reads the five switches with today as default', () => {
  const o = C.optsFromConfig({}, 0.00165);
  assert.deepStrictEqual(o, { rate: 0.00165, mode: 'legacy', currencyMap: {}, rates: { XOF: 0.00165, USD: 1 },
    outlierFactor: 10, outlierExclude: false });
  const p = C.optsFromConfig({ asset_amount_parser: 'locale', asset_cost_outlier_factor: '5',
    asset_cost_outlier_exclude: '1', asset_site_currency: '{"*":"XOF"}' }, 0.002);
  assert.strictEqual(p.mode, 'locale'); assert.strictEqual(p.outlierFactor, 5); assert.strictEqual(p.outlierExclude, true);
  assert.deepStrictEqual(p.currencyMap, { '*': 'XOF' });
});
