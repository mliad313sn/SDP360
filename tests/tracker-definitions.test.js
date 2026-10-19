'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const T = require('../services/trackerDefinitions');

function sample() {
  return {
    key: 'field-dispatch-2027', name: 'Field dispatch 2027', version: 1,
    period: { kind: 'monthly', start: '2027-01', count: 12 },
    units: [{ code: 'SGO', name: 'Sabodala' }, { code: 'HGO', name: 'Houndé' }],
    ragPolicy: 'tracker-activity',
    groups: [
      { code: 'G1', name: 'Dispatch', weight: 0.6, items: [
        { code: 'G1-01', name: 'Dispatches closed', kpiType: 'COUNT', weight: 1, target: 120, start: 1, end: 12 },
        { code: 'G1-02', name: 'Monthly review held', kpiType: 'BOOLEAN', weight: 1 },
      ] },
      { code: 'G2', name: 'Quality', weight: 0.4, items: [
        { code: 'G2-01', name: 'First-time fix %', kpiType: 'PERCENT', weight: 1, target: 90 },
      ] },
    ],
  };
}

test('a well-formed definition validates', () => {
  const r = T.validate(sample());
  assert.deepEqual(r, { ok: true, errors: [] });
});

test('validation catches the classic authoring mistakes', () => {
  const d = sample();
  d.groups[0].weight = 0.7;                         // weights sum 1.1
  d.groups[1].items[0].kpiType = 'MAGIC';
  d.units.push({ code: 'sgo' });                    // duplicate (case-insensitive)
  d.groups[0].items[0].end = 13;
  d.ragPolicy = 'unknown';
  const r = T.validate(d);
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('groups'));
  assert.ok(paths.includes('groups[1].items[0].kpiType'));
  assert.ok(paths.includes('units[2].code'));
  assert.ok(paths.includes('groups[0].items[0].end'));
  assert.ok(paths.includes('ragPolicy'));
  assert.equal(T.validate(null).ok, false);
  assert.equal(T.validate({ key: 'x', name: 'x', period: { kind: 'weekly', count: 60 }, units: [], groups: [] }).ok, false);
});

test('scoring: pro-rata COUNT, BOOLEAN, PERCENT, group & unit roll-up, fleet stats', () => {
  const d = sample();
  const inputs = {
    SGO: { 'G1-01': [10, 10, 10, 10, 10, 10], 'G1-02': [0, 0, 1], 'G2-01': [90, 95] },   // on target
    HGO: { 'G1-01': [2, 2, 2, 2, 2, 2], 'G1-02': [0], 'G2-01': [50] },                  // weak
  };
  const r = T.score(d, inputs, { currentPeriod: 6 });
  const sgo = r.units.SGO, hgo = r.units.HGO;
  assert.equal(sgo.items['G1-01'].attainment, 1, '60 of pro-rated 60');
  assert.equal(sgo.items['G1-01'].rag, 'GREEN');
  assert.equal(sgo.items['G1-02'].rag, 'GREEN');
  assert.ok(Math.abs(sgo.items['G2-01'].attainment - 92.5 / 90) < 1e-9);
  assert.ok(Math.abs(sgo.score - 1) < 1e-9, 'all capped at 1 → 100 %');
  assert.equal(sgo.rag, 'GREEN');
  assert.equal(hgo.items['G1-01'].attainment, 0.2);
  assert.equal(hgo.items['G1-01'].rag, 'RED');
  assert.equal(hgo.items['G1-02'].rag, 'AMBER', 'BOOLEAN not yet overdue stays AMBER');
  assert.ok(hgo.score < 0.5);
  assert.equal(hgo.rag, 'RED');
  assert.equal(r.fleet.best, 'SGO');
  assert.equal(r.fleet.worst, 'HGO');
  assert.equal(r.fleet.attainment, 0.5);
  assert.ok(Math.abs(r.units.SGO.groups.G1.score - 1) < 1e-9);
});

test('scoring: inactive items are excluded and weight is redistributed; shared items take the best unit', () => {
  const d = sample();
  d.groups[0].items[1].shared = true;
  const inputs = { SGO: { 'G1-01': [60], 'G1-02': [1] }, HGO: { 'G1-01': [60], 'G1-02': [0] } };
  const r = T.score(d, inputs, { currentPeriod: 6, targets: { HGO: { 'G2-01': { active: false } } } });
  assert.equal(r.units.HGO.items['G1-02'].value, 1, 'shared → best of fleet');
  assert.equal(r.units.HGO.items['G2-01'].rag, 'NA');
  assert.equal(r.units.HGO.items['G2-01'].weight, 0);
  const w = T.effectiveWeights(d, (it) => it.code !== 'G2-01');
  assert.equal(w['G2-01'], 0);
  assert.ok(Math.abs(w['G1-01'] - 0.3) < 1e-9);
});

test('fromLegacyInit converts the inherited tracker-init.json into a valid definition', () => {
  const init = require(path.join('..', 'tracker-init.json'));
  const def = T.fromLegacyInit(init, 2026);
  const r = T.validate(def);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors.slice(0, 3)));
  assert.equal(def.period.count, 12);
  assert.equal(def.groups.length, 4);
  const items = def.groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(items, (init.activities || []).length);
  assert.ok(def.units.length >= 1);
});
