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

test('siteStatus is major when the site has an active MI', async () => {
  const d = buildSiteReportDeps(mods);
  assert.strictEqual(await d.siteStatus('HGO'), 'major');
});

test('siteStatus is operational when no active MI', async () => {
  const d = buildSiteReportDeps({ ...mods, reportsDb: { ...mods.reportsDb, getActiveMajorIncidentsForSite: () => [] } });
  assert.strictEqual(await d.siteStatus('HGO'), 'operational');
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
