'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { siteReportData } = require('../services/siteReport');

const WIN = { from: '2026-04-14', to: '2026-07-14' };

const deps = {
  meetingsSummary: async () => ({
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1, signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'Maintenance', status: 'on_track', last_pv: '2026-07-05' }],
  }),
  meetingsActions: async () => [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }],
  // adapted shape (siteReportAdapters.adaptInspectionAggregate), period-scoped
  inspectionAggregate: async (code, period) => ({ inspections_done: 1, findings_critical_major: 0, overall_risk: 'low' }),
  inspectionActions: async () => [{ description: 'Replace UPS', owner: 'Sam', due_date: '2026-07-30' }],
  helpdesk: async () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [] }),
  technicians: async () => [{ name: 'Tech A', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4 }],
  siteStatus: () => 'degraded',
  // The score comes from its OWN 3-month-rolling reader now — NOT derived from
  // the meetings/inspection blocks above (which stay monthly narrative content).
  // 8→2 · 50→2 · 2→1 · 3→2 · 0→2 · 80→2 = 11/12 → 92, GREEN.
  scoreInputs: async () => ({ window: { ...WIN }, inputs: { reviews: 8, resolution: 50, overdue: 2, inspections: 3, findings: 0, signoff: 80 } }),
  prevScore: async () => 58,
};

test('assembles all six blocks + fm view', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.site_code, 'HGO');
  assert.strictEqual(r.score.score, 92);
  assert.strictEqual(r.score.points, 11);
  assert.strictEqual(r.score.rag, 'GREEN');            // UPPERCASE — the sbDims contract
  assert.strictEqual(r.score.trend_pts, 34);           // 92 − 58
  assert.strictEqual(r.score.dims.length, 6);
  assert.strictEqual(r.score.moves.length, 2);
  assert.deepStrictEqual(r.score.window, WIN);         // the score states its own window
  assert.strictEqual(r.meetings.pvs_held, 2);
  assert.strictEqual(r.inspection.inspections_done, 1);
  assert.strictEqual(r.helpdesk.created, 40);
  assert.strictEqual(r.technicians.length, 1);
  assert.ok(Array.isArray(r.recommended));
  assert.strictEqual(r.fm.site_status, 'degraded');
  assert.strictEqual(r.fm.major_incidents, 1);
});

test('dims carry the raw value, its display string and a 0/1/2 rating', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  const byKey = Object.fromEntries(r.score.dims.map(d => [d.key, d]));
  assert.deepStrictEqual(Object.keys(byKey), ['reviews', 'resolution', 'overdue', 'inspections', 'findings', 'signoff']);
  assert.strictEqual(byKey.resolution.val, 50);
  assert.strictEqual(byKey.resolution.disp, '50%');
  assert.strictEqual(byKey.overdue.pts, 1);
  assert.ok(byKey.overdue.tip);
});

// THE contract change: the score is no longer derived from the monthly
// meetings/inspection blocks. Zeroing those must not move it.
test('the score comes from scoreInputs, not from the meetings/inspection blocks', async () => {
  const barren = { ...deps,
    meetingsSummary: async () => ({ site_code: 'HGO', month_label: 'July 2026', kpis: {}, departments: [] }),
    inspectionAggregate: async () => ({ inspections_done: 0, findings_critical_major: 0, overall_risk: '—' }),
  };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, barren);
  assert.strictEqual(r.score.score, 92);
  assert.strictEqual(r.meetings.pvs_held, 0);
});

test('no previous window → trend_pts null, not a fabricated 0', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, { ...deps, prevScore: async () => null });
  assert.strictEqual(r.score.trend_pts, null);
});

test('a failing reader degrades to an empty block, not a throw', async () => {
  const broken = { ...deps, helpdesk: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.deepStrictEqual(r.helpdesk, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] });
  assert.ok(r.score);
});

test('a failing scoreInputs degrades to a zeroed score, not a throw', async () => {
  const broken = { ...deps, scoreInputs: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  // all six dims at 0 → overdue/findings invert to 2 pts each = 4/12 → 33
  assert.strictEqual(r.score.score, 33);
  assert.strictEqual(r.score.rag, 'RED');
  assert.strictEqual(r.score.window, null);
  assert.strictEqual(r.score.dims.length, 6);
});

test('technicians get deterministic alerts', async () => {
  const overloaded = { ...deps, technicians: async () => [
    { name: 'Busy', assigned: 30, resolved: 12, avg_resolution_h: 9, reopened: 0, current_load: 20 },
    { name: 'Norm', assigned: 10, resolved: 9, avg_resolution_h: 5, reopened: 0, current_load: 4 },
  ] };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, overloaded);
  const busy = r.technicians.find(t => t.name === 'Busy');
  assert.ok(busy.alerts.includes('overloaded') || busy.alerts.includes('low_closure'));
});
