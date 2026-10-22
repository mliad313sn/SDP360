'use strict';
// Step 3 (SDP-DASH-2.0) — KPI dictionary: ≥ 40 entries, each complete; the dispatch serves a value
// from the existing reader (stubbed here) and never invents one; the conformity formula is shared.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../services/metrics/registry');
const { computeMetric, resolveWindow, FIELD } = require('../services/metrics/dispatch');
const { conformityPct } = require('../services/metrics/formulas');

test('the dictionary holds at least 40 complete, unique KPIs', () => {
  assert.ok(R.METRICS.length >= 40, `got ${R.METRICS.length}`);
  const keys = new Set();
  for (const m of R.METRICS) {
    assert.ok(!keys.has(m.key), 'duplicate ' + m.key); keys.add(m.key);
    for (const f of ['domain', 'en', 'fr', 'formula', 'window', 'owner', 'source', 'unit']) assert.ok(m[f], `${m.key}.${f}`);
    assert.ok(['higher', 'lower', 'neutral'].includes(m.direction), m.key);
    // Sources whose value is computed from the whole record (step 6: survey, engagements, WAN) need no field.
    const WHOLE_RECORD = ['assets_effort', 'survey_month', 'meetings_engagements', 'wan_period'];
    if (m.serve) assert.ok(WHOLE_RECORD.includes(m.serve) || m.key === 'inspections.conformity_pct' || FIELD[m.key], `${m.key} has no field mapping`);
  }
});

test('every RAG policy named by the dictionary exists in kpiRag', () => {
  const rag = require('../public/lib/kpiRag');
  for (const m of R.METRICS) if (m.policy) assert.ok(rag.POLICIES[m.policy], `${m.key} → unknown policy ${m.policy}`);
});

test('conformity: ok ÷ applicable, N/A excluded, null when nothing applicable', () => {
  assert.equal(conformityPct([{ status: 'ok', n: 3 }, { status: 'minor', n: 1 }, { status: 'na', n: 9 }]), 75);
  assert.equal(conformityPct([{ status: 'na', n: 4 }]), null);
  assert.equal(conformityPct(undefined), null);
});

test('window: month, from/to, and bad input', () => {
  assert.deepEqual(resolveWindow({ month: '2026-02' }), { year: 2026, month: 2, from: '2026-02-01', to: '2026-02-28' });
  assert.equal(resolveWindow({ from: '2026-01-01', to: '2026-03-31' }).month, 3);
  assert.ok(resolveWindow({ month: '2026-13' }).error);
  assert.ok(resolveWindow({ from: '2026-03-01', to: '2026-01-01' }).error);
});

const site = { code: 'HGO', site_id: 4 };
const win = resolveWindow({ month: '2026-09' });
const deps = {
  getCalendarMonthlyHelpdesk: async (id, y, m) => (id === 4 && y === 2026 && m === 9 ? { inbound: 50, sla_res_pct: null } : null),
  getSiteHelpdeskWindow: async () => ({ backlog: 7 }),
  getSiteChangesWindow: async () => ({ total: 3, success_pct: 66.7 }),
  getSiteMonthlyMeetingSummary: async (c) => ({ kpis: { pvs_held: c === 'HGO' ? 2 : 0 } }),
  getInspectionAggregate: async (o) => ({ counts: { total: 2 }, findingStatus: [{ status: 'ok', n: 1 }, { status: 'major', n: 1 }], open_actions: 4, site: o.site }),
  getEffortLeaderboard: async () => ({ rows: [] }),
  effortForSite: () => ({ score: 61 }),
};

test('dispatch reads the existing reader and keeps null as null', async () => {
  const v = k => computeMetric(k, { site, window: win }, deps);
  assert.equal((await v('helpdesk.inbound')).value, 50);
  const sla = await v('helpdesk.sla_res_pct');
  assert.equal(sla.value, null); assert.equal(sla.measured, false); assert.equal(sla.policy, 'sla_pct');
  assert.equal((await v('helpdesk.backlog')).value, 7);
  assert.equal((await v('changes.success_pct')).value, 66.7);
  assert.equal((await v('meetings.pvs_held')).value, 2);
  assert.equal((await v('inspections.conformity_pct')).value, 50);
  assert.equal((await v('inspections.done')).value, 2);
  assert.equal((await v('inspections.open_actions')).value, 4);
  assert.equal((await v('assets.effort_score')).value, 61);
  assert.equal((await v('score.programme')).status, 422, 'documented-only KPI is not computed here');
  assert.equal((await v('nope')).status, 404);
});
