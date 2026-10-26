'use strict';
// Step 6 (performance) — getCalendarMonthlyHelpdesk reads the month in ONE pass and getSiteHelpdeskWindow uses a
// sargable `created_time >= from AND < to+1day` window. Both were proved identical to the former readers on the
// production copy; this pins the boundaries and the formulas on a fresh database.
process.env.REPORTS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-hd-readers-'));
process.env.DASH_USER = process.env.DASH_USER || 'hd-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'hd-admin-pass-0000';
const rdb = require('../reports-db');

const site = rdb.createSite({ name: 'Readers Site', zoho_group: 'G-A, G-B' });
const ins = rdb.db.prepare(`INSERT INTO request_records (request_id, tech_group, created_time, pending_status, overdue_status,
  responded_time, first_response_overdue, assigned_time, resolved_time) VALUES (?,?,?,?,?,?,?,?,?)`);
let n = 0;
const row = (group, created, o = {}) => ins.run(String(++n), group, created, o.pending ?? 0, o.overdue ?? 0,
  o.responded ?? null, o.fro ?? null, o.assigned ?? null, o.resolved ?? null);

row('G-A', '2026-05-31T23:59:59.000Z');                                   // previous month, previous window
row('G-A', '2026-06-01T00:00:00.000Z', { responded: '2026-06-01T02:00:00.000Z', fro: 'false', assigned: '2026-06-01T01:00:00.000Z', resolved: '2026-06-03T00:00:00.000Z' });
row('G-B', '2026-06-07T23:59:59.000Z', { overdue: 1, responded: '2026-06-08T03:59:59.000Z', fro: 'true' });   // last instant of the window
row('G-A', '2026-06-08T00:00:00.000Z', { pending: 1 });                   // first instant AFTER the window
row('G-C', '2026-06-03T10:00:00.000Z');                                   // another site's group
row('G-A', '2026-06-30T23:59:59.000Z', { pending: 1, overdue: 1 });       // last instant of the month (open)
row('G-B', '2026-07-01T00:00:00.000Z');                                   // next month

test('window: the last day is included up to 23:59:59, the next day is not, other groups never', () => {
  const w = rdb.getSiteHelpdeskWindow(site.id, '2026-06-01', '2026-06-07');
  assert.strictEqual(w.created, 2);
  assert.strictEqual(w.resolved, 2);
  assert.strictEqual(w.sla_res_ok, 1);
  assert.strictEqual(w.sla_res_pct, 50);
  assert.strictEqual(rdb.getSiteHelpdeskWindow(site.id, '2026-06-08', '2026-06-08').created, 1);
  assert.strictEqual(rdb.getSiteHelpdeskWindow(site.id, '2026-05-31', '2026-05-31').created, 1);
});

test('window: the last day of a month and a year end keep the same rule', () => {
  assert.strictEqual(rdb.getSiteHelpdeskWindow(site.id, '2026-06-30', '2026-06-30').created, 1);
  assert.strictEqual(rdb.getSiteHelpdeskWindow(site.id, '2026-06-29', '2026-06-30').created, 1);
  assert.strictEqual(rdb.getSiteHelpdeskWindow(site.id, '2026-12-31', '2026-12-31').created, 0);
});

test('calendar month: one pass, same formulas (SLA over closed, first response over responded, averages)', () => {
  const m = rdb.getCalendarMonthlyHelpdesk(site.id, 2026, 6);
  assert.deepStrictEqual(m, {
    inbound: 4, closed: 2, close_pct: 50,
    sla_res_pct: 50, sla_reply_pct: 50,
    sla_res_ok: 1, sla_reply_ok: 1, sla_reply_total: 2,
    avg_tta_h: 1, avg_first_reply_h: 3, avg_resolution_d: 2,
    source: 'calendar', from: '2026-06-01', to: '2026-06-30',
  });
});

test('calendar month: no ticket → the zero block; unknown site → null', () => {
  assert.deepStrictEqual(rdb.getCalendarMonthlyHelpdesk(site.id, 2026, 8),
    { inbound: 0, closed: 0, close_pct: 0, sla_res_pct: null, sla_reply_pct: null, sla_res_ok: 0, sla_reply_ok: 0, sla_reply_total: 0, source: 'calendar' });
  assert.strictEqual(rdb.getCalendarMonthlyHelpdesk(999999, 2026, 6), null);
});
