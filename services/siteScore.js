'use strict';
// The site scoreboard score — a FAITHFUL port of the user's sbDims() model from
// their "IT Review Dashboard" (the authoritative source; see
// docs/superpowers/plans/2026-07-15-score-alignment-sbdims.md).
//
// 6 dimensions x 0/1/2 points, score = round(points / 12 * 100), RAG 70/45.
// Inputs are the RAW measured values over a 3-month rolling window (the window
// itself is computed by services/scoreWindow.js and measured by each module's
// getSiteScoreInputs reader) — this module is pure arithmetic.
//
// DO NOT "improve" the thresholds, the rounding, or the tie-break comparator:
// this must agree with what the team already sees on their dashboard. A score
// that diverges from the one on screen is worse than no score.

const num = (v) => (Number.isFinite(+v) ? +v : 0);

// pt(value, green, amber, invert) → 2 | 1 | 0   (verbatim from sbDims)
const pt = (v, g, a, invert) => (invert ? (v <= g ? 2 : v <= a ? 1 : 0) : (v >= g ? 2 : v >= a ? 1 : 0));

// [key, label, green, amber, invert, disp, tip] — order is the user's dims order
// and is load-bearing (it is the moves tie-break's stable-sort order).
const PT_THRESHOLDS = [
  ['reviews',     'Reviews',     8,  5,  false, (v) => String(v),  'reviews held · G≥8 A5–7 R<5'],
  ['resolution',  'Resolution',  40, 20, false, (v) => v + '%',    'resolved ÷ raised · G≥40 A20–39 R<20'],
  ['overdue',     'Overdue',     0,  5,  true,  (v) => String(v),  'overdue issues + actions · G0 A1–5 R>5'],
  ['inspections', 'Inspections', 3,  2,  false, (v) => String(v),  'inspections run · G≥3 A2 R≤1'],
  ['findings',    'Findings',    0,  2,  true,  (v) => String(v),  'critical+major findings · G0 A1–2 R≥3'],
  ['signoff',     'Sign-off',    70, 30, false, (v) => v + '%',    'minutes fully signed % · G≥70 A30–69 R<30'],
];

// rag2() — bands on the composite score.
// Bands from the registry policy 'site-score' (70/45 — the author's model, registered verbatim).
const KpiRag = require('./kpiRag');
function rag2(score) { return KpiRag.rag(score, 'site-score'); }

// sbMoveText() — verbatim. NOTE: the 6th branch is a FALLBACK return, not an
// `if (key === 'signoff')`, so an unknown key yields the sign-off text. Kept.
function moveText(d) {
  if (d.key === 'reviews')     return 'Hold ' + Math.max(8 - d.val, 1) + ' more departmental reviews to reach the green cadence of 8 — book them with GM sponsorship now.';
  if (d.key === 'resolution')  return 'Lift resolution from ' + d.val + '% toward 40%: run a weekly closure sprint on the oldest in-progress items.';
  if (d.key === 'overdue')     return 'Clear ' + d.val + ' overdue commitments — re-date with dept heads what is still real, close the rest this week.';
  if (d.key === 'inspections') return 'Run ' + Math.max(3 - d.val, 1) + ' more infrastructure inspection' + (3 - d.val > 1 ? 's' : '') + ' to reach the quarterly green of 3.';
  if (d.key === 'findings')    return 'Close out ' + d.val + ' critical/major inspection findings with dated corrective actions.';
  return 'Get minutes counter-signed: sign-off at ' + d.val + '% vs 70% green — capture both signatures at meeting close.';
}

// The applicability gate.
//
// Two of the six dims are INVERTED (`overdue` and `findings` — less is better),
// so ABSENCE of data looks like excellence: a site with nothing measured scores
// overdue 0 → 2 pts and findings 0 → 2 pts = 4/12 = 33 = RED. That is a
// CONFIDENT verdict on a site we know nothing about, and it put sites we have no
// data for into coordinators' inboxes as a graded RED.
//
// The distinction that matters: "we measured zero" is NOT "we measured nothing".
// A site that held 2 reviews and resolved nothing is a real RED and must stay
// scored. A site with no data at all is not a verdict — it is a gap in our
// coverage, and the report says so.
//
// Any future dimension that REWARDS a zero must respect this same gate.
//
// But the gate cannot be read off the six scored inputs alone, because two of
// them are RATIOS, and a ratio's zero is ambiguous WITHOUT ITS DENOMINATOR:
//   • `resolution` = resolved ÷ RAISED  → 0 means either "0% of 4 issues
//     resolved" (a real measurement, and a bad one) or "no issues were ever
//     raised" (nothing measured). The six inputs cannot tell those apart.
//   • `signoff`    = signed ÷ REVIEWS   → same ambiguity, but its denominator
//     (`reviews`) is already one of the six, so the gate can already see it.
// The other four (`reviews`, `inspections`, `overdue`, `findings`) are COUNTS —
// their zeros are unambiguous and need no denominator.
//
// So `raised` is passed in purely to disambiguate `resolution`'s zero.
// `raised` is an APPLICABILITY SIGNAL, NOT A DIMENSION — do not score it.
// It must never appear in `dims`, never affect `points`/`score`/`rag`, and
// never change any existing number. The boss's model is untouched by this.
function hasData(inputs) {
  return num(inputs.reviews) > 0 || num(inputs.raised) > 0 || num(inputs.resolution) > 0 ||
         num(inputs.overdue) > 0 || num(inputs.inspections) > 0 || num(inputs.findings) > 0 ||
         num(inputs.signoff) > 0;
}

/**
 * computeSiteScore(inputs, window, previousScore)
 *   inputs: { reviews, resolution, overdue, inspections, findings, signoff } — raw measured values
 *   window: { from, to } — echoed as provenance
 *   previousScore: number | null — the same score recomputed as-of the previous window's end
 *
 * → { applicable, score, points, rag, trend_pts, dims, moves, window }
 *   When `applicable` is false everything measured is null/[]: no verdict is claimed.
 */
function computeSiteScore(inputs = {}, window = null, previousScore = null) {
  if (!hasData(inputs || {})) {
    // The window still rides along: it is provenance for WHAT we found nothing in.
    return { applicable: false, score: null, points: null, rag: null, trend_pts: null,
             dims: [], moves: [], window: window || null };
  }

  const dims = PT_THRESHOLDS.map(([key, label, g, a, invert, disp, tip]) => {
    const val = num(inputs[key]);
    return { key, label, val, disp: disp(val), pts: pt(val, g, a, invert), tip };
  });
  const points = dims.reduce((s, d) => s + d.pts, 0);
  const score = Math.round((points / 12) * 100);

  // Two moves — verbatim, INCLUDING the asymmetric tie-break. It returns -1 when
  // a is 'overdue' but 0 (not +1) when b is, so it is not a valid comparator.
  // Copied literally so our ranking matches theirs; Node's sort is spec-stable
  // (V8 >= 7.0), so the same expression over the same array agrees with V8.
  const gaps = dims.filter((d) => d.pts < 2).sort((a, b) => (2 - b.pts) - (2 - a.pts) || (a.key === 'overdue' ? -1 : 0));
  const moves = gaps.slice(0, 2).map((d, i) => ({ n: i + 1, gain: '+' + Math.round(((2 - d.pts) / 12) * 100) + ' pts', text: moveText(d) }));
  while (moves.length < 2) moves.push({ n: moves.length + 1, gain: 'sustain', text: 'All dimensions green — hold cadence and keep the register clean.' });

  const trend_pts = previousScore === null || previousScore === undefined ? null : score - Math.round(num(previousScore));
  return { applicable: true, score, points, rag: rag2(score), trend_pts, dims, moves, window: window || null };
}

module.exports = { computeSiteScore, rag2, moveText, hasData, PT_THRESHOLDS };
