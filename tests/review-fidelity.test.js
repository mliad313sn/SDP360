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

/** His renderVals(), with the `pick` closures stripped. */
const oracle = (st) => strip(runOracle(EM, st), ['pick']);

/**
 * Our port, with `key` stripped.
 *
 * APPROVED DEVIATION: his option objects carry a `pick` closure binding live
 * setState; ours carries a declarative `key` instead (a pure function cannot
 * hold a component's setState). Comparing pick-stripped vs key-stripped puts
 * both sides on the same footing — every OTHER field of those objects is still
 * compared, and `key` itself is pinned by tests/review-dashboard.test.js.
 */
const ours = (st) => strip(buildReviewVals(EM, Object.assign({ asOf: A }, st)), ['key']);

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

// ── Threshold-drift guard ────────────────────────────────────────────────────
// The deep-equals above prove our 61 keys match his oracle ON HIS FIXTURE — but
// they CANNOT see a threshold that drifts into a gap his data never lands on.
// Proven by injection: changing `reviews` green 8 -> 9 leaves every deep-equal
// combo green (no site in the fixture scores exactly 8), so the port would be
// silently wrong with a fully green suite.
//
// So compare the NUMBERS directly, parsing them out of the author's own caption.
// Those captions are a verbatim port of his text (kept deliberately — the RAG
// legend decodes them instead of rewording them), which is exactly what makes
// them usable as the reference for his thresholds.
//
// Parse the G and A GROUPS — never "the first/last number in the string". The
// red band contributes its own digits (`A1-2 R>=3`), so a naive last-number rule
// reads findings' amber as 3 instead of 2.
test('PT_THRESHOLDS still encode the AUTHOR own bands, dim for dim', () => {
  const { PT_THRESHOLDS } = require('../services/siteScore');
  assert.ok(Array.isArray(PT_THRESHOLDS) && PT_THRESHOLDS.length === 6,
    'PT_THRESHOLDS must be exported for this guard to see it');

  for (const row of PT_THRESHOLDS) {
    const key = row[0], green = row[2], amber = row[3], invert = row[4], tip = String(row[6]);
    const g = tip.match(/G[^0-9]*(\d+)/);                       // G>=8 · G0 · G>=70
    const a = tip.match(/A[^0-9]*(\d+)(?:[^0-9]+(\d+))?/);      // A5-7 · A2 · A1-5
    assert.ok(g && a, key + ': could not parse bands from "' + tip + '"');

    assert.strictEqual(Number(g[1]), green,
      key + ': green threshold drifted from his band "' + tip + '"');

    // The amber boundary that matters is the one TOUCHING red: the low end when
    // more is better (A5-7 -> 5), the high end when less is better (A1-2 -> 2).
    const lo = Number(a[1]);
    const hi = a[2] === undefined ? lo : Number(a[2]);
    assert.strictEqual(invert ? hi : lo, amber,
      key + ': amber threshold drifted from his band "' + tip + '"');
  }
});
