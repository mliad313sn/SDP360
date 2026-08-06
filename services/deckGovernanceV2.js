'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// "Scoring v2" — the OPS manager's board-deck governance model (v14 deck, Jul 2026).
//
// Philosophy (his words on slide 13): "finding & fixing problems is rewarded" —
// an inspection programme that finds nothing, visit after visit, scores LOW, not
// high. This is the INVERSE of the sbDims model (services/siteScore.js), which
// treats findings as a penalty. The two deliberately disagree.
//
// REVERSE-ENGINEERED from the deck's own July column values and VALIDATED by the
// author (2026-08-06). Reproduces MGO 100 · SML 75 · SGO 67 · HGO 58 · SMI 58,
// group avg 72. tests/deck-governance-v2-fidelity.test.js pins scoreV2 to those
// 5 rows.  *** THE DECK IS THE ORACLE. If scoreV2 disagrees, scoreV2 is wrong. ***
//
// The intermediate ("1 pt") bands were NOT discriminated by the 5 July sites; the
// author confirmed the chosen bands (2026-08-06). Do NOT retune them to chase a
// different number without re-validating against a board deck.
// ─────────────────────────────────────────────────────────────────────────────

// Six dimensions, each scored 0 / 1 / 2 → points/12 × 100.
const DIMS = [
  { key: 'meetings',    label: 'Meetings' },
  { key: 'capture',     label: 'Capture' },
  { key: 'overdue',     label: 'Overdue' },
  { key: 'inspections', label: 'Inspections' },
  { key: 'findfix',     label: 'Find · Fix' },
  { key: 'signoff',     label: 'Sign-off' },
];

// higher-is-better banding
function _band(v, g, a) { return v >= g ? 2 : v >= a ? 1 : 0; }

// Per-dimension points from a site's raw measures. `m` carries:
//   meetings (count), capture (issues logged / meeting), overdue (open past
//   target, count), inspections (count), findPerInsp (findings / inspection),
//   fixPct (% of high/critical actions closed), signoff (% both signatures),
//   incubation (count — cap only, not scored).
function dimPts(m) {
  const find = Number(m.findPerInsp) || 0;
  const fix = Number(m.fixPct) || 0;
  return {
    meetings:    _band(Number(m.meetings) || 0, 8, 6),
    capture:     _band(Number(m.capture) || 0, 1.5, 0.5),
    overdue:     (Number(m.overdue) || 0) === 0 ? 2 : (Number(m.overdue) || 0) <= 4 ? 1 : 0, // lower better
    inspections: _band(Number(m.inspections) || 0, 4, 2),
    // reward finding AND fixing: 2 = finds a lot and closes most; 1 = finds
    // something OR closes what little it finds; 0 = finds ~nothing.
    findfix:     (find >= 1.5 && fix >= 70) ? 2
               : (find > 0 && (fix >= 70 || find >= 1.5)) ? 1 : 0,
    signoff:     _band(Number(m.signoff) || 0, 70, 40),
  };
}

// RAG bands: GREEN ≥70 · AMBER 45–69 · RED <45 (the deck's footer thresholds).
function rag(score) {
  if (score >= 70) return 'GREEN';
  if (score >= 45) return 'AMBER';
  return 'RED';
}

// Ground rules: 3 department meetings a month over the 4-month programme (= 12)
// AND at least 1 business incubation AND at least 1 inspection. A miss caps the
// OVERALL rating at AMBER (the "*" on the deck) — never at GREEN.
function groundRules(m) {
  return ((Number(m.meetings) || 0) >= 12 && (Number(m.incubation) || 0) >= 1 && (Number(m.inspections) || 0) >= 1)
    ? 'PASS' : 'FAIL';
}

// Full v2 verdict for one site's measures.
function scoreV2(m) {
  const pts = dimPts(m);
  const points = DIMS.reduce((s, d) => s + pts[d.key], 0);
  const score = Math.round(points / 12 * 100);
  const base = rag(score);
  const gr = groundRules(m);
  const capped = gr === 'FAIL' && base === 'GREEN';   // GREEN→AMBER* when ground rules missed
  return {
    points, score,
    rag: base,                       // uncapped band from the score
    overall: capped ? 'AMBER' : base, // what the deck's "Overall" column shows
    capped,                          // true → render the "*"
    groundRules: gr,
    pts,                             // { meetings, capture, overdue, inspections, findfix, signoff } → 0/1/2
  };
}

module.exports = { scoreV2, rag, groundRules, dimPts, DIMS };
