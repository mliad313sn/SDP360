'use strict';
// Unit test for siteMeasuresV2 — deriving the 6 v2 measures from live review
// data arrays (controlled synthetic dataset, so each measure is checked in
// isolation). Fidelity of the SCORING lives in deck-governance-v2-fidelity;
// this proves the measure DERIVATION from D.
const test = require('node:test');
const assert = require('node:assert');
const { siteMeasuresV2, scoreV2 } = require('../services/deckGovernanceV2');

const W = { from: '2026-04-01', to: '2026-07-14' };
const md = '2026-04-15';   // a meeting_date inside the window

const D = {
  meetings: [
    // both signed → signoff 100%
    { site_code: 'X', meeting_date: md, dept_head_signed_at: '2026-04-16 09:00', site_it_signed_at: '2026-04-16 10:00' },
    { site_code: 'X', meeting_date: md, dept_head_signed_at: '2026-04-16 09:00', site_it_signed_at: '2026-04-16 10:00' },
    { site_code: 'X', meeting_date: md, intake_source: 'business_incubation' },   // incubation, NOT a dept meeting
    { site_code: 'Y', meeting_date: md },   // other site — must be ignored
  ],
  issues: [
    { site_code: 'X', meeting_date: md, status: 'resolved', closed_at: '2026-05-01' },
    { site_code: 'X', meeting_date: md, status: 'resolved', closed_at: '2026-05-02' },
    { site_code: 'X', meeting_date: md, status: 'open', target_date: '2026-04-10' }, // overdue
    { site_code: 'X', meeting_date: md, status: 'open', target_date: '2026-08-01' }, // not overdue
  ],
  actions: [],
  inspections: [
    { site_code: 'X', inspection_date: '2026-05-20' },
    { site_code: 'X', inspection_date: '2026-06-20' },
  ],
  findings: [
    { site_code: 'X', inspection_date: '2026-05-20', status: 'critical' },
    { site_code: 'X', inspection_date: '2026-05-20', status: 'major' },
    { site_code: 'X', inspection_date: '2026-05-20', status: 'minor' },
    { site_code: 'X', inspection_date: '2026-06-20', status: 'major' },
    { site_code: 'X', inspection_date: '2026-06-20', status: 'major' },
    { site_code: 'X', inspection_date: '2026-06-20', status: 'critical' },
    { site_code: 'X', inspection_date: '2026-06-20', status: 'ok' },   // NOT a finding
    { site_code: 'X', inspection_date: '2026-06-20', status: 'na' },   // NOT a finding
  ],
  inspActions: [
    { site_code: 'X', priority: 'Critical', status: 'closed' },
    { site_code: 'X', priority: 'High', status: 'open' },
    { site_code: 'X', priority: 'Low', status: 'open' },   // not high/crit → excluded from fix%
  ],
};

test('siteMeasuresV2 derives all six measures correctly', () => {
  const m = siteMeasuresV2('X', D, W);
  assert.equal(m.meetings, 2, 'meetings (business_incubation excluded)');
  assert.equal(m.incubation, 1, 'incubation = business_incubation meetings');
  assert.equal(m.raised, 4, 'issues raised');
  assert.equal(m.capture, 2.0, 'capture = raised/meetings');
  assert.equal(m.closePct, 50, 'close% = resolved/raised');
  assert.equal(m.overdue, 1, 'overdue = open past target');
  assert.equal(m.inspections, 2, 'inspections');
  assert.equal(m.found, 6, 'found = crit+major+minor (ok/na excluded)');
  assert.equal(m.findPerInsp, 3.0, 'findings per inspection');
  assert.equal(m.fixPct, 50, 'fix% = closed high/crit actions ÷ high/crit actions');
  assert.equal(m.signoff, 100, 'sign-off = both-signed meetings %');
});

test('siteMeasuresV2 feeds scoreV2 end to end', () => {
  const m = { ...siteMeasuresV2('X', D, W), incubation: 1 };
  const r = scoreV2(m);
  // meetings 2→0, capture 2.0→2, overdue 1→1, insp 2→1, findfix (3.0,50%)→1, signoff 100→2 = 7 → 58
  assert.equal(r.score, 58);
  assert.equal(r.groundRules, 'FAIL');   // <12 meetings
});

test('empty site → all zeros, RED, ground rules FAIL', () => {
  const m = { ...siteMeasuresV2('Z', D, W), incubation: 0 };
  assert.equal(m.meetings, 0);
  assert.equal(m.capture, 0);
  assert.equal(m.fixPct, 0);
  assert.equal(scoreV2(m).overall, 'RED');
});
