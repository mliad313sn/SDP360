// tests/site-score.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeSiteScore, rag2 } = require('../services/siteScore');

// inputs are the RAW measured values, exactly as the user's sbDims computes them.
const perfect = { reviews: 8, resolution: 40, overdue: 0, inspections: 3, findings: 0, signoff: 70 };
const win = { from: '2026-04-14', to: '2026-07-14' };

test('all-green inputs → 12 pts / 100 / GREEN', () => {
  const r = computeSiteScore(perfect, win);
  assert.strictEqual(r.points, 12);
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.rag, 'GREEN');
});

test('all-red inputs → 0 pts / 0 / RED', () => {
  const r = computeSiteScore({ reviews: 0, resolution: 0, overdue: 99, inspections: 0, findings: 9, signoff: 0 }, win);
  assert.strictEqual(r.points, 0);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.rag, 'RED');
});

test('score = round(points/12*100) — only 13 values are realisable', () => {
  // 6 pts → 50 (AMBER floor), 9 pts → 75 (GREEN floor), 5 pts → 42 (RED)
  assert.strictEqual(computeSiteScore({ reviews: 8, resolution: 40, overdue: 0, inspections: 0, findings: 9, signoff: 0 }, win).points, 6);
  assert.strictEqual(computeSiteScore({ reviews: 8, resolution: 40, overdue: 0, inspections: 0, findings: 9, signoff: 0 }, win).score, 50);
});

// Only 13 scores are realisable ({0,8,17,25,33,42,50,58,67,75,83,92,100}), so
// GREEN effectively starts at 9/12 pts and AMBER at 6/12. 8 pts = 67 = AMBER —
// NOT green. If this test ever goes red, the fix is NEVER to move the band:
// 70/45 is the user's rag2 and the whole point is agreeing with their dashboard.
test('rag2 bands over the realisable scores', () => {
  assert.strictEqual(rag2(42), 'RED');     // 5 pts
  assert.strictEqual(rag2(50), 'AMBER');   // 6 pts
  assert.strictEqual(rag2(67), 'AMBER');   // 8 pts — not green
  assert.strictEqual(rag2(75), 'GREEN');   // 9 pts
});

test('each dimension bands exactly as the user specified', () => {
  const d = (inp) => Object.fromEntries(computeSiteScore({ ...perfect, ...inp }, win).dims.map(x => [x.key, x.pts]));
  assert.strictEqual(d({ reviews: 8 }).reviews, 2);
  assert.strictEqual(d({ reviews: 7 }).reviews, 1);
  assert.strictEqual(d({ reviews: 5 }).reviews, 1);
  assert.strictEqual(d({ reviews: 4 }).reviews, 0);
  assert.strictEqual(d({ resolution: 40 }).resolution, 2);
  assert.strictEqual(d({ resolution: 39 }).resolution, 1);
  assert.strictEqual(d({ resolution: 19 }).resolution, 0);
  assert.strictEqual(d({ overdue: 0 }).overdue, 2);      // inverted
  assert.strictEqual(d({ overdue: 5 }).overdue, 1);
  assert.strictEqual(d({ overdue: 6 }).overdue, 0);
  assert.strictEqual(d({ inspections: 3 }).inspections, 2);
  assert.strictEqual(d({ inspections: 2 }).inspections, 1);
  assert.strictEqual(d({ inspections: 1 }).inspections, 0);
  assert.strictEqual(d({ findings: 0 }).findings, 2);    // inverted
  assert.strictEqual(d({ findings: 2 }).findings, 1);
  assert.strictEqual(d({ findings: 3 }).findings, 0);
  assert.strictEqual(d({ signoff: 70 }).signoff, 2);
  assert.strictEqual(d({ signoff: 69 }).signoff, 1);
  assert.strictEqual(d({ signoff: 29 }).signoff, 0);
});

test('dims carry key/label/val/disp/pts/tip in the user order', () => {
  const r = computeSiteScore(perfect, win);
  assert.deepStrictEqual(r.dims.map(d => d.key), ['reviews', 'resolution', 'overdue', 'inspections', 'findings', 'signoff']);
  const res = r.dims.find(d => d.key === 'resolution');
  assert.strictEqual(res.disp, '40%');
  assert.match(res.tip, /resolved/);
  const rev = r.dims.find(d => d.key === 'reviews');
  assert.strictEqual(rev.disp, '8');
  assert.strictEqual(rev.label, 'Reviews');
});

test('moves: gain is +17 for a 0-pt gap, +8 for a 1-pt gap', () => {
  const r = computeSiteScore({ ...perfect, reviews: 0, resolution: 39 }, win);
  const rev = r.moves.find(m => /departmental reviews/.test(m.text));
  assert.strictEqual(rev.gain, '+17 pts');
  const res = r.moves.find(m => /Lift resolution/.test(m.text));
  assert.strictEqual(res.gain, '+8 pts');
});

test('moves: always exactly 2; all-green pads with sustain', () => {
  const r = computeSiteScore(perfect, win);
  assert.strictEqual(r.moves.length, 2);
  assert.strictEqual(r.moves[0].gain, 'sustain');
  assert.match(r.moves[0].text, /All dimensions green/);
});

test('moves: biggest gap first', () => {
  const r = computeSiteScore({ ...perfect, reviews: 0, resolution: 39 }, win);
  assert.strictEqual(r.moves.length, 2);
  assert.strictEqual(r.moves[0].gain, '+17 pts');   // 0-pt gap outranks the 1-pt gap
  assert.strictEqual(r.moves[1].gain, '+8 pts');
});

test('move texts are the user texts verbatim', () => {
  const r = computeSiteScore({ ...perfect, reviews: 3 }, win);
  assert.match(r.moves[0].text, /^Hold 5 more departmental reviews to reach the green cadence of 8 — book them with GM sponsorship now\.$/);
});

test('trend_pts null without a previous score, else the delta', () => {
  assert.strictEqual(computeSiteScore(perfect, win).trend_pts, null);
  assert.strictEqual(computeSiteScore(perfect, win, 75).trend_pts, 25);
});

test('window provenance is echoed', () => {
  assert.deepStrictEqual(computeSiteScore(perfect, win).window, win);
});

test('missing inputs are treated as 0, never a throw', () => {
  const r = computeSiteScore({}, win);
  assert.strictEqual(r.points, 4);   // overdue 0 → 2pts, findings 0 → 2pts; rest 0
  assert.strictEqual(r.rag, 'RED');
});
