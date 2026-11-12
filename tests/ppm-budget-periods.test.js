'use strict';
// E-P04 (audit P-04) — budget per period, pure rules (services/ppmBudgetPeriods.js) + the project-page renderer
// (public/lib/ppmExtras.js). Fictitious figures only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const BP = require('../services/ppmBudgetPeriods');
const X = require('../public/lib/ppmExtras');
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');

const rows = [
  { period: '2026-09', currency: 'USD', kind: 'baseline', amount: 100 }, { period: '2026-09', currency: 'USD', kind: 'actual', amount: 120 },
  { period: '2026-10', currency: 'USD', kind: 'baseline', amount: 100 }, { period: '2026-10', currency: 'USD', kind: 'actual', amount: 90 },
  { period: '2026-12', currency: 'USD', kind: 'baseline', amount: 100 }, { period: '2026-12', currency: 'USD', kind: 'forecast', amount: 130 },
  { period: '2026-10', currency: 'XOF', kind: 'baseline', amount: 50000 },
];

test('two currencies are never summed: one block per currency, no grand total', () => {
  const v = BP.view(rows, { asOf: '2026-11-06' });
  assert.deepEqual(v.currencies.map((c) => c.currency), ['USD', 'XOF']);
  assert.equal(v.never_summed_across_currencies, true);
  assert.equal(v.total, undefined); assert.equal(v.eac, undefined);
  assert.equal(v.currencies[0].baseline_total, 300); assert.equal(v.currencies[1].baseline_total, 50000);
});

test('EAC = actual to date + remaining forecast; variance vs baseline; missing period / kind → null', () => {
  const usd = BP.view(rows, { asOf: '2026-11-06' }).currencies[0];
  assert.equal(usd.actual_to_date, 210); assert.equal(usd.remaining_forecast, 130); assert.equal(usd.eac, 340); assert.equal(usd.variance, 40);
  assert.equal(usd.eac_basis, 'actual_plus_forecast');
  const nov = usd.periods.find((p) => p.period === '2026-11'); assert.equal(nov, undefined, 'a month with no row is absent, never 0');
  const dec = usd.periods.find((p) => p.period === '2026-12'); assert.equal(dec.actual, null);
  const xof = BP.view(rows, { asOf: '2026-11-06' }).currencies[1];
  assert.equal(xof.eac, null); assert.equal(xof.variance, null); assert.equal(xof.actual_to_date, null); assert.equal(xof.eac_basis, 'none');
  assert.deepEqual(BP.view([], { asOf: '2026-11-06' }).currencies, []);
});

test('justification required on a change and on a variance vs the period baseline; validation of the row', () => {
  assert.equal(BP.needsJustification({ row: { kind: 'baseline', amount: 100 } }), false, 'a first baseline needs none');
  assert.equal(BP.needsJustification({ row: { kind: 'actual', amount: 100 }, baseline: { amount: 100 } }), false);
  assert.equal(BP.needsJustification({ row: { kind: 'actual', amount: 120 }, baseline: { amount: 100 } }), true);
  assert.equal(BP.needsJustification({ row: { kind: 'baseline', amount: 90 }, existing: { amount: 100 } }), true);
  assert.equal(BP.validate({ period: '2026-13', currency: 'USD', kind: 'actual', amount: 1 }), 'period must be YYYY-MM');
  assert.match(BP.validate({ period: '2026-01', currency: 'usd', kind: 'actual', amount: 1 }), /ISO/);
  assert.match(BP.validate({ period: '2026-01', currency: 'USD', kind: 'actual', amount: -1 }), /≥ 0/);
  assert.match(BP.validate({ period: '2026-01', currency: 'USD', kind: 'eac', amount: 1 }), /kind/);
  assert.equal(BP.validate({ period: '2026-01', currency: 'USD', kind: 'forecast', amount: 0 }), null);
});

test('renderer: money stripped for a reader without money rights, "not certified" always, values escaped', () => {
  const hidden = X.budgetHtml({ money_hidden: true, view: null, certification: BP.CERTIFICATION }, esc);
  assert.match(hidden, /restricted/); assert.doesNotMatch(hidden, /\d{3}/); assert.match(hidden, /not certified/);
  const h = X.budgetHtml({ view: BP.view(rows, { asOf: '2026-11-06' }), certification: BP.CERTIFICATION }, esc);
  assert.match(h, /<h3>USD<\/h3>/); assert.match(h, /<b>340<\/b>/); assert.match(h, /never added together/); assert.match(h, /not certified/);
  assert.match(X.budgetHtml({ view: { currencies: [{ currency: '<x>', periods: [], eac_basis: 'none' }] } }, esc), /&#60;x&#62;/);
});

test('project.html: the Budget tab is hidden and only joins the tabs when the switch answers', () => {
  const pj = fs.readFileSync(path.join(__dirname, '..', 'public', 'project.html'), 'utf8');
  assert.match(pj, /id="tab-budget"[^>]*hidden/);
  assert.match(pj, /if \(FEAT\.budget_periods\) addTab\("budget", "gates"\)/);
  assert.match(pj, /src="lib\/ppmExtras\.js"/);
});
