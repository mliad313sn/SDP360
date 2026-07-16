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
} = require('../services/reviewDashboard');

const EM = require('./fixtures/em-data.json');
const A = '2026-07-14'; // the source's ANCHOR

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
