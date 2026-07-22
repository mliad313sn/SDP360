'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSiteReportDeps, _asOfFor } = require('../services/siteReportDeps');

// meetings/inspection getSiteScoreInputs return the RAW measured values over the
// window they are handed — the deps map them onto the six sbDims inputs.
const mScore = { reviews: 8, raised: 10, resolved: 5, resolution: 50, signed: 4, signoff: 80, overdue: 2 };
const iScore = { inspections: 3, findings: 0 };

const mods = {
  reportsDb: {
    getSiteIdByModuleCode: () => ({ site_id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }),
    getSiteHelpdeskMonthly: () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [], recurring: [] }),
    getSiteTechnicianStats: () => [{ name: 'A', assigned: 3, resolved: 3, current_load: 0, sla_overdue: 0, reopened: 0, avg_resolution_h: 2 }],
    listSites: () => [{ id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }],
    getActiveMajorIncidentsForSite: () => [{ request_id: '1' }],
    getSiteChangesWindow: () => ({ buckets: {}, successful: 1, failed: 0, cancelled: 0, deferred: 0,
                                   pending: 0, executed: 1, total: 1, emergency: 0, success_pct: 100 }),
  },
  meetingsDb: {
    getSiteMonthlyMeetingSummary: () => ({ site_code: 'HGO', kpis: { pvs_held: 1, dept_target: 3 }, departments: [] }),
    listActions: () => [],
    getSiteScoreInputs: () => ({ ...mScore }),
  },
  inspectionDb: {
    aggregate: () => ({ counts: { total: 1 }, findingStatus: [] }),
    listActions: () => [],
    getSiteScoreInputs: () => ({ ...iScore }),
  },
};

// Records the (code, from, to) each reader was called with, so the window the
// deps derive is asserted at the reader boundary rather than inferred.
function spying(over) {
  const seen = { meetings: [], inspection: [] };
  const d = buildSiteReportDeps({
    ...mods,
    meetingsDb: { ...mods.meetingsDb, getSiteScoreInputs: (c, from, to) => { seen.meetings.push([c, from, to]); return { ...mScore, ...(over && over.m) }; } },
    inspectionDb: { ...mods.inspectionDb, getSiteScoreInputs: (c, from, to) => { seen.inspection.push([c, from, to]); return { ...iScore, ...(over && over.i) }; } },
  });
  return { d, seen };
}

test('helpdesk dep resolves the code to a site_id and returns the contract block', async () => {
  const d = buildSiteReportDeps(mods);
  const hd = await d.helpdesk('HGO', { year: 2026, month: 7 });
  assert.strictEqual(hd.created, 40);
});

test('unknown site code → null (siteReport._safe turns it into the zeroed block)', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getSiteIdByModuleCode: () => null } });
  const hd = await d.helpdesk('NOPE', { year: 2026, month: 7 });
  assert.strictEqual(hd, null);   // the dep returns null; _safe substitutes EMPTY.helpdesk
});

// ── the changes dep ─────────────────────────────────────────────────────────
// The reader takes a site_id and resolves the group ITSELF. Passing s.zoho_group
// here would hand a group string where an id belongs → the reader's
// `SELECT zoho_group FROM sites WHERE id=?` matches nothing → an all-zero block
// with NO error, which siteReport._safe then swallows. That is verbatim the
// CLAUDE.md pitfall "a binder that looks wired can silently read zeros", so the
// argument is asserted at the reader boundary rather than inferred from output.
test('changes dep passes the site_id and the report MONTH bounds', async () => {
  const seen = [];
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb,
    getSiteChangesWindow: (site_id, from, to) => { seen.push([site_id, from, to]); return { total: 1, success_pct: 100 }; } } });
  const c = await d.changes('HGO', { year: 2026, month: 7 });
  assert.strictEqual(c.total, 1);
  assert.deepStrictEqual(seen[0], [3, '2026-07-01', '2026-07-31']);   // site_id — NOT the zoho_group
});

test('changes dep: February is month-length aware, not a hardcoded 30/31', async () => {
  const seen = [];
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb,
    getSiteChangesWindow: (site_id, from, to) => { seen.push([site_id, from, to]); return {}; } } });
  await d.changes('HGO', { year: 2026, month: 2 });
  assert.deepStrictEqual(seen[0], [3, '2026-02-01', '2026-02-28']);
});

test('changes dep: unknown site code → null (_safe substitutes EMPTY.changes)', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getSiteIdByModuleCode: () => null } });
  assert.strictEqual(await d.changes('NOPE', { year: 2026, month: 7 }), null);
});

// ── the major-incident detail dep ───────────────────────────────────────────
test('majorIncidents dep resolves the groups and returns the open list', async () => {
  const seen = [];
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb,
    getActiveMajorIncidentsForSite: (groups) => { seen.push(groups); return [{ display_id: '1' }]; } } });
  const mi = await d.majorIncidents('HGO');
  assert.strictEqual(mi.length, 1);
  assert.deepStrictEqual(seen[0], ['Hounde IT Agents', 'Extra Grp']);   // comma-split + trimmed
});

test('majorIncidents dep: no zoho_group → empty list, never a throw', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb,
    getSiteIdByModuleCode: () => ({ site_id: 9, name: 'X', zoho_group: '' }) } });
  assert.deepStrictEqual(await d.majorIncidents('X'), []);
});

test('siteStatus is major when the site has an active MI', async () => {
  const d = buildSiteReportDeps(mods);
  assert.strictEqual(await d.siteStatus('HGO'), 'major');
});

test('siteStatus is operational when no active MI', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getActiveMajorIncidentsForSite: () => [] } });
  assert.strictEqual(await d.siteStatus('HGO'), 'operational');
});

// ── the asset-effort dep (Task 1) ────────────────────────────────────────────
// assetEffort(code) folds the FLEET effort leaderboard by code + re-ranks via the
// shared, synchronous effortForSite. The leaderboard is the same for every site
// (getEffortLeaderboard takes no site filter), so it is fetched ONCE per deps
// object and memoised in the closure — a batch send reusing one deps object must
// not refetch it per site.
test('assetEffort folds+ranks the fleet leaderboard, fetched ONCE and memoised', async () => {
  let boardCalls = 0;
  const board = { rows: [
    { site: 'Hounde', effort_score: 80, delta: 3 },
    { site: 'Sabodala', effort_score: 71, delta: 5 },   // Sabodala + MASSAWA
    { site: 'MASSAWA', effort_score: 71, delta: 9 },     //   both fold to SGO
    { site: 'Mana', effort_score: 60, delta: -2 },
  ] };
  const d = buildSiteReportDeps({ ...mods,
    assetsDb: { getEffortLeaderboard: async () => { boardCalls++; return board; } } });

  const sgo = await d.assetEffort('SGO');
  // SGO = mean(71,71)=71, ranks 2nd of 3 folded codes (HGO 80 > SGO 71 > MGO 60).
  // delta = the first Sabodala/MASSAWA row folding to SGO (5), never a mean.
  assert.deepStrictEqual(sgo, { score: 71, rank: 2, of: 3, delta: 5 });

  const hgo = await d.assetEffort('HGO');
  assert.strictEqual(hgo.rank, 1);
  assert.strictEqual(boardCalls, 1, 'the fleet leaderboard is fetched once, not per site');
});

test('assetEffort → null for a code with no AP label / no effort history', async () => {
  const d = buildSiteReportDeps({ ...mods,
    assetsDb: { getEffortLeaderboard: async () => ({ rows: [{ site: 'Hounde', effort_score: 80, delta: 1 }] }) } });
  assert.strictEqual(await d.assetEffort('KGO'), null);   // Kalana absent from the board
});

// ── the asset-hygiene dep ────────────────────────────────────────────────────
// assetHygiene(code) answers "which of this site's assets are out of compliance"
// so the report can be ACTED on. Same fold rule as assetEffort: real labels from
// getAssetLookups(), folded FORWARD through assetLabelToCode — never ALIAS
// inverted, whose folded keys match zero rows and read as a spotless site.
test('assetHygiene sums by_kind across EVERY label folding to the code', async () => {
  let lookupCalls = 0;
  const perLabel = {
    Sabodala: { by_kind: { no_owner: 4, ghost: 1, no_cost: 0 } },
    MASSAWA:  { by_kind: { no_owner: 3, never_scanned: 2 } },
  };
  const d = buildSiteReportDeps({ ...mods, assetsDb: {
    getAssetLookups: async () => { lookupCalls++; return { sites: ['Sabodala', 'MASSAWA', 'Hounde'] }; },
    getHygieneSummary: async ({ site }) => perLabel[site] || { by_kind: {} },
  } });

  const sgo = await d.assetHygiene('SGO');
  assert.deepStrictEqual(sgo.labels.sort(), ['MASSAWA', 'Sabodala']);
  // Summed across both labels; the ZERO kind is dropped, not shown as 0 — a
  // block of zeros trains the reader to skip the section.
  assert.deepStrictEqual(sgo.by_kind, { no_owner: 7, ghost: 1, never_scanned: 2 });

  await d.assetHygiene('HGO');
  assert.strictEqual(lookupCalls, 1, 'the fleet label list is fetched once, not per site');
});

test('assetHygiene → null when the code maps to no AP label (never zeros)', async () => {
  const d = buildSiteReportDeps({ ...mods, assetsDb: {
    getAssetLookups: async () => ({ sites: ['Sabodala', 'Hounde'] }),
    getHygieneSummary: async () => ({ by_kind: { no_owner: 9 } }),
  } });
  // null, NOT {by_kind:{}} — "no inventory attached" and "inventory is clean"
  // are different statements and the renderer prints a different sentence for each.
  assert.strictEqual(await d.assetHygiene('KGO'), null);
});

test('assetHygiene resolves a label that is literally the site code', async () => {
  const d = buildSiteReportDeps({ ...mods, assetsDb: {
    getAssetLookups: async () => ({ sites: ['MGO', 'Sabodala'] }),   // AP stores the code itself
    getHygieneSummary: async ({ site }) => ({ by_kind: site === 'MGO' ? { no_age: 5 } : {} }),
  } });
  assert.deepStrictEqual((await d.assetHygiene('MGO')).by_kind, { no_age: 5 });
});

// ── _asOfFor — the report's as-of date. The clock is injected: an internal
// new Date() would make the MTD branch untestable and rot the test daily.
test('_asOfFor: a closed month scores as-of that month\'s last day', () => {
  assert.strictEqual(_asOfFor({ year: 2026, month: 6 }, new Date(2026, 6, 15)), '2026-06-30');
});

test('_asOfFor: a still-running month scores as-of today, never a future date', () => {
  assert.strictEqual(_asOfFor({ year: 2026, month: 7 }, new Date(2026, 6, 14)), '2026-07-14');
});

test('_asOfFor: the last day of a running month is the month end, not tomorrow', () => {
  assert.strictEqual(_asOfFor({ year: 2026, month: 7 }, new Date(2026, 6, 31)), '2026-07-31');
});

// ── scoreInputs — the 3-month rolling window + the six-dim mapping (+ `raised`).
//
// `raised` rides along with the six SCORED dimensions but is NEVER scored: it is
// `resolution`'s denominator (resolution = resolved ÷ raised). Without it the
// applicability gate in siteScore.js cannot tell "0% of 4 issues resolved" (a real
// measurement, and a bad one) from "no issues at all" (nothing measured) — and it
// would call a genuinely bad site "non applicable" on its own report. It is an
// applicability signal only: it never appears in `dims` and never moves the score.
test('scoreInputs windows 3 months back from as_of and maps the six sbDims dimensions + the raised applicability signal', async () => {
  const { d, seen } = spying();
  const si = await d.scoreInputs('HGO', { year: 2026, month: 7, as_of: '2026-07-14' });
  assert.deepStrictEqual(si.window, { from: '2026-04-14', to: '2026-07-14' });
  assert.deepStrictEqual(si.inputs, { reviews: 8, raised: 10, resolution: 50, overdue: 2, inspections: 3, findings: 0, signoff: 80 });
  // both readers measure the SAME window
  assert.deepStrictEqual(seen.meetings[0], ['HGO', '2026-04-14', '2026-07-14']);
  assert.deepStrictEqual(seen.inspection[0], ['HGO', '2026-04-14', '2026-07-14']);
});

test('scoreInputs falls back to _asOfFor when the period carries no as_of', async () => {
  const { d, seen } = spying();
  await d.scoreInputs('HGO', { year: 2020, month: 2 });   // long closed → the month end, leap-clamped
  assert.deepStrictEqual(seen.meetings[0], ['HGO', '2019-11-29', '2020-02-29']);
});

// ── prevScore — the SAME score recomputed over the previous, non-overlapping
// trailing 3 months, so trend_pts is like-for-like.
test('prevScore scores the previous, non-overlapping 3-month window', async () => {
  const { d, seen } = spying();
  const p = await d.prevScore('HGO', { year: 2026, month: 7, as_of: '2026-07-14' });
  assert.strictEqual(typeof p, 'number');
  // asOf 07-14 → this window {04-14 … 07-14} → prevAsOf 04-13 → {01-13 … 04-13}
  assert.deepStrictEqual(seen.meetings[0], ['HGO', '2026-01-13', '2026-04-13']);
  assert.deepStrictEqual(seen.inspection[0], ['HGO', '2026-01-13', '2026-04-13']);
});

test('prevScore returns the score number of the previous window, not the whole object', async () => {
  const { d } = spying();
  // reviews 8→2, resolution 50→2, overdue 2→1, inspections 3→2, findings 0→2,
  // signoff 80→2 = 11/12 → 92
  assert.strictEqual(await d.prevScore('HGO', { year: 2026, month: 7, as_of: '2026-07-14' }), 92);
});

// REGRESSION GUARD — a site's first quarter must show "no trend", not a
// fabricated one. Zeroed inputs still score (overdue 0 → 2 pts, findings 0 → 2
// pts) so without this gate a never-existed window reads as a confident 33.
test('prevScore → null when nothing happened in the previous window', async () => {
  const { d } = spying({ m: { reviews: 0, raised: 0, resolved: 0, resolution: 0, signoff: 0, overdue: 0 }, i: { inspections: 0, findings: 0 } });
  assert.strictEqual(await d.prevScore('HGO', { year: 2026, month: 7, as_of: '2026-07-14' }), null);
});

test('prevScore scores a window that had activity but no reviews (issues raised only)', async () => {
  const { d } = spying({ m: { reviews: 0, raised: 4, resolved: 0, resolution: 0, signoff: 0, overdue: 0 }, i: { inspections: 0, findings: 0 } });
  assert.strictEqual(typeof await d.prevScore('HGO', { year: 2026, month: 7, as_of: '2026-07-14' }), 'number');
});
