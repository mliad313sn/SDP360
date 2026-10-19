'use strict';
// Unit tests for services/reviewDashboard.js — the port of the authoritative
// IT Review Dashboard's renderVals() and its helpers.
//
//   SOURCE OF TRUTH: docs/reference/it-review-dashboard.source.js
//   RULES:           docs/reference/README.md
//
// These prove INTERNAL consistency (our code does what we say it does) and PIN
// THE QUIRKS (our code reproduces the source's warts rather than "improving"
// them). tests/review-fidelity.test.js is the separate acceptance test that
// proves FIDELITY against the boss's own output.
//
// The dev .env pins every backend to postgres; siteComposite → meetings-db reads
// that at require time. Force sqlite BEFORE any require.
process.env.MEETINGS_BACKEND = 'sqlite';
process.env.INSPECTION_BACKEND = 'sqlite';
process.env.REPORTS_BACKEND = 'sqlite';

const test = require('node:test');
const assert = require('node:assert');

const {
  SITES, GREEN, AMBER, RED, REDT,
  addDays, fmt, windows, filterSite, metrics, delta, spark, pack, sbMeasure,
  codesOf, extrasWindows, buildReviewVals,
} = require('../services/reviewDashboard');

const EM = require('./fixtures/em-data.json');
const A = '2026-07-14'; // the source's ANCHOR

// The source's full 61-key return (:471-488). Module-scope so the extras tests
// below can diff against it — adding a key without declaring it must fail.
const KEYS = [
  'isDashboard', 'isBrief', 'isScoreboard',
  'sbAvg', 'sbAvgColor', 'sbAvgDelta', 'sbAvgDeltaColor',
  'sbDimHeaders', 'sbRows', 'emBubbles', 'emSplitX', 'emSplitY', 'emQ2x',
  'gapRows', 'gapLegend', 'sbMoves',
  'viewOpts', 'periodOpts', 'siteOpts',
  'scopeLabel', 'scopeSuffix', 'anchorLabel', 'dataThrough',
  'curWinLabel', 'prevWinLabel',
  'nIssues', 'nMeetings', 'nInspections', 'nFindings', 'defectCount',
  'periodShort', 'kpis', 'leaderboard', 'groupRows', 'flowMonths',
  'backlogPts', 'backlogEndX', 'backlogEndY', 'backlogNow', 'backlogPeak',
  'backlogStartLabel', 'backlogTrendTxt', 'backlogTrendColor',
  'eHeaders', 'eMatrix', 'sigFunnel', 'aging', 'champLoad',
  'overdueRows', 'overdueCount', 'noTargetNote',
  'inspSiteRows', 'findCats', 'pipeline', 'pipelineNote',
  'dqScore', 'dqColor', 'dqItems',
  'briefKpis', 'briefNarrative', 'briefSites',
];

// ── statics ─────────────────────────────────────────────────────────────────

test('SITES carries the source\'s 5 codes verbatim', () => {
  assert.deepStrictEqual(Object.keys(SITES), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
  assert.deepStrictEqual(SITES.HGO, { name: 'Houndé', country: 'Burkina Faso' });
  assert.strictEqual(SITES.SGO.name, 'Sabodala-Massawa');
});

test('the four palette constants are the source\'s (:15)', () => {
  assert.strictEqual(GREEN, '#2f7d4f');
  assert.strictEqual(AMBER, '#b07a17');
  assert.strictEqual(RED, 'var(--color-accent)');
  assert.strictEqual(REDT, '#c2280f');
});

// ── addDays / fmt ───────────────────────────────────────────────────────────

test('addDays walks UTC days, including across month boundaries', () => {
  assert.strictEqual(addDays('2026-07-14', -6), '2026-07-08');
  assert.strictEqual(addDays('2026-07-14', -13), '2026-07-01');
  assert.strictEqual(addDays('2026-07-01', -1), '2026-06-30');
  assert.strictEqual(addDays('2026-07-14', 0), '2026-07-14');
});

test('fmt renders "D Mon"; null → em dash', () => {
  assert.strictEqual(fmt('2026-07-14'), '14 Jul');
  assert.strictEqual(fmt('2026-01-01'), '1 Jan');
  assert.strictEqual(fmt('2026-12-31'), '31 Dec');
  assert.strictEqual(fmt(null), '—');
  assert.strictEqual(fmt(undefined), '—');
});

// ── windows ─────────────────────────────────────────────────────────────────

test('windows(week) is anchored on ANCHOR and spans 7 days each side', () => {
  assert.deepStrictEqual(windows('week'), {
    cur: ['2026-07-08', '2026-07-14'],
    prev: ['2026-07-01', '2026-07-07'],
    short: 'WoW',
    note: 'vs prior week',
  });
});

// QUIRK — ported as-is, NOT a bug to fix here.
test('QUIRK: month/quarter/semester windows are HARDCODED to July 2026, not derived from any as-of', () => {
  assert.deepStrictEqual(windows('month'), {
    cur: ['2026-07-01', A], prev: ['2026-06-01', '2026-06-30'], short: 'MoM', note: 'vs June',
  });
  assert.deepStrictEqual(windows('quarter'), {
    cur: ['2026-07-01', A], prev: ['2026-04-01', '2026-06-30'], short: 'QoQ', note: 'vs Q2',
  });
  assert.deepStrictEqual(windows('semester'), {
    cur: ['2026-07-01', A], prev: ['2026-01-01', '2026-06-30'], short: 'HoH', note: 'vs H1',
  });
  // and the fall-through: anything unrecognised IS the semester window.
  assert.deepStrictEqual(windows('nonsense'), windows('semester'));
  // This is NOT services/scoreWindow.js's rolling 3-month window. Two different
  // concepts — do not merge them.
});

// ── filterSite ──────────────────────────────────────────────────────────────

test('filterSite: ALL passes the array through; a code narrows by site_code', () => {
  const rows = [{ site_code: 'HGO', n: 1 }, { site_code: 'MGO', n: 2 }, { site_code: 'HGO', n: 3 }];
  assert.strictEqual(filterSite(rows, 'ALL'), rows);
  assert.deepStrictEqual(filterSite(rows, 'HGO').map(r => r.n), [1, 3]);
  assert.deepStrictEqual(filterSite(rows, 'ZZZ'), []);
});

// ── delta ───────────────────────────────────────────────────────────────────

test('delta: a null on either side yields the em dash, not a fabricated 0', () => {
  assert.deepStrictEqual(delta(null, 5, false), { txt: '—', color: 'var(--color-neutral-500)' });
  assert.deepStrictEqual(delta(5, null, false), { txt: '—', color: 'var(--color-neutral-500)' });
  assert.deepStrictEqual(delta(undefined, undefined, false), { txt: '—', color: 'var(--color-neutral-500)' });
});

test('delta: zero is "· 0" and neutral', () => {
  assert.deepStrictEqual(delta(5, 5, false), { txt: '· 0', color: 'var(--color-neutral-500)' });
});

test('delta: sign, arrow and good/bad colour — invert flips the verdict, not the arrow', () => {
  assert.deepStrictEqual(delta(7, 5, false), { txt: '▲ +2', color: GREEN });
  assert.deepStrictEqual(delta(3, 5, false), { txt: '▼ -2', color: REDT });
  // invert: less is better (backlog, overdue, HIGH, MTTR)
  assert.deepStrictEqual(delta(3, 5, true), { txt: '▼ -2', color: GREEN });
  assert.deepStrictEqual(delta(7, 5, true), { txt: '▲ +2', color: REDT });
});

test('delta: rounds to 1 dp and appends the unit', () => {
  assert.deepStrictEqual(delta(5.26, 5, false), { txt: '▲ +0.3', color: GREEN });
  assert.deepStrictEqual(delta(7, 5, true, ' d'), { txt: '▲ +2 d', color: REDT });
  // rounding to exactly 0 collapses to the neutral zero branch
  assert.deepStrictEqual(delta(5.01, 5, false), { txt: '· 0', color: 'var(--color-neutral-500)' });
});

// ── spark ───────────────────────────────────────────────────────────────────

test('spark: exact point geometry — x = 4 + i*(56/(n-1)), y = 19 - v/max*16', () => {
  const s = spark([0, 8, 16]); // max 16, n 3 → x step 28; y: 19, 19-8=11, 19-16=3
  assert.strictEqual(s.pts, '4,19 32,11 60,3');
  assert.strictEqual(s.x, '60');
  assert.strictEqual(s.y, '3');
});

test('spark: an all-zero series does not divide by zero (max(...series, 1))', () => {
  const s = spark([0, 0, 0]);
  assert.strictEqual(s.pts, '4,19 32,19 60,19');
  assert.ok(!s.pts.includes('NaN'));
});

test('spark: a single point does not divide by zero (max(n-1, 1))', () => {
  const s = spark([2]);
  assert.strictEqual(s.pts, '4,3');
  assert.strictEqual(s.x, '4');
  assert.strictEqual(s.y, '3');
});

// ── pack ────────────────────────────────────────────────────────────────────

test('pack renames a delta into the template\'s two keys', () => {
  assert.deepStrictEqual(pack({ txt: '▲ +2', color: GREEN }), { deltaTxt: '▲ +2', deltaColor: GREEN });
});

// ── metrics ─────────────────────────────────────────────────────────────────
//
// A synthetic scope, so every expectation below is hand-derivable.
// win = windows('week') → cur ['2026-07-08','2026-07-14'], prev ['2026-07-01','2026-07-07'].

const SYN_ISSUES = [
  // raised in cur; open; overdue vs ANCHOR; HIGH; escalate as a STRING
  { id: 1, meeting_date: '2026-07-10', status: 'open', target_date: '2026-07-01', severity: 'HIGH', escalate: '1' },
  // raised in prev; resolved — effClose falls back to updated_at → closes in cur
  { id: 2, meeting_date: '2026-07-03', status: 'resolved', updated_at: '2026-07-09', closed_at: null },
  // raised in prev; closed in prev
  { id: 3, meeting_date: '2026-07-02', status: 'closed', closed_at: '2026-07-05' },
  // old, still open, no target date; escalate as a NUMBER
  { id: 4, meeting_date: '2026-06-01', status: 'in_progress', target_date: null, severity: 'MEDIUM', escalate: 1 },
];
const SYN_MEETINGS = [
  { site_code: 'AAA', department: 'mining', meeting_date: '2026-07-10' },
  { site_code: 'AAA', department: 'mining', meeting_date: '2026-07-12' }, // same dept|site → dedup
  { site_code: 'BBB', department: 'it', meeting_date: '2026-07-09' },
  { site_code: 'AAA', department: 'hr', meeting_date: '2026-07-03' },     // prev window
];

test('metrics: stock + flow over the week window', () => {
  const M = metrics(SYN_ISSUES, SYN_MEETINGS, windows('week'));
  assert.strictEqual(M.raisedCur, 1);
  assert.strictEqual(M.raisedPrev, 2);
  assert.strictEqual(M.openNow, 2);       // #1 open, #4 in_progress
  assert.strictEqual(M.openPrev, 2);      // #2 (closed after p1) and #4
  assert.strictEqual(M.overdueNow, 1);    // #1 only — #4 has no target date
  assert.strictEqual(M.overduePrev, 0);
  assert.strictEqual(M.highNow, 1);
  assert.strictEqual(M.highPrev, 0);
  assert.strictEqual(M.mttrCur, 6);       // #2: 2026-07-03 → 2026-07-09
  assert.strictEqual(M.mttrPrev, null);   // median of [] is null, not 0
  assert.strictEqual(M.covCur, 2);        // AAA|mining, BBB|it
  assert.strictEqual(M.covPrev, 1);       // AAA|hr
  assert.deepStrictEqual(M.openList.map(i => i.id), [1, 4]);
});

// This is the reason the source's clumsy `=== '1' || === 1` must survive the port.
test('metrics.escNow counts BOTH the string \'1\' and the number 1', () => {
  const M = metrics(SYN_ISSUES, SYN_MEETINGS, windows('week'));
  assert.strictEqual(M.escNow, 2, 'our DB stores escalate INTEGER, the fixture stores it as a string');
});

// QUIRK — computed by the source, read by nothing in renderVals. Ported anyway.
test('QUIRK: metrics.closedCur/closedPrev are computed but never read by renderVals', () => {
  const M = metrics(SYN_ISSUES, SYN_MEETINGS, windows('week'));
  assert.strictEqual(M.closedCur, 1);   // #2, via the updated_at fallback
  assert.strictEqual(M.closedPrev, 1);  // #3, via closed_at
});

test('metrics.overdueNow is measured against ANCHOR, not the window end', () => {
  // The source hardcodes `const A = Component.ANCHOR` inside metrics(). An item
  // overdue vs ANCHOR but not vs the window counts; ported as-is.
  const M = metrics([{ meeting_date: '2026-07-10', status: 'open', target_date: '2026-07-13' }], [], windows('week'));
  assert.strictEqual(M.overdueNow, 1);
});

// ── sbMeasure ───────────────────────────────────────────────────────────────
//
// The measurement half of sbDims (source :166-179) — the half computeSiteScore
// does NOT have. computeSiteScore is pure arithmetic over these inputs.

test('sbMeasure returns the six measured dims plus the `raised` applicability signal', () => {
  const D = { meetings: [], issues: [], actions: [], inspections: [], findings: [] };
  const m = sbMeasure('HGO', D, A);
  assert.deepStrictEqual(Object.keys(m).sort(),
    ['findings', 'inspections', 'overdue', 'raised', 'resolution', 'reviews', 'signoff']);
});

test('sbMeasure: a site with nothing measured reports zeros AND raised 0 (→ non-applicable)', () => {
  const D = { meetings: [], issues: [], actions: [], inspections: [], findings: [] };
  assert.deepStrictEqual(sbMeasure('ZZZ', D, A),
    { reviews: 0, raised: 0, resolution: 0, overdue: 0, inspections: 0, findings: 0, signoff: 0 });
});

test('sbMeasure: the W0 window floor is 2026-04-01 — earlier reviews/issues are out of scope', () => {
  const D = {
    meetings: [
      { site_code: 'HGO', meeting_date: '2026-03-31' },  // before W0 → excluded
      { site_code: 'HGO', meeting_date: '2026-04-01' },  // on W0 → included
      { site_code: 'HGO', meeting_date: '2026-07-14' },  // on A → included
      { site_code: 'HGO', meeting_date: '2026-07-15' },  // after A → excluded
      { site_code: 'MGO', meeting_date: '2026-05-01' },  // other site
    ],
    issues: [], actions: [], inspections: [], findings: [],
  };
  assert.strictEqual(sbMeasure('HGO', D, A).reviews, 2);
});

test('sbMeasure: overdue = overdue ISSUES + overdue ACTIONS', () => {
  const D = {
    meetings: [{ site_code: 'HGO', meeting_date: '2026-05-01' }],
    issues: [{ site_code: 'HGO', meeting_date: '2026-05-01', status: 'open', target_date: '2026-06-01' }],
    actions: [
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'open', target_date: '2026-06-01', closed_at: null },
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'open', target_date: '2026-08-01', closed_at: null }, // not yet due
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'Closed', target_date: '2026-06-01', closed_at: null }, // not an OPEN status
    ],
    inspections: [], findings: [],
  };
  assert.strictEqual(sbMeasure('HGO', D, A).overdue, 2, '1 issue + 1 action');
});

test('sbMeasure: signoff needs BOTH signatures, dated on or before the as-of', () => {
  const D = {
    meetings: [
      { site_code: 'HGO', meeting_date: '2026-05-01', dept_head_signed_at: '2026-05-02', site_it_signed_at: '2026-05-02' },
      { site_code: 'HGO', meeting_date: '2026-05-01', dept_head_signed_at: '2026-05-02', site_it_signed_at: null },
      { site_code: 'HGO', meeting_date: '2026-05-01', dept_head_signed_at: '2026-05-02', site_it_signed_at: '2026-09-01' }, // after A
      { site_code: 'HGO', meeting_date: '2026-05-01' },
    ],
    issues: [], actions: [], inspections: [], findings: [],
  };
  assert.strictEqual(sbMeasure('HGO', D, A).signoff, 25, '1 of 4');
});

test('sbMeasure: findings counts critical+major only, inspections counts runs on/before as-of', () => {
  const D = {
    meetings: [{ site_code: 'HGO', meeting_date: '2026-05-01' }],
    issues: [], actions: [],
    inspections: [
      { site_code: 'HGO', inspection_date: '2026-05-01' },
      { site_code: 'HGO', inspection_date: '2026-08-01' }, // after A
    ],
    findings: [
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'critical' },
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'major' },
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'minor' },  // not counted
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'ok' },     // not counted
    ],
  };
  const m = sbMeasure('HGO', D, A);
  assert.strictEqual(m.inspections, 1);
  assert.strictEqual(m.findings, 2);
});

test('sbMeasure: resolution = resolved ÷ raised, honouring effClose\'s updated_at fallback', () => {
  const D = {
    meetings: [{ site_code: 'HGO', meeting_date: '2026-05-01' }],
    issues: [
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-05-10' },
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'resolved', closed_at: null, updated_at: '2026-05-11' },
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-09-01' }, // after A
      { site_code: 'HGO', meeting_date: '2026-05-01', status: 'open' },
    ],
    actions: [], inspections: [], findings: [],
  };
  const m = sbMeasure('HGO', D, A);
  assert.strictEqual(m.raised, 4);
  assert.strictEqual(m.resolution, 50, '2 of 4');
});

// THE ORACLE for this half: sbMeasure → computeSiteScore must reproduce the
// scores the boss's own sbDims() produces on his own data.
test('sbMeasure feeds computeSiteScore to the boss\'s own sbDims scores on his data', () => {
  const { computeSiteScore } = require('../services/siteScore');
  const ORACLE = { HGO: 58, SML: 50, MGO: 50, SMI: 42, SGO: 17 };
  for (const [code, score] of Object.entries(ORACLE)) {
    const got = computeSiteScore(sbMeasure(code, EM, A));
    assert.strictEqual(got.applicable, true, code);
    assert.strictEqual(got.score, score, `${code}: ours ${got.score} vs the dashboard's ${score}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// buildReviewVals — the port of renderVals() (source :206-499)
// ═════════════════════════════════════════════════════════════════════════════
//
// The scalars asserted below come from RUNNING HIS CODE, not from ours. They are
// the oracle. If one fails, OUR code is wrong — never edit the expectation.
// tests/review-fidelity.test.js is the full acceptance harness.

const OPTS = { view: 'dashboard', period: 'week', site: 'ALL', asOf: A };
const V = () => buildReviewVals(EM, OPTS);

// ── the 61-key contract ─────────────────────────────────────────────────────

test('buildReviewVals returns the source\'s full 61-key return (:471-488)', () => {
  const v = V();
  assert.strictEqual(KEYS.length, 61);
  assert.deepStrictEqual(Object.keys(v).sort(), [...KEYS].sort());
});

test('view flags are driven by the `view` argument, not React state', () => {
  const d = V();
  assert.deepStrictEqual([d.isDashboard, d.isBrief, d.isScoreboard], [true, false, false]);
  const b = buildReviewVals(EM, { ...OPTS, view: 'brief' });
  assert.deepStrictEqual([b.isDashboard, b.isBrief, b.isScoreboard], [false, true, false]);
  const s = buildReviewVals(EM, { ...OPTS, view: 'scoreboard' });
  assert.deepStrictEqual([s.isDashboard, s.isBrief, s.isScoreboard], [false, false, true]);
});

// ── DECIDED: codes derives from D, in HIS order ─────────────────────────────

test('codes is HIS 5 in HIS order on his data — byte-identical to source :213', () => {
  assert.deepStrictEqual(V().siteOpts.map(o => o.key), ['ALL', 'SML', 'SMI', 'HGO', 'MGO', 'SGO']);
});

test('a site he never saw APPENDS — it must not reorder his five', () => {
  // His order is load-bearing: it IS eMatrix/inspSiteRows row order AND the
  // sbSorted tie-break (SML and MGO both score 50).
  const D = { ...EM, meetings: [...EM.meetings, { site_code: 'KGO', department: 'it', meeting_date: '2026-05-05' }] };
  assert.deepStrictEqual(buildReviewVals(D, OPTS).siteOpts.map(o => o.key),
    ['ALL', 'SML', 'SMI', 'HGO', 'MGO', 'SGO', 'KGO']);
});

test('codes unions BOTH parent tables — a site with an inspection but no PV still counts', () => {
  const D = { ...EM, inspections: [...EM.inspections, { id: 'X', site_code: 'ZZZ', inspection_date: '2026-05-05', status: 'submitted' }] };
  assert.ok(buildReviewVals(D, OPTS).siteOpts.map(o => o.key).includes('ZZZ'));
});

// DEVIATION 3 — the source would throw here (Component.SITES[code].name, :225).
test('an unknown site code does not throw — it falls back to the code as its name', () => {
  const D = { ...EM, meetings: [...EM.meetings, { site_code: 'KGO', department: 'it', meeting_date: '2026-05-05' }] };
  assert.doesNotThrow(() => buildReviewVals(D, OPTS));
  const v = buildReviewVals(D, { ...OPTS, site: 'KGO' });
  assert.strictEqual(v.scopeLabel, 'KGO (KGO)');
  assert.ok(v.eMatrix.some(r => r.site === 'KGO · KGO'));
});

// ── scope / labels ──────────────────────────────────────────────────────────

test('scope labels, anchor and window labels', () => {
  const v = V();
  assert.strictEqual(v.scopeLabel, 'All sites — group view');
  assert.strictEqual(v.scopeSuffix, '— all sites');
  assert.strictEqual(v.anchorLabel, '14 Jul 2026');
  assert.strictEqual(v.dataThrough, '14 Jul');
  assert.strictEqual(v.curWinLabel, '8 Jul – 14 Jul');
  assert.strictEqual(v.prevWinLabel, 'prior week');
  assert.strictEqual(v.periodShort, 'WoW');
  const h = buildReviewVals(EM, { ...OPTS, site: 'HGO' });
  assert.strictEqual(h.scopeLabel, 'Houndé (HGO)');
  assert.strictEqual(h.scopeSuffix, '— Houndé');
});

// ── the counters ────────────────────────────────────────────────────────────

test('the header counters read straight off D', () => {
  const v = V();
  assert.strictEqual(v.nIssues, EM.issues.length);
  assert.strictEqual(v.nMeetings, EM.meetings.length);
  assert.strictEqual(v.nInspections, EM.inspections.length);
  assert.strictEqual(v.nFindings, EM.findings.filter(f => f.status !== 'na').length);
  assert.strictEqual(v.defectCount, EM.findings.filter(f => ['critical', 'major', 'minor'].includes(f.status)).length);
});

// ── PANEL: controls ─────────────────────────────────────────────────────────

test('PANEL viewOpts/periodOpts/siteOpts — active styling, and `key` replaces the dropped pick closure', () => {
  const v = V();
  assert.deepStrictEqual(v.viewOpts.map(o => o.label), ['DASHBOARD', 'SCOREBOARD', 'WEEKLY BRIEF']);
  assert.deepStrictEqual(v.periodOpts.map(o => o.label), ['WEEK', 'MONTH', 'QUARTER', 'SEMESTER']);
  // the active one inverts
  assert.deepStrictEqual(v.viewOpts[0], { key: 'dashboard', label: 'DASHBOARD', bg: 'var(--color-text)', fg: 'var(--color-bg)' });
  assert.deepStrictEqual(v.viewOpts[1], { key: 'scoreboard', label: 'SCOREBOARD', bg: 'var(--color-bg)', fg: 'var(--color-text)' });
  // no function survives — the source's pick closures bound live setState
  for (const o of [...v.viewOpts, ...v.periodOpts, ...v.siteOpts]) {
    assert.ok(!Object.values(o).some(x => typeof x === 'function'), 'no pick closure');
  }
});

// ── PANEL: kpis ─────────────────────────────────────────────────────────────

test('PANEL kpis — the 8 tiles, in order, with spark geometry', () => {
  const v = V();
  assert.deepStrictEqual(v.kpis.map(k => k.label),
    ['Raised', 'Open now', 'Overdue', 'HIGH open', 'Escalations', 'Actions open', 'MTTR', 'Dept coverage']);
  for (const k of v.kpis) {
    assert.deepStrictEqual(Object.keys(k).sort(),
      ['deltaColor', 'deltaNote', 'deltaTxt', 'label', 'spark', 'sparkX', 'sparkY', 'unit', 'value'].sort());
    assert.ok(!String(k.spark).includes('NaN'), `${k.label} spark has NaN`);
  }
  // Dept coverage renders against the derived fleet size (DEVIATION 2: 12 * codes.length)
  assert.strictEqual(v.kpis[7].unit, 'depts met');
  assert.ok(String(v.kpis[7].value).endsWith('/60'), 'his 5 sites × 12 depts');
  assert.strictEqual(v.kpis[4].deltaNote, 'to Council');
});

test('PANEL kpis — the tile values agree with metrics() over the same scope', () => {
  const v = V();
  const M = metrics(EM.issues, EM.meetings, windows('week'));
  assert.strictEqual(v.kpis[0].value, M.raisedCur);
  assert.strictEqual(v.kpis[1].value, M.openNow);
  assert.strictEqual(v.kpis[2].value, M.overdueNow);
  assert.strictEqual(v.kpis[3].value, M.highNow);
  assert.strictEqual(v.kpis[4].value, M.escNow);
});

// ── PANEL: leaderboard (the composite model — RAG 75/55) ────────────────────

test('PANEL leaderboard — HIS ranking, rank-sorted desc, NOT codes order', () => {
  const lb = V().leaderboard;
  assert.deepStrictEqual(lb.map(r => r.code), ['SML', 'SMI', 'HGO', 'SGO', 'MGO']);
  assert.deepStrictEqual(lb.map(r => r.score), [62, 58, 48, 44, 41]);
  assert.deepStrictEqual(lb.map(r => r.rag), ['AMBER', 'AMBER', 'RED', 'RED', 'RED']);
  assert.deepStrictEqual(lb.map(r => r.rank), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(lb.map(r => r.name), ['Lafigué', 'Ity', 'Houndé', 'Sabodala-Massawa', 'Mana']);
});

test('PANEL leaderboard — per-row composite detail matches the 3B-1 oracle', () => {
  const by = Object.fromEntries(V().leaderboard.map(r => [r.code, r]));
  assert.deepStrictEqual(
    (({ del, gov, eng, open, overdue, high, penalty }) => ({ del, gov, eng, open, overdue, high, penalty }))(by.SML),
    { del: 83, gov: 56, eng: 58, open: 12, overdue: 2, high: 3, penalty: '−5' });
  assert.strictEqual(by.SMI.penalty, '·', 'no penalty renders as a middot, not 0');
  // odRate > 20 and high >= 4 drive the emphasis columns
  assert.strictEqual(by.HGO.overdueColor, REDT);   // odRate 67
  assert.strictEqual(by.HGO.overdueWeight, 700);
  assert.strictEqual(by.MGO.highColor, REDT);      // 5 HIGH
  assert.strictEqual(by.SML.highColor, 'var(--color-text)');  // 3 HIGH
});

test('PANEL leaderboard — the selected site\'s row is tinted', () => {
  const lb = buildReviewVals(EM, { ...OPTS, site: 'HGO' }).leaderboard;
  assert.strictEqual(lb.find(r => r.code === 'HGO').rowBg, 'var(--color-accent-100)');
  assert.strictEqual(lb.find(r => r.code === 'SML').rowBg, 'var(--color-bg)');
});

// ── PANEL: groupRows ────────────────────────────────────────────────────────

test('PANEL groupRows — the three countries plus the fleet roll-up', () => {
  const g = V().groupRows;
  assert.deepStrictEqual(g.map(r => r.name), ['Côte d’Ivoire', 'Burkina Faso', 'Senegal', 'GROUP — ALL SITES']);
  assert.deepStrictEqual(g.map(r => r.sites), ['SML · SMI', 'HGO · MGO', 'SGO', 'SML · SMI · HGO · MGO · SGO']);
  assert.strictEqual(g[0].score, Math.round((62 + 58) / 2));  // 60
  assert.strictEqual(g[1].score, Math.round((48 + 41) / 2));  // 45 (44.5 → 45)
  assert.strictEqual(g[2].score, 44);
  assert.strictEqual(g[3].score, Math.round((62 + 58 + 48 + 41 + 44) / 5)); // 51
});

// ── PANEL: flowMonths ───────────────────────────────────────────────────────

test('PANEL flowMonths — 4 months, raised/closed bars and the closure ratio', () => {
  const f = V().flowMonths;
  assert.deepStrictEqual(f.map(r => r.label), ['APR', 'MAY', 'JUN', 'JUL']);
  for (const r of f) {
    assert.deepStrictEqual(Object.keys(r).sort(),
      ['closed', 'hClosed', 'hRaised', 'label', 'raised', 'ratio', 'ratioColor'].sort());
    assert.ok(r.hRaised >= 0 && r.hRaised <= 100);
    assert.match(String(r.ratio), /^(—|\d+\.\d{2})$/);
  }
  // raised per month must reconcile with D
  const apr = EM.issues.filter(i => String(i.meeting_date || '').slice(0, 7) === '2026-04').length;
  assert.strictEqual(f[0].raised, apr);
});

// ── PANEL: backlog polyline ─────────────────────────────────────────────────

test('PANEL backlog — weekly polyline from Apr 1, his backlogNow oracle', () => {
  const v = V();
  assert.strictEqual(v.backlogNow, 80);   // reviewer-confirmed, from HIS code
  assert.strictEqual(v.backlogStartLabel, 'Apr 1');
  assert.ok(v.backlogPeak >= v.backlogNow);
  assert.ok(!v.backlogPts.includes('NaN'));
  assert.ok(v.backlogPts.split(' ').length > 10, 'one point per week from Apr 1 to the anchor');
  assert.match(v.backlogTrendTxt, /^(▼ falling|▲ rising|· flat)$/);
});

// ── PANEL: eMatrix (5E) ─────────────────────────────────────────────────────

test('PANEL eMatrix — rows follow CODES order (not rank), 5 cells each, E4 never measured', () => {
  const v = V();
  assert.deepStrictEqual(v.eHeaders.map(h => h.label), ['E1', 'E2', 'E3', 'E4', 'E5']);
  assert.deepStrictEqual(v.eMatrix.map(r => r.site),
    ['Lafigué · SML', 'Ity · SMI', 'Houndé · HGO', 'Mana · MGO', 'Sabodala-Massawa · SGO']);
  for (const r of v.eMatrix) {
    assert.strictEqual(r.cells.length, 5);
    assert.deepStrictEqual(r.cells[3], { val: '—', bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-500)', tip: 'E4 not yet measured' });
    for (const c of r.cells) assert.match(String(c.val), /^(\d+%|—)$/);
  }
});

// ── PANEL: sigFunnel ────────────────────────────────────────────────────────

test('PANEL sigFunnel — the four signature stages', () => {
  const s = V().sigFunnel;
  assert.deepStrictEqual(s.map(r => r.label), ['PVs submitted', 'Dept head signed', 'Site IT signed', 'Both ≤ 48 h']);
  assert.strictEqual(s[0].value, EM.meetings.filter(m => m.submitted_at).length);
  assert.strictEqual(s[0].note, 'of ' + EM.meetings.length + ' meetings');
  assert.match(String(s[3].value), /^\d+ \/ \d+$/);
  assert.match(s[3].note, /% — target ≥ 80%$/);
});

// ── PANEL: aging ────────────────────────────────────────────────────────────

test('PANEL aging — the four buckets partition the open list', () => {
  const a = V().aging;
  assert.deepStrictEqual(a.map(r => r.label), ['≤ 30 d', '31–60 d', '61–90 d', '> 90 d']);
  const M = metrics(EM.issues, EM.meetings, windows('week'));
  assert.strictEqual(a.reduce((s, r) => s + r.total, 0), M.openList.length, 'buckets must cover every open issue');
  for (const r of a) {
    assert.match(String(r.wHigh), /^\d+\.\d$/);
    assert.ok(r.highTxt === '' || /^· \d+ HIGH$/.test(r.highTxt));
  }
});

// ── PANEL: champLoad ────────────────────────────────────────────────────────

test('PANEL champLoad — top 8 champions by open load, desc, flagged at ≥ 7', () => {
  const c = V().champLoad;
  assert.ok(c.length > 0 && c.length <= 8);
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].n >= c[i].n, 'descending');
  assert.strictEqual(c[0].w, 100, 'the heaviest bar is full width');
  for (const r of c) {
    assert.strictEqual(r.flag, r.n >= 7 ? ' ⚠' : '');
    assert.strictEqual(r.numColor, r.n >= 7 ? REDT : 'var(--color-text)');
  }
});

// ── PANEL: overdueRows ──────────────────────────────────────────────────────

test('PANEL overdueRows — his overdueCount oracle; the register caps at 9, oldest first', () => {
  const v = V();
  assert.strictEqual(v.overdueCount, 26);   // reviewer-confirmed, from HIS code
  assert.strictEqual(v.overdueRows.length, 9, 'capped at 9 even though 26 are overdue');
  for (let i = 1; i < v.overdueRows.length; i++) {
    assert.ok(v.overdueRows[i - 1].days >= v.overdueRows[i].days, 'oldest target date first');
  }
  const r = v.overdueRows[0];
  assert.deepStrictEqual(Object.keys(r).sort(), ['dColor', 'days', 'meta', 'sev', 'sevBg', 'sevFg', 'title'].sort());
  assert.match(r.meta, / · due \d+ \w{3}$/);
  assert.ok(v.noTargetNote.length > 0);
});

// ── PANEL: inspSiteRows ─────────────────────────────────────────────────────

test('PANEL inspSiteRows — one row per site in CODES order', () => {
  const v = V();
  assert.deepStrictEqual(v.inspSiteRows.map(r => r.site),
    ['Lafigué · SML', 'Ity · SMI', 'Houndé · HGO', 'Mana · MGO', 'Sabodala-Massawa · SGO']);
  for (const r of v.inspSiteRows) {
    assert.strictEqual(r.count, EM.inspections.filter(i => i.site_code === r.site.split(' · ')[1]).length);
    assert.match(String(r.conf), /^(\d+%|—)$/);
    assert.match(r.defTxt, /^\d+ \/ \d+ \/ \d+$/);
  }
});

test('PANEL inspSiteRows — scoping to one site yields exactly that row', () => {
  const v = buildReviewVals(EM, { ...OPTS, site: 'HGO' });
  assert.strictEqual(v.inspSiteRows.length, 1);
  assert.strictEqual(v.inspSiteRows[0].site, 'Houndé · HGO');
});

// QUIRK — source :348-350. `opp` is in the conformity DENOMINATOR (status !== 'na')
// but not the NUMERATOR (status === 'ok'), so opportunities depress conf%.
// This is inspSiteRows, NOT findCats — findCats computes no conformity at all.
test('QUIRK: inspSiteRows conformity counts `opp` in the denominator but not the numerator', () => {
  const D = {
    meetings: [], issues: [], actions: [], projects: [], inspActions: [],
    inspections: [{ id: 'i1', site_code: 'HGO', inspection_date: '2026-05-01' }],
    findings: [
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'ok', category: 'net' },
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'opp', category: 'net' },
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'na', category: 'net' },
    ],
  };
  const row = buildReviewVals(D, OPTS).inspSiteRows[0];
  assert.strictEqual(row.conf, '50%', 'appl = ok+opp = 2, ok = 1 → 50%. Were opp excluded it would read 100%');
  // and it bites on the real data:
  assert.strictEqual(EM.findings.filter(f => f.status === 'opp').length, 12,
    '12 opportunities in his data depress every conformity reading');
});

// QUIRK — source :353 filters `a.status !== 'Closed'`. Our inspection-actions
// vocabulary also has 'Cancelled' (public/inspection-actions.html STATUSES),
// which his data lacks — so a cancelled action counts as OPEN. LATENT, not
// active: his snapshot has zero Cancelled. Pinned with a synthetic row.
test('QUIRK: inspSiteRows.actOpen counts a Cancelled action as open (only \'Closed\' is excluded)', () => {
  const D = {
    meetings: [], issues: [], actions: [], projects: [], findings: [],
    inspections: [{ id: 'i1', site_code: 'HGO', inspection_date: '2026-05-01' }],
    inspActions: [
      { id: 1, site_code: 'HGO', status: 'Open' },
      { id: 2, site_code: 'HGO', status: 'Closed' },
      { id: 3, site_code: 'HGO', status: 'Cancelled' },  // synthetic — absent from his data
    ],
  };
  assert.strictEqual(buildReviewVals(D, OPTS).inspSiteRows[0].actOpen, 2, 'Open + Cancelled');
  assert.strictEqual(EM.inspActions.filter(a => a.status === 'Cancelled').length, 0, 'latent on his data');
});

// ── PANEL: findCats ─────────────────────────────────────────────────────────

test('PANEL findCats — top 8 defect categories, desc, named via catNames', () => {
  const f = V().findCats;
  assert.ok(f.length > 0 && f.length <= 8);
  for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].n >= f[i].n, 'descending');
  assert.strictEqual(f[0].w, 100);
  for (const r of f) {
    assert.deepStrictEqual(Object.keys(r).sort(), ['color', 'label', 'n', 'w'].sort());
    assert.ok(r.color === 'var(--color-accent)' || r.color === 'var(--color-neutral-600)');
  }
  // an unmapped category code falls through to the raw key
  const D = {
    meetings: [], issues: [], actions: [], projects: [], inspActions: [],
    inspections: [{ id: 'i1', site_code: 'HGO', inspection_date: '2026-05-01' }],
    findings: [
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'major', category: 'pwr' },
      { site_code: 'HGO', inspection_date: '2026-05-01', status: 'minor', category: 'zz_unmapped' },
    ],
  };
  const got = buildReviewVals(D, OPTS).findCats;
  assert.deepStrictEqual(got.map(r => r.label), ['Power / UPS', 'zz_unmapped']);
  assert.strictEqual(got[0].color, 'var(--color-accent)', 'a non-minor defect reddens the bar');
  assert.strictEqual(got[1].color, 'var(--color-neutral-600)', 'minor-only stays neutral');
});

// ── PANEL: pipeline ─────────────────────────────────────────────────────────

test('PANEL pipeline — the four hardcoded phases', () => {
  const p = V().pipeline;
  assert.deepStrictEqual(p.map(r => r.label), ['Scoping', 'Design', 'Build', 'Deploy']);
  assert.deepStrictEqual(p.map(r => r.bg),
    ['var(--color-accent)', 'var(--color-neutral-650)', 'var(--color-neutral-500)', 'var(--color-neutral-350)']);
  for (const r of p) assert.strictEqual(r.flex, Math.max(r.n, 1), 'an empty phase still occupies a slot');
});

// QUIRK — the source hardcodes 4 phases. Our seed has 5 ('closeout') and the
// fixture carries a null phase; both fall OUT of the bars but stay IN
// projs.length, so pipelineNote says "N of M" where the bars sum to < M.
test('QUIRK: pipeline drops closeout/null projects from the bars but keeps them in the note\'s denominator', () => {
  const D = {
    meetings: [], issues: [], actions: [], inspections: [], findings: [], inspActions: [],
    projects: [
      { id: 1, site_code: 'HGO', phase: 'scoping', target_end: '2026-12-31' },
      { id: 2, site_code: 'HGO', phase: 'closeout', target_end: '2026-12-31' },
      { id: 3, site_code: 'HGO', phase: null, target_end: null },
    ],
  };
  const v = buildReviewVals(D, OPTS);
  assert.strictEqual(v.pipeline.reduce((s, r) => s + r.n, 0), 1, 'only the scoping project reaches a bar');
  assert.match(v.pipelineNote, /^1 of 3 projects still in scoping/, 'but all 3 are in the denominator');
  assert.match(v.pipelineNote, /1 have no target end date\.$/);
  // and it is live on his data:
  assert.ok(EM.projects.some(p => !['scoping', 'design', 'build', 'deploy'].includes(p.phase)),
    'his fixture already carries a project outside the four phases');
});

// ── PANEL: dqItems ──────────────────────────────────────────────────────────

test('PANEL dqItems / dqScore — his dqScore oracle', () => {
  const v = V();
  assert.strictEqual(v.dqScore, 0);   // reviewer-confirmed, from HIS code (floored at 0)
  assert.strictEqual(v.dqColor, REDT);
  assert.deepStrictEqual(v.dqItems.map(i => i.label), [
    'PVs unsigned > 7 days',
    'Open issues without target date',
    'Open issues, champion has no email',
    'Champion name-spelling variants',
  ]);
  for (const i of v.dqItems) assert.strictEqual(typeof i.value, 'number');
});

// ── PANEL: briefKpis / briefNarrative / briefSites ──────────────────────────

test('PANEL briefKpis — always the FLEET week, regardless of the selected scope', () => {
  const site = buildReviewVals(EM, { ...OPTS, site: 'HGO' });
  const all = V();
  assert.deepStrictEqual(site.briefKpis, all.briefKpis, 'the brief is fleet-wide by design');
  assert.deepStrictEqual(all.briefKpis.map(k => k.label),
    ['Open backlog', 'Overdue', 'HIGH open', 'Raised this week']);
  const MF = metrics(EM.issues, EM.meetings, windows('week'));
  assert.strictEqual(all.briefKpis[0].value, MF.openNow);
  assert.deepStrictEqual(Object.keys(all.briefKpis[0]).sort(), ['deltaColor', 'deltaTxt', 'label', 'value'].sort());
});

test('PANEL briefNarrative — names the best and worst site and quotes the fleet score', () => {
  const n = V().briefNarrative;
  // fleet = mean of the 5 composite scores = 51
  assert.match(n, /^Fleet health stands at 51\/100\. /);
  assert.match(n, /Lafigué leads the board/);      // best = 62
  assert.match(n, /Mana needs the most attention/); // worst = 41
  assert.match(n, /against a target of 80%\.$/);
});

test('PANEL briefSites — rank-sorted, each with 4 period deltas, 6 stats and 2 moves', () => {
  const b = V().briefSites;
  assert.deepStrictEqual(b.map(r => r.code), ['SML', 'SMI', 'HGO', 'SGO', 'MGO']);
  for (const r of b) {
    assert.deepStrictEqual(r.deltas.map(d => d.label), ['WoW', 'MoM', 'QoQ', 'HoH']);
    assert.deepStrictEqual(r.stats.map(s => s.label), ['Open', 'Overdue', 'HIGH', 'MTTR', 'E2 48 h', 'Last inspection']);
    assert.strictEqual(r.moves.length, 2);
    for (const m of r.moves) assert.ok(m.text.length > 0);
  }
  const sgo = b.find(r => r.code === 'SGO');
  assert.strictEqual(sgo.stats[3].value, '—', 'SGO resolved nothing → MTTR renders as a dash, not 0');
});

// ═════════════════════════════════════════════════════════════════════════════
// SCOREBOARD (the sbDims model — RAG 70/45). Genuinely disagrees with the
// leaderboard above; that is the source's design, not a defect to reconcile.
// ═════════════════════════════════════════════════════════════════════════════

test('PANEL sbRows — HIS ranking; the SML/MGO tie at 50 resolves on codes order', () => {
  const r = V().sbRows;
  assert.deepStrictEqual(r.map(x => x.code), ['HGO', 'SML', 'MGO', 'SMI', 'SGO']);
  assert.deepStrictEqual(r.map(x => x.score), [58, 50, 50, 42, 17]);
  assert.deepStrictEqual(r.map(x => x.rank), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(r.map(x => x.rag), ['AMBER', 'AMBER', 'AMBER', 'RED', 'RED']);
  // bridge gap 2: rag2 returns a string; the row still carries the source's colours
  assert.strictEqual(r[0].ragBg, '#d99a2b');
  assert.strictEqual(r[0].ragFg, '#fff');
  assert.strictEqual(r[4].ragBg, 'var(--color-accent)');
});

test('PANEL sbRows — 6 cells per row, in the source\'s dim order', () => {
  const v = V();
  assert.deepStrictEqual(v.sbDimHeaders.map(h => h.label),
    ['REVIEWS', 'RESOLUTION', 'OVERDUE', 'INSPECTIONS', 'FINDINGS', 'SIGN-OFF']);
  for (const row of v.sbRows) {
    assert.strictEqual(row.cells.length, 6);
    for (const c of row.cells) assert.deepStrictEqual(Object.keys(c).sort(), ['bg', 'fg', 'tip', 'val'].sort());
  }
  // the cells are the measured dims
  const hgo = v.sbRows.find(r => r.code === 'HGO');
  const inputs = sbMeasure('HGO', EM, A);
  assert.strictEqual(hgo.cells[0].val, String(inputs.reviews));
  assert.strictEqual(hgo.cells[1].val, inputs.resolution + '%');
  assert.strictEqual(hgo.cells[2].val, String(inputs.overdue));
});

test('PANEL sbAvg — his oracle, and the RAG colour off it', () => {
  const v = V();
  assert.strictEqual(v.sbAvg, 43);   // reviewer-confirmed, from HIS code
  assert.strictEqual(v.sbAvgColor, REDT, '43 is below the 45 amber floor');
  assert.strictEqual(typeof v.sbAvgDelta, 'string');
});

test('PANEL emBubbles — one per site, in codes order, no NaN coordinate', () => {
  const v = V();
  assert.deepStrictEqual(v.emBubbles.map(b => b.label), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
  for (const b of v.emBubbles) {
    assert.deepStrictEqual(Object.keys(b).sort(), ['fill', 'label', 'lx', 'ly', 'r', 'x', 'y'].sort());
    for (const k of ['x', 'y', 'r', 'lx', 'ly']) {
      assert.ok(Number.isFinite(+b[k]), `${b.label}.${k} = ${b[k]} is not finite`);
    }
  }
  for (const k of ['emSplitX', 'emSplitY', 'emQ2x']) assert.ok(Number.isFinite(+v[k]), k);
});

test('PANEL gapRows / gapLegend — segments for scored dims, loss for the rest', () => {
  const v = V();
  assert.deepStrictEqual(v.gapRows.map(r => r.code), ['HGO', 'SML', 'MGO', 'SMI', 'SGO']);
  assert.deepStrictEqual(v.gapLegend.map(l => l.label),
    ['Reviews', 'Resolution', 'Overdue', 'Inspections', 'Findings', 'Sign-off']);
  assert.strictEqual(v.gapLegend[0].color, '#1d6b5e');
  const sgo = v.gapRows.find(r => r.code === 'SGO');   // score 17 → 2/12 pts
  assert.strictEqual(sgo.loss, '−83 pts lost');
  assert.strictEqual(sgo.lossColor, REDT);
});

test('PANEL sbMoves — two moves per site, gains quoted in points', () => {
  const v = V();
  assert.deepStrictEqual(v.sbMoves.map(r => r.code), ['HGO', 'SML', 'MGO', 'SMI', 'SGO']);
  for (const r of v.sbMoves) {
    assert.strictEqual(r.moves.length, 2);
    for (const m of r.moves) assert.match(m.gain, /^(\+\d+ pts|sustain)$/);
  }
  assert.strictEqual(v.sbMoves[0].name, 'Houndé');
  assert.strictEqual(v.sbMoves[0].hdrBg, '#d99a2b');  // AMBER 58
});

// ── applicable:false — the state the source has no concept of ───────────────
//
// A site with a PV outside the W0 window measures all-zero. Two of the six dims
// are INVERTED, so the source would score it 4/12 = RED 33 — a confident verdict
// on nothing — and fold that fabricated 0 into sbAvg via the hardcoded /5.

const D_GAP = { ...EM, meetings: [...EM.meetings, { site_code: 'KGO', department: 'it', meeting_date: '2026-01-15' }] };

test('applicable:false — the site is in codes but sbMeasure finds nothing to score', () => {
  const { computeSiteScore } = require('../services/siteScore');
  assert.strictEqual(computeSiteScore(sbMeasure('KGO', D_GAP, A)).applicable, false);
  assert.ok(buildReviewVals(D_GAP, OPTS).siteOpts.map(o => o.key).includes('KGO'));
});

test('applicable:false — its row is OMITTED from sbRows/emBubbles/gapRows/sbMoves, not rendered broken', () => {
  const v = buildReviewVals(D_GAP, OPTS);
  for (const panel of ['sbRows', 'gapRows', 'sbMoves']) {
    assert.ok(!v[panel].some(r => r.code === 'KGO'), `${panel} must omit the data-less site`);
    assert.strictEqual(v[panel].length, 5);
  }
  assert.ok(!v.emBubbles.some(b => b.label === 'KGO'));
  assert.strictEqual(v.emBubbles.length, 5);
});

test('applicable:false — sbAvg IGNORES it rather than averaging in a fabricated 0', () => {
  const v = buildReviewVals(D_GAP, OPTS);
  assert.strictEqual(v.sbAvg, 43, 'still the mean of the 5 applicable sites — the source would report 40');
  assert.strictEqual(v.sbAvgColor, REDT);
});

test('applicable:false — no bubble coordinate goes NaN', () => {
  const v = buildReviewVals(D_GAP, OPTS);
  for (const b of v.emBubbles) {
    for (const k of ['x', 'y', 'r', 'lx', 'ly']) assert.ok(Number.isFinite(+b[k]), `${b.label}.${k}`);
  }
  for (const k of ['emSplitX', 'emSplitY', 'emQ2x']) assert.ok(Number.isFinite(+v[k]), k);
});

test('a D with no sites at all does not throw and claims no verdict', () => {
  const EMPTY = { meetings: [], issues: [], actions: [], inspections: [], findings: [], inspActions: [], projects: [] };
  let v;
  assert.doesNotThrow(() => { v = buildReviewVals(EMPTY, OPTS); });
  assert.strictEqual(v.sbAvg, null, 'no applicable site → no fleet score, not a fabricated 0');
  assert.strictEqual(v.sbAvgColor, 'var(--color-neutral-500)', 'and no RAG verdict off it');
  assert.deepStrictEqual(v.sbRows, []);
  assert.deepStrictEqual(v.leaderboard, []);
});

// ═════════════════════════════════════════════════════════════════════════════
// OUR EXTRAS — the Helpdesk & Changes panel (sub-project 3C).
//
// NOT the source's. His `D` has no helpdesk concept at all. Everything below
// rides in via the OPTIONAL `opts.extras` so that calling without it still
// emits exactly his 61 keys and tests/review-fidelity.test.js keeps proving the
// port. Nothing here may reach the score.
// ═════════════════════════════════════════════════════════════════════════════

const BASE = { view: 'dashboard', period: 'week', site: 'ALL', asOf: '2026-07-14' };

// Task 1's changes contract VERBATIM — _tallyChanges' output plus total/emergency/
// success_pct. No `completed`/`open` pair; `failed` already includes backed_out.
const CHG = (o = {}) => ({ buckets: {}, successful: 0, failed: 0, cancelled: 0, deferred: 0,
                           pending: 0, executed: 0, total: 0, emergency: 0, success_pct: null, ...o });
const EXTRAS = {
  helpdesk: { HGO: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1 } },
  changes:  { HGO: CHG({ successful: 3, failed: 1, executed: 4, total: 4, success_pct: 75 }) },
};

test('buildReviewVals WITHOUT extras emits exactly the 61 keys — the fidelity proof must not move', () => {
  const vals = buildReviewVals(EM, { ...BASE });
  assert.strictEqual(Object.keys(vals).length, 61);
  assert.ok(!('hdRows' in vals));
});

test('buildReviewVals WITH extras adds ONLY the declared keys', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: EXTRAS });
  const added = Object.keys(vals).filter(k => !KEYS.includes(k));
  assert.deepStrictEqual(added.sort(), ['hdNote', 'hdRows']);   // the declared allowlist
});

test('hdRows: one row per site in codes order, joined by site code', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: EXTRAS });
  assert.deepStrictEqual(vals.hdRows.map(r => r.code), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
  const hgo = vals.hdRows.find(r => r.code === 'HGO');
  assert.strictEqual(hgo.name, 'Houndé');
  assert.strictEqual(hgo.created, 40);
  assert.strictEqual(hgo.backlog, 5);
  assert.strictEqual(hgo.changes, 4);
  assert.strictEqual(hgo.successPct, '75%');
});

test('hdRows: a site with no helpdesk data renders dashes, not fabricated zeros', () => {
  const vals = buildReviewVals(EM, { ...BASE, extras: { helpdesk: {}, changes: {} } });
  assert.strictEqual(vals.hdRows[0].created, '—');
  assert.strictEqual(vals.hdRows[0].successPct, '—');
});

test('hdRows: success_pct null renders as a dash, NOT 0%', () => {
  const extras = { helpdesk: {}, changes: { SML: CHG({ pending: 1, total: 1 }) } };
  const vals = buildReviewVals(EM, { ...BASE, extras });
  assert.strictEqual(vals.hdRows.find(r => r.code === 'SML').successPct, '—');
});

test('hdRows: our declared colour thresholds', () => {
  const extras = {
    helpdesk: {
      SML: { created: 10, resolved: 10, backlog: 0, sla_overdue: 0, major_incidents: 0 },
      SMI: { created: 10, resolved: 8, backlog: 2, sla_overdue: 3, major_incidents: 0 },
      HGO: { created: 10, resolved: 8, backlog: 2, sla_overdue: 9, major_incidents: 2 },
    },
    changes: {
      SML: CHG({ successful: 10, executed: 10, total: 10, success_pct: 100 }),
      SMI: CHG({ successful: 4, failed: 1, executed: 5, total: 5, success_pct: 80 }),
      HGO: CHG({ successful: 1, failed: 1, executed: 2, total: 2, success_pct: 50 }),
    },
  };
  const by = Object.fromEntries(buildReviewVals(EM, { ...BASE, extras }).hdRows.map(r => [r.code, r]));
  assert.strictEqual(by.SML.slaColor, 'var(--color-text)');  // 0 overdue
  assert.strictEqual(by.SMI.slaColor, AMBER);                // 3 → >0
  assert.strictEqual(by.HGO.slaColor, REDT);                 // 9 → >5
  assert.strictEqual(by.SML.miColor, 'var(--color-text)');
  assert.strictEqual(by.HGO.miColor, REDT);                  // any MI
  assert.strictEqual(by.SML.successColor, GREEN);            // 100
  assert.strictEqual(by.SMI.successColor, AMBER);            // 80 → <90
  assert.strictEqual(by.HGO.successColor, REDT);             // 50 → <75
  // null → no verdict, neutral
  const none = buildReviewVals(EM, { ...BASE, extras: { helpdesk: {}, changes: {} } });
  assert.strictEqual(none.hdRows[0].successColor, 'var(--color-neutral-500)');
});

test('hdNote states BOTH windows and disclaims the score', () => {
  const note = buildReviewVals(EM, { ...BASE, extras: EXTRAS }).hdNote;
  assert.match(note, /8 Jul – 14 Jul/, 'the helpdesk window (the period selector)');
  assert.match(note, /15 Apr – 14 Jul/, 'the fixed changes window');
  assert.match(note, /not part of the site score/);
  // and it moves with the selector
  const q = buildReviewVals(EM, { ...BASE, period: 'quarter', extras: EXTRAS }).hdNote;
  assert.match(q, /1 Jul – 14 Jul/);
  assert.match(q, /15 Apr – 14 Jul/, 'the changes window never moves');
});

test('extras never touch the score', () => {
  const a = buildReviewVals(EM, { ...BASE, view: 'scoreboard' });
  const b = buildReviewVals(EM, { ...BASE, view: 'scoreboard', extras: EXTRAS });
  assert.deepStrictEqual(b.sbRows, a.sbRows);
  assert.deepStrictEqual(b.leaderboard, a.leaderboard);
  assert.strictEqual(b.sbAvg, a.sbAvg);
});

// ── codesOf ─────────────────────────────────────────────────────────────────
// Lifted out of buildReviewVals so the route derives `codes` from the ONE
// definition. His order is load-bearing — see DEVIATION 1.

test('codesOf is the single definition of the row order buildReviewVals uses', () => {
  assert.deepStrictEqual(codesOf(EM), ['SML', 'SMI', 'HGO', 'MGO', 'SGO']);
  assert.deepStrictEqual(codesOf(EM), V().siteOpts.slice(1).map(o => o.key));
  const D = { ...EM, meetings: [...EM.meetings, { site_code: 'KGO', department: 'it', meeting_date: '2026-05-05' }] };
  assert.deepStrictEqual(codesOf(D), ['SML', 'SMI', 'HGO', 'MGO', 'SGO', 'KGO'], 'unseen sites append');
});

// ── extrasWindows ───────────────────────────────────────────────────────────

test('extrasWindows: helpdesk follows the period, changes are the fixed 90 days', () => {
  const w = extrasWindows('week');
  assert.deepStrictEqual([w.chgFrom, w.chgTo], ['2026-04-15', '2026-07-14']);   // 90d ending at ANCHOR
  assert.strictEqual(w.hdTo, '2026-07-14');
  // month/quarter/semester share an identical `cur` — only `prev` differs. So the
  // ONLY period that proves hd* moves is 'week'.
  assert.notDeepStrictEqual(extrasWindows('month').hdFrom, w.hdFrom);
  assert.deepStrictEqual(extrasWindows('quarter').chgFrom, w.chgFrom);          // chg never moves
});

test('extrasWindows emits ISO strings SQL can consume — never fmt\'s display form', () => {
  // fmt('2026-04-15') is '15 Apr'. Feeding that to
  // `substr(created_time,1,10) BETWEEN ? AND ?` matches NOTHING and returns 0
  // rows with no error. This test is the guard against that silent zero.
  for (const p of ['week', 'month', 'quarter', 'semester']) {
    for (const [k, v] of Object.entries(extrasWindows(p))) {
      assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `${p}.${k} = ${v}`);
    }
  }
});

// ── loadReviewExtras — the binder ───────────────────────────────────────────
//
// "A binder that looks wired can silently read zeros" (CLAUDE.md). Nothing in
// the tests above exercises the loader: mis-wire it and the panel renders
// dashes forever with every test green. Stub the readers and prove the wiring.

const { loadReviewExtras } = require('../services/reviewData');

const stubDeps = (calls = []) => ({
  reportsDb: {
    getSiteIdByModuleCode: (mod, code) => {
      calls.push(['resolve', mod, code]);
      return code === 'ZZZ' ? null : { site_id: 'id-' + code, name: 'Site ' + code, zoho_group: code + ' IT Agents' };
    },
    getSiteHelpdeskWindow: (site_id, from, to) => {
      calls.push(['hd', site_id, from, to]);
      return { created: 1, resolved: 1, backlog: 0, sla_overdue: 0, major_incidents: 0 };
    },
    getSiteChangesWindow: (site_id, from, to) => {
      calls.push(['chg', site_id, from, to]);
      return { total: 2, successful: 2, executed: 2, success_pct: 100 };
    },
  },
});

const WIN = { hdFrom: '2026-07-08', hdTo: '2026-07-14', chgFrom: '2026-04-15', chgTo: '2026-07-14' };

test('loadReviewExtras: maps each code through BOTH readers, in the meetings namespace', async () => {
  const calls = [];
  const out = await loadReviewExtras(['HGO', 'MGO'], WIN, stubDeps(calls));
  assert.deepStrictEqual(Object.keys(out).sort(), ['changes', 'helpdesk']);
  assert.deepStrictEqual(Object.keys(out.helpdesk), ['HGO', 'MGO']);
  assert.deepStrictEqual(Object.keys(out.changes), ['HGO', 'MGO']);
  assert.strictEqual(out.helpdesk.HGO.created, 1);
  assert.strictEqual(out.changes.MGO.success_pct, 100);
  // the code namespace is 'meetings' — SMI/ITY, KGO/KLN differ per module
  assert.ok(calls.filter(c => c[0] === 'resolve').every(c => c[1] === 'meetings'));
});

test('loadReviewExtras: each reader gets its OWN window — hd follows the period, chg does not', () => {
  const calls = [];
  return loadReviewExtras(['HGO'], WIN, stubDeps(calls)).then(() => {
    assert.deepStrictEqual(calls.find(c => c[0] === 'hd'), ['hd', 'id-HGO', '2026-07-08', '2026-07-14']);
    assert.deepStrictEqual(calls.find(c => c[0] === 'chg'), ['chg', 'id-HGO', '2026-04-15', '2026-07-14']);
  });
});

test('loadReviewExtras: an unresolvable code is ABSENT — not a throw, not a zero', async () => {
  const out = await loadReviewExtras(['HGO', 'ZZZ'], WIN, stubDeps());
  assert.deepStrictEqual(Object.keys(out.helpdesk), ['HGO']);
  assert.deepStrictEqual(Object.keys(out.changes), ['HGO']);
  // and the panel then renders dashes for it, not a fabricated 0
  const vals = buildReviewVals(EM, { ...BASE, extras: out });
  assert.strictEqual(vals.hdRows.find(r => r.code === 'SGO').created, '—');
});

test('loadReviewExtras: no codes → empty maps, no reader calls', async () => {
  const calls = [];
  assert.deepStrictEqual(await loadReviewExtras([], WIN, stubDeps(calls)), { helpdesk: {}, changes: {} });
  assert.deepStrictEqual(calls, []);
});
