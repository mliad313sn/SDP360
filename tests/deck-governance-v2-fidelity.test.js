'use strict';
// FIDELITY ORACLE for the OPS manager's board-deck "scoring v2" governance model.
//
// The rows below are the EXACT July-2026 column values read off the final board
// deck (Group_IT_Operations_Report_July_2026_v14.pptx, slide 13). The expected
// scores are the deck's own printed scores. The v2 point rules were
// reverse-engineered from these rows and VALIDATED by the author (2026-08-06).
//
//   *** THE DECK IS THE ORACLE. IF scoreV2 DISAGREES, scoreV2 IS WRONG. ***
//
// Never edit an expectation to match code output — that converts the one test
// that can catch an infidelity into one that certifies it.
const test = require('node:test');
const assert = require('node:assert');
const { scoreV2 } = require('../services/deckGovernanceV2');

// site → raw per-site measures over the Apr–Jul programme window (from the deck).
const ROWS = {
  MGO: { meetings: 16, capture: 6.9, overdue: 0,  inspections: 10, findPerInsp: 2.4, fixPct: 100, signoff: 100, incubation: 2 },
  SML: { meetings: 7,  capture: 2.0, overdue: 0,  inspections: 8,  findPerInsp: 1.6, fixPct: 75,  signoff: 0,   incubation: 0 },
  SGO: { meetings: 5,  capture: 0.8, overdue: 0,  inspections: 12, findPerInsp: 0.3, fixPct: 100, signoff: 100, incubation: 0 },
  HGO: { meetings: 10, capture: 5.4, overdue: 12, inspections: 1,  findPerInsp: 3.0, fixPct: 33,  signoff: 100, incubation: 1 },
  SMI: { meetings: 7,  capture: 6.3, overdue: 0,  inspections: 6,  findPerInsp: 0.2, fixPct: 0,   signoff: 0,   incubation: 1 },
};
// deck-printed score · overall RAG · ground-rules · AMBER* cap flag
const EXPECT = {
  MGO: { score: 100, overall: 'GREEN', gr: 'PASS', capped: false },
  SML: { score: 75,  overall: 'AMBER', gr: 'FAIL', capped: true  },
  SGO: { score: 67,  overall: 'AMBER', gr: 'FAIL', capped: false },
  HGO: { score: 58,  overall: 'AMBER', gr: 'FAIL', capped: false },
  SMI: { score: 58,  overall: 'AMBER', gr: 'FAIL', capped: false },
};

for (const [c, m] of Object.entries(ROWS)) {
  test(`v2 fidelity — ${c} reproduces the board deck`, () => {
    const r = scoreV2(m);
    assert.equal(r.score, EXPECT[c].score, `${c} score`);
    assert.equal(r.overall, EXPECT[c].overall, `${c} overall RAG`);
    assert.equal(r.groundRules, EXPECT[c].gr, `${c} ground rules`);
    assert.equal(r.capped, EXPECT[c].capped, `${c} AMBER* cap`);
  });
}

test('group average = 72 (deck: "72")', () => {
  const scores = Object.values(ROWS).map((m) => scoreV2(m).score);
  assert.equal(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), 72);
});

test('RED band: an all-zero site scores 0/RED, not applicable-green', () => {
  const r = scoreV2({ meetings: 0, capture: 0, overdue: 0, inspections: 0, findPerInsp: 0, fixPct: 0, signoff: 0, incubation: 0 });
  // overdue 0 still earns 2 (an empty backlog is not overdue) — but nothing else scores.
  assert.equal(r.score, Math.round(2 / 12 * 100));
  assert.equal(r.overall, 'RED');
  assert.equal(r.groundRules, 'FAIL');
});
