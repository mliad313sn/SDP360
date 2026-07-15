'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { siteReportData } = require('../services/siteReport');

const deps = {
  meetingsSummary: async () => ({
    site_code: 'HGO', month_label: 'July 2026', available: true,
    kpis: { pvs_held: 2, pvs_target: 3, open_issues: 4, high_open: 1, resolved: 6, new: 3, escalations: 1, signoff_pct: 80, overdue_actions_count: 2 },
    departments: [{ department: 'Maintenance', status: 'on_track', last_pv: '2026-07-05' }],
  }),
  meetingsActions: async () => [{ description: 'Fix X', owner: 'Jean', target_date: '2026-07-20' }],
  inspectionAggregate: async () => ({ total: 1, findings_critical_major: 0, overall_risk: 'low', overdue: [] }),
  inspectionActions: async () => [{ description: 'Replace UPS', owner: 'Sam', due_date: '2026-07-30' }],
  helpdesk: async () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [{ category: 'Network', count: 12 }], recurring: [] }),
  technicians: async () => [{ name: 'Tech A', assigned: 20, resolved: 18, avg_resolution_h: 6, reopened: 1, current_load: 4 }],
  siteStatus: () => 'degraded',
  prevComposite: async () => 70,
};

test('assembles all six blocks + fm view', async () => {
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, deps);
  assert.strictEqual(r.site_code, 'HGO');
  assert.ok(r.score && typeof r.score.composite === 'number');
  assert.ok(Array.isArray(r.score.two_moves));
  assert.strictEqual(r.meetings.pvs_held, 2);
  assert.strictEqual(r.inspection.inspections_done, 1);
  assert.strictEqual(r.helpdesk.created, 40);
  assert.strictEqual(r.technicians.length, 1);
  assert.ok(Array.isArray(r.recommended));
  assert.strictEqual(r.fm.site_status, 'degraded');
  assert.strictEqual(r.fm.major_incidents, 1);
});

test('a failing reader degrades to an empty block, not a throw', async () => {
  const broken = { ...deps, helpdesk: async () => { throw new Error('db down'); } };
  const r = await siteReportData('HGO', { year: 2026, month: 7, kind: 'weekly' }, broken);
  assert.deepStrictEqual(r.helpdesk, { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] });
  assert.ok(r.score);
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
