'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// services/reviewDashboard.js — a PORT of the authoritative IT Review
// Dashboard's presentation layer (its `renderVals()` and helpers).
//
//   SOURCE OF TRUTH: docs/reference/it-review-dashboard.source.js
//   RULES:           docs/reference/README.md
//
// Every threshold, weight, rounding, string and colour here is copied from that
// file. DO NOT retune any of it. If our number disagrees with the source, OUR
// CODE IS WRONG — the team reads the numbers the source produces.
//
// Pure: it takes the `D` shape (services/reviewData.js builds it from our DBs)
// and returns the flat object the template binds. No I/O, no DB, no state.
//
// REUSED, never duplicated — two copies of this maths would silently drift, and
// that drift is the exact class of bug this effort exists to kill:
//   • services/siteComposite.js → the composite() model + the date primitives.
//   • services/siteScore.js     → computeSiteScore() (the sbDims model's
//                                 arithmetic half) + rag2/moveText.
//
// WHAT THIS FILE ADDS THAT NEITHER HAS: `sbMeasure()`. The source's sbDims()
// does two jobs — it MEASURES six dimensions out of `D`, then scores them.
// siteScore.js ported only the scoring; the measuring half (source :166-179)
// existed nowhere. It lives here.
//
// Deliberate, mechanical deviations from the source (the class-shaped ones):
//   • `this.x()` → plain function calls (the source is a class method body).
//   • `Component.X` statics → module constants.
//   • `this.state.{view,period,site}` → arguments (no React here).
//
// The SUBSTANTIVE deviations are four, each marked `DEVIATION:` at its site:
//   1. `codes` derives from `D` instead of being 5 hardcoded strings.
//   2. The three hardcoded `/ 5` and `* 5` denominators follow `codes`.
//   3. `SITES[code]` lookups are made total (his 5 → our 11-12 site fleet).
//   4. `applicable:false` sites are omitted rather than rendered broken.
// All four are no-ops on his data — see tests/review-fidelity.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const {
  dUTC, days, median, isOpenNow, effClose, openAt,
  composite, twoMoves, rag, ragPct, ANCHOR,
} = require('./siteComposite');
const { computeSiteScore, rag2 } = require('./siteScore');

// ── statics (source :12-15) ─────────────────────────────────────────────────

const SITES = {
  SML: { name: 'Lafigué', country: 'Côte d’Ivoire' },
  SMI: { name: 'Ity', country: 'Côte d’Ivoire' },
  HGO: { name: 'Houndé', country: 'Burkina Faso' },
  MGO: { name: 'Mana', country: 'Burkina Faso' },
  SGO: { name: 'Sabodala-Massawa', country: 'Senegal' },
};

const GREEN = '#2f7d4f';
const AMBER = '#b07a17';
const RED = 'var(--color-accent)';
const REDT = '#c2280f';

// source :14 — the OPEN status set. Imported behaviour via isOpenNow/openAt, but
// sbMeasure's action filter and a couple of panels test it directly.
const { MD_OPEN: OPEN } = require('../meetings-db');

// DEVIATION 3 — the source does `Component.SITES[site].name` (:225, :257, :300,
// :344, :418, :435, :468) and THROWS on any code outside his 5. Our fleet has
// 11-12 sites (Kalana, Ouaga, Abidjan, Dakar, Tanda, Exploration…) that his
// dashboard never saw. Make the lookup total; his 5 resolve exactly as before.
function siteOf(code) { return SITES[code] || { name: code, country: '' }; }

// BRIDGE GAP — siteScore.rag2() returns a STRING ('GREEN'); renderVals needs
// rg.fg / rg.solidBg / rg.solidFg (:432, :438, :446, :450, :464, :468, :473).
// Look the colours up off the string here rather than modify siteScore.js
// (which is fidelity-pinned and not on the approved-to-touch list).
// Colours verbatim from source :494-498.
const RAG2_COLORS = {
  GREEN: { fg: GREEN, solidBg: '#2f7d4f', solidFg: '#fff' },
  AMBER: { fg: AMBER, solidBg: '#d99a2b', solidFg: '#fff' },
  RED: { fg: REDT, solidBg: RED, solidFg: '#fff' },
};
function rag2Full(score) {
  const label = rag2(score);
  return { label, ...RAG2_COLORS[label] };
}

// ── date helpers (source :19-20) ────────────────────────────────────────────

function addDays(iso, n) {
  const t = dUTC(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmt(iso) {
  if (!iso) return '—';
  const d = dUTC(iso);
  return d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()];
}

// ── windows (source :27) ────────────────────────────────────────────────────
//
// QUIRK — ported AS-IS: only 'week' is derived from the anchor. month / quarter
// / semester are HARDCODED to July 2026 ('2026-07-01' cur, literal prev ranges).
// They do not move with an as-of date. Pinned by tests; do not "fix" here.
//
// NOT services/scoreWindow.js. That is the rolling 3-month SCORE window — a
// different concept with different thresholds. Do not merge the two.
function windows(period) {
  const A = ANCHOR;
  if (period === 'week') return { cur: [addDays(A, -6), A], prev: [addDays(A, -13), addDays(A, -7)], short: 'WoW', note: 'vs prior week' };
  if (period === 'month') return { cur: ['2026-07-01', A], prev: ['2026-06-01', '2026-06-30'], short: 'MoM', note: 'vs June' };
  if (period === 'quarter') return { cur: ['2026-07-01', A], prev: ['2026-04-01', '2026-06-30'], short: 'QoQ', note: 'vs Q2' };
  return { cur: ['2026-07-01', A], prev: ['2026-01-01', '2026-06-30'], short: 'HoH', note: 'vs H1' };
}

// ── filterSite (source :35) ─────────────────────────────────────────────────

function filterSite(rows, site) { return site === 'ALL' ? rows : rows.filter(r => r.site_code === site); }

// ── metrics (source :38) — stock/flow extraction for a site scope ───────────
//
// NOTE the anchor: `const A = ANCHOR` is the source's own line — overdueNow is
// measured against the ANCHOR, not against the window end. Ported as-is.
function metrics(issues, meetings, win) {
  const [c0, c1] = win.cur;
  const [p0, p1] = win.prev;
  const inWin = (d, w0, w1) => d && d >= w0 && d <= w1;
  const raisedCur = issues.filter(i => inWin(i.meeting_date, c0, c1)).length;
  const raisedPrev = issues.filter(i => inWin(i.meeting_date, p0, p1)).length;
  // QUIRK: closedCur/closedPrev are computed here and read by NOTHING in
  // renderVals. Ported verbatim anyway — this is a port, not a redesign.
  const closedCur = issues.filter(i => { const c = effClose(i); return i.status !== 'cancelled' && inWin(c, c0, c1); }).length;
  const closedPrev = issues.filter(i => { const c = effClose(i); return i.status !== 'cancelled' && inWin(c, p0, p1); }).length;
  const openNow = issues.filter(i => isOpenNow(i));
  const openPrev = issues.filter(i => openAt(i, p1)).length;
  const A = ANCHOR;
  const overdueNow = openNow.filter(i => i.target_date && i.target_date < A).length;
  const overduePrev = issues.filter(i => openAt(i, p1) && i.target_date && i.target_date < p1).length;
  const highNow = openNow.filter(i => i.severity === 'HIGH').length;
  const highPrev = issues.filter(i => openAt(i, p1) && i.severity === 'HIGH').length;
  // `=== '1' || === 1` is LOAD-BEARING, not clumsiness to tidy away: our DB
  // stores `escalate` as INTEGER, the boss's export stores it as a string.
  // Both must count. Do not "simplify".
  const escNow = openNow.filter(i => i.escalate === '1' || i.escalate === 1).length;
  const mttrOf = (w0, w1) => {
    const v = issues
      .filter(i => { const c = effClose(i); return i.status === 'resolved' && c && inWin(c, w0, w1) && i.meeting_date; })
      .map(i => days(effClose(i), i.meeting_date));
    return median(v);
  };
  const covOf = (w0, w1) => new Set(meetings.filter(m => inWin(m.meeting_date, w0, w1)).map(m => m.site_code + '|' + m.department)).size;
  return {
    raisedCur, raisedPrev, closedCur, closedPrev,
    openNow: openNow.length, openPrev, overdueNow, overduePrev,
    highNow, highPrev, escNow,
    mttrCur: mttrOf(c0, c1), mttrPrev: mttrOf(p0, p1),
    covCur: covOf(c0, c1), covPrev: covOf(p0, p1),
    openList: openNow,
  };
}

// ── delta (source :58) ──────────────────────────────────────────────────────

function delta(cur, prev, invert, unit) {
  if (cur == null || prev == null) return { txt: '—', color: 'var(--color-neutral-500)' };
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return { txt: '· 0', color: 'var(--color-neutral-500)' };
  const good = invert ? d < 0 : d > 0;
  return { txt: (d > 0 ? '▲ +' : '▼ ') + d + (unit || ''), color: good ? GREEN : REDT };
}

// ── spark (source :66) ──────────────────────────────────────────────────────
//
// Both clamps are deliberate: `max(...series, 1)` stops an all-zero series
// dividing by zero, `max(n - 1, 1)` stops a single-point series doing the same.
function spark(series) {
  const max = Math.max(...series, 1);
  const n = series.length;
  const pts = series.map((v, i) => (4 + i * (56 / Math.max(n - 1, 1))) + ',' + (19 - (v / max) * 16));
  const last = pts[pts.length - 1].split(',');
  return { pts: pts.join(' '), x: last[0], y: last[1] };
}

// ── pack (source :491) ──────────────────────────────────────────────────────

function pack(dl) { return { deltaTxt: dl.txt, deltaColor: dl.color }; }

// ── sbMeasure — THE MISSING HALF OF sbDims (source :166-179) ────────────────
//
// services/siteScore.js ported sbDims' ARITHMETIC (thresholds → points →
// score). This is the half that MEASURES those six values out of `D`, verbatim
// from the source. Feed its output straight to computeSiteScore().
//
// Do NOT substitute meetings-db.getSiteScoreInputs / inspection-db's namesake:
// they query the DB (breaking this module's pure contract and the fixture-based
// fidelity proof) and they measure over scoreWindow's ROLLING 3-month window,
// not the hardcoded W0 below — the numbers would silently diverge from the
// oracle.
//
// Returns the six dims PLUS `raised`. `raised` is siteScore.hasData()'s
// APPLICABILITY SIGNAL, not a dimension: it exists only to disambiguate
// `resolution`'s zero ("0% of 4 issues resolved" vs "no issues ever raised").
// It never enters dims/points/score. See siteScore.js's own note.
function sbMeasure(site, D, asOf) {
  const A = asOf || ANCHOR;
  const W0 = '2026-04-01';   // the source's hardcoded programme start
  const meets = D.meetings.filter(m => m.site_code === site && m.meeting_date >= W0 && m.meeting_date <= A);
  const isss = D.issues.filter(i => i.site_code === site && i.meeting_date >= W0 && i.meeting_date <= A);
  const reviews = meets.length;
  const resolved = isss.filter(i => { const c = effClose(i); return i.status === 'resolved' && c && c <= A; }).length;
  const resolution = isss.length ? Math.round(100 * resolved / isss.length) : 0;
  const odIss = D.issues.filter(i => i.site_code === site && openAt(i, A) && i.target_date && i.target_date < A).length;
  const odAct = D.actions.filter(a => a.site_code === site && a.meeting_date && a.meeting_date <= A
    && (!a.closed_at || String(a.closed_at).slice(0, 10) > A)
    && OPEN[a.status] && a.target_date && a.target_date < A).length;
  const overdue = odIss + odAct;
  const insp = D.inspections.filter(i => i.site_code === site && i.inspection_date <= A).length;
  const findings = D.findings.filter(f => f.site_code === site && f.inspection_date <= A
    && (f.status === 'critical' || f.status === 'major')).length;
  const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at
    && String(m.dept_head_signed_at).slice(0, 10) <= A
    && String(m.site_it_signed_at).slice(0, 10) <= A).length;
  const signoff = meets.length ? Math.round(100 * signed / meets.length) : 0;
  return { reviews, raised: isss.length, resolution, overdue, inspections: insp, findings, signoff };
}

module.exports = {
  SITES, GREEN, AMBER, RED, REDT, OPEN,
  siteOf, rag2Full,
  addDays, fmt, windows, filterSite, metrics, delta, spark, pack, sbMeasure,
};
