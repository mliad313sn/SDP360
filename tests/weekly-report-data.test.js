'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadWeeklyReportData } = require('../services/weeklyReportData.js');
const aliases = require('../services/scoreboardAliases.js');

// ── stub deps ───────────────────────────────────────────────────────────────
// Every reader is async — under REPORTS_BACKEND/ASSETS_BACKEND=postgres the real
// ones return promises, so the stubs must too or the tests would prove nothing
// about the await discipline.
function makeDeps(over = {}) {
  const calls = { resolve: [], listSites: 0, listReports: [], getReport: [], hygiene: [], effort: 0, lookups: 0};

  const deps = {
    reportsDb: {
      async getSiteIdByModuleCode(module, code) {
        calls.resolve.push([module, code]);
        return 'resolved' in over ? over.resolved : { site_id: 7, name: 'Sabodala', zoho_group: 'SGO IT Agents' };
      },
      async listSites() {
        calls.listSites++;
        return 'sites' in over ? over.sites : [{ id: 7, name: 'Sabodala', zoho_group: 'SGO IT Agents', active: 1, sort_order: 1 }];
      },
      async listReports(site_id, year, week) {
        calls.listReports.push([site_id, year, week]);
        return 'reports' in over ? over.reports : [{ id: 42, status: 'submitted' }];
      },
      async getReport(id) {
        calls.getReport.push(id);
        return 'report' in over ? over.report : {
          id: 42, status: 'submitted', site_name: 'Sabodala',
          year: 2026, week_number: 29,
          week_label: 'W29 · 13–19 Jul 2026', start_date: '2026-07-13', end_date: '2026-07-19',
          infra_kpis: [], helpdesk: {}, lights: [], action_items: [],
        };
      },
    },
    assetsDb: {
      // The real distinct `assets.site` labels. These are DB spellings, NOT the
      // accent-folded lowercase keys of scoreboardAliases.ALIAS.
      async getAssetLookups() {
        calls.lookups++;
        return { sites: over.siteLabels || ['Sabodala', 'MASSAWA'], states: [], product_types: [], manufacturers: [] };
      },
      async getHygieneSummary(filters) {
        calls.hygiene.push(filters);
        const table = over.hygiene || {};
        // ⚠ EXACT key match, deliberately — `_assetWhere` (assets-db.js:116)
        // filters with `a.site = ?`, case-sensitively. A stub that folded the
        // key would accept 'sabodala' and hide the fact that the real query
        // matches nothing against a stored 'Sabodala'. That is how the original
        // ALIAS-inversion bug survived its own test.
        return table[String(filters && filters.site)] || { total: 0, by_kind: {} };
      },
      async getEffortLeaderboard() {
        calls.effort++;
        return { rows: over.effortRows || [], most_improved: null, needs_attention: null };
      },
    },
    aliases,
  };
  return { deps, calls };
}

const WEEK = { year: 2026, week: 29 };

// ── 1 · unresolvable code ───────────────────────────────────────────────────
test('unresolvable site code → skip, and listReports is never called', async () => {
  const { deps, calls } = makeDeps({ resolved: null });
  const r = await loadWeeklyReportData({ siteCode: 'NOPE', ...WEEK, deps });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /meetings module code/i);
  assert.strictEqual(calls.listReports.length, 0);
});

// ── 2 · THE SEVERE TRAP ─────────────────────────────────────────────────────
// listReports does `if (site_id) { sql += ' AND wr.site_id=?' }` in BOTH backends.
// A falsy site_id silently DROPS the filter and returns every site's report for
// the week — one site's report mailed to another site's coordinator, no error.
// A truthy row with no site_id (the {site_id} vs {id} mis-destructure) is exactly
// how that happens, and tests 1 and 3 do not cover it.
test('resolver returns a truthy row with NO site_id → listReports is never called', async () => {
  const { deps, calls } = makeDeps({ resolved: { name: 'Sabodala', zoho_group: 'SGO IT Agents' } });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls.listReports.length, 0, 'a falsy site_id must never reach listReports');
});

// ── 3 · the site_id is forwarded verbatim ───────────────────────────────────
test('resolved site_id is passed to listReports', async () => {
  const { deps, calls } = makeDeps();
  await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(calls.listReports.length, 1);
  assert.deepStrictEqual(calls.listReports[0], [7, 2026, 29]);
});

// ── 4 · no report row ───────────────────────────────────────────────────────
test('no report for the week → skip', async () => {
  const { deps } = makeDeps({ reports: [] });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /no report/i);
});

// ── 5 · ready ───────────────────────────────────────────────────────────────
// The most common real skip: the coordinator filled everything in and never
// clicked Submit. Saying "not submitted" is true and useless — the operator
// must be told the work is DONE and only the click is missing.
test('status "ready" → skip, and the reason must not read merely "not submitted"', async () => {
  const { deps } = makeDeps({ reports: [{ id: 42, status: 'ready' }] });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, false);
  assert.doesNotMatch(r.reason, /not submitted/i);
  assert.match(r.reason, /submit/i);
});

// ── 6 · in_progress / draft ─────────────────────────────────────────────────
for (const status of ['in_progress', 'draft']) {
  test(`status "${status}" → skip, not finished`, async () => {
    const { deps } = makeDeps({ reports: [{ id: 42, status }] });
    const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not finished/i);
  });
}

// ── 7 · submitted ───────────────────────────────────────────────────────────
test('status "submitted" → ok, report is the getReport result, week from its columns', async () => {
  const { deps, calls } = makeDeps();
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.report.id, 42);
  assert.ok(Array.isArray(r.report.action_items), 'the hydrated getReport row, not the listReports header');
  assert.deepStrictEqual(calls.getReport, [42]);
  assert.deepStrictEqual(r.week, {
    year: 2026, week: 29,
    label: 'W29 · 13–19 Jul 2026', start: '2026-07-13', end: '2026-07-19',
  });
});

// ── 8 · inactive site ───────────────────────────────────────────────────────
test('site absent from the active listSites() → skip', async () => {
  const { deps } = makeDeps({ sites: [{ id: 99, name: 'Somewhere else', active: 1 }] });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /inactive/i);
});

// ── 9 · hygiene fold, SGO (Sabodala + Massawa) ──────────────────────────────
// 7 discriminates a SUM from a mean (3.5) and from a single call (3 or 4).
test('hygiene worklist SUMS by_kind across every AP label folding to the code', async () => {
  const { deps, calls } = makeDeps({
    hygiene: {
      'Sabodala': { total: 10, by_kind: { no_owner: 3, ghost: 1 } },
      'MASSAWA': { total: 20, by_kind: { no_owner: 4, ghost: 0 } },
    },
  });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.assets.hygiene.no_owner, 7);
  assert.strictEqual(calls.hygiene.length, 2, 'one call per AP label, not one per code');
});

// ── 10 · hygiene fold, OUA (ouagadougou + ouaga) ────────────────────────────
// A SGO-only test would pass while OUA stayed broken.
test('hygiene fold works for OUA too (ouagadougou + ouaga)', async () => {
  const { deps, calls } = makeDeps({
    resolved: { site_id: 3, name: 'Ouagadougou', zoho_group: 'OUA IT Agents' },
    sites: [{ id: 3, name: 'Ouagadougou', active: 1 }],
    siteLabels: ['Ouagadougou', 'Ouaga', 'Sabodala'],   // real DB spellings; Sabodala must NOT leak in
    hygiene: {
      'Ouagadougou': { total: 5, by_kind: { no_cost: 2, discovered: 1 } },
      'Ouaga':       { total: 6, by_kind: { no_cost: 5, discovered: 0 } },
      'Sabodala':    { total: 99, by_kind: { no_cost: 99 } },
    },
  });
  const r = await loadWeeklyReportData({ siteCode: 'OUA', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.assets.hygiene.no_cost, 7);
  assert.strictEqual(calls.hygiene.length, 2);
});

// ── 11 · zero-count kinds are dropped ───────────────────────────────────────
// A list of zeros trains people to skip the block.
test('zero-count kinds are absent from the worklist, not present as 0', async () => {
  const { deps } = makeDeps({
    hygiene: {
      'Sabodala': { total: 10, by_kind: { no_owner: 3, ghost: 0, no_cost: 0 } },
      'MASSAWA': { total: 20, by_kind: { no_owner: 0, ghost: 0, no_cost: 0 } },
    },
  });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.deepStrictEqual(Object.keys(r.assets.hygiene), ['no_owner']);
  assert.strictEqual('ghost' in r.assets.hygiene, false);
});

// ── 12 · no AP label for the code ───────────────────────────────────────────
test('no AP label maps to the code → assets is null, never a block of zeros', async () => {
  const { deps, calls } = makeDeps({
    resolved: { site_id: 11, name: 'Tanda', zoho_group: 'TDA IT Agents' },
    sites: [{ id: 11, name: 'Tanda', active: 1 }],
  });
  const r = await loadWeeklyReportData({ siteCode: 'TDA', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.assets, null);
  assert.strictEqual(calls.hygiene.length, 0);
});

// ── 13 · effort fold + rank RECOMPUTATION ───────────────────────────────────
// Three distinct codes: with one, rank is trivially 1 and the recomputation is
// never exercised. Raw AP ranks here are 1..4; after folding, SGO's mean is 71
// which places it SECOND — a mean of the raw ranks (1.5) would be meaningless.
test('effort score is folded and rank is recomputed across folded codes', async () => {
  const { deps } = makeDeps({
    effortRows: [
      { site: 'Sabodala', effort_score: 80, baseline_score: 70, delta: 10, rank: 1 },
      { site: 'Hounde',   effort_score: 75, baseline_score: 74, delta: 1,  rank: 2 },
      { site: 'Massawa',  effort_score: 62, baseline_score: 60, delta: 2,  rank: 3 },
      { site: 'Mana',     effort_score: 50, baseline_score: 55, delta: -5, rank: 4 },
    ],
  });
  const r = await loadWeeklyReportData({ siteCode: 'SGO', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  // folded: HGO 75 (rank 1) · SGO round((80+62)/2)=71 (rank 2) · MGO 50 (rank 3)
  assert.strictEqual(r.assets.effort.effort_score, 71);
  assert.strictEqual(r.assets.effort.rank, 2);
  assert.strictEqual('delta' in r.assets.effort, false, 'delta is a ~30-day lookback — it barely moves week to week');
});

// ── 14 · a label that IS the site code ──────────────────────────────────────
// Two label vocabularies exist. The AP export uses mine names ('Sabodala'), but
// the dev assets DB stores site CODES directly ('HGO', 'MGO'). ALIAS has no
// 'hgo' key, so assetLabelToCode('HGO') is null — without the direct
// code comparison this site's worklist silently reads empty.
test('a label that is literally the site code still resolves', async () => {
  const { deps, calls } = makeDeps({
    resolved: { site_id: 5, name: 'Hounde', zoho_group: 'HGO IT Agents' },
    sites: [{ id: 5, name: 'Hounde', active: 1 }],
    siteLabels: ['HGO', 'MGO'],
    hygiene: { 'HGO': { total: 8, by_kind: { no_owner: 2 } } },
  });
  const r = await loadWeeklyReportData({ siteCode: 'HGO', ...WEEK, deps });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.assets.hygiene.no_owner, 2, 'code-as-label must not fall through to null');
  assert.strictEqual(calls.hygiene.length, 1, 'only HGO, never MGO');
});
