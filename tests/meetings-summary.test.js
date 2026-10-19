'use strict';

// getSiteMonthlyMeetingSummary — the data feed for the weekly deck's
// "Department Meetings — Monthly Status" slide. Seeds a known site/month
// scenario and asserts the cadence KPIs, per-department RAG, 3-month trend,
// and auto-commentary compute correctly.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-sum-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const mdb = require('../meetings-db');

let S; // summary

before(() => {
  mdb.loadLookups();
  const conn = mdb.getDB();
  const meeting = conn.prepare('INSERT INTO md_meetings (reference, site_code, department, meeting_date, status) VALUES (?,?,?,?,?)');
  const issue   = conn.prepare('INSERT INTO md_issues (meeting_id, title, category, severity, status, escalate, created_at, closed_at) VALUES (?,?,?,?,?,?,?,?)');

  // Network — PV 12 Jun. open=4 (1 HIGH, 1 escalated), resolved_m=1, new_m=2
  const net = meeting.run('HGO_Network_PV_2026-06', 'HGO', 'Network', '2026-06-12', 'signed').lastInsertRowid;
  issue.run(net, 'a', 'HW', 'HIGH',   'open',     1, '2026-05-10', null);
  issue.run(net, 'b', 'HW', 'MEDIUM', 'open',     0, '2026-05-11', null);
  issue.run(net, 'c', 'HW', 'MEDIUM', 'open',     0, '2026-06-03', null);
  issue.run(net, 'd', 'HW', 'MEDIUM', 'open',     0, '2026-06-04', null);
  issue.run(net, 'e', 'HW', 'MEDIUM', 'resolved', 0, '2026-05-01', '2026-06-15');

  // Maintenance — PV 5 Jun. open=2 (0 HIGH), resolved_m=2, new_m=1
  const mnt = meeting.run('HGO_Maintenance_PV_2026-06', 'HGO', 'Maintenance', '2026-06-05', 'signed').lastInsertRowid;
  issue.run(mnt, 'f', 'HW', 'MEDIUM', 'open',     0, '2026-05-20', null);
  issue.run(mnt, 'g', 'HW', 'MEDIUM', 'open',     0, '2026-06-02', null);
  issue.run(mnt, 'h', 'HW', 'MEDIUM', 'resolved', 0, '2026-04-10', '2026-06-10');
  issue.run(mnt, 'i', 'HW', 'MEDIUM', 'resolved', 0, '2026-05-09', '2026-06-12');

  // Finance — last PV May 20 (NO PV in June). open=1
  const fin = meeting.run('HGO_Finance_PV_2026-05', 'HGO', 'Finance', '2026-05-20', 'signed').lastInsertRowid;
  issue.run(fin, 'j', 'HW', 'MEDIUM', 'open', 0, '2026-05-21', null);

  // Operations — PV 9 Jun. open=0, resolved_m=1, new_m=1
  const ops = meeting.run('HGO_Operations_PV_2026-06', 'HGO', 'Operations', '2026-06-09', 'signed').lastInsertRowid;
  issue.run(ops, 'k', 'HW', 'MEDIUM', 'resolved', 0, '2026-06-07', '2026-06-08');

  S = mdb.getSiteMonthlyMeetingSummary('HGO', 2026, 6);
});

test('cadence + flow KPIs', () => {
  assert.strictEqual(S.available, true);
  assert.strictEqual(S.kpis.pvs_held, 3, '3 PVs held in June (Finance was May)');
  assert.strictEqual(S.kpis.depts_with_pv, 3);
  assert.strictEqual(S.kpis.open_issues, 7, '4+2+1+0');
  assert.strictEqual(S.kpis.high_open, 1);
  assert.strictEqual(S.kpis.resolved_month, 4, '1+2+0+1');
  assert.strictEqual(S.kpis.new_month, 4, '2+1+0+1');
  assert.strictEqual(S.kpis.escalations_open, 1);
});

test('per-department breakdown + RAG status', () => {
  const by = Object.fromEntries(S.departments.map(d => [d.department, d]));
  assert.strictEqual(by.Network.open, 4);
  assert.strictEqual(by.Network.high, 1);
  assert.strictEqual(by.Network.status, 'blocked', 'HIGH open → blocked');
  assert.strictEqual(by.Maintenance.open, 2);
  assert.strictEqual(by.Maintenance.status, 'on_track', 'PV held, no HIGH → on track');
  assert.strictEqual(by.Finance.status, 'no_pv', 'no PV this month');
  assert.strictEqual(by.Operations.open, 0);
  assert.strictEqual(by.Operations.status, 'on_track');
  // blocked sorts first
  assert.strictEqual(S.departments[0].status, 'blocked');
});

test('3-month opened/closed trend', () => {
  assert.deepStrictEqual(S.trend.months, ['Apr', 'May', 'Jun']);
  assert.strictEqual(S.trend.opened.length, 3);
  assert.strictEqual(S.trend.closed.length, 3);
  // June: opened = c,d,g,k = 4 ; closed = e,h,i,k = 4
  assert.strictEqual(S.trend.opened[2], 4);
  assert.strictEqual(S.trend.closed[2], 4);
});

test('auto-commentary names the blockers', () => {
  assert.match(S.commentary, /Network/);
  assert.match(S.commentary, /Finance: no PV in Jun/);
  assert.match(S.commentary, /escalated to Council/);
});

test('unknown site → available:false, no throw', () => {
  const empty = mdb.getSiteMonthlyMeetingSummary(null, 2026, 6);
  assert.strictEqual(empty.available, false);
  assert.deepStrictEqual(empty.departments, []);
});
