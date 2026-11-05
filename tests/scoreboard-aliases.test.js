'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { assetLabelToCode, foldEffortByCode, ALIAS } = require('../services/scoreboardAliases');

test('assetLabelToCode maps AP labels to canonical meetings codes', () => {
  assert.strictEqual(assetLabelToCode('HOUNDE'), 'HGO');
  assert.strictEqual(assetLabelToCode('MANA'), 'MGO');
  assert.strictEqual(assetLabelToCode('Sabodala'), 'SGO');
  assert.strictEqual(assetLabelToCode('Ouagadougou'), 'OUA');
  assert.strictEqual(assetLabelToCode('Ouaga'), 'OUA');
  assert.strictEqual(assetLabelToCode('LAFIGUE'), 'SML');
  assert.strictEqual(assetLabelToCode('ITY'), 'SMI');
  assert.strictEqual(assetLabelToCode('KALANA'), 'KGO');
  assert.strictEqual(assetLabelToCode('ABIDJAN'), 'ABJ');
  assert.strictEqual(assetLabelToCode('Dakar'), 'DKR');
});

// 2026-11-05 — user decision: Massawa is its OWN site, never folded into Sabodala/SGO.
test('Massawa is separated from Sabodala (own code, own fold key)', () => {
  const SiteAliases = require('../public/lib/siteAliases');
  assert.strictEqual(assetLabelToCode('MASSAWA'), 'MASSAWA');
  assert.strictEqual(assetLabelToCode('Massawa'), 'MASSAWA');
  assert.strictEqual(assetLabelToCode('Sabodala'), 'SGO');
  assert.notStrictEqual(SiteAliases.siteFoldKey('Massawa'), SiteAliases.siteFoldKey('Sabodala'));
  const m = foldEffortByCode([
    { site: 'Sabodala', effort_score: 70 },
    { site: 'MASSAWA', effort_score: 30 },
  ]);
  assert.strictEqual(m.get('SGO'), 70, 'Massawa no longer drags the Sabodala mean');
  assert.strictEqual(m.get('MASSAWA'), 30);
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
    { site: 'Ouaga', effort_score: 40 },
    { site: 'Ouagadougou', effort_score: 66 },
    { site: 'NOPE', effort_score: 10 },
  ]);
  assert.ok(m instanceof Map);
  assert.strictEqual(m.get('HGO'), 52);
  assert.strictEqual(m.get('OUA'), 53); // round((40+66)/2)
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

// Step 3 — registry-first: site_module_codes (module='assets') beats the in-code map.
test('setRegistry / loadFromRegistry: registry rows win over ALIAS, fallback stays when absent', async () => {
  const { setRegistry, loadFromRegistry } = require('../services/scoreboardAliases');
  const rdb = { listSiteModuleCodes: async (m) => m === 'assets' ? [{ site_id: 1, code: 'HOUNDE,Hounde Gold' }, { site_id: 9, code: 'NEWSITE' }] : m === 'meetings' ? [{ site_id: 1, code: 'HGO' }, { site_id: 9, code: 'NEW' }] : [] };
  const map = await loadFromRegistry(rdb);
  assert.strictEqual(map['hounde gold'], 'HGO');
  assert.strictEqual(assetLabelToCode('NewSite'), 'NEW');       // registry-only label
  assert.strictEqual(assetLabelToCode('Sabodala'), 'SGO');      // ALIAS fallback for a label not in the registry
  setRegistry(null);
  assert.strictEqual(assetLabelToCode('NewSite'), null);
});
