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

// A throwaway sqlite reports.db seeded with the report-editor tables (copy-script source).
function _makeReportsSqliteFixture() {
  const Database = require('better-sqlite3');
  const dir = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'rrep-fix-'));
  const p = _path.join(dir, 'reports.db');
  const db = new Database(p);
  db.exec(`
    CREATE TABLE sites (id INTEGER PRIMARY KEY, name TEXT, zoho_group TEXT, active INTEGER, sort_order INTEGER);
    CREATE TABLE weeks (id INTEGER PRIMARY KEY, year INTEGER, week_number INTEGER, start_date TEXT, end_date TEXT, label TEXT);
    CREATE TABLE weekly_reports (id INTEGER PRIMARY KEY, site_id INTEGER, week_id INTEGER, status TEXT, submitted_at TEXT, submitted_by INTEGER, created_by INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE infra_kpis (id INTEGER PRIMARY KEY, report_id INTEGER, service TEXT, kpi TEXT, target TEXT, status_value TEXT, status_color TEXT, trend TEXT, sort_order INTEGER);
    CREATE TABLE helpdesk_data (id INTEGER PRIMARY KEY, report_id INTEGER, time_to_assign REAL, time_to_assign_prev REAL, first_reply REAL, first_reply_prev REAL, resolution_time REAL, resolution_time_prev REAL, closing_time REAL, closing_time_prev REAL, comments_metrics TEXT, comments_sla TEXT, tech_on_break TEXT, techs_on_duty TEXT, sla_violations TEXT, group_metrics TEXT, all_groups TEXT, selected_group TEXT, chart_data TEXT, fetched_at TEXT, updated_at TEXT);
    CREATE TABLE lights (id INTEGER PRIMARY KEY, report_id INTEGER, type TEXT, content TEXT, sort_order INTEGER);
    CREATE TABLE action_items (id INTEGER PRIMARY KEY, report_id INTEGER, task TEXT, priority TEXT, due_date TEXT, owner TEXT, status TEXT, sort_order INTEGER, department TEXT, comment TEXT);
    CREATE TABLE monthly_reports (id INTEGER PRIMARY KEY, site_id INTEGER, year INTEGER, month INTEGER, edited_lights TEXT, edited_actions TEXT, notes TEXT, status TEXT, updated_at TEXT);
    CREATE TABLE annual_objectives (id INTEGER PRIMARY KEY, site_id INTEGER, year INTEGER, objective TEXT, target TEXT, status TEXT, sort_order INTEGER, updated_at TEXT);
    CREATE TABLE site_module_codes (site_id INTEGER, module TEXT, code TEXT, updated_at TEXT, PRIMARY KEY(site_id,module));
    CREATE TABLE infra_kpi_catalog (id INTEGER PRIMARY KEY, service TEXT, kpi TEXT, target_default TEXT, display_order INTEGER, active INTEGER, created_at TEXT);
  `);
  db.prepare(`INSERT INTO sites VALUES (1,'Hounde','Hounde IT Agents',1,0)`).run();
  db.prepare(`INSERT INTO weeks VALUES (5,2026,20,'2026-05-11','2026-05-17','W20 2026')`).run();
  db.prepare(`INSERT INTO weekly_reports VALUES (3,1,5,'submitted','2026-05-18 09:00:00',1,1,'2026-05-11 00:00:00','2026-05-18 09:00:00')`).run();
  db.prepare(`INSERT INTO infra_kpis VALUES (7,3,'Network','Availability','99%','99.5%','green','up',0)`).run();
  db.prepare(`INSERT INTO helpdesk_data (id,report_id,time_to_assign,selected_group,sla_violations) VALUES (4,3,1.5,'Ops','[{"category":"X"}]')`).run();
  db.prepare(`INSERT INTO lights VALUES (9,3,'low_light','L1',0)`).run();
  db.prepare(`INSERT INTO action_items VALUES (11,3,'Do X','High','2026-05-30','Bob','open',0,'Mining','note')`).run();
  db.prepare(`INSERT INTO monthly_reports VALUES (2,1,2026,5,'[]','[]','n','draft','2026-05-20 00:00:00')`).run();
  db.prepare(`INSERT INTO annual_objectives VALUES (6,1,2026,'O1','T1','in_progress',0,'2026-05-20 00:00:00')`).run();
  db.prepare(`INSERT INTO site_module_codes VALUES (1,'tracker','HGO','2026-05-20 00:00:00')`).run();
  db.prepare(`INSERT INTO infra_kpi_catalog VALUES (8,'Network','Availability','99%',0,1,'2026-05-20 00:00:00')`).run();
  db.close();
  return p;
}

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

// 2026-09-11 — Lafigue W36 showed every Infrastructure KPI twice (WAN1/WAN1/WAN2/WAN2…):
// an autosave and a manual Save raced within the 1.5 s debounce; under READ COMMITTED each
// DELETE saw only the old rows, then both INSERTed. The writers now lock the report row
// (SELECT … FOR UPDATE) so concurrent saves serialise. Reproduced (14/4/4) and fixed (7/2/2)
// against the dev sdp_dashboard PG with the same parallel pattern before this test existed.
test('reports pg: concurrent section saves never double the rows (row lock)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r = await rdb.ensureReport(siteId, 2026, 23);
    const kpis = ['WAN1','WAN2','LAN','WLAN','Servers','Backup','Radio'].map(s => ({ service:s, kpi:'Uptime', target:'98%', status_value:'99%', status_color:'green', trend:'stable' }));
    const lights = [{ type:'low_light', content:'L1' }, { type:'high_light', content:'H1' }];
    const actions = [{ task:'A1', department:'IT', status:'open' }, { task:'A2', department:'IT', status:'open' }];
    for (let i = 0; i < 10; i++) {
      await Promise.all([rdb.saveInfraKpis(r.id, kpis), rdb.saveInfraKpis(r.id, kpis)]);
      await Promise.all([rdb.saveLights(r.id, lights), rdb.saveLights(r.id, lights)]);
      await Promise.all([rdb.saveActionItems(r.id, actions), rdb.saveActionItems(r.id, actions)]);
      const full = await rdb.getReport(r.id);
      assert.equal(full.infra_kpis.length, 7, `round ${i}: infra rows doubled`);
      assert.equal(full.lights.length, 2, `round ${i}: lights doubled`);
      assert.equal(full.action_items.length, 2, `round ${i}: action rows doubled`);
      await rdb.saveActionItems(r.id, []);   // new uid-less rows each round → reset
    }
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

test('copy-reports-reports: sqlite → pg parity + sequence advance', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const { copyReportsReports } = require('../tools/pg/copy-reports-reports');
  const src = _makeReportsSqliteFixture();
  const db = makePgDb(ctx.url); await db.connect();
  try {
    // sites is owned by copy-reports-auth (runs first in a real cutover). Seed the
    // referenced site so weekly_reports/monthly_reports/etc. FKs resolve.
    await db.exec(_fs.readFileSync(_path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8'));
    await db.prepare(`INSERT INTO sites (id, name, active, sort_order) VALUES (1, 'Hounde', 1, 0) ON CONFLICT (id) DO NOTHING`).run();
    const c = await copyReportsReports(src, db);
    assert.equal(c.weeks, 1); assert.equal(c.weekly_reports, 1); assert.equal(c.action_items, 1);
    assert.equal(c.site_module_codes, 1); assert.equal(c.infra_kpi_catalog, 1);
    // parity + ALTER-added cols
    assert.equal((await db.prepare('SELECT created_by FROM weekly_reports WHERE id=3').get()).created_by, 1);
    const ai = await db.prepare('SELECT department, comment FROM action_items WHERE id=11').get();
    assert.equal(ai.department, 'Mining'); assert.equal(ai.comment, 'note');
    assert.equal((await db.prepare('SELECT code FROM site_module_codes WHERE site_id=1').get()).code, 'HGO');
    // idempotent re-copy
    await copyReportsReports(src, db);
    assert.equal(Number((await db.prepare('SELECT COUNT(*)::int n FROM weekly_reports').get()).n), 1);
    // IDENTITY advanced past copied weekly_reports id 3 + infra_kpi_catalog id 8
    assert.ok((await db.prepare(`INSERT INTO weeks (year, week_number, start_date, end_date, label) VALUES (2027,1,'2027-01-01','2027-01-07','W01 2027')`).run()).lastID > 5);
    assert.ok((await db.prepare(`INSERT INTO infra_kpi_catalog (service, kpi) VALUES ('Email','Latency')`).run()).lastID > 8, 'catalog seq advanced');
  } finally { await db.close(); await dropTestDb(ctx); _fs.rmSync(_path.dirname(src), { recursive: true, force: true }); }
});

test('reports pg: reassignReportWeek (wiring-2 helper)', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r1 = await rdb.ensureReport(siteId, 2026, 10);   // (site_id, year, week)
    const r2 = await rdb.ensureReport(siteId, 2026, 11);
    const id1 = r1.id, id2 = r2.id;
    const w2id = (await rdb.getReport(id2)).week_id;
    const w3id = await rdb.ensureWeek(2026, 12);   // a FREE week (ensureWeek makes only the week row, no report)
    const dup = await rdb.reassignReportWeek({ reportId: id1, siteId, newWeekId: w2id });
    assert.equal(dup.duplicateReportId, id2, 'conflict returns the occupying report id');
    assert.notEqual((await rdb.getReport(id1)).week_id, w2id, 'r1 week unchanged on conflict');
    const ok = await rdb.reassignReportWeek({ reportId: id1, siteId, newWeekId: w3id });
    assert.equal(ok.duplicateReportId, null, 'free week → reassigned');
    assert.equal((await rdb.getReport(id1)).week_id, w3id, 'week_id updated');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// 2026-10-15 — merging a follow-up moves its WHOLE group (every week it was carried), and
// the import window reads every follow-up row of the site with its week.
test('reports pg: relineageGroup moves every week of the group + getSiteActionRows', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const r40 = await rdb.ensureReport(siteId, 2026, 40), r41 = await rdb.ensureReport(siteId, 2026, 41), r43 = await rdb.ensureReport(siteId, 2026, 43);
    await rdb.saveActionItems(r40.id, [{ task: 'Foudre', department: 'IT', status: 'on_hold' }]);
    const root = (await rdb.getReport(r40.id)).action_items[0].uid;
    await rdb.saveActionItems(r41.id, [{ task: 'Foudre', department: 'IT', status: 'on_hold', lineage: root }]);
    const copy = (await rdb.getReport(r41.id)).action_items[0].uid;
    await rdb.saveActionItems(r43.id, [{ task: 'Protection foudre', department: 'IT', status: 'open' }]);
    const winner = (await rdb.getReport(r43.id)).action_items[0].uid;
    const res = await rdb.relineageGroup(copy, winner, 'Protection foudre');
    assert.equal(res.ok, true); assert.equal(res.rows, 2); assert.equal(res.from_key, root);
    const open = (await rdb.getSiteOpenReportActions(siteId)).actions;
    assert.equal(open.length, 1, 'no ghost from W40');
    assert.equal((await rdb.getReport(r40.id)).action_items[0].task, 'Protection foudre');
    const rows = await rdb.getSiteActionRows(siteId);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(r => Number.isInteger(Number(r.year)) && r.week_label && r.report_id));
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// 2026-10-16 — a hub cancellation appends its justification to the comment and stamps
// status_changed_at; the hub "Show closed / cancelled" list reads it back.
test('reports pg: setActionStatus note + status_changed_at + getSiteClosedReportActions', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const now = new Date();
    const r = await rdb.ensureReport(siteId, now.getFullYear(), 30);
    await rdb.saveActionItems(r.id, [{ task: 'Core switch', department: 'IT', status: 'open', comment: 'quote asked' }]);
    const uid = (await rdb.getReport(r.id)).action_items[0].uid;
    const res = await rdb.setActionStatus(uid, 'cancelled', 'Cancelled: vendor contract');
    assert.equal(res.ok, true);
    const a = (await rdb.getReport(r.id)).action_items[0];
    assert.equal(a.comment, 'quote asked — Cancelled: vendor contract');
    assert.ok(a.status_changed_at, 'stamped');
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const closed = (await rdb.getSiteClosedReportActions(siteId, since)).actions;
    assert.equal(closed.length, 1); assert.equal(closed[0].uid, uid);
    await rdb.setActionStatus(uid, 'open', null);
    assert.equal((await rdb.getSiteClosedReportActions(siteId, since)).actions.length, 0, 'reopened → off the list');
    // a report re-save that changes the status stamps it too; an unchanged status keeps the stamp
    await rdb.saveActionItems(r.id, [{ uid, task: 'Core switch', department: 'IT', status: 'closed', comment: 'done' }]);
    assert.ok((await rdb.getReport(r.id)).action_items[0].status_changed_at);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
