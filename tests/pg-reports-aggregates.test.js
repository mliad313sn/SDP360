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
