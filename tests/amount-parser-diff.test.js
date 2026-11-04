'use strict';
// A-26 — the read-only parser-diff dry run (tools/assets/amount-parser-diff.js).
const test = require('node:test');
const assert = require('node:assert');

test('require() does not execute the CLI and exposes the pure core', () => {
  const before = process.exitCode;
  const cli = require('../tools/assets/amount-parser-diff');
  assert.strictEqual(typeof cli.diffAmounts, 'function');
  assert.strictEqual(typeof cli.main, 'function');
  assert.strictEqual(process.exitCode, before);
});

test('fixture shapes give zero differences; "2 250 000,00" gives one', () => {
  const { diffAmounts } = require('../tools/assets/amount-parser-diff');
  const fixture = ['9.99', '999,999.99', '9,999,999.99', '9,999.99', '0.00', ''].map((v, i) =>
    ({ asset_id: 'A' + i, site: 'MANA', purchase_cost: v }));
  const a = diffAmounts(fixture);
  assert.strictEqual(a.total, 6);
  assert.strictEqual(a.differing.length, 0);
  const b = diffAmounts([...fixture, { asset_id: 'X', site: 'LONDON', purchase_cost: '2 250 000,00' }]);
  assert.strictEqual(b.differing.length, 1);
  assert.deepStrictEqual(b.differing[0], { asset_id: 'X', site: 'LONDON', field: 'purchase_cost',
    raw: '2 250 000,00', legacy: 225000000, locale: 2250000 });
});

test('a candidate map lists the sites without a currency', () => {
  const { diffAmounts } = require('../tools/assets/amount-parser-diff');
  const rows = [{ asset_id: '1', site: 'MANA', purchase_cost: '1.00' }, { asset_id: '2', site: 'LONDON', purchase_cost: '1.00' },
    { asset_id: '3', site: 'LONDON', purchase_cost: '2.00' }];
  const r = diffAmounts(rows, { map: { MANA: 'XOF' } });
  assert.deepStrictEqual(r.sites_without_currency, [{ site: 'LONDON', assets: 2 }]);
  assert.deepStrictEqual(diffAmounts(rows).sites_without_currency, []);
});
