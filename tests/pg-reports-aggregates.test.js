'use strict';
// Chunk 4D-2 — reports.db KPI aggregate readers → PostgreSQL. TDD suite (accretes
// across 4D-2a/b/c/d). Runs the postgres backend against a throwaway DB; skips
// cleanly when Postgres is down. The whole point: byte-for-byte KPI reconciliation.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'ragg-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

// request_records writers use @named params for EVERY column → fill all, override.
const _req = o => ({ request_id:null, display_id:null, subject:null, request_status:null,
  pending_status:1, overdue_status:0, request_type:null, service_request:0, is_escalated:0,
  reopen_count:0, due_by_time:null, time_elapsed_ms:null, created_time:null, resolved_time:null,
  completed_time:null, responded_time:null, assigned_time:null, last_updated_time:null,
  first_response_overdue:null, technician:null, requester:null, category:null, sub_category:null,
  site:null, tech_group:null, mode:null, impact:null, ...o });

async function boot() {
  const ctx = await provisionTestDb();
  if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  const site = await rdb.createSite({ name: 'Hounde', zoho_group: 'Hounde IT Agents' });
  return { ctx, rdb, siteId: site.id };
}

test('agg pg: getCalendarMonthlyHelpdesk denominators + duration', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'A',tech_group:G,created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false',assigned_time:'2026-05-10 11:00:00',resolved_time:'2026-05-11 09:00:00'}),
      _req({request_id:'B',tech_group:G,created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'D',tech_group:G,created_time:C,pending_status:0,overdue_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'E',tech_group:G,created_time:C,pending_status:1,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'true'}),
      _req({request_id:'F',tech_group:G,created_time:C,pending_status:1,overdue_status:0}),
    ]);
    const cal = await rdb.getCalendarMonthlyHelpdesk(siteId, 2026, 5);
    assert.equal(cal.inbound, 5); assert.equal(cal.closed, 3); assert.equal(cal.close_pct, 60);
    assert.equal(cal.sla_res_pct, 67, 'closed-only: round(2/3*100)');
    assert.equal(cal.sla_reply_pct, 75, 'responded-only: round(3/4*100)');
    assert.equal(cal.avg_tta_h, 2);
    assert.equal(cal.avg_first_reply_h, 1);
    assert.equal(cal.avg_resolution_d, 1);
    const top = await rdb.getCalendarMonthlyTop10(siteId, 2026, 5);
    assert.ok(Array.isArray(top) && top.length >= 1 && top[0].violations >= 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: getCalendarMonthlyTop10 NULL + empty category collapse to one Uncategorised', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'N1',tech_group:G,created_time:C,overdue_status:1,category:null}),
      _req({request_id:'N2',tech_group:G,created_time:C,overdue_status:1,category:''}),
    ]);
    const top = await rdb.getCalendarMonthlyTop10(siteId, 2026, 5);
    const unc = top.filter(r => r.category === 'Uncategorised');
    assert.equal(unc.length, 1, 'NULL + empty collapse into ONE Uncategorised group (GROUP BY 1)');
    assert.equal(unc[0].violations, 2);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: 6-month history (calendar + raw) + monthly history', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'A',tech_group:G,site:'Hounde',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'B',tech_group:G,site:'Hounde',created_time:C,pending_status:0,overdue_status:0}),
      _req({request_id:'D',tech_group:G,site:'Hounde',created_time:C,pending_status:0,overdue_status:1}),
      _req({request_id:'E',tech_group:G,site:'Hounde',created_time:C,pending_status:1}),
      _req({request_id:'F',tech_group:G,site:'Hounde',created_time:C,pending_status:1}),
    ]);
    // calendar path (no groups)
    const h6 = await rdb.getHelpdesk6MonthHistory(siteId, 2026, 5);
    assert.equal(h6.length, 6);
    const may = h6[5];
    assert.equal(may.inbound, 5); assert.equal(may.closed, 3); assert.equal(may.res_sla_pct, 67);
    // raw path (groups → _aggregateHelpdesk6MoFromRaw)
    const h6r = await rdb.getHelpdesk6MonthHistory(siteId, 2026, 5, ['Hounde IT Agents']);
    assert.equal(h6r.length, 6); assert.equal(h6r[5].inbound, 5);
    // monthly history (12 months, all sites/groups)
    const mh = await rdb.getMonthlyHelpdeskHistory(12);
    assert.equal(mh.length, 12);
    const mRow = mh.find(r => r['Created Time'] === 'May 2026');
    assert.ok(mRow); assert.equal(mRow['Requests'], 5); assert.equal(mRow['Closed Requests Count'], 3);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: getMonthlyData assembler + getYearlySummary', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb, siteId } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'A',tech_group:G,created_time:C,pending_status:0,overdue_status:0}),
      _req({request_id:'B',tech_group:G,created_time:C,pending_status:0}),
      _req({request_id:'D',tech_group:G,created_time:C,pending_status:0,overdue_status:1}),
      _req({request_id:'E',tech_group:G,created_time:C,pending_status:1}),
      _req({request_id:'F',tech_group:G,created_time:C,pending_status:1}),
    ]);
    const md = await rdb.getMonthlyData(siteId, 2026, 5);
    assert.equal(md.calendar_hd.inbound, 5);
    assert.ok(Array.isArray(md.history6m) && md.history6m.length === 6);
    assert.ok(Array.isArray(md.reports) && Array.isArray(md.weeks));
    assert.ok(Array.isArray(md.monthly_top10));
    const ys = await rdb.getYearlySummary(siteId, 2026);
    assert.equal(ys.length, 12);
    assert.equal(ys[4].hd.inbound, 5);          // May (index 4)
    assert.ok(Array.isArray(ys[4].kpis));
    assert.equal(ys[0].has_data, false);        // Jan — no weekly reports
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: getRequestMetrics denominators + getRequestFilterOptions', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    await rdb.upsertRequestBatch([
      _req({request_id:'A',tech_group:G,site:'Hounde',request_status:'Closed',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'B',tech_group:G,site:'Hounde',request_status:'Closed',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'D',tech_group:G,site:'Hounde',request_status:'Closed',created_time:C,pending_status:0,overdue_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}),
      _req({request_id:'E',tech_group:G,site:'Hounde',request_status:'Open',created_time:C,pending_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'true'}),
      _req({request_id:'F',tech_group:G,site:'Hounde',request_status:'Open',created_time:C,pending_status:1}),
    ]);
    const m = await rdb.getRequestMetrics({});
    assert.equal(m.total, 5); assert.equal(m.closed_count, 3); assert.equal(m.open_count, 2);
    assert.equal(m.sla_ok_pct, 66.7, 'closed-only +(2/3*100).toFixed(1)');
    assert.equal(m.first_resp_violated_pct, 25, 'responded-only +(1/4*100).toFixed(1)');
    assert.equal(m.reopen_pct, 0);
    assert.ok(Array.isArray(m.monthly_trend) && m.monthly_trend.length >= 1);
    const fo = await rdb.getRequestFilterOptions();
    assert.ok(fo.statuses.includes('Closed') && fo.statuses.includes('Open'));
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: major-incident history + active', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents';
    // recent major incident (within the 12-month window)
    const C = new Date(); C.setMonth(C.getMonth() - 1);
    const created = `${C.getFullYear()}-${String(C.getMonth()+1).padStart(2,'0')}-15 09:00:00`;
    await rdb.upsertRequestBatch([
      _req({request_id:'MI1', display_id:'#INC-MI1', request_type:'Major Incident', tech_group:G, site:'Hounde', pending_status:1, created_time:created}),
    ]);
    await rdb.upsertRequestUdfBatch([{ request_id:'MI1', udf_json:JSON.stringify({'UDF:Priority':'High','UDF:Root Cause Analysis :':'rca text that is long enough'}) }]);
    const hist = await rdb.getMajorIncidentsHistory(12);
    const mi = hist.find(r => r['Request ID'] === 'MI1');
    assert.ok(mi, 'major incident in history'); assert.equal(mi['Request Type'], 'Major Incident');
    const active = await rdb.getActiveMajorIncidentsForSite(['Hounde IT Agents']);
    assert.ok(active.find(r => r.request_id === 'MI1'), 'open major incident for the group');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── 4D-2b — request SLA / ageing / trend ──────────────────────────────────
test('agg pg: ageing buckets (site/group/summary) + TRUNC boundary + noise filter', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents';
    // an OPEN row created N days ago (TEXT 'YYYY-MM-DD HH:MM:SS', UTC)
    const daysAgo = (n) => new Date(Date.now() - n*86400000).toISOString().slice(0,19).replace('T',' ');
    await rdb.upsertRequestBatch([
      // Hounde site/group: one per bucket. 65d → >60; 50d → 46-60; 40d → 31-45; 10d → 0-30
      _req({request_id:'AG1',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(65),first_response_overdue:'false'}),
      _req({request_id:'AG2',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(50),first_response_overdue:'true'}),
      _req({request_id:'AG3',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(40),first_response_overdue:'false'}),
      _req({request_id:'AG4',tech_group:G,site:'Hounde',pending_status:1,created_time:daysAgo(10),first_response_overdue:'false'}),
      // a second group with FEWER open rows → locks getAgeingSummaryDB ORDER BY (total DESC)
      _req({request_id:'AG5',tech_group:'Mana IT Agents',site:'Mana',pending_status:1,created_time:daysAgo(5),first_response_overdue:'false'}),
      // closed row — excluded from all ageing (pending_status=0)
      _req({request_id:'AG6',tech_group:G,site:'Hounde',pending_status:0,created_time:daysAgo(70)}),
      // noise site — dropped by getAgeingBySiteDB filter, but counted in the group path
      _req({request_id:'AG7',tech_group:G,site:'-No Value-',pending_status:1,created_time:daysAgo(20)}),
    ]);

    const bySite = await rdb.getAgeingBySiteDB();
    const hs = bySite.find(r => r.site === 'Hounde');
    assert.ok(hs, 'Hounde site present');
    assert.equal(hs.d0, 1); assert.equal(hs.d31, 1); assert.equal(hs.d46, 1); assert.equal(hs.d60, 1);
    assert.equal(hs.total, 4, 'closed AG6 + noise AG7 excluded');
    assert.ok(!bySite.find(r => String(r.site).toLowerCase().includes('no value')), 'noise site dropped');

    const byGrp = await rdb.getAgeingByGroupDB();
    const hg = byGrp.find(r => r.group === G);
    assert.ok(hg, 'Hounde group present');
    // AG7 has tech_group=G and is open → counted by GROUP (group path has NO site-noise filter).
    // 5 open Hounde-group rows: 65d,50d,40d,10d,20d → >60:1, 46-60:1, 31-45:1, 0-30:2.
    assert.equal(hg.total, 5, 'AG6 closed excluded; AG7 counted in group path');
    assert.equal(hg.t0_30, 2);   // 10d + 20d
    assert.equal(hg.t31_45, 1);  // 40d
    assert.equal(hg.t46_60, 1);  // 50d
    assert.equal(hg.tOver60, 1); // 65d
    assert.ok(hg.slaPct >= 0 && hg.slaPct <= 100, 'frt slaPct in range');

    const summ = await rdb.getAgeingSummaryDB();
    const grps = summ.map(r => r['Group']);
    const iH = grps.indexOf(G), iM = grps.indexOf('Mana IT Agents');
    assert.ok(iH >= 0 && iM >= 0, 'both groups present');
    assert.ok(iH < iM, 'higher-total Hounde group sorts before Mana (ORDER BY repeated-SUM)');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('agg pg: SLA trend + by-category denominators + string %', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    const G = 'Hounde IT Agents', C = '2026-05-10 09:00:00';
    const big = [];
    // category 'Network' — 5 rows: 3 closed (1 overdue), 1 responded+frt-violated, 1 open
    big.push(_req({request_id:'S1',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S2',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S3',tech_group:G,category:'Network',created_time:C,pending_status:0,overdue_status:0,responded_time:'2026-05-10 10:00:00',first_response_overdue:'false'}));
    big.push(_req({request_id:'S4',tech_group:G,category:'Network',created_time:C,pending_status:1,responded_time:'2026-05-10 10:00:00',first_response_overdue:'true'}));
    big.push(_req({request_id:'S5',tech_group:G,category:'Network',created_time:C,pending_status:1}));
    // small category 'Tiny' — 4 rows, closed+overdue (dropped by HAVING>=5 in by-category,
    // but DO leak into the category-less monthly trend)
    for (let i=0;i<4;i++) big.push(_req({request_id:'T'+i,tech_group:G,category:'Tiny',created_time:C,pending_status:0,overdue_status:1}));
    await rdb.upsertRequestBatch(big);

    const trend = await rdb.getSlaTrendDB();
    const may = trend.find(r => r['Created Date'] === 'May 2026');
    assert.ok(may, 'May 2026 trend row');
    // whole-month aggregate: closed = 3 Network + 4 Tiny = 7; violated_closed = S1 + 4 Tiny = 5
    //   → round(5/7*1000)/10 = 71.4 ; responded = S1,S2,S3,S4 = 4; frt_viol = S4 = 1 → 25.0
    assert.equal(may['% of SLA Violated'], 71.4);
    assert.equal(may['% of First Responses SLA Violated'], 25);

    const byCat = await rdb.getSlaByCategoryDB();
    const net = byCat.find(r => r['Category'] === 'Network');
    assert.ok(net, 'Network category present (>=5)');
    assert.equal(typeof net['% of SLA Violated'], 'string');
    assert.ok(net['% of SLA Violated'].endsWith('%'), 'string with % suffix');
    assert.ok(!byCat.find(r => r['Category'] === 'Tiny'), 'Tiny dropped by HAVING >= 5');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});
