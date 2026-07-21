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

// ── lookup tables (source :357, :422) ───────────────────────────────────────

const catNames = {
  pwr: 'Power / UPS', env: 'Environment', net: 'Network', fire: 'Fire safety',
  radio: 'Radio', tower: 'Towers', sec: 'Security', srv: 'Servers', sto: 'Storage',
  cell: 'Cellular', rack: 'Racks', doc: 'Documentation', cctv: 'CCTV',
  bcp: 'BCP / DR', hse: 'HSE', op: 'Operations', ug: 'Underground',
};

const dimColors = {
  reviews: '#1d6b5e', resolution: '#2a9d8f', overdue: '#7fb7d9',
  inspections: '#2f7d4f', findings: '#d9a13b', signoff: '#8a8a8a',
};

// The source's 5 codes, in HIS order (source :213). LOAD-BEARING — see DEVIATION 1.
const HIS_CODES = ['SML', 'SMI', 'HGO', 'MGO', 'SGO'];

// ── codesOf — DEVIATION 1, lifted out of buildReviewVals ────────────────────
//
// `codes` derives from D instead of source :213's 5 literals. His order is
// LOAD-BEARING, not incidental: it IS eMatrix/inspSiteRows row order AND the
// sbSorted stable-sort tie-break (SML and MGO both score 50). Sorting naively
// flips five panels. So: keep his five in his order, then append sites he never
// saw, sorted for determinism.
//
// `present` = the union of the two PARENT tables — issues/actions/projects hang
// off meetings, findings/inspActions off inspections. meetings alone would drop
// a site with an inspection but no PV.
//
// EXPORTED so the route can derive `codes` for loadReviewExtras from the ONE
// definition. Do not re-derive the order anywhere else.
function codesOf(D) {
  const present = new Set([
    ...D.meetings.map(m => m.site_code),
    ...D.inspections.map(i => i.site_code),
  ].filter(Boolean));
  return [
    ...HIS_CODES.filter(c => present.has(c)),
    ...[...present].filter(c => !HIS_CODES.includes(c)).sort(),
  ];
}

// ── extrasWindows — OURS, not the source's ──────────────────────────────────
//
// The two windows the Helpdesk & Changes panel reads over, in ONE place. This
// is the user's decision #1 made executable:
//   • helpdesk FOLLOWS the period selector — windows(period).cur.
//   • changes are a FIXED ~90 days ending at ANCHOR. The last change in the data
//     is 2026-07-03 and ANCHOR is 2026-07-14, so the default WEEK window holds
//     ZERO changes — following the selector would render them as permanent
//     dashes beside a helpdesk showing hundreds of tickets.
// Two spans in one panel is confusing unless labelled, hence hdNote states both.
//
// ISO STRINGS ONLY — addDays, NEVER fmt. fmt is a DISPLAY formatter:
// fmt('2026-04-15') is '15 Apr', and feeding that to the readers'
// `substr(created_time,1,10) BETWEEN ? AND ?` matches nothing and returns 0 rows
// with NO error. windows() already returns ISO; addDays keeps it ISO.
//
// Pedantry: an inclusive BETWEEN over addDays(-90)..ANCHOR spans 91 days. The
// bounds are exact; just don't write "exactly 90" in the UI note.
//
// windows() pins to ANCHOR, not asOf (his line, :109) — so this panel moves with
// the period selector and NOT with ?asOf=, consistent with the rest of the page.
function extrasWindows(period) {
  const cur = windows(period).cur;
  return { hdFrom: cur[0], hdTo: cur[1], chgFrom: addDays(ANCHOR, -90), chgTo: ANCHOR };
}

// ── the extras panel — OURS, additive, and it NEVER enters the score ─────────
//
// His dashboard has no helpdesk concept at all (its D is meetings/inspection
// only). This rides in via the OPTIONAL opts.extras precisely so that calling
// buildReviewVals without it still emits exactly his 61 keys and
// tests/review-fidelity.test.js keeps proving the port. Never fold it into D.
//
// Colour thresholds are OURS — declared here rather than buried at the callsite:
//   sla_overdue  > 5 → red, > 0 → amber
//   major_incidents > 0 → red
//   success_pct  < 75 → red, < 90 → amber, null → NO verdict (neutral)
// Palette reused from the constants above; the leaderboard uses REDT for exactly
// this job (emphasising a bad number in a table cell, :360-361).
const DASH = '—';
const NEUTRAL = 'var(--color-neutral-500)';

function hdRowsOf(codes, extras, siteName) {
  const hd = (extras && extras.helpdesk) || {};
  const ch = (extras && extras.changes) || {};
  return codes.map(c => {
    const h = hd[c];
    const k = ch[c];
    // success_pct is null when nothing executed — "nothing to judge" is not
    // "0% success". `?? null` and never `|| 0`: 0 IS a real reading here.
    const pct = k ? (k.success_pct ?? null) : null;
    return {
      code: c, name: siteName(c),
      created: h ? h.created : DASH,
      resolved: h ? h.resolved : DASH,
      backlog: h ? h.backlog : DASH,
      slaOverdue: h ? h.sla_overdue : DASH,
      slaColor: !h ? NEUTRAL : h.sla_overdue > 5 ? REDT : h.sla_overdue > 0 ? AMBER : 'var(--color-text)',
      majorIncidents: h ? h.major_incidents : DASH,
      miColor: !h ? NEUTRAL : h.major_incidents > 0 ? REDT : 'var(--color-text)',
      changes: k ? k.total : DASH,
      failed: k ? k.failed : DASH,          // already INCLUDES backed_out (Task 1's contract)
      emergency: k ? k.emergency : DASH,
      successPct: pct == null ? DASH : pct + '%',
      successColor: pct == null ? NEUTRAL : pct < 75 ? REDT : pct < 90 ? AMBER : GREEN,
    };
  });
}

// ── buildReviewVals — the port of renderVals() (source :206-499) ────────────
/**
 * @param {object} D    the dashboard's data shape (services/reviewData.js).
 * @param {object} opts { view, period, site, asOf }
 * @returns {object} the 61-key flat object the template binds (source :471-488).
 *
 * The source reads view/period/site off React state and D off window.EM_DATA;
 * here they are arguments and this function is pure. The 23-key loading stub
 * (source :206) has no analogue — there is no async boot to guard.
 */
function buildReviewVals(D, opts = {}) {
  const { view = 'dashboard', period = 'week', site = 'ALL', asOf = ANCHOR, extras } = opts;
  const G = GREEN, AM = AMBER, RD = REDT;
  const A = asOf || ANCHOR;
  const win = windows(period);

  // DEVIATION 1 — `codes` derives from D, in HIS order. See codesOf above: it is
  // the ONE definition, so the route and this function cannot drift apart.
  const codes = codesOf(D);

  // ── controls ──────────────────────────────────────────────────────────────
  // The source's `pick` closures are DROPPED: they bound live setState (4
  // sc-camel-on-click sites) and cannot survive a pure function. `key` carries
  // the same information declaratively — 3B-2b turns these into links/query
  // params. (Not derivable from `label`: 'WEEKLY BRIEF' → 'brief'.)
  const mk = (key, label, active) => ({
    key, label,
    bg: active ? 'var(--color-text)' : 'var(--color-bg)',
    fg: active ? 'var(--color-bg)' : 'var(--color-text)',
  });
  const viewOpts = [
    mk('dashboard', 'DASHBOARD', view === 'dashboard'),
    mk('scoreboard', 'SCOREBOARD', view === 'scoreboard'),
    mk('brief', 'WEEKLY BRIEF', view === 'brief'),
  ];
  const periodOpts = [['week', 'WEEK'], ['month', 'MONTH'], ['quarter', 'QUARTER'], ['semester', 'SEMESTER']]
    .map(([k, l]) => mk(k, l, period === k));
  const siteOpts = [['ALL', 'ALL'], ...codes.map(c => [c, c])].map(([k, l]) => mk(k, l, site === k));

  // ── scope ─────────────────────────────────────────────────────────────────
  const issues = filterSite(D.issues, site);
  const meetings = filterSite(D.meetings, site);
  const M = metrics(issues, meetings, win);
  const scopeLabel = site === 'ALL' ? 'All sites — group view' : siteOf(site).name + ' (' + site + ')';
  const scopeSuffix = site === 'ALL' ? '— all sites' : '— ' + siteOf(site).name;

  // ── monthly series for the sparks ─────────────────────────────────────────
  const months = ['2026-04', '2026-05', '2026-06', '2026-07'];
  const ends = ['2026-04-30', '2026-05-31', '2026-06-30', A];
  const serRaised = months.map(mo => issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length);
  const serOpen = ends.map(e => issues.filter(i => openAt(i, e)).length);
  const serOver = ends.map(e => issues.filter(i => openAt(i, e) && i.target_date && i.target_date < e).length);
  const serHigh = ends.map(e => issues.filter(i => openAt(i, e) && i.severity === 'HIGH').length);

  // DEVIATION 2 — the source hardcodes `12 * 5`. Follows `codes` now, so the
  // denominator stays true on our 11-12 site fleet. Identical on his data.
  const targetDepts = site === 'ALL' ? 12 * codes.length : 12;
  const kd = (label, value, unit, dlt, series, note) => {
    const sp = spark(series);
    return { label, value, unit, deltaTxt: dlt.txt, deltaColor: dlt.color, spark: sp.pts, sparkX: sp.x, sparkY: sp.y, deltaNote: note || win.note };
  };
  const kpis = [
    kd('Raised', M.raisedCur, 'in window', delta(M.raisedCur, M.raisedPrev, false), serRaised),
    kd('Open now', M.openNow, 'backlog', delta(M.openNow, M.openPrev, true), serOpen),
    kd('Overdue', M.overdueNow, 'past target', delta(M.overdueNow, M.overduePrev, true), serOver),
    kd('HIGH open', M.highNow, 'severity', delta(M.highNow, M.highPrev, true), serHigh),
    kd('Escalations', M.escNow, 'open', { txt: M.escNow ? '● live' : '· none', color: M.escNow ? RD : G },
      ends.map(e => issues.filter(i => openAt(i, e) && (i.escalate === '1' || i.escalate === 1)).length), 'to Council'),
    kd('Actions open', filterSite(D.actions, site).filter(a => OPEN[a.status]).length, 'IT promises',
      { txt: '', color: 'var(--color-neutral-500)' },
      ends.map(e => filterSite(D.actions, site).filter(a => {
        if (!a.meeting_date || a.meeting_date > e) return false;
        const c = a.closed_at ? String(a.closed_at).slice(0, 10) : null;
        return !c || c > e;
      }).length), 'from reviews'),
    kd('MTTR', M.mttrCur != null ? M.mttrCur : '—', 'days median', delta(M.mttrCur, M.mttrPrev, true, ' d'),
      months.map(mo => {
        const v = issues
          .filter(i => { const c = effClose(i); return i.status === 'resolved' && c && String(c).slice(0, 7) === mo && i.meeting_date; })
          .map(i => days(effClose(i), i.meeting_date));
        return median(v) || 0;
      })),
    kd('Dept coverage', M.covCur + '/' + targetDepts, 'depts met', delta(M.covCur, M.covPrev, false),
      months.map(mo => new Set(meetings.filter(m => String(m.meeting_date || '').slice(0, 7) === mo).map(m => m.site_code + '|' + m.department)).size)),
  ];

  // ── leaderboard (the composite model — RAG 75/55) ─────────────────────────
  // The source calls this.composite(c, D) bare, which defaults to ANCHOR. We
  // thread `A` through so the port generalises past his hardcoded date; at
  // asOf === ANCHOR the two are identical.
  const comps = {}; const compsPrev = {};
  codes.forEach(c => { comps[c] = composite(c, D, A); compsPrev[c] = composite(c, D, win.prev[1]); });
  const leaderboard = codes.map(c => ({ c, comp: comps[c] })).sort((a, b) => b.comp.score - a.comp.score).map((x, idx) => {
    const { c, comp } = x;
    const rg = rag(comp.score);
    const dl = delta(comp.score, compsPrev[c].score, false);
    const tot = Math.max(comp.del * 0.4 + comp.gov * 0.35 + comp.eng * 0.25, 1);
    return {
      rank: idx + 1, code: c, name: siteOf(c).name, country: siteOf(c).country,
      wDel: Math.round(comp.del * 0.4 / tot * 100), wGov: Math.round(comp.gov * 0.35 / tot * 100), wEng: Math.round(comp.eng * 0.25 / tot * 100),
      del: comp.del, gov: comp.gov, eng: comp.eng, score: comp.score, delta: dl.txt, deltaColor: dl.color,
      open: comp.open, overdue: comp.overdue, high: comp.high, penalty: comp.pen ? '−' + comp.pen : '·',
      overdueColor: comp.odRate > 20 ? RD : 'var(--color-text)', overdueWeight: comp.odRate > 20 ? 700 : 400,
      highColor: comp.high >= 4 ? RD : 'var(--color-text)', highWeight: comp.high >= 4 ? 700 : 400,
      rag: rg.label, ragBg: rg.bg, ragFg: rg.fg,
      rowBg: site === c ? 'var(--color-accent-100)' : 'var(--color-bg)',
      // `pick` dropped — see the controls note above.
    };
  });
  // The country groups hardcode his 5 codes (source :268). DEVIATION 3 again:
  // narrow each to the codes actually present, or comps[c] is undefined and the
  // reduce throws. Identical on his data; drops an empty country on ours.
  const groups = [
    ['Côte d’Ivoire', ['SML', 'SMI']],
    ['Burkina Faso', ['HGO', 'MGO']],
    ['Senegal', ['SGO']],
    ['GROUP — ALL SITES', codes],
  ];
  const groupRows = groups
    .map(([name, cs]) => [name, cs.filter(c => comps[c])])
    .filter(([, cs]) => cs.length)
    .map(([name, cs]) => {
      const sc = Math.round(cs.reduce((s, c) => s + comps[c].score, 0) / cs.length);
      const scP = Math.round(cs.reduce((s, c) => s + compsPrev[c].score, 0) / cs.length);
      const dl = delta(sc, scP, false);
      return {
        name, sites: cs.join(' · '), score: sc, delta: dl.txt, deltaColor: dl.color,
        open: cs.reduce((s, c) => s + comps[c].open, 0),
        overdue: cs.reduce((s, c) => s + comps[c].overdue, 0),
        high: cs.reduce((s, c) => s + comps[c].high, 0),
      };
    });

  // ── flow months ───────────────────────────────────────────────────────────
  const maxFlow = Math.max(...months.map(mo => Math.max(
    issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length,
    issues.filter(i => { const c = effClose(i); return i.status !== 'cancelled' && c && String(c).slice(0, 7) === mo; }).length)), 1);
  const flowMonths = months.map(mo => {
    const r = issues.filter(i => String(i.meeting_date || '').slice(0, 7) === mo).length;
    const cl = issues.filter(i => { const c = effClose(i); return i.status !== 'cancelled' && c && String(c).slice(0, 7) === mo; }).length;
    const ratio = r ? Math.round(cl / r * 100) / 100 : null;
    return {
      label: ['APR', 'MAY', 'JUN', 'JUL'][months.indexOf(mo)], raised: r, closed: cl,
      hRaised: Math.round(r / maxFlow * 100), hClosed: Math.round(cl / maxFlow * 100),
      ratio: ratio == null ? '—' : ratio.toFixed(2),
      ratioColor: ratio == null ? 'var(--color-neutral-500)' : ratio >= 1 ? G : ratio >= 0.7 ? AM : RD,
    };
  });

  // ── backlog weekly polyline ───────────────────────────────────────────────
  const wk = []; let t = '2026-04-01';
  while (t <= A) { wk.push(t); t = addDays(t, 7); }
  if (wk[wk.length - 1] !== A) wk.push(A);
  const blSeries = wk.map(e => issues.filter(i => openAt(i, e)).length);
  const blMax = Math.max(...blSeries, 1);
  const blPts = blSeries.map((v, i) => (i * (600 / (blSeries.length - 1))).toFixed(1) + ',' + (145 - v / blMax * 135).toFixed(1));
  const blEnd = blPts[blPts.length - 1].split(',');
  const blTrend = blSeries[blSeries.length - 1] - blSeries[blSeries.length - 3];

  // ── 5E matrix — rows follow CODES order, not rank ─────────────────────────
  const eHeaders = [{ label: 'E1', sub: 'cadence' }, { label: 'E2', sub: '48 h diffusion' }, { label: 'E3', sub: 'champions' }, { label: 'E4', sub: 'not measured' }, { label: 'E5', sub: 'discipline' }];
  const eMatrix = codes.map(c => {
    const e = comps[c].e;
    const cell = (v, g, a, tip) => { const rg = ragPct(v, g, a); return { val: v == null ? '—' : v + '%', bg: rg.bg, fg: rg.fg, tip }; };
    return {
      site: siteOf(c).name + ' · ' + c,
      cells: [
        cell(e.e1, 90, 70, 'PV cadence held'),
        cell(e.e2, 80, 50, 'both signatures ≤48h'),
        cell(e.e3, 90, 70, 'issues with champion'),
        { val: '—', bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-500)', tip: 'E4 not yet measured' },
        cell(e.e5, 90, 70, 'next date + priorities set'),
      ],
    };
  });

  // ── signature funnel ──────────────────────────────────────────────────────
  const subM = meetings.filter(m => m.submitted_at);
  const dhSigned = subM.filter(m => m.dept_head_signed_at);
  const itSigned = subM.filter(m => m.site_it_signed_at);
  const both48 = subM.filter(m => {
    if (!m.dept_head_signed_at || !m.site_it_signed_at) return false;
    return (Math.max(new Date(m.dept_head_signed_at.replace(' ', 'T') + 'Z'), new Date(m.site_it_signed_at.replace(' ', 'T') + 'Z'))
      - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) <= 48 * 3600000;
  });
  const medLatH = (list, f) => {
    const v = list.filter(m => m[f])
      .map(m => (new Date(m[f].replace(' ', 'T') + 'Z') - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) / 3600000)
      .filter(h => h >= 0);
    const md = median(v);
    return md == null ? null : Math.round(md * 10) / 10;
  };
  const dhLat = medLatH(subM, 'dept_head_signed_at');
  const itLat = medLatH(subM, 'site_it_signed_at');
  const sigFunnel = [
    { label: 'PVs submitted', value: subM.length, note: 'of ' + meetings.length + ' meetings', noteColor: 'var(--color-neutral-600)' },
    { label: 'Dept head signed', value: dhSigned.length, note: dhLat != null ? 'median ' + dhLat + ' h' : 'no data', noteColor: dhLat != null && dhLat <= 48 ? G : RD },
    { label: 'Site IT signed', value: itSigned.length, note: itLat != null ? 'median ' + itLat + ' h' : 'no data', noteColor: itLat != null && itLat <= 48 ? G : RD },
    { label: 'Both ≤ 48 h', value: both48.length + ' / ' + subM.length, note: subM.length ? Math.round(100 * both48.length / subM.length) + '% — target ≥ 80%' : '—', noteColor: subM.length && both48.length / subM.length >= 0.8 ? G : RD },
  ];

  // ── aging ─────────────────────────────────────────────────────────────────
  const buckets = [['≤ 30 d', 0, 30], ['31–60 d', 31, 60], ['61–90 d', 61, 90], ['> 90 d', 91, 9999]];
  const openList = M.openList;
  const maxB = Math.max(...buckets.map(([, lo, hi]) => openList.filter(i => { const a2 = days(A, i.meeting_date); return a2 >= lo && a2 <= hi; }).length), 1);
  const aging = buckets.map(([label, lo, hi]) => {
    const rows = openList.filter(i => { const a2 = days(A, i.meeting_date); return a2 >= lo && a2 <= hi; });
    const h = rows.filter(i => i.severity === 'HIGH').length;
    const m2 = rows.filter(i => i.severity === 'MEDIUM').length;
    const l = rows.filter(i => i.severity === 'LOW').length;
    const scale = 100 / maxB;
    return { label, total: rows.length, wHigh: (h * scale).toFixed(1), wMed: (m2 * scale).toFixed(1), wLow: (l * scale).toFixed(1), highTxt: h ? '· ' + h + ' HIGH' : '' };
  });

  // ── champion load ─────────────────────────────────────────────────────────
  const loadMap = {};
  openList.forEach(i => { const c = (i.champion || '').trim(); if (c) loadMap[c] = (loadMap[c] || 0) + 1; });
  const champSorted = Object.entries(loadMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxL = Math.max(...champSorted.map(x => x[1]), 1);
  const champLoad = champSorted.map(([name, n]) => ({
    name, n, w: Math.round(n / maxL * 100),
    color: n >= 7 ? 'var(--color-accent)' : n >= 5 ? '#d9a13b' : 'var(--color-neutral-600)',
    numColor: n >= 7 ? RD : 'var(--color-text)', flag: n >= 7 ? ' ⚠' : '',
  }));

  // ── overdue register ──────────────────────────────────────────────────────
  const odAll = openList.filter(i => i.target_date && i.target_date < A).sort((a, b) => a.target_date < b.target_date ? -1 : 1);
  const sevTag = s => s === 'HIGH' ? { bg: 'var(--color-accent-100)', fg: RD }
    : s === 'MEDIUM' ? { bg: '#f5e7c8', fg: '#7a5510' }
      : { bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-700)' };
  const overdueRows = odAll.slice(0, 9).map(o => {
    const dl = days(A, o.target_date);
    const st = sevTag(o.severity);
    return {
      days: dl, dColor: dl > 60 ? RD : dl > 30 ? AM : 'var(--color-text)',
      title: (o.title || '').slice(0, 80),
      meta: o.site_code + ' · ' + (o.department || '') + ' · ' + ((o.champion || '').trim() || 'no champion') + ' · due ' + fmt(o.target_date),
      sev: o.severity, sevBg: st.bg, sevFg: st.fg,
    };
  });
  const noTargetN = openList.filter(i => !i.target_date).length;

  // ── inspections — rows follow CODES order ─────────────────────────────────
  const findAll = site === 'ALL' ? D.findings : D.findings.filter(f => f.site_code === site);
  const inspSiteRows = (site === 'ALL' ? codes : [site]).map(c => {
    const ins = D.inspections.filter(i => i.site_code === c);
    const fs = D.findings.filter(f => f.site_code === c);
    const crit = fs.filter(f => f.status === 'critical').length;
    const maj = fs.filter(f => f.status === 'major').length;
    const min2 = fs.filter(f => f.status === 'minor').length;
    // QUIRK: `opp` (opportunity) is in the conformity DENOMINATOR (!== 'na')
    // but not the NUMERATOR (=== 'ok'), so opportunities depress conf%. His
    // data carries 12 of them. Ported as-is.
    const appl = fs.filter(f => f.status !== 'na').length;
    const ok = fs.filter(f => f.status === 'ok').length;
    const conf = appl ? Math.round(100 * ok / appl) : null;
    const last = ins.map(i => i.inspection_date).sort().pop();
    const dAgo = last ? days(A, last) : null;
    // QUIRK: only 'Closed' is excluded. Our vocabulary also has 'Cancelled'
    // (public/inspection-actions.html STATUSES), which his data lacks — a
    // cancelled action therefore counts as open. LATENT; ported as-is.
    const acts = D.inspActions.filter(a => a.site_code === c && a.status !== 'Closed').length;
    const maxD = Math.max(crit + maj + min2, 1);
    return {
      site: siteOf(c).name + ' · ' + c, count: ins.length, last: fmt(last),
      daysAgo: dAgo == null ? '—' : dAgo, daysColor: dAgo == null || dAgo > 45 ? RD : 'var(--color-text)',
      wCrit: Math.round(crit / maxD * 100), wMaj: Math.round(maj / maxD * 100), wMin: Math.round(min2 / maxD * 100),
      defTxt: crit + ' / ' + maj + ' / ' + min2,
      conf: conf == null ? '—' : conf + '%',
      confColor: conf == null ? 'var(--color-neutral-500)' : conf >= 90 ? G : conf >= 75 ? AM : RD,
      actOpen: acts,
    };
  });
  const defects = findAll.filter(f => f.status === 'critical' || f.status === 'major' || f.status === 'minor');
  const byCat = {};
  defects.forEach(f => {
    byCat[f.category] = byCat[f.category] || { n: 0, crit: 0 };
    byCat[f.category].n++;
    if (f.status !== 'minor') byCat[f.category].crit++;
  });
  const catSorted = Object.entries(byCat).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const maxC = Math.max(...catSorted.map(x => x[1].n), 1);
  const findCats = catSorted.map(([k, v]) => ({
    label: catNames[k] || k, n: v.n, w: Math.round(v.n / maxC * 100),
    color: v.crit ? 'var(--color-accent)' : 'var(--color-neutral-600)',
  }));

  // ── projects pipeline ─────────────────────────────────────────────────────
  // QUIRK: the four phases are hardcoded. Our seed has a fifth ('closeout') and
  // the data carries nulls — those projects fall OUT of the bars but stay IN
  // projs.length, so pipelineNote reads "N of M" where the bars sum to < M.
  const projs = site === 'ALL' ? D.projects : D.projects.filter(p => p.site_code === site);
  const phases = [['scoping', 'Scoping'], ['design', 'Design'], ['build', 'Build'], ['deploy', 'Deploy']];
  const pipeline = phases.map(([k, label], i) => {
    const n = projs.filter(p => p.phase === k).length;
    return {
      label, n, flex: Math.max(n, 1),
      bg: i === 0 && n > projs.length / 2 ? 'var(--color-accent)' : 'var(--color-neutral-' + (800 - i * 150) + ')',
      fg: 'var(--color-bg)',
    };
  });
  const scopingN = projs.filter(p => p.phase === 'scoping').length;
  const pipelineNote = scopingN + ' of ' + projs.length + ' projects still in scoping — uncosted exposure. '
    + projs.filter(p => !p.target_end).length + ' have no target end date.';

  // ── data quality ──────────────────────────────────────────────────────────
  const unsigned7 = D.meetings.filter(m => m.submitted_at && (!m.dept_head_signed_at || !m.site_it_signed_at)
    && (new Date(A) - new Date(m.submitted_at.replace(' ', 'T') + 'Z')) > 7 * 86400000).length;
  const openNoTarget = D.issues.filter(i => isOpenNow(i) && !i.target_date).length;
  const noChampEmail = D.issues.filter(i => isOpenNow(i) && (i.champion || '').trim() && !(i.champion_email || '').trim()).length;
  const nameKeys = {};
  D.issues.forEach(i => {
    const c = (i.champion || '').trim();
    if (c) { const k = c.toLowerCase().replace(/[^a-z]/g, ''); nameKeys[k] = nameKeys[k] || new Set(); nameKeys[k].add(c); }
  });
  const variants = Object.values(nameKeys).filter(s => s.size > 1).length;
  const dqScore = Math.max(0, 100 - unsigned7 * 3 - openNoTarget * 2 - noChampEmail * 1 - variants * 2);
  const dqItems = [
    { label: 'PVs unsigned > 7 days', value: unsigned7, color: unsigned7 ? RD : G },
    { label: 'Open issues without target date', value: openNoTarget, color: openNoTarget ? RD : G },
    { label: 'Open issues, champion has no email', value: noChampEmail, color: noChampEmail ? AM : G },
    { label: 'Champion name-spelling variants', value: variants, color: variants ? AM : G },
  ];

  // ── weekly brief — always fleet-wide, whatever the selected scope ──────────
  const winW = windows('week');
  const MF = metrics(D.issues, D.meetings, winW);
  const briefKpis = [
    { label: 'Open backlog', value: MF.openNow, ...pack(delta(MF.openNow, MF.openPrev, true)) },
    { label: 'Overdue', value: MF.overdueNow, ...pack(delta(MF.overdueNow, MF.overduePrev, true)) },
    { label: 'HIGH open', value: MF.highNow, ...pack(delta(MF.highNow, MF.highPrev, true)) },
    { label: 'Raised this week', value: MF.raisedCur, ...pack(delta(MF.raisedCur, MF.raisedPrev, false)) },
  ];
  // DEVIATION 2 — source :395 divides by a literal 5. composite() always yields
  // a number (it has no applicability concept), so the mean is over every code.
  const fleetScore = codes.length ? Math.round(codes.reduce((s, c) => s + comps[c].score, 0) / codes.length) : 0;
  const worst = [...codes].sort((a, b) => comps[a].score - comps[b].score)[0];
  // QUIRK (source :397): `comps[b - 0]` is comps[NaN] for any string code →
  // always undefined → always falsy → the ternary always takes the descending
  // branch. It works, bizarrely. Ported verbatim.
  const best = [...codes].sort((a, b) => comps[b - 0] ? 0 : comps[b].score - comps[a].score)[0];
  const briefNarrative = codes.length
    ? 'Fleet health stands at ' + fleetScore + '/100. ' + siteOf(best).name + ' leads the board; '
      + siteOf(worst).name + ' needs the most attention this week with ' + comps[worst].overdue
      + ' overdue and ' + comps[worst].high + ' HIGH items open. Signature diffusion (E2) remains the '
      + 'weakest engagement fleet-wide — ' + (subM.length ? Math.round(100 * both48.length / Math.max(subM.length, 1)) : 0)
      + '% of PVs fully signed within 48 h against a target of 80%.'
    // The source would throw here (comps[undefined].overdue). No sites → no claim.
    : 'No site data available for this period.';
  const briefSites = [...codes].sort((a, b) => comps[b].score - comps[a].score).map(c => {
    const comp = comps[c];
    const rg = rag(comp.score);
    const deltas = ['week', 'month', 'quarter', 'semester'].map((p, i) => {
      const w = windows(p);
      const prev = composite(c, D, w.prev[1]);
      const dl = delta(comp.score, prev.score, false);
      return { label: ['WoW', 'MoM', 'QoQ', 'HoH'][i], txt: dl.txt, color: dl.color };
    });
    const ins = D.inspections.filter(i => i.site_code === c);
    const lastI = ins.map(i => i.inspection_date).sort().pop();
    const fs = D.findings.filter(f => f.site_code === c);
    const crit = fs.filter(f => f.status === 'critical' || f.status === 'major').length;
    const stats = [
      { label: 'Open', value: comp.open, color: 'var(--color-text)' },
      { label: 'Overdue', value: comp.overdue + ' (' + comp.odRate + '%)', color: comp.odRate > 20 ? RD : 'var(--color-text)' },
      { label: 'HIGH', value: comp.high, color: comp.high >= 4 ? RD : 'var(--color-text)' },
      { label: 'MTTR', value: comp.mttr != null ? comp.mttr + ' d' : '—', color: 'var(--color-text)' },
      { label: 'E2 48 h', value: comp.e.e2 + '%', color: comp.e.e2 >= 80 ? G : comp.e.e2 >= 50 ? AM : RD },
      { label: 'Last inspection', value: lastI ? days(A, lastI) + ' d ago' + (crit ? ' · ' + crit + ' def.' : '') : 'none', color: !lastI || days(A, lastI) > 45 ? RD : 'var(--color-text)' },
    ];
    return { code: c, name: siteOf(c).name, country: siteOf(c).country, score: comp.score, rag: rg.label, ragBg: rg.bg, ragFg: rg.fg, deltas, stats, moves: twoMoves(c, D, comp) };
  });

  // ── scoreboard (the sbDims model — RAG 70/45) ─────────────────────────────
  const ragPts = p => p === 2 ? { bg: '#dcefe2', fg: G } : p === 1 ? { bg: '#f5e7c8', fg: '#7a5510' } : { bg: 'var(--color-accent-100)', fg: RD };
  // sbIn keeps the RAW measured inputs alongside the score: computeSiteScore
  // does NOT return reviews/resolution/overdue, and emBubbles needs all three
  // (source :442-448 reads them off sbDims' return). Reading them from the
  // inputs is the bridge — computeSiteScore is fidelity-pinned, don't touch it.
  const sbIn = {}; const sbs = {}; const sbsPrev = {};
  codes.forEach(c => {
    sbIn[c] = sbMeasure(c, D, A);
    sbs[c] = computeSiteScore(sbIn[c]);
    sbsPrev[c] = computeSiteScore(sbMeasure(c, D, win.prev[1]));
  });
  // DEVIATION 4 — `applicable:false` is a state the source has no concept of.
  // Its sb.dims is [] and sb.score null, so every scoreboard panel would render
  // a broken row. Omit the site instead: no data is not a verdict.
  const sbApplicable = codes.filter(c => sbs[c].applicable);
  const sbSorted = [...sbApplicable].sort((a, b) => sbs[b].score - sbs[a].score);
  // DEVIATION 2 + 4 — source :427 does `codes.reduce(...) / 5`, and `score:null`
  // coerces (s + null === s + 0), so a site we know NOTHING about enters the
  // fleet average as a fabricated 0 — exactly the verdict-on-nothing the
  // applicable gate exists to prevent, sneaking back in through an average.
  // Omitting the row cannot fix it while the /5 is hardcoded. Mean over the
  // applicable sites; null when there are none.
  const meanScore = (list, tbl) => list.length ? Math.round(list.reduce((s, c) => s + tbl[c].score, 0) / list.length) : null;
  const sbAvg = meanScore(sbApplicable, sbs);
  const sbAvgPrev = meanScore(codes.filter(c => sbsPrev[c].applicable), sbsPrev);
  const sbAvgD = delta(sbAvg, sbAvgPrev, false);
  const sbDimHeaders = [{ label: 'REVIEWS', sub: 'held' }, { label: 'RESOLUTION', sub: 'resolved ÷ raised' }, { label: 'OVERDUE', sub: 'issues + actions' }, { label: 'INSPECTIONS', sub: 'run' }, { label: 'FINDINGS', sub: 'crit + major' }, { label: 'SIGN-OFF', sub: 'both signatures' }];
  const sbRows = sbSorted.map((c, idx) => {
    const sb = sbs[c];
    const rg = rag2Full(sb.score);
    const dl = delta(sb.score, sbsPrev[c].applicable ? sbsPrev[c].score : null, false);
    return {
      rank: idx + 1, code: c, name: siteOf(c).name,
      score: sb.score, scoreColor: rg.fg, delta: dl.txt, deltaColor: dl.color,
      cells: sb.dims.map(d => { const r = ragPts(d.pts); return { val: d.disp, bg: r.bg, fg: r.fg, tip: d.tip }; }),
      rag: rg.label, ragBg: rg.solidBg, ragFg: rg.solidFg,
    };
  });
  // effort matrix: x = resolution %, y = overdue, r = reviews.
  // Over the APPLICABLE sites only — a non-applicable one would drag a
  // non-number into Math.max and NaN would poison EVERY bubble's x/y/r.
  const emMaxX = Math.max(...sbApplicable.map(c => sbIn[c].resolution), 50) * 1.15;
  const emMaxY = Math.max(...sbApplicable.map(c => sbIn[c].overdue), 10) * 1.2;
  const px = v => 40 + v / emMaxX * 510;
  const emBubbles = codes.filter(c => sbs[c].applicable).map(c => {
    const rg = rag2Full(sbs[c].score);
    const x = px(sbIn[c].resolution);
    const y = 310 - (sbIn[c].overdue / emMaxY * 300);
    const r = 8 + sbIn[c].reviews * 1.6;
    return { x: x.toFixed(1), y: y.toFixed(1), r: r.toFixed(1), fill: rg.solidBg, label: c, lx: (x + r + 4).toFixed(1), ly: (y + 4).toFixed(1) };
  });
  const emSplitX = px(30).toFixed(1);
  const emSplitY = (310 - 10 / emMaxY * 300).toFixed(1);
  const emQ2x = (px(30) + 12).toFixed(1);
  // gap to green
  const gapRows = sbSorted.map(c => {
    const sb = sbs[c];
    const segs = sb.dims.filter(d => d.pts > 0).map(d => ({ w: (d.pts / 12 * 100).toFixed(1), color: dimColors[d.key], tip: d.label + ' ' + d.pts + ' pts' }));
    const loss = 12 - sb.points;
    return { code: c, segs, loss: loss > 0 ? '−' + Math.round(loss / 12 * 100) + ' pts lost' : 'at max', lossColor: loss >= 6 ? RD : loss >= 3 ? AM : G };
  });
  const gapLegend = [['reviews', 'Reviews'], ['resolution', 'Resolution'], ['overdue', 'Overdue'], ['inspections', 'Inspections'], ['findings', 'Findings'], ['signoff', 'Sign-off']]
    .map(([k, label]) => ({ label, color: dimColors[k] }));
  // two moves per site (points-ranked). computeSiteScore already builds these
  // identically to source :465-467 — reuse rather than fork the tie-break.
  const sbMoves = sbSorted.map(c => {
    const sb = sbs[c];
    const rg = rag2Full(sb.score);
    return { code: c, name: siteOf(c).name, score: sb.score, hdrBg: rg.solidBg, hdrFg: rg.solidFg, moves: sb.moves };
  });

  // ── OUR extras — the Helpdesk & Changes panel ─────────────────────────────
  // ABSENT → this object is untouched and the return below is exactly his 61
  // keys, so tests/review-fidelity.test.js keeps proving the port. PRESENT →
  // exactly two more, hdRows + hdNote (the allowlist that test declares).
  // Note what this block does NOT do: it reads nothing back into comps/sbs/
  // codes. Nothing here can reach the score.
  const ex = {};
  // Null-safe SUB-KEY gates — opts.extras has no default, so a bare
  // `extras.helpdesk` throws on the no-extras path. Each panel gates on its own
  // sub-key so a scoreboard-only (or helpdesk-only) call adds only its keys.
  if (extras && extras.helpdesk) {
    const w = extrasWindows(period);
    ex.hdRows = hdRowsOf(codes, extras, c => siteOf(c).name);
    // BOTH windows, stated plainly: two different spans in one panel reads as a
    // bug unless labelled (the user's decision #1). And the raw counts sit next
    // to the percentage on purpose — the panel is thin (some sites have ≤2
    // executed changes, where one backed-out change reads as "50%").
    ex.hdNote = 'Helpdesk over ' + fmt(w.hdFrom) + ' – ' + fmt(w.hdTo) + ' (follows the period selector) · '
      + 'changes over the last 90 days (' + fmt(w.chgFrom) + ' – ' + fmt(w.chgTo) + ', fixed) · '
      + 'group-scoped · not part of the site score.';
  }
  // ── OUR extras — the operational Scoreboard panel (additive) ──────────────
  // A 4-dimension weighted composite (helpdesk · inspections · réunions ·
  // actifs), DISTINCT from his "Score programme" (sbDims). Exactly TWO added
  // keys — sbuRows + sbuNote (an object carrying the callouts, bound single-dot
  // in the template). It reads nothing back into sbs/comps/codes: nothing here
  // can reach his score.
  if (extras && extras.scoreboard) {
    const sb = extras.scoreboard;
    // RAG → cell colours (mirrors the sbDims panel's ragPts palette).
    const ragBg = { green: '#dcefe2', amber: '#f5e7c8', red: 'var(--color-accent-100)' };
    const ragFg = { green: G, amber: '#7a5510', red: RD };
    ex.sbuRows = sb.rows.map((r) => ({
      rank: r.rank == null ? DASH : r.rank,
      name: r.name,
      code: r.code,
      score: r.score == null ? DASH : r.score,
      scoreBg: r.rag ? (ragBg[r.rag] || 'var(--color-bg)') : 'var(--color-bg)',
      scoreFg: r.rag ? (ragFg[r.rag] || 'var(--color-text)') : NEUTRAL,
      delta: r.delta == null ? DASH : (r.delta > 0 ? '▲ +' + r.delta : (r.delta < 0 ? '▼ −' + Math.abs(r.delta) : '–')),
      deltaColor: r.delta == null ? NEUTRAL : (r.delta > 0 ? G : (r.delta < 0 ? RD : NEUTRAL)),
      // Flatten dims to a single-dot `cells` array (the renderer resolves ≤1
      // dot — {{ c.val }} works, {{ dims.x.value }} renders empty).
      cells: ['helpdesk', 'inspections', 'meetings', 'assets'].map((d) => {
        const c = r.dims[d];
        return {
          // Display-only rounding (meetings score×100 can be fractional); the
          // weighted composite itself keeps full precision upstream.
          val: c == null ? DASH : Math.round(c.value),
          bg: c == null ? 'var(--color-bg)' : (ragBg[c.rag] || 'var(--color-bg)'),
          fg: c == null ? NEUTRAL : (ragFg[c.rag] || 'var(--color-text)'),
        };
      }),
    }));
    ex.sbuNote = {
      text: '4 dimensions pondérées (helpdesk 40 % · inspections 20 % · réunions 20 % · actifs 20 %), '
        + 'renormalisées sur les dimensions présentes · RAG 75/55 · helpdesk & réunions = mois courant, '
        + 'inspections = trimestre glissant (cadence trimestrielle), actifs = état courant · le sélecteur de '
        + 'période ne pilote PAS ce panneau · complément additif, hors score programme.',
      fleet_avg: sb.fleet_avg == null ? DASH : sb.fleet_avg,
      most_improved: (sb.most_improved && sb.most_improved.name) || DASH,
      needs_attention: (sb.needs_attention && sb.needs_attention.name) || DASH,
    };
  }

  return {
    isDashboard: view === 'dashboard', isBrief: view === 'brief', isScoreboard: view === 'scoreboard',
    sbAvg,
    // rag2Full(null) would report a confident RED — the very thing the
    // applicable gate exists to prevent. No score → no colour verdict.
    sbAvgColor: sbAvg == null ? 'var(--color-neutral-500)' : rag2Full(sbAvg).fg,
    sbAvgDelta: sbAvgD.txt, sbAvgDeltaColor: sbAvgD.color,
    sbDimHeaders, sbRows, emBubbles, emSplitX, emSplitY, emQ2x, gapRows, gapLegend, sbMoves,
    viewOpts, periodOpts, siteOpts,
    scopeLabel, scopeSuffix, anchorLabel: fmt(A) + ' 2026', dataThrough: fmt(A),
    curWinLabel: fmt(win.cur[0]) + ' – ' + fmt(win.cur[1]), prevWinLabel: win.note.replace('vs ', ''),
    nIssues: D.issues.length, nMeetings: D.meetings.length, nInspections: D.inspections.length,
    nFindings: D.findings.filter(f => f.status !== 'na').length,
    defectCount: D.findings.filter(f => f.status === 'critical' || f.status === 'major' || f.status === 'minor').length,
    periodShort: win.short,
    kpis, leaderboard, groupRows, flowMonths,
    backlogPts: blPts.join(' '), backlogEndX: blEnd[0], backlogEndY: blEnd[1],
    backlogNow: blSeries[blSeries.length - 1], backlogPeak: Math.max(...blSeries), backlogStartLabel: 'Apr 1',
    backlogTrendTxt: blTrend < 0 ? '▼ falling' : blTrend > 0 ? '▲ rising' : '· flat',
    backlogTrendColor: blTrend < 0 ? G : blTrend > 0 ? RD : 'var(--color-neutral-500)',
    eHeaders, eMatrix, sigFunnel, aging, champLoad, overdueRows, overdueCount: odAll.length,
    noTargetNote: noTargetN
      ? '+ ' + noTargetN + ' open issues have no target date — invisible to this register (see Data quality).'
      : 'Every open issue carries a target date.',
    inspSiteRows, findCats, pipeline, pipelineNote,
    dqScore, dqColor: dqScore >= 90 ? G : dqScore >= 75 ? AM : RD, dqItems,
    briefKpis, briefNarrative, briefSites,
    ...ex,   // OURS — empty unless opts.extras was supplied. See above.
  };
}

module.exports = {
  SITES, GREEN, AMBER, RED, REDT, OPEN, HIS_CODES, catNames, dimColors,
  siteOf, rag2Full,
  addDays, fmt, windows, filterSite, metrics, delta, spark, pack, sbMeasure,
  codesOf, extrasWindows, buildReviewVals,
};
