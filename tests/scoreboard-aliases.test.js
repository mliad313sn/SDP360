'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assetLabelToCode, foldEffortByCode, ALIAS } = require('../services/scoreboardAliases');

test('assetLabelToCode maps AP labels to canonical meetings codes', () => {
  assert.strictEqual(assetLabelToCode('HOUNDE'), 'HGO');
  assert.strictEqual(assetLabelToCode('MANA'), 'MGO');
  assert.strictEqual(assetLabelToCode('Sabodala'), 'SGO');
  assert.strictEqual(assetLabelToCode('MASSAWA'), 'SGO');
  assert.strictEqual(assetLabelToCode('LAFIGUE'), 'SML');
  assert.strictEqual(assetLabelToCode('ITY'), 'SMI');
  assert.strictEqual(assetLabelToCode('KALANA'), 'KGO');
  assert.strictEqual(assetLabelToCode('ABIDJAN'), 'ABJ');
  assert.strictEqual(assetLabelToCode('Dakar'), 'DKR');
});

test('assetLabelToCode is accent/case-fold + trim tolerant', () => {
  assert.strictEqual(assetLabelToCode('hounde'), 'HGO');
  assert.strictEqual(assetLabelToCode('Houndé'), 'HGO');
  assert.strictEqual(assetLabelToCode(' MANA '), 'MGO');
});

test('assetLabelToCode returns null for unknown/empty/null', () => {
  assert.strictEqual(assetLabelToCode('LONDON'), null);
  assert.strictEqual(assetLabelToCode(''), null);
  assert.strictEqual(assetLabelToCode(null), null);
});

test('foldEffortByCode folds multiple labels per code by simple mean', () => {
  const m = foldEffortByCode([
    { site: 'HOUNDE', effort_score: 52 },
    { site: 'MASSAWA', effort_score: 40 },
    { site: 'Sabodala', effort_score: 66 },
    { site: 'NOPE', effort_score: 10 },
  ]);
  assert.ok(m instanceof Map);
  assert.strictEqual(m.get('HGO'), 52);
  assert.strictEqual(m.get('SGO'), 53); // round((40+66)/2)
  assert.strictEqual(m.has('NOPE'), false);
  assert.strictEqual(m.size, 2);
});

test('foldEffortByCode handles empty + single-label cases', () => {
  const empty = foldEffortByCode([]);
  assert.ok(empty instanceof Map);
  assert.strictEqual(empty.size, 0);

  const single = foldEffortByCode([{ site: 'MANA', effort_score: 70 }]);
  assert.strictEqual(single.get('MGO'), 70);
});

test('ALIAS is exported', () => {
  assert.strictEqual(typeof ALIAS, 'object');
});
