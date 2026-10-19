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
  // Incubation is an editorial input (not in our data). When NOT provided
  // (null/undefined) we cannot assess it, so it does not fail the rule; when
  // provided (even 0) it is enforced. Meetings + inspections are always assessed.
  const incOk = (m.incubation == null) || (Number(m.incubation) >= 1);
  return ((Number(m.meetings) || 0) >= 12 && incOk && (Number(m.inspections) || 0) >= 1)
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

// ─────────────────────────────────────────────────────────────────────────────
// Derive a site's raw v2 measures from the live review data `D`
// (services/reviewData.loadReviewData shape: meetings/issues/actions/inspections/
// findings/inspActions). PURE — operates on the arrays, no DB. `incubation` is
// NOT here: it is not in our data model, so the composer injects it from the
// editorial store before scoring (it feeds only the ground-rules cap).
//
// Windowed to the programme (default Apr 1 → asOf), matching the deck and the
// sbDims sbMeasure() convention. Date helpers come from meetings-db (the same
// port siteComposite.js reuses — never a second copy that could drift).
// `inspActions` must carry { site_code, priority, status } for the fix% column.
// ─────────────────────────────────────────────────────────────────────────────
const { _effClose: effClose, _openAt: openAt, MD_OPEN } = require('../meetings-db');

const _r1 = (v) => Math.round(v * 10) / 10;   // one decimal, as the deck prints
function _isFound(f) { const s = String(f.status || '').toLowerCase(); return s === 'critical' || s === 'major' || s === 'minor'; }
function _isHighAction(a) { const p = String(a.priority || '').toLowerCase(); return p === 'critical' || p === 'high'; }
function _isClosedAction(a) { const s = String(a.status || '').toLowerCase(); return s === 'closed' || s === 'resolved' || s === 'done' || s === 'completed'; }
// A "business incubation" is a meeting whose intake_source marks it as such
// (md_meetings.intake_source = 'business_incubation'). It is NOT a department
// meeting, so it is counted as the incubation measure and excluded from the
// department-meeting count (the "Meet" column + the 3-meetings/month rule).
function _isIncub(m) { return /incub/i.test(String(m.intake_source || '')); }

function siteMeasuresV2(site, D, { from = '2026-04-01', to } = {}) {
  const A = to;
  const allMeets = (D.meetings || []).filter((m) => m.site_code === site && m.meeting_date >= from && m.meeting_date <= A);
  const incubation = allMeets.filter(_isIncub).length;
  const meets = allMeets.filter((m) => !_isIncub(m));   // department meetings only
  const isss = (D.issues || []).filter((i) => i.site_code === site && i.meeting_date >= from && i.meeting_date <= A);
  const reviews = meets.length;
  const capture = reviews ? isss.length / reviews : 0;               // items logged per meeting
  const resolved = isss.filter((i) => { const c = effClose(i); return i.status === 'resolved' && c && c <= A; }).length;
  const closePct = isss.length ? Math.round(100 * resolved / isss.length) : 0;
  // overdue = open issues + open meeting-actions past their target (sbMeasure convention)
  const odIss = (D.issues || []).filter((i) => i.site_code === site && openAt(i, A) && i.target_date && i.target_date < A).length;
  const odAct = (D.actions || []).filter((a) => a.site_code === site && a.meeting_date && a.meeting_date <= A
    && (!a.closed_at || String(a.closed_at).slice(0, 10) > A) && MD_OPEN[a.status] && a.target_date && a.target_date < A).length;
  const overdue = odIss + odAct;
  const insps = (D.inspections || []).filter((i) => i.site_code === site && i.inspection_date <= A);
  const inspections = insps.length;
  const found = (D.findings || []).filter((f) => f.site_code === site && f.inspection_date <= A && _isFound(f)).length;
  const findPerInsp = inspections ? found / inspections : 0;
  const highActions = (D.inspActions || []).filter((a) => a.site_code === site && _isHighAction(a));
  const fixPct = highActions.length ? Math.round(100 * highActions.filter(_isClosedAction).length / highActions.length) : 0;
  const signed = meets.filter((m) => m.dept_head_signed_at && m.site_it_signed_at
    && String(m.dept_head_signed_at).slice(0, 10) <= A && String(m.site_it_signed_at).slice(0, 10) <= A).length;
  const signoff = meets.length ? Math.round(100 * signed / meets.length) : 0;
  return {
    meetings: reviews, incubation, raised: isss.length, capture: _r1(capture), closePct,
    overdue, inspections, found, findPerInsp: _r1(findPerInsp), fixPct, signoff,
  };
}

const ANCHOR = '2026-07-14';

// Distinct sites that held ≥1 department meeting in the window — the governance
// programme's participating sites (the deck's 5). Deterministic order: by score
// is applied later; here we just collect.
function _activeCodes(D, from, to) {
  const set = new Set();
  (D.meetings || []).forEach((m) => { if (m.meeting_date >= from && m.meeting_date <= to) set.add(m.site_code); });
  return [...set];
}

// Slide 13 — the league table + composite bar chart.
//   opts: { asOf, from, codes, incubation:{code:n}, siteName:code=>string }
function buildScoreboardV2(D, opts = {}) {
  const to = opts.asOf || ANCHOR;
  const from = opts.from || '2026-04-01';
  const inc = opts.incubation || {};
  const name = opts.siteName || ((c) => c);
  const codes = opts.codes || _activeCodes(D, from, to);
  const rows = codes.map((c) => {
    const m = siteMeasuresV2(c, D, { from, to });
    // incubation now comes from the data (business_incubation meetings); an
    // explicit editorial value still overrides it if the operator provides one.
    if (inc[c] != null) m.incubation = Number(inc[c]);
    const v = scoreV2(m);
    return {
      code: c, name: name(c),
      score: v.score, overall: v.overall, capped: v.capped, groundRules: v.groundRules, pts: v.pts,
      meetings: m.meetings, capture: m.capture, closePct: m.closePct, overdue: m.overdue,
      inspections: m.inspections, findPerInsp: m.findPerInsp, fixPct: m.fixPct,
      signoff: m.signoff, incubation: m.incubation,
    };
  }).sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i + 1; });
  const groupAvg = rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null;
  return { rows, groupAvg, window: { from, to } };
}

// Deterministic "two moves" per site — biggest gaps first, plain sentences.
// These are the EDITABLE DEFAULTS (the author overrides the human framing).
function _movesFor(r) {
  const cands = [];
  if (r.groundRules === 'FAIL' && r.incubation < 1) cands.push([95, 'Hold a first business incubation — none logged this quarter (a ground rule).']);
  if (r.overdue > 0) cands.push([90 + r.overdue, 'Clear the overdue backlog — ' + r.overdue + ' item(s) past their target date.']);
  if (r.pts.signoff < 2) cands.push([80, 'Sign the minutes — only ' + r.signoff + '% of meetings have both signatures.']);
  if (r.pts.findfix < 2) cands.push([78, 'Inspect deeper and close findings — ' + r.findPerInsp + ' found/inspection, ' + r.fixPct + '% of high/critical closed.']);
  if (r.pts.inspections < 2) cands.push([72, 'Run more inspections — ' + r.inspections + ' this quarter (target ≥ 4).']);
  if (r.pts.meetings < 2) cands.push([70, 'Hold more department meetings — ' + r.meetings + ' this quarter (target 3/month).']);
  if (r.pts.capture < 2) cands.push([60, 'Capture more per meeting — ' + r.capture + ' items logged/meeting.']);
  cands.sort((a, b) => b[0] - a[0]);
  while (cands.length < 2) cands.push([0, 'Hold the line — keep every routine and sign every PV.']);
  return cands.slice(0, 2).map((x, i) => ({ n: i + 1, text: x[1] }));
}

// Slide 14 — effort matrix bubbles + gap-to-green stacked points + two moves.
//   opts: same as buildScoreboardV2, plus roadmap:{code:deltaPP}
function buildEffortMatrixV2(D, opts = {}) {
  const sb = buildScoreboardV2(D, opts);
  const roadmap = opts.roadmap || {};
  const GREEN_PTS = 8.4;   // 70% of 12 — the deck's GREEN line
  const bubbles = sb.rows.map((r) => ({
    code: r.code, x: r.closePct, y: r.overdue, size: r.meetings,
    dashed: r.groundRules === 'FAIL', delta: roadmap[r.code] == null ? null : roadmap[r.code],
    score: r.score, overall: r.overall,
  }));
  const gap = sb.rows.map((r) => ({
    code: r.code, score: r.score,
    segs: DIMS.map((d) => ({ key: d.key, label: d.label, pts: r.pts[d.key] })),
    points: DIMS.reduce((s, d) => s + r.pts[d.key], 0),
  }));
  const moves = sb.rows.map((r) => ({ code: r.code, name: r.name, score: r.score, overall: r.overall, moves: _movesFor(r) }));
  return { bubbles, gap, moves, greenPts: GREEN_PTS, groupAvg: sb.groupAvg, window: sb.window };
}

module.exports = { scoreV2, rag, groundRules, dimPts, DIMS, siteMeasuresV2, buildScoreboardV2, buildEffortMatrixV2, ANCHOR };
