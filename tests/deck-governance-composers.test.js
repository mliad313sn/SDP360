'use strict';
// buildScoreboardV2 + buildEffortMatrixV2 — structure, ranking, ground-rules,
// incubation injection, and effort-matrix shapes (bubbles/gap/moves).
const test = require('node:test');
const assert = require('node:assert');
const { buildScoreboardV2, buildEffortMatrixV2, DIMS } = require('../services/deckGovernanceV2');

const md = '2026-04-15';
const mtg = (site, signed) => ({ site_code: site, meeting_date: md,
  dept_head_signed_at: signed ? '2026-04-16 09:00' : null, site_it_signed_at: signed ? '2026-04-16 10:00' : null });
const iss = (site, resolved) => ({ site_code: site, meeting_date: md,
  status: resolved ? 'resolved' : 'open', closed_at: resolved ? '2026-05-01' : null });

const D = {
  meetings: [...Array(12)].map(() => mtg('A', true)).concat([...Array(2)].map(() => mtg('B', false))),
  issues: [...Array(8)].map(() => iss('A', true)).concat([...Array(8)].map(() => iss('A', false)))
    .concat([iss('B', false), iss('B', false)]),
  actions: [],
  inspections: [...Array(5)].map((_, k) => ({ site_code: 'A', inspection_date: '2026-05-1' + k })),
  findings: [...Array(10)].map(() => ({ site_code: 'A', inspection_date: '2026-05-10', status: 'major' }))
    .concat([{ site_code: 'B', inspection_date: '2026-05-10', status: 'major' }]),
  inspActions: [{ site_code: 'A', priority: 'Critical', status: 'closed' }, { site_code: 'A', priority: 'High', status: 'closed' }],
};
const OPTS = { asOf: '2026-07-14', incubation: { A: 2, B: 0 }, siteName: (c) => 'Site ' + c, roadmap: { A: 2, B: -3 } };

test('buildScoreboardV2 ranks by score and injects incubation + ground rules', () => {
  const { rows, groupAvg } = buildScoreboardV2(D, OPTS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].code, 'A');           // strong site first
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].code, 'B');
  assert.ok(rows[0].score > rows[1].score, 'A outscores B');
  assert.equal(rows[0].groundRules, 'PASS'); // 12 meetings + 2 incub + 5 insp
  assert.equal(rows[0].overall, 'GREEN');
  assert.equal(rows[1].groundRules, 'FAIL');
  assert.equal(rows[0].incubation, 2);
  assert.equal(rows[0].name, 'Site A');
  assert.equal(groupAvg, Math.round((rows[0].score + rows[1].score) / 2));
});

test('ground-rules FAIL caps a GREEN score to AMBER*', () => {
  // Same A but with 0 incubations → ground rules FAIL → capped
  const { rows } = buildScoreboardV2(D, { ...OPTS, incubation: { A: 0, B: 0 } });
  const a = rows.find((r) => r.code === 'A');
  assert.equal(a.groundRules, 'FAIL');
  assert.equal(a.overall, 'AMBER');   // capped down from GREEN
  assert.equal(a.capped, true);
});

test('buildEffortMatrixV2 produces bubbles, 6-segment gaps, and two moves each', () => {
  const em = buildEffortMatrixV2(D, OPTS);
  assert.equal(em.bubbles.length, 2);
  assert.equal(em.bubbles[0].code, 'A');
  assert.equal(em.bubbles[0].delta, 2);          // roadmap Δ passed through
  assert.equal(em.bubbles[1].dashed, true);      // B fails ground rules → dashed
  assert.equal(em.greenPts, 8.4);
  em.gap.forEach((g) => assert.equal(g.segs.length, DIMS.length));
  em.moves.forEach((m) => assert.equal(m.moves.length, 2));
  // weakest site gets an actionable move, not the hold-the-line filler only
  const bMoves = em.moves.find((m) => m.code === 'B').moves;
  assert.ok(bMoves.some((x) => /incubation|meetings|inspections/i.test(x.text)));
});
