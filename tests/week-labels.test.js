'use strict';
// D-03 (AMDEC AM-07) — one week vocabulary on screen, behind report_config ui_week_labels ('legacy' = today).
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../services/weekLabels');
const { buildSiteReportDeps } = require('../services/siteReportDeps');

test('ui_week_labels defaults to legacy (today) and an unknown value reads legacy', () => {
  assert.equal(require('../services/reportConfig').DEFAULTS.ui_week_labels, 'legacy');
  assert.equal(L.normalizeMode(undefined), 'legacy'); assert.equal(L.normalizeMode('Explicit '), 'legacy');
  assert.equal(L.normalizeMode('explicit'), 'explicit');
});

test('ISO chart labels: legacy "W37 2026"; explicit "ISO W37 (7–13 Sep)", across months and years', () => {
  const w = { year: 2026, week: 37, from: '2026-09-07', to: '2026-09-13' };
  assert.equal(L.isoWeekLabel(w, 'legacy'), 'W37 2026');
  assert.equal(L.isoWeekLabel(w, 'explicit'), 'ISO W37 (7–13 Sep)');
  assert.equal(L.isoWeekLabel({ year: 2026, week: 40, from: '2026-09-28', to: '2026-10-04' }, 'explicit'), 'ISO W40 (28 Sep–4 Oct)');
  assert.equal(L.isoWeekLabel({ year: 2026, week: 53, from: '2026-12-28', to: '2027-01-03' }, 'explicit'), 'ISO W53 (28 Dec–3 Jan)');
});

test('Zoho report labels: legacy unchanged; explicit carries the Sun→Sat range', () => {
  assert.equal(L.zohoWeekLabel('W37 2026', '2026-09-13', '2026-09-19', 'legacy'), 'W37 2026');
  assert.equal(L.zohoWeekLabel('W37 2026', '2026-09-13', '2026-09-19', 'explicit'), 'W37 2026 (13–19 Sep)');
  assert.equal(L.zohoWeekLabel('W37 2026', null, null, 'explicit'), 'W37 2026', 'no dates → no invented range');
});

test('the switch reader degrades to legacy on any error', async () => {
  assert.equal(await L.weekLabelMode({ getConfig: async () => { throw new Error('pg down'); } }, null), 'legacy');
  assert.equal(await L.weekLabelMode({ getConfig: async () => ({ ui_week_labels: 'explicit' }) }, null), 'explicit');
});

test('site-report helpdesk weekly chart: one label per mode, so two "W37" never mean two date ranges', async () => {
  const mk = (mode) => buildSiteReportDeps({ weekLabels: mode, meetingsDb: {}, inspectionDb: {}, reportsDb: {
    getSiteIdByModuleCode: async () => ({ site_id: 1 }), listSites: async () => [{ id: 1, name: 'Sabodala' }],
    getSiteHelpdeskWindow: async () => ({ created: 2, resolved: 1, sla_overdue: 0 }) } });
  const legacy = await mk('legacy').helpdeskWeekly('SGO', { year: 2026, month: 9, as_of: '2026-09-13' });
  const explicit = await mk('explicit').helpdeskWeekly('SGO', { year: 2026, month: 9, as_of: '2026-09-13' });
  assert.equal(legacy.at(-1).label, 'W37 2026');
  assert.equal(explicit.at(-1).label, 'ISO W37 (7–13 Sep)');
});
