'use strict';
// FIDELITY HARNESS — the acceptance test for the renderVals() port.
//
// Sibling of tests/composite-fidelity.test.js and tests/score-fidelity.test.js.
// tests/review-dashboard.test.js proves INTERNAL consistency (our code agrees
// with our tests). This file is the only thing that proves FIDELITY: that
// buildReviewVals() produces the same 61 keys the boss's own dashboard shows him.
//
//   *** HIS CODE IS THE ORACLE. IF WE DISAGREE, WE ARE WRONG. ***
//
// Never edit an expectation to match our output — that would convert the one
// test that can detect a fidelity bug into a test that certifies it. If this
// cannot be made to pass, the port is broken: report it, don't retune it.
//
// THE ORACLE IS NOT A DUMPED JSON. tests/review-oracle.js COMPILES AND RUNS
// docs/reference/it-review-dashboard.source.js against the fixture on every run.
// That matters: em-data.json is a later export of our own production database,
// so if the snapshot is ever refreshed, re-running re-derives the oracle rather
// than leaving a stale blob quietly certifying a drifted port.
//
// The fixture (tests/fixtures/em-data.json) is `window.EM_DATA` lifted out of his
// "IT Review Dashboard" artifact — his real data for his 5 sites.

const test = require('node:test');
const assert = require('node:assert');

const EM = require('./fixtures/em-data.json');
const { runOracle, fnPaths, strip } = require('./review-oracle');
const { buildReviewVals } = require('../services/reviewDashboard');

// HIS anchor — the dashboard's ANCHOR constant. The oracle is only meaningful at
// the as-of date it was produced at.
const A = '2026-07-14';

const VIEWS = ['dashboard', 'scoreboard', 'brief'];
const PERIODS = ['week', 'month', 'quarter', 'semester'];
const SITES = ['ALL', 'SML', 'SMI', 'HGO', 'MGO', 'SGO'];

/**
 * APPROVED DEVIATION #2 — the six RAG band captions (`sbRows[].cells[].tip`).
 *
 * The author writes them as shorthand (`G≥8 A5–7 R<5`, source :182-187). The
 * Service Desk Manager asked for plain English everywhere they are shown, and
 * services/siteScore.js' PT_THRESHOLDS now carries the spelled-out wording. So
 * this ONE string field, on this ONE panel, no longer matches his.
 *
 * Scope of the blanking, deliberately as narrow as it can be:
 *   • ONLY `sbRows[].cells[].tip`. Every other `tip` in the tree — eMatrix's
 *     engagement cells (:502, :509) and the score-bar segments (:770) — is
 *     still compared verbatim, because none of them comes from PT_THRESHOLDS.
 *   • `val`, `bg` and `fg` on those same cells are UNTOUCHED, so the displayed
 *     number and its RAG colour are still proved identical cell by cell.
 *
 * THE NUMBERS ARE STILL PROVED — and by the STRONGER of the two mechanisms:
 *   • the 72-combo deep-equal still compares every `pts`/`score`/`rank` the
 *     bands govern, but only at the values his fixture happens to contain. It
 *     is NOT a threshold check: moving reviews' green from 8 to 9 leaves all 72
 *     combos green, because no site in his data sits on exactly 8. Verified.
 *   • so 'the plain-English bands encode the AUTHOR's own thresholds' below is
 *     what actually guards the boundaries: it re-extracts the numbers from HIS
 *     shorthand and asserts they equal our columns. That same 8→9 edit fails it.
 * We gave up the fidelity of the TEXT. We never gave up the fidelity of the
 * NUMBERS — a threshold drift still fails, loudly, in this file.
 */
const BAND_TIP = '<band caption — diverged on purpose, see the threshold test>';
const blankBandTips = (vals) => (
  !vals || !Array.isArray(vals.sbRows) ? vals : Object.assign({}, vals, {
    sbRows: vals.sbRows.map((r) => (!Array.isArray(r.cells) ? r : Object.assign({}, r, {
      cells: r.cells.map((c) => Object.assign({}, c, { tip: BAND_TIP })),
    }))),
  })
);

/** His renderVals(), with the `pick` closures stripped. */
const oracle = (st) => blankBandTips(strip(runOracle(EM, st), ['pick']));

/**
 * Our port, with `key` stripped.
 *
 * APPROVED DEVIATION: his option objects carry a `pick` closure binding live
 * setState; ours carries a declarative `key` instead (a pure function cannot
 * hold a component's setState). Comparing pick-stripped vs key-stripped puts
 * both sides on the same footing — every OTHER field of those objects is still
 * compared, and `key` itself is pinned by tests/review-dashboard.test.js.
 */
const ours = (st) => blankBandTips(strip(buildReviewVals(EM, Object.assign({ asOf: A }, st)), ['key']));

// ── the oracle is sound ───────────────────────────────────────────────────────

test('the fixture is the boss\'s real dataset for his 5 sites', () => {
  assert.deepStrictEqual(Object.keys(EM).sort(),
    ['actions', 'findings', 'inspActions', 'inspections', 'issues', 'meetings', 'projects']);
  assert.deepStrictEqual([...new Set(EM.meetings.map((m) => m.site_code))].sort(),
    ['HGO', 'MGO', 'SGO', 'SMI', 'SML']);
});

test('his renderVals() runs outside a browser and returns the 61-key full object', () => {
  const raw = runOracle(EM, { view: 'dashboard', period: 'week', site: 'ALL' });
  assert.strictEqual(Object.keys(raw).length, 61, 'not the 61-key return — did we hit the 23-key loading stub?');
  // The loading stub (:206) would have scopeLabel 'Loading…'; the full return
  // (:471) computes it. Proves dataReady took us down the real path.
  assert.strictEqual(raw.scopeLabel, 'All sites — group view');
});

test('exactly 18 function-valued paths exist, and they are all `pick`', () => {
  // ⚠️ JSON.stringify SILENTLY DROPS functions instead of throwing, so an
  // unstripped dump would "verify" 61 keys by coincidence while discarding these.
  // Assert the count explicitly: a 19th closure must break this, not vanish.
  const paths = fnPaths(runOracle(EM, { view: 'dashboard', period: 'week', site: 'ALL' }));
  assert.strictEqual(paths.length, 18);
  assert.ok(paths.every((p) => p.endsWith('.pick')), `non-pick function: ${paths.filter((p) => !p.endsWith('.pick'))}`);
  assert.deepStrictEqual(
    [...new Set(paths.map((p) => p.replace(/\[\d+\]\.pick$/, '')))].sort(),
    ['leaderboard', 'periodOpts', 'siteOpts', 'viewOpts']);
});

// ── THE ACCEPTANCE TEST ───────────────────────────────────────────────────────

test('ALL 61 keys are identical to his output (dashboard · week · ALL)', () => {
  const O = oracle({ view: 'dashboard', period: 'week', site: 'ALL' });
  const P = ours({ view: 'dashboard', period: 'week', site: 'ALL' });
  assert.deepStrictEqual(Object.keys(P).sort(), Object.keys(O).sort());
  assert.strictEqual(Object.keys(P).length, 61);
  assert.deepStrictEqual(P, O);
});

// ── THE BAND CAPTIONS: text diverged, thresholds pinned ──────────────────────
// This is the price-tag for APPROVED DEVIATION #2 above. The deep-equal can no
// longer see `sbRows[].cells[].tip`, so the risk it used to cover — a threshold
// silently drifting out of step with the author's model — is re-covered here by
// reading the numbers out of HIS OWN shorthand and comparing them to ours.
//
// Change 8 → 9 in PT_THRESHOLDS and this test fails even though every caption
// is still grammatical English.

const { PT_THRESHOLDS } = require('../services/siteScore');

/** `{green, amber}` out of the AUTHOR's shorthand, e.g. 'G≥8 A5–7 R<5'. */
function authorBands(tip, invert) {
  const green = Number((tip.match(/G(?:≥|>|=)?(\d+)/) || [])[1]);
  const amberNums = ((tip.match(/A([\d–\-—]+)/) || [])[1] || '').match(/\d+/g);
  assert.ok(Number.isFinite(green) && amberNums, `unparsable author band: ${tip}`);
  // The amber threshold is the boundary that touches RED: the LOW end of the
  // amber range when more is better, the HIGH end when less is better.
  const a = amberNums.map(Number);
  return { green, amber: invert ? Math.max(...a) : Math.min(...a) };
}

/** `{green, amber}` out of OUR plain English, e.g. 'green from 8, amber 5 to 7, red below 5'. */
function plainBands(tip, invert) {
  const green = /green if none/.test(tip) ? 0 : Number((tip.match(/green from (\d+)/) || [])[1]);
  const amberNums = ((tip.match(/amber ([^,]+), red/) || [])[1] || '').match(/\d+/g);
  assert.ok(Number.isFinite(green) && amberNums, `unparsable plain band: ${tip}`);
  const a = amberNums.map(Number);
  return { green, amber: invert ? Math.max(...a) : Math.min(...a) };
}

test('the plain-English bands encode the AUTHOR\'s own thresholds, dim for dim', () => {
  // His captions, live off his code — same source the deep-equal runs.
  const raw = runOracle(EM, { view: 'scoreboard', period: 'week', site: 'ALL' });
  const hisTips = raw.sbRows[0].cells.map((c) => c.tip);
  assert.strictEqual(hisTips.length, PT_THRESHOLDS.length, 'his dims count moved');

  PT_THRESHOLDS.forEach(([key, , green, amber, invert, , tip], i) => {
    const his = authorBands(hisTips[i], invert);
    const ours_ = plainBands(tip, invert);
    // 1. our columns still equal the numbers HE writes under that dimension …
    assert.deepStrictEqual(his, { green, amber }, `${key}: PT_THRESHOLDS drifted from his band "${hisTips[i]}"`);
    // 2. … and our caption still states those same numbers, so it cannot go
    //    stale against the columns sitting on its own line.
    assert.deepStrictEqual(ours_, { green, amber }, `${key}: caption "${tip}" contradicts its own thresholds`);
  });
});

test('the six band captions are the SDM-approved plain-English wording', () => {
  assert.deepStrictEqual(PT_THRESHOLDS.map(([k, , , , , , tip]) => [k, tip]), [
    ['reviews', 'reviews held — green from 8, amber 5 to 7, red below 5'],
    ['resolution', 'resolved ÷ raised — green from 40%, amber 20 to 39%, red below 20%'],
    ['overdue', 'overdue issues + actions — green if none, amber 1 to 5, red above 5'],
    ['inspections', 'inspections run — green from 3, amber 2, red 1 or none'],
    ['findings', 'critical + major findings — green if none, amber 1 or 2, red from 3'],
    ['signoff', 'minutes fully signed — green from 70%, amber 30 to 69%, red below 30%'],
  ]);
  // No G/A/R shorthand survives anywhere in the six — that was the whole ask.
  for (const [, , , , , , tip] of PT_THRESHOLDS) assert.ok(!/\bG[≥>0-9]/.test(tip), `shorthand left in "${tip}"`);
});

// ── THE EXTRAS ALLOWLIST ──────────────────────────────────────────────────────
// The test above is the proof and it must never move: without extras we emit
// exactly his 61 keys. This one guards the other side of that door — WITH extras
// we add a DECLARED set and nothing else, so a future accidental key addition
// fails loudly here instead of silently polluting his contract.
test('WITH extras, the added keys are exactly the declared allowlist', () => {
  const st = { view: 'dashboard', period: 'week', site: 'ALL' };
  const base = Object.keys(ours(st));
  const withExtras = Object.keys(ours(Object.assign({}, st, {
    extras: { helpdesk: { HGO: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1 } },
              changes: { HGO: { total: 4, successful: 3, failed: 1, executed: 4, emergency: 0, success_pct: 75 } } },
  })));
  assert.deepStrictEqual(withExtras.filter((k) => !base.includes(k)).sort(), ['hdNote', 'hdRows']);
  assert.strictEqual(base.length, 61);
});

// The operational scoreboard rides the SAME extras path, additively. With BOTH
// helpdesk and scoreboard extras, the added keys extend to exactly four — the
// two helpdesk keys plus the two scoreboard keys — and nothing else. Guards the
// allowlist so a future accidental key fails loudly here.
test('WITH scoreboard extras, the added keys are exactly [hdNote, hdRows, sbuNote, sbuRows]', () => {
  const { buildSiteScoreboard } = require('../services/siteScoreboard');
  const st = { view: 'dashboard', period: 'week', site: 'ALL' };
  const base = Object.keys(ours(st));
  const withExtras = Object.keys(ours(Object.assign({}, st, {
    extras: {
      helpdesk: { HGO: { created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1 } },
      changes: {},
      scoreboard: buildSiteScoreboard(
        [{ code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 }], {}),
    },
  })));
  assert.deepStrictEqual(withExtras.filter((k) => !base.includes(k)).sort(),
    ['hdNote', 'hdRows', 'sbuNote', 'sbuRows']);
  assert.strictEqual(base.length, 61);
});

// The whole surface, not one screen: every view × period × site combination the
// controls can reach. `period` drives windows() (4 different cur/prev windows),
// `site` drives filterSite (rescoping every panel), `view` drives the isX flags.
// 72 combos, each a full 61-key deep-equal against his own code.
for (const view of VIEWS) {
  for (const period of PERIODS) {
    for (const site of SITES) {
      test(`61-key deep-equal: ${view} · ${period} · ${site}`, () => {
        assert.deepStrictEqual(ours({ view, period, site }), oracle({ view, period, site }));
      });
    }
  }
}

// ── per-panel pins ────────────────────────────────────────────────────────────
// The deep-equal above subsumes these. They are kept deliberately: a deep-equal
// failure says "objects differ" somewhere in a 61-key tree; these name the panel
// and carry the reviewer-confirmed numbers as readable documentation of what the
// team actually sees on screen.

test('scalars match the reviewer-confirmed run of his code', () => {
  const P = ours({ view: 'dashboard', period: 'week', site: 'ALL' });
  assert.strictEqual(P.sbAvg, 43);
  assert.strictEqual(P.dqScore, 0);
  assert.strictEqual(P.backlogNow, 80);
  assert.strictEqual(P.overdueCount, 26);
  assert.strictEqual(P.nIssues, EM.issues.length);
  assert.strictEqual(P.nMeetings, EM.meetings.length);
  assert.strictEqual(P.nInspections, EM.inspections.length);
});

test('leaderboard is RANK-sorted desc, not codes order', () => {
  const P = ours({ view: 'dashboard', period: 'week', site: 'ALL' });
  // SGO precedes MGO — a row-indexed assertion copied from the 3A/3B-1 per-site
  // tables (which are in codes order) would FAIL here. This panel sorts.
  assert.deepStrictEqual(P.leaderboard.map((r) => `${r.code} ${r.score} ${r.rag}`),
    ['SML 62 AMBER', 'SMI 58 AMBER', 'HGO 48 RED', 'SGO 44 RED', 'MGO 41 RED']);
});

test('sbRows is rank-sorted, SML/MGO tie at 50 broken by codes order', () => {
  const P = ours({ view: 'scoreboard', period: 'week', site: 'ALL' });
  // SML before MGO: both score 50, and sbSorted's sort is STABLE — so the tie
  // resolves to whichever comes first in `codes`. This is why his codes order is
  // load-bearing rather than incidental. Sorting `codes` flips this row.
  assert.deepStrictEqual(P.sbRows.map((r) => `${r.code} ${r.score}`),
    ['HGO 58', 'SML 50', 'MGO 50', 'SMI 42', 'SGO 17']);
  assert.deepStrictEqual(P.sbRows.map((r) => r.rank), [1, 2, 3, 4, 5]);
});

test('eMatrix and inspSiteRows rows are in CODES order, not rank order', () => {
  const P = ours({ view: 'scoreboard', period: 'week', site: 'ALL' });
  // These two iterate `codes` directly (:297, :344) — their row order IS codes
  // order. Different from the panels above; both are pinned on purpose.
  // Both label rows 'Name · CODE' rather than carrying a bare code.
  const EXP = ['Lafigué · SML', 'Ity · SMI', 'Houndé · HGO', 'Mana · MGO', 'Sabodala-Massawa · SGO'];
  assert.deepStrictEqual(P.eMatrix.map((r) => r.site), EXP);
  assert.deepStrictEqual(P.inspSiteRows.map((r) => r.site), EXP);
});

test('gapRows and sbMoves inherit sbSorted order', () => {
  const P = ours({ view: 'scoreboard', period: 'week', site: 'ALL' });
  assert.deepStrictEqual(P.gapRows.map((r) => r.code), ['HGO', 'SML', 'MGO', 'SMI', 'SGO']);
  assert.deepStrictEqual(P.sbMoves.map((r) => r.code), ['HGO', 'SML', 'MGO', 'SMI', 'SGO']);
});

test('no bubble coordinate is NaN', () => {
  const P = ours({ view: 'scoreboard', period: 'week', site: 'ALL' });
  assert.strictEqual(P.emBubbles.length, 5);
  for (const b of P.emBubbles) {
    for (const k of ['x', 'y', 'r', 'lx', 'ly']) {
      assert.ok(!String(b[k]).includes('NaN'), `emBubbles ${b.label}.${k} = ${b[k]}`);
    }
  }
});

test('the 8 KPI tiles match his labels and values', () => {
  const O = oracle({ view: 'dashboard', period: 'week', site: 'ALL' });
  const P = ours({ view: 'dashboard', period: 'week', site: 'ALL' });
  assert.strictEqual(P.kpis.length, 8);
  assert.deepStrictEqual(P.kpis.map((k) => `${k.label}=${k.value}`), O.kpis.map((k) => `${k.label}=${k.value}`));
});

// Each remaining panel, named, so a regression points at the panel rather than at
// a 61-key tree. Same oracle, compared array-for-array.
for (const panel of ['groupRows', 'flowMonths', 'eMatrix', 'eHeaders', 'sigFunnel', 'aging',
  'champLoad', 'overdueRows', 'inspSiteRows', 'findCats', 'pipeline', 'dqItems',
  'sbMoves', 'gapRows', 'emBubbles', 'briefKpis', 'briefSites', 'sbRows', 'sbDimHeaders',
  'gapLegend', 'viewOpts', 'periodOpts', 'siteOpts', 'leaderboard', 'kpis']) {
  test(`panel ${panel} matches his output exactly`, () => {
    const st = { view: 'dashboard', period: 'week', site: 'ALL' };
    assert.deepStrictEqual(ours(st)[panel], oracle(st)[panel]);
  });
}
