'use strict';
// E-D01 — site_codes_from_registry = 'shadow': the hard maps answer (like '0'), the registry answer is
// computed and a divergence is logged once per day per site × module; '0' and '1' unchanged.
const { test } = require('node:test');
const assert = require('node:assert');
const SCR = require('../services/siteCodeRegistry');

const hard = (n) => ({ Hounde: 'HGO', Tanda: 'TND' })[n] || null;
const reg = () => new Map([['tracker', new Map([['hounde', 'HGX'], ['tanda', 'TND']])]]);
function rdbStub() { const events = []; return { events, logEvent: (e) => events.push(e) }; }

test("'0': hard map only, nothing logged", () => {
  const r = rdbStub(); SCR._setForTest(false, reg(), r);
  assert.equal(SCR.resolve('tracker', 'Hounde', hard), 'HGO');
  assert.equal(r.events.length, 0); assert.equal(SCR.status().mode, '0');
});

test("'shadow': answers like '0' and logs the divergence once", () => {
  const r = rdbStub(); SCR._setForTest('shadow', reg(), r);
  assert.equal(SCR.status().enabled, false); assert.equal(SCR.status().mode, 'shadow');
  for (let i = 0; i < 3; i++) assert.equal(SCR.resolve('tracker', 'Hounde', hard), 'HGO');
  assert.equal(SCR.resolve('tracker', 'Tanda', hard), 'TND', 'same answer on both sides = no divergence');
  assert.equal(SCR.resolve('tracker', 'Nowhere', hard), null, 'absent from the registry = no divergence');
  assert.equal(SCR.lookup('tracker', 'Hounde'), undefined, 'lookup stays silent in shadow');
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.category, 'governance'); assert.equal(e.action, 'site_code_shadow_divergence');
  assert.deepStrictEqual([e.details.hard_coded, e.details.registry, e.details.answered], ['HGO', 'HGX', 'HGO']);
});

test("'1': the registry wins, nothing logged", () => {
  const r = rdbStub(); SCR._setForTest(true, reg(), r);
  assert.equal(SCR.resolve('tracker', 'Hounde', hard), 'HGX');
  assert.equal(SCR.resolve('tracker', 'Nowhere', hard), null);
  assert.equal(r.events.length, 0);
  SCR._setForTest(false, new Map(), null);
});

test('parseMode accepts exactly 0 / 1 / shadow', () => {
  assert.deepStrictEqual(['1', 'shadow', 'SHADOW', '0', '', null, 'yes'].map(SCR.parseMode), ['1', 'shadow', 'shadow', '0', '0', '0', '0']);
});

test('the module lookups route through resolve (tracker, inspection, meetings)', () => {
  const r = rdbStub(); SCR._setForTest('shadow', new Map([['tracker', new Map([['hounde', 'ZZZ']])], ['inspection', new Map([['hounde', 'ZZI']])], ['meetings', new Map([['hounde', 'ZZM']])]]), r);
  const t = require('../tracker-db'); const ins = require('../inspection-db');
  assert.equal(t.siteNameToCode('Hounde'), t.hardSiteNameToCode('Hounde'));
  assert.equal(ins.siteNameToCode('Hounde'), ins.hardSiteNameToCode('Hounde'));
  assert.deepStrictEqual(r.events.map((e) => e.details.module).sort(), ['inspection', 'tracker']);
  SCR._setForTest(false, new Map(), null);
});
