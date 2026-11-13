'use strict';
// D2 (P10) — Value scoreboard, pure half: unknown ≠ 0 for every un-instrumented metric, perimeter filtering of site
// rows, before / after comparison keyed on config-change events.
const test = require('node:test');
const assert = require('node:assert');
const V = require('../services/valueScoreboard');

test('every metric with no reading is UNKNOWN (null) with a reason — never 0', () => {
  const b = V.assemble({ why: { report: 'no weekly report in the last 90 days' } });
  assert.ok(b.metrics.length >= 11);
  for (const m of b.metrics) {
    assert.strictEqual(m.value, null, m.key);
    assert.strictEqual(m.state, 'UNKNOWN', m.key);
    assert.ok(m.missing && m.missing.length > 3, `${m.key} carries a reason`);
  }
  assert.strictEqual(b.metrics.find((m) => m.key === 'report_on_time_pct').missing, 'no weekly report in the last 90 days');
  for (const k of ['report_on_time_pct', 'action_median_age_days', 'action_overdue_pct', 'asset_cost_coverage_pct', 'repeat_finding_rate', 'decision_cycle_days', 'plans_updated_30d_pct', 'wau', 'csat_pct', 'sla_credits_recovered_usd'])
    assert.ok(b.metrics.some((m) => m.key === k), k);
});

test('a report reading with no on-time rule keeps on-time UNKNOWN (the rule is a human decision)', () => {
  const b = V.assemble({ report: { reports: 4, on_time_pct: null, on_time_den: 0, median_minutes: 35, timed: 3, by_site: [] } });
  const ot = b.metrics.find((m) => m.key === 'report_on_time_pct');
  assert.strictEqual(ot.value, null); assert.match(ot.missing, /weekly_report_due_days/);
  assert.strictEqual(b.metrics.find((m) => m.key === 'report_median_minutes').value, 35);
});

test('actions: median age + % overdue, site rows only for the allowed perimeter', () => {
  const rows = [
    { site_id: 1, site_name: 'A', open: true, created_at: '2026-11-03T00:00:00Z', due: '2026-11-10' },
    { site_id: 1, site_name: 'A', open: true, created_at: '2026-11-11T00:00:00Z', due: '2026-12-01' },
    { site_id: 2, site_name: 'B', open: true, created_at: '2026-10-14T00:00:00Z', due: null },
    { site_id: 2, site_name: 'B', open: false, created_at: '2026-01-01T00:00:00Z', due: '2026-01-02' },
  ];
  const all = V.actionMetrics(rows, { today: '2026-11-13' });
  assert.deepStrictEqual([all.open, all.median_age_days, all.overdue_pct, all.with_due], [3, 10, 50, 2]);
  const mine = V.actionMetrics(rows, { today: '2026-11-13', allowed: [1] });
  assert.deepStrictEqual(mine.by_site.map((s) => s.site_id), [1], 'site B never appears for a site-A reader');
  assert.strictEqual(mine.open, 2);
  const none = V.actionMetrics(rows, { today: '2026-11-13', allowed: [] });
  assert.deepStrictEqual([none.open, none.median_age_days, none.overdue_pct], [0, null, null], 'no perimeter = unknown, not 0');
});

test('csat / plans / claims / wau helpers keep null when there is nothing to measure', () => {
  assert.deepStrictEqual(V.csat([]), { n: 0, value: null });
  assert.strictEqual(V.csat([90, 70, 85, 40]).value, 50);
  assert.strictEqual(V.planFreshShare([{ plan_updated_days: null }]).value, null);
  assert.strictEqual(V.planFreshShare([{ plan_updated_days: 3 }, { plan_updated_days: 45 }]).value, 50);
  assert.deepStrictEqual(V.claimsValue([]), { claims: 0, usd: null });
  assert.strictEqual(V.claimsValue([{ claims: 2, usd_indicative: null }]).usd, null, 'a currency without a rate → no USD figure');
  assert.deepStrictEqual(V.claimsValue([{ claims: 1, usd_indicative: { due: 10, claimed: 8, recovered: 5 } }, { claims: 1, usd_indicative: { due: 1, claimed: 1, recovered: 1 } }]).usd, { due: 11, claimed: 9, recovered: 6 });
  const w = V.wauByTier([{ actor_id: 1, details: 'admin' }, { actor_id: 1, details: 'admin' }, { actor_id: 2, details: 'editor' }, { actor_id: null }], { tierOf: (d) => d });
  assert.deepStrictEqual(w, { total: 2, by_tier: { admin: 1, editor: 1 } });
});

test('before / after: nearest snapshot before and first after each config change, within the window', () => {
  const ev = [{ id: 7, key: 'ui_home_queue', from: '0', to: '1', ts: '2026-11-10T10:00:00Z' }, { id: 8, key: 'x', from: '0', to: '1', ts: '2026-11-12T00:00:00Z' }];
  const snaps = [
    { id: 1, taken_at: '2026-10-01T00:00:00Z', metrics: { wau: 1 } },   // outside the 30-day window? 40 days → ignored
    { id: 2, taken_at: '2026-11-09T09:00:00Z', metrics: { wau: 10, csat_pct: null } },
    { id: 3, taken_at: '2026-11-11T09:00:00Z', metrics: { wau: 14, csat_pct: 80 } },
  ];
  const [a, b] = V.compareRollouts(ev, snaps, { windowDays: 30 });
  assert.deepStrictEqual([a.before_snapshot, a.after_snapshot, a.state], [2, 3, 'compared']);
  assert.deepStrictEqual(a.deltas.find((d) => d.metric === 'wau'), { metric: 'wau', before: 10, after: 14, delta: 4 });
  assert.deepStrictEqual(a.deltas.find((d) => d.metric === 'csat_pct'), { metric: 'csat_pct', before: null, after: 80, delta: null }, 'unknown before = no delta, never a 0 baseline');
  assert.strictEqual(b.state, 'no snapshot after the change');
  assert.deepStrictEqual(b.deltas, []);
  assert.deepStrictEqual(V.snapshotValues(V.assemble({})).wau, null);
});
