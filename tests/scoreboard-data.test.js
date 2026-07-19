'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadScoreboardData } = require('../services/scoreboardData');

// DI stubs shaped EXACTLY like the real readers (per the pitfall — a mis-shaped
// stub passes while the wiring is wrong). Window-agnostic so the previous-month
// gather returns the same shapes (prev mirrors current, which is fine here).
function makeDeps() {
  const calls = { insights: 0, effort: 0 };
  return {
    calls,
    // reports-db.listSiteModuleCodes('meetings') → rows {code, site_id, name}
    listSiteModuleCodes(module) {
      assert.strictEqual(module, 'meetings');
      return [
        { code: 'HGO', site_id: 2, name: 'Houndé' },
        { code: 'MGO', site_id: 5, name: 'Mana' },
        { code: 'SGO', site_id: 1, name: 'Sabodala' },
      ];
    },
    // getCalendarMonthlyHelpdesk(site_id, year, m) → null (WHOLE object) when no zoho_group
    getCalendarMonthlyHelpdesk(site_id, year, m) {
      if (site_id === 2) return { sla_res_pct: 74, inbound: 10, closed: 9 };
      if (site_id === 5) return { sla_res_pct: 70, inbound: 20, closed: 18 };
      return null; // site 1 (SGO) — no zoho_group
    },
    // meetings-db.insights({from,to}) → { site_leaderboard: [{site, score(0-1|null)}] }
    getMeetingsInsights({ from, to }) {
      calls.insights++;
      assert.ok(from && to, 'insights window present');
      return {
        site_leaderboard: [
          { site: 'HGO', score: 0.60 },
          { site: 'MGO', score: 0.50 },
          { site: 'SGO', score: null },
        ],
      };
    },
    // inspection-db.aggregate({site,from,to}) → { findingStatus: [{status,n}] }
    getInspectionAggregate({ site, from, to }) {
      assert.ok(from && to, 'inspection window present');
      if (site === 'HGO') return { findingStatus: [{ status: 'ok', n: 8 }, { status: 'minor', n: 2 }, { status: 'na', n: 1 }] };
      if (site === 'MGO') return { findingStatus: [] };
      if (site === 'SGO') return { findingStatus: [{ status: 'ok', n: 5 }] };
      return { findingStatus: [] };
    },
    // assets-db.getEffortLeaderboard({asOf}) → { rows:[{site, effort_score, baseline_score, delta, rank}], ... }
    getEffortLeaderboard({ asOf }) {
      calls.effort++;
      assert.ok(asOf, 'effort asOf present');
      return {
        rows: [
          { site: 'HOUNDE', effort_score: 52, baseline_score: 50, delta: 2, rank: 1 },
          { site: 'MASSAWA', effort_score: 40, baseline_score: 38, delta: 2, rank: 3 },
          { site: 'Sabodala', effort_score: 66, baseline_score: 64, delta: 2, rank: 2 },
        ],
        most_improved: null,
        needs_attention: null,
      };
    },
  };
}

test('loadScoreboardData assembles 4 dims per site, null-safe', async () => {
  const deps = makeDeps();
  const result = await loadScoreboardData({ month: { year: 2026, m: 7 }, asOf: '2026-07-31', deps });

  assert.ok(Array.isArray(result.perSite), 'perSite is an array');
  const byCode = Object.fromEntries(result.perSite.map(r => [r.code, r]));

  // Order = listSiteModuleCodes order
  assert.deepStrictEqual(result.perSite.map(r => r.code), ['HGO', 'MGO', 'SGO']);

  assert.deepStrictEqual(byCode.HGO, {
    code: 'HGO', name: 'Houndé', helpdesk: 74, inspections: 80, meetings: 60, assets: 52,
  });
  assert.deepStrictEqual(byCode.MGO, {
    code: 'MGO', name: 'Mana', helpdesk: 70, inspections: null, meetings: 50, assets: null,
  });
  // SGO: helpdesk null-object guarded; meetings score was null → stays null NOT 0;
  //      assets = mean of MASSAWA(40)+Sabodala(66) folded → 53.
  assert.deepStrictEqual(byCode.SGO, {
    code: 'SGO', name: 'Sabodala', helpdesk: null, inspections: 100, meetings: null, assets: 53,
  });
});

test('loadScoreboardData gathers the previous month (prev keyed by code)', async () => {
  const deps = makeDeps();
  const result = await loadScoreboardData({ month: { year: 2026, m: 7 }, asOf: '2026-07-31', deps });

  assert.ok(result.prev && typeof result.prev === 'object', 'prev is an object');
  assert.ok(result.prev.HGO, 'prev keyed by code');
  assert.strictEqual(result.prev.HGO.helpdesk, 74, 'prev has a helpdesk field');
});

test('loadScoreboardData fetches effort + insights ONCE per window (not per site)', async () => {
  const deps = makeDeps();
  await loadScoreboardData({ month: { year: 2026, m: 7 }, asOf: '2026-07-31', deps });
  // 2 windows (current + prev) × 1 call each = 2, NOT 6 (per-site).
  assert.strictEqual(deps.calls.insights, 2, 'insights once per window');
  assert.strictEqual(deps.calls.effort, 2, 'effort once per window');
});

test('loadScoreboardData exposes month + window', async () => {
  const deps = makeDeps();
  const result = await loadScoreboardData({ month: { year: 2026, m: 7 }, asOf: '2026-07-31', deps });
  assert.deepStrictEqual(result.month, { year: 2026, m: 7 });
  assert.deepStrictEqual(result.window, { from: '2026-07-01', to: '2026-07-31' });
});

test('loadScoreboardData does not throw when readers return null/empty', async () => {
  const deps = {
    listSiteModuleCodes: () => [{ code: 'ZZZ', site_id: 99, name: 'Empty' }],
    getCalendarMonthlyHelpdesk: () => null,
    getMeetingsInsights: () => ({ site_leaderboard: [] }),
    getInspectionAggregate: () => ({ findingStatus: [] }),
    getEffortLeaderboard: () => ({ rows: [] }),
  };
  const result = await loadScoreboardData({ month: { year: 2026, m: 1 }, asOf: '2026-01-31', deps });
  assert.deepStrictEqual(result.perSite[0], {
    code: 'ZZZ', name: 'Empty', helpdesk: null, inspections: null, meetings: null, assets: null,
  });
  // Jan → prev month is Dec of previous year.
  assert.deepStrictEqual(result.window, { from: '2026-01-01', to: '2026-01-31' });
});
