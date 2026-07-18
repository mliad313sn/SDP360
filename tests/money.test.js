'use strict';
// Task 0 — currency infrastructure. money.js is PURE (no requires).
// Finance surfaces display USD: assets are XOF (converted via xof_usd_rate),
// licence cost is already USD. No currency glyph is ever rendered — USD clarity
// is via a text label, and the digest asserts !html.includes('$').
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount, toUsd, fmtUsd } = require('../services/money');

test('parseAmount handles comma / space / $ thousands separators', () => {
  assert.strictEqual(parseAmount('2,250,000.00'), 2250000);
  assert.strictEqual(parseAmount('55 920.00'), 55920);
  assert.strictEqual(parseAmount('$1,250'), 1250);
});

test('parseAmount keeps zero, rejects empty / null / garbage', () => {
  assert.strictEqual(parseAmount('0.00'), 0);
  assert.strictEqual(parseAmount(''), null);
  assert.strictEqual(parseAmount(null), null);
  assert.strictEqual(parseAmount('abc'), null);
  assert.strictEqual(parseAmount(undefined), null);
});

test('toUsd converts XOF via rate, propagates null, keeps zero', () => {
  assert.ok(Math.abs(toUsd('2,250,000.00', 0.00165) - 3712.5) < 0.01);
  assert.strictEqual(toUsd('', 0.00165), null);
  assert.strictEqual(toUsd('0.00', 0.00165), 0);
  assert.strictEqual(toUsd(null, 0.00165), null);
});

test('fmtUsd — thousands sep, 2dp, NO currency glyph', () => {
  assert.strictEqual(fmtUsd(3712.5), '3,712.50');
  assert.ok(!fmtUsd(3712.5).includes('$'));
  assert.strictEqual(fmtUsd(null), '—');
  assert.strictEqual(fmtUsd(0), '0.00');
});
