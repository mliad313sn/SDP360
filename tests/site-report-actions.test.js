'use strict';
// SP2 T2 — the openActions deps binder (per-theme open counts via buildSiteActions)
// and siteReportData carrying `actions`.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSiteReportDeps } = require('../services/siteReportDeps');
const { siteReportData } = require('../services/siteReport');

test('openActions binder returns per-theme counts + total (via buildSiteActions)', async () => {
  const recent = new Date().toISOString();
  const deps = buildSiteReportDeps({
    meetingsDb: { listActions: async () => [
      { id: 1, description: 'm-open', status: 'open', created_at: recent, target_date: null },
      { id: 2, description: 'm-closed', status: 'closed', created_at: recent },
    ] },
    inspectionDb: { listActions: async () => [
      { id: 3, description: 'i-open', status: 'Open', created_at: recent },
    ] },
    reportsDb: {
      getSiteIdByModuleCode: async () => ({ site_id: 9, name: 'X', zoho_group: 'G' }),
      getSiteOpenReportActions: async () => ({ actions: [
        { task: 'r1', status: 'open', uid: 'u1', report_id: 5, week_label: 'W1' },
        { task: 'r2', status: 'open', uid: 'u2', report_id: 5, week_label: 'W1' },
      ] }),
    },
  });
  const out = await deps.openActions('HGO', { year: 2026, month: 7 });
  assert.equal(out.meetings.count, 1, 'closed excluded');
  assert.equal(out.inspection.count, 1);
  assert.equal(out.report.count, 2);
  assert.equal(out.total, 4);
});

test('openActions returns null for an unresolved site', async () => {
  const deps = buildSiteReportDeps({
    meetingsDb: { listActions: async () => [] },
    inspectionDb: { listActions: async () => [] },
    reportsDb: { getSiteIdByModuleCode: async () => null, getSiteOpenReportActions: async () => ({ actions: [] }) },
  });
  assert.equal(await deps.openActions('NOPE', { year: 2026, month: 7 }), null);
});

test('siteReportData carries `actions` from deps.openActions; null when the binder is absent', async () => {
  const shape = { meetings: { count: 2, oldest: 30 }, inspection: { count: 0, oldest: null }, report: { count: 1, oldest: null }, total: 3 };
  const withBinder = await siteReportData('HGO', { year: 2026, month: 7 }, { openActions: async () => shape });
  assert.deepEqual(withBinder.actions, shape);
  const noBinder = await siteReportData('HGO', { year: 2026, month: 7 }, {});
  assert.equal(noBinder.actions, null);
});
