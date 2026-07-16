'use strict';
// FIDELITY HARNESS — the acceptance test for the composite() model port.
//
// Sibling of tests/score-fidelity.test.js (which pins the OTHER model, sbDims).
// Everything in tests/composite-model.test.js proves INTERNAL consistency (our
// code agrees with our tests). This file is the only thing that proves FIDELITY:
// that our port produces the same numbers the boss's own dashboard shows him.
//
// The fixture (tests/fixtures/em-data.json, 335,946 bytes) is `window.EM_DATA`
// lifted out of his "IT Review Dashboard" artifact — his real data for his 5
// sites. The expectations below were produced by running HIS OWN composite() /
// eMetrics() in Node against this exact fixture.
//
//   *** THE TABLES ARE THE ORACLE. IF WE DISAGREE, WE ARE WRONG. ***
//
// Never edit an expectation to match our output — that would convert the one
// test that can detect a fidelity bug into a test that certifies it. If this
// cannot be made to pass, the port is broken: report it, don't retune it.
//
// Note this passes the WHOLE fixture `D` to composite(), never a per-site slice
// — quirk 4: fleetMttr is the median across ALL sites, so slicing would change
// every number below. That is the source's design, not an accident here.

const test = require('node:test');
const assert = require('node:assert');

const EM = require('./fixtures/em-data.json');
const { composite, eMetrics, rag } = require('../services/siteComposite');

// HIS anchor — the dashboard's ANCHOR constant. The oracle is only meaningful
// at the as-of date it was produced at.
const A = '2026-07-14';

// site → composite() outputs
const ORACLE = {
  SML: { score: 62, rag: 'AMBER', del: 83,  gov: 56, eng: 58, pen: 5, open: 12, overdue: 2,  odRate: 17,  high: 3, mttr: 45.5 },
  SMI: { score: 58, rag: 'AMBER', del: 100, gov: 27, eng: 35, pen: 0, open: 22, overdue: 0,  odRate: 0,   high: 2, mttr: 6 },
  HGO: { score: 48, rag: 'RED',   del: 41,  gov: 53, eng: 75, pen: 5, open: 15, overdue: 10, odRate: 67,  high: 2, mttr: 74 },
  MGO: { score: 41, rag: 'RED',   del: 53,  gov: 33, eng: 52, pen: 5, open: 29, overdue: 12, odRate: 41,  high: 5, mttr: 68 },
  SGO: { score: 44, rag: 'RED',   del: 48,  gov: 37, eng: 50, pen: 0, open: 2,  overdue: 2,  odRate: 100, high: 0, mttr: null },
};

// site → eMetrics() outputs
const E_ORACLE = {
  SML: { e1: 25, e2: 71, e3: 100, e5: 57, cov: 58, nextRate: 57 },
  SMI: { e1: 33, e2: 0,  e3: 100, e5: 0,  cov: 58, nextRate: 0 },
  HGO: { e1: 36, e2: 30, e3: 100, e5: 80, cov: 58, nextRate: 100 },
  MGO: { e1: 33, e2: 17, e3: 100, e5: 8,  cov: 75, nextRate: 17 },
  SGO: { e1: 33, e2: 0,  e3: 100, e5: 50, cov: 33, nextRate: 75 },
};

test('fixture is the boss\'s real dataset for his 5 sites', () => {
  assert.deepStrictEqual(Object.keys(EM).sort(),
    ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
  assert.deepStrictEqual([...new Set(EM.meetings.map((m) => m.site_code))].sort(),
    ['HGO', 'MGO', 'SGO', 'SMI', 'SML']);
});

for (const [site, exp] of Object.entries(ORACLE)) {
  test(`${site}: composite() matches the boss's dashboard`, () => {
    const c = composite(site, EM, A);
    // Assert the TERMS before the score: a term mismatch localises the bug
    // (del → mttr/odRate/highAging; gov/eng → eMetrics; pen → the penalty
    // branches), while a score-only mismatch means the final weighting drifted.
    assert.strictEqual(c.del, exp.del, `${site} del`);
    assert.strictEqual(c.gov, exp.gov, `${site} gov`);
    assert.strictEqual(c.eng, exp.eng, `${site} eng`);
    assert.strictEqual(c.pen, exp.pen, `${site} pen`);
    assert.strictEqual(c.open, exp.open, `${site} open`);
    assert.strictEqual(c.overdue, exp.overdue, `${site} overdue`);
    assert.strictEqual(c.odRate, exp.odRate, `${site} odRate`);
    assert.strictEqual(c.high, exp.high, `${site} high`);
    assert.strictEqual(c.score, exp.score, `${site} score`);
    assert.strictEqual(rag(c.score).label, exp.rag, `${site} rag (75/55 bands)`);
  });

  test(`${site}: eMetrics() matches the boss's dashboard`, () => {
    assert.deepStrictEqual(eMetrics(site, EM, A), E_ORACLE[site], `${site} eMetrics`);
  });
}

// MTTR is the median resolution time in days. SGO's `null` is QUIRK 3 firing on
// REAL data: it has resolved nothing, so mttr is null and mttrIdx silently
// defaults to 60/100 rather than 0 — the site is credited for a speed we have
// never observed. Pinned here so that default is a known property, not a
// surprise discovered in a board meeting.
test('MTTR medians match — and SGO exercises the mttrIdx-60 default on real data', () => {
  for (const [site, exp] of Object.entries(ORACLE)) {
    assert.strictEqual(composite(site, EM, A).mttr, exp.mttr, `${site} mttr`);
  }
  assert.strictEqual(composite('SGO', EM, A).mttr, null);
});
