'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSiteReportDeps } = require('../services/siteReportDeps');

const mods = {
  reportsDb: {
    getSiteIdByModuleCode: () => ({ site_id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }),
    getSiteHelpdeskMonthly: () => ({ created: 40, resolved: 35, backlog: 5, sla_overdue: 2, major_incidents: 1, top_categories: [], recurring: [] }),
    getSiteTechnicianStats: () => [{ name: 'A', assigned: 3, resolved: 3, current_load: 0, sla_overdue: 0, reopened: 0, avg_resolution_h: 2 }],
    listSites: () => [{ id: 3, name: 'Hounde', zoho_group: 'Hounde IT Agents, Extra Grp' }],
    getActiveMajorIncidentsForSite: () => [{ request_id: '1' }],
  },
  meetingsDb: { getSiteMonthlyMeetingSummary: () => ({ site_code: 'HGO', kpis: { pvs_held: 1, dept_target: 3 }, departments: [] }), listActions: () => [] },
  inspectionDb: { aggregate: () => ({ counts: { total: 1 }, findingStatus: [] }), listActions: () => [] },
};

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

test('prevComposite recomputes the previous month and returns a number', async () => {
  const d = buildSiteReportDeps(mods);
  const p = await d.prevComposite('HGO', { year: 2026, month: 1 });   // rolls to Dec 2025
  assert.strictEqual(typeof p, 'number');
});

// REGRESSION GUARD — uses the shape the REAL reader emits for a site with no
// PVs that month: available:TRUE with zeroed kpis. (A stub returning
// available:false would pass while proving nothing — the real reader only sets
// available:false when siteCode is falsy.) Without the noActivity gate these
// zeros score ~50 and the report shows a trend against a month that never was.
test('prevComposite → null when the previous month had no activity at all', async () => {
  const dead = { ...mods, meetingsDb: { ...mods.meetingsDb,
    getSiteMonthlyMeetingSummary: async () => ({
      site_code: 'HGO', available: true,
      kpis: { pvs_held: 0, dept_target: 3, open_issues: 0, high_open: 0,
              resolved_month: 0, new_month: 0, escalations_open: 0,
              signoff_pct: 0, overdue_actions_count: 0 },
      departments: [],
    }) } };
  const d = buildSiteReportDeps(dead);
  assert.strictEqual(await d.prevComposite('HGO', { year: 2026, month: 7 }), null);
});
