'use strict';
// FIDELITY HARNESS — the acceptance test for the sbDims score port.
//
// Everything else in this sub-project proves INTERNAL consistency (our code
// agrees with our tests). This file is the only thing that proves FIDELITY:
// that our port produces the same numbers the user's own dashboard shows them.
//
// The fixture (tests/fixtures/em-data.json, 335,946 bytes) is `window.EM_DATA`
// lifted out of the user's "IT Review Dashboard" artifact — their real data for
// their 5 sites. The expectations below were produced by running THEIR OWN
// sbDims() in Node against this exact fixture.
//
//   *** THE TABLE IS THE ORACLE. IF WE DISAGREE, WE ARE WRONG. ***
//
// Never edit an expectation to match our output — that would convert the one
// test that can detect a fidelity bug into a test that certifies it. If this
// cannot be made to pass, the port is broken: report it, don't retune it.
//
// Two properties of THIS DATA that a reader should know before trusting a green run:
//
//  1. Deviation 2 (we window inspections/findings; the source counts them
//     cumulatively to the as-of date) is MOOT here — verified: the earliest
//     inspection_date in the fixture is 2026-05-18, so 0 of 12 inspections and
//     0 critical/major findings predate from='2026-04-01'. Windowed === unbounded
//     at their W0. This test therefore does NOT exercise that deviation; it is
//     covered by tests/inspection-score-inputs.test.js.
//
//  2. KNOWN COVERAGE GAP: every site's top-2 gaps here are both 0-pt dims, so
//     all 10 moves come out '+17 pts'. This data never discriminatingly
//     exercises the '+8' path (a 1-pt gap) or the deliberately asymmetric
//     tie-break comparator. Those live only in the synthetic cases in
//     tests/site-score.test.js. A green run here is NOT full moves coverage.

const test = require('node:test');
const assert = require('node:assert');

const EM = require('./fixtures/em-data.json');
const { _computeMeetingsScoreInputs } = require('../meetings-db');
const { _computeInspectionScoreInputs } = require('../inspection-db');
const { computeSiteScore } = require('../services/siteScore');

// THEIR window — the dashboard's W0/ANCHOR, deliberately NOT our rolling window.
// The oracle numbers are only meaningful at the window they were produced at.
const W = { from: '2026-04-01', to: '2026-07-14' };

// site → [points, score, rag, dims pts [rev,res,ovd,insp,find,sign], dims vals]
const ORACLE = {
  SML: { points: 6, score: 50, rag: 'AMBER', pts: [1, 0, 1, 2, 0, 2], vals: [7, 14, 2, 5, 6, 71] },
  SMI: { points: 5, score: 42, rag: 'RED',   pts: [1, 0, 2, 0, 2, 0], vals: [7, 12, 0, 1, 0, 0] },
  HGO: { points: 7, score: 58, rag: 'AMBER', pts: [2, 2, 0, 0, 2, 1], vals: [10, 48, 18, 1, 0, 30] },
  MGO: { points: 6, score: 50, rag: 'AMBER', pts: [2, 2, 0, 2, 0, 0], vals: [12, 41, 20, 4, 5, 17] },
  SGO: { points: 2, score: 17, rag: 'RED',   pts: [0, 0, 1, 0, 1, 0], vals: [4, 0, 3, 1, 1, 0] },
};

// The pure cores take rows already scoped to ONE site (that scoping is the
// reader's job in prod), so we filter the fixture the same way the readers do.
function scoreFor(site) {
  const md = _computeMeetingsScoreInputs({
    meetings: EM.meetings.filter((m) => m.site_code === site),
    issues:   EM.issues.filter((i) => i.site_code === site),
    actions:  EM.actions.filter((a) => a.site_code === site),
  }, W);
  const insp = _computeInspectionScoreInputs({
    inspections: EM.inspections.filter((i) => i.site_code === site),
    findings:    EM.findings.filter((f) => f.site_code === site),
  }, W);
  return computeSiteScore({
    reviews:     md.reviews,
    resolution:  md.resolution,
    overdue:     md.overdue,
    inspections: insp.inspections,
    findings:    insp.findings,
    signoff:     md.signoff,
  }, W);
}

test('fixture is the user\'s real dataset for their 5 sites', () => {
  assert.deepStrictEqual(Object.keys(EM).sort(),
    ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
  assert.deepStrictEqual([...new Set(EM.meetings.map((m) => m.site_code))].sort(),
    ['HGO', 'MGO', 'SGO', 'SMI', 'SML']);
});

// Guards the "deviation 2 is moot here" claim above: if a future re-extraction
// ever pulls in earlier inspections, this fails loudly rather than silently
// invalidating the oracle.
test('deviation 2 is inert on this data (nothing predates their W0)', () => {
  assert.strictEqual(EM.inspections.filter((i) => i.inspection_date < W.from).length, 0);
  assert.strictEqual(EM.findings.filter((f) =>
    f.inspection_date < W.from && (f.status === 'critical' || f.status === 'major')).length, 0);
});

for (const [site, exp] of Object.entries(ORACLE)) {
  test(`${site} matches the user's dashboard at their window`, () => {
    const r = scoreFor(site);
    // dims values first: a val mismatch means a MEASUREMENT bug (the readers),
    // while a pts-only mismatch means a THRESHOLD bug (siteScore). Asserting
    // vals before pts makes the failure say which.
    assert.deepStrictEqual(r.dims.map((d) => d.val), exp.vals, `${site} dims values`);
    assert.deepStrictEqual(r.dims.map((d) => d.pts), exp.pts, `${site} dims points`);
    assert.strictEqual(r.points, exp.points, `${site} points`);
    assert.strictEqual(r.score, exp.score, `${site} score`);
    assert.strictEqual(r.rag, exp.rag, `${site} rag`);
  });
}

test('dims order is the user\'s order (the moves tie-break depends on it)', () => {
  assert.deepStrictEqual(scoreFor('SML').dims.map((d) => d.key),
    ['reviews', 'resolution', 'overdue', 'inspections', 'findings', 'signoff']);
});
