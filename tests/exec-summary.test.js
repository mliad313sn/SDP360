'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deriveSiteStatus, buildExecSummary } = require('../services/execSummary');

// input: array of { site, open_incidents, has_active_mi, overdue_open }
test('deriveSiteStatus: active MI → major (highest)', () => {
  const out = deriveSiteStatus([{ site: 'LAFIGUE', open_incidents: 3, has_active_mi: true, overdue_open: 1 }]);
  assert.equal(out[0].status, 'major');
});
test('deriveSiteStatus: overdue open, no MI → degraded', () => {
  const out = deriveSiteStatus([{ site: 'SABODALA', open_incidents: 2, has_active_mi: false, overdue_open: 1 }]);
  assert.equal(out[0].status, 'degraded');
});
test('deriveSiteStatus: clean → operational and EXCLUDED (exception-only)', () => {
  const out = deriveSiteStatus([{ site: 'MANA', open_incidents: 1, has_active_mi: false, overdue_open: 0 }]);
  assert.equal(out.length, 0);
});
test('deriveSiteStatus: major before degraded, cap 4', () => {
  const rows = [
    { site: 'A', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'B', open_incidents: 1, has_active_mi: true,  overdue_open: 0 }, // major
    { site: 'C', open_incidents: 1, has_active_mi: false, overdue_open: 2 }, // degraded
    { site: 'D', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded
    { site: 'E', open_incidents: 1, has_active_mi: false, overdue_open: 1 }, // degraded (5th → dropped)
  ];
  const out = deriveSiteStatus(rows);
  assert.equal(out.length, 4);
  assert.equal(out[0].status, 'major');       // B first
});

const DEPS = {
  period: '2026-06',
  dataAsOf: '2026-06-25T08:00:00Z',
  helpdesk: {
    requests_resolved: { value: 1236, delta_pct: 8 },
    sla_compliance: { value_pct: 91, delta_pp: 2 },
    avg_resolution_h: { value: 14, delta_h: -3 },
    csat: { value_pct: 88, delta_pp: 4 },
    change_success: { value_pct: 96, delta_pp: 1 },
  },
  spark: { sla: [88,89,91], csat: [84,86,88] },
  siteRows: [
    { site: 'SABODALA', code: 'SGO', name: 'Sabodala', open_incidents: 2, has_active_mi: false, overdue_open: 1 },
    { site: 'MANA', code: 'MGO', name: 'Mana', open_incidents: 1, has_active_mi: false, overdue_open: 0 },
  ],
  activeMajorIncidents: 0,
  upcomingMaintenance: [{ date: '2026-06-26', title: 'SAP Upgrade', window: '22:00–04:00', impact: 'High', scope: 'ITY, Houndé' }],
  strategic: { overall_pct: 72, pillars: [{ name: 'Network & Infrastructure', pct: 82 }] },
  editorial: { highlights: ['2 major projects completed'], focus: [{ title: 'UPS Upgrade – Lafigué', subtitle: 'Power reliability' }] },
};

test('buildExecSummary: status degraded when a site is degraded (SGO)', () => {
  const s = buildExecSummary(DEPS);
  assert.equal(s.status.level, 'degraded');
  assert.equal(s.status.active_major_incidents, 0);
});
test('buildExecSummary: KPIs + strategic passthrough', () => {
  const s = buildExecSummary(DEPS);
  assert.equal(s.kpis.sla_compliance.value_pct, 91);
  assert.equal(s.strategic_progress.overall_pct, 72);
  assert.equal(s.sites_attention.length, 1);           // only SGO (MANA operational, omitted)
  assert.equal(s.all_sites_ok, false);
});
test('buildExecSummary: empty editorial → blocks omitted (null)', () => {
  const s = buildExecSummary({ ...DEPS, editorial: { highlights: [], focus: [] } });
  assert.equal(s.highlights, null);
  assert.equal(s.focus_areas, null);
});
test('buildExecSummary: ANTI-PII — no forbidden keys anywhere in the JSON', () => {
  const s = buildExecSummary(DEPS);
  const blob = JSON.stringify(s).toLowerCase();
  for (const bad of ['subject', 'requester', 'technician', 'request_id', 'udf', 'verbatim', 'email']) {
    assert.ok(!blob.includes(bad), `must not contain "${bad}"`);
  }
});
test('buildExecSummary: all_sites_ok true when no exceptions', () => {
  const s = buildExecSummary({ ...DEPS, siteRows: [{ site:'MANA', open_incidents:1, has_active_mi:false, overdue_open:0 }] });
  assert.equal(s.sites_attention.length, 0);
  assert.equal(s.all_sites_ok, true);
  assert.equal(s.status.level, 'operational');
});
