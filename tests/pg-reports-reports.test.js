'use strict';
// Chunk 4C — reports.db report-editor layer → PostgreSQL. TDD suite. Runs the
// postgres backend against a throwaway DB; skips cleanly when Postgres is down.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rrep-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA3 = _fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/003_reports.sql'), 'utf8');

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  // Every report needs a site_id — create one via the forked 4B createSite.
  const site = await rdb.createSite({ name: 'TestSite', zoho_group: 'TestSite IT' });
  return { ctx, rdb, siteId: site.id };
}

test('reports pg: schema idempotent + catalog tables present', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    await rdb.pgHandle().exec(SCHEMA3);   // re-apply → idempotent
    const h = rdb.pgHandle();
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM infra_kpi_catalog').get()).n), 0);
    assert.ok((await h.prepare("SELECT to_regclass('public.weekly_reports') AS t").get()).t, 'weekly_reports exists');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reports pg: week + report header CRUD + status', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r = await rdb.ensureReport(siteId, 2026, 20);
    assert.ok(r.id); assert.equal(r.status, 'draft');
    const again = await rdb.ensureReport(siteId, 2026, 20);
    assert.equal(again.id, r.id, 'idempotent on UNIQUE(site,week)');
    const full = await rdb.getReport(r.id);
    assert.equal(full.site_name, 'TestSite'); assert.ok(full.week_label);
    assert.ok(Array.isArray(full.infra_kpis) && Array.isArray(full.action_items));
    assert.equal((await rdb.listReports(siteId, 2026, 20)).length, 1);
    await rdb.updateReportStatus(r.id, 'submitted', 1);
    assert.equal((await rdb.getReport(r.id)).status, 'submitted');
    assert.ok((await rdb.getReport(r.id)).submitted_at, 'submitted_at stamped');
    await rdb.touchReport(r.id);   // no throw
    await rdb.updateReportStatus(r.id, 'draft', 1);
    assert.equal((await rdb.getReport(r.id)).submitted_at, null, 'revert clears submitted_at');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reports pg: infra/helpdesk/lights/actions save + read + carry-over', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r = await rdb.ensureReport(siteId, 2026, 21);
    await rdb.saveInfraKpis(r.id, [{ service:'Network', kpi:'Availability', target:'99%', status_value:'99.5%', status_color:'green', trend:'up' }]);
    // Save #1 — full payload. JSON round-trip asserted on THIS save.
    await rdb.saveHelpdeskData(r.id, { time_to_assign: 1.5, sla_violations:[{category:'X',pct:10}], group_metrics:[{label:'W21'}], selected_group:'Ops' });
    let full = await rdb.getReport(r.id);
    assert.equal(full.helpdesk.time_to_assign, 1.5);
    assert.deepEqual(full.helpdesk.sla_violations, [{category:'X',pct:10}], 'JSON round-trip');
    // Save #2 — partial. saveHelpdeskData's ON CONFLICT does a FULL-column replace (no COALESCE).
    await rdb.saveHelpdeskData(r.id, { time_to_assign: 2.0, selected_group:'Ops2' });
    await rdb.saveLights(r.id, [{ type:'low_light', content:'L1' }, { type:'high_light', content:'H1' }]);
    await rdb.saveActionItems(r.id, [{ task:'Do X', owner:'Bob', department:'Mining', comment:'note', status:'open' }]);
    full = await rdb.getReport(r.id);
    assert.equal(full.infra_kpis.length, 1);
    assert.equal(full.helpdesk.time_to_assign, 2.0, 'helpdesk upsert replaced');
    assert.equal(full.helpdesk.sla_violations, null, 'full-replace upsert NULLs unset cols');
    assert.equal(full.lights.length, 2);
    assert.equal(full.action_items[0].department, 'Mining');
    // readers
    assert.equal((await rdb.getLightsForReport(r.id)).lights.length, 2);
    assert.equal((await rdb.getActionsForReport(r.id)).actions.length, 1);
    // carry-over from a 2nd report
    const r2 = await rdb.ensureReport(siteId, 2026, 22);
    assert.equal((await rdb.getPreviousWeekOpenActions(siteId, r2.id)).actions.length, 1);
    assert.equal((await rdb.getPreviousWeekInfraKpis(siteId, r2.id)).kpis.length, 1);
    assert.ok((await rdb.listAllWeeksWithActions(siteId, r2.id)).length >= 1);
    assert.ok((await rdb.listAllWeeksWithLights(siteId, r2.id)).length >= 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reports pg: deleteReport cascade + getWeekSummaryData', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r = await rdb.ensureReport(siteId, 2026, 23);
    await rdb.saveInfraKpis(r.id, [{ service:'N', kpi:'A' }]);
    await rdb.saveActionItems(r.id, [{ task:'T' }]);
    await rdb.updateReportStatus(r.id, 'submitted', 1);
    const sum = await rdb.getWeekSummaryData(2026, 23);
    assert.equal(sum.reports.length, 1); assert.ok(sum.week_label);
    await rdb.deleteReport(r.id);
    assert.equal(await rdb.getReport(r.id), null);
    const h = rdb.pgHandle();
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM infra_kpis WHERE report_id=?').get(r.id)).n), 0);
    assert.equal(Number((await h.prepare('SELECT COUNT(*) AS n FROM action_items WHERE report_id=?').get(r.id)).n), 0);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('reports pg: monthly edits + annual objectives', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    assert.equal(await rdb.getMonthlyReport(siteId, 2026, 5), null);
    await rdb.saveMonthlyEdits(siteId, 2026, 5, { edited_lights:[{type:'low_light',content:'L'}], edited_actions:[{task:'T'}], notes:'n', status:'draft' });
    // Honest pg check — unforked fns silently hit the sqlite db; assert the row is in PG.
    assert.equal(Number((await rdb.pgHandle().prepare('SELECT COUNT(*) AS n FROM monthly_reports').get()).n), 1, 'wrote to PG');
    const m = await rdb.getMonthlyEdits(siteId, 2026, 5);
    assert.equal(m.source, 'saved'); assert.equal(m.edited_lights.length, 1); assert.equal(m.notes, 'n');
    await rdb.saveMonthlyEdits(siteId, 2026, 5, { status:'finalized' });   // upsert COALESCE keeps lights
    assert.equal((await rdb.getMonthlyReport(siteId, 2026, 5)).status, 'finalized');
    assert.equal((await rdb.getMonthlyEdits(siteId, 2026, 5)).edited_lights.length, 1, 'COALESCE kept lights');
    await rdb.saveAnnualObjectives(siteId, 2026, [{ objective:'O1', target:'T1' }, { objective:'O2' }]);
    const objs = await rdb.getAnnualObjectives(siteId, 2026);
    assert.equal(objs.length, 2); assert.equal(objs[0].objective, 'O1');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
