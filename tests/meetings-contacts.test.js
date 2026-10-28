'use strict';

// getSiteContacts / _pickContacts — best-effort contact discovery from PV data,
// plus the two additive kpis on getSiteMonthlyMeetingSummary
// (signoff_pct / overdue_actions_count).


const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-contacts-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const mdb = require('../meetings-db');
const { _pickContacts } = mdb;

test('coordinator = most frequent site_it_lead; fm = department_head of newest finance PV', () => {
  const rows = [
    { site_it_lead: 'Eric FEGBO',  department: 'mining',  department_head: 'X',             meeting_date: '2026-05-02' },
    { site_it_lead: 'Eric FEGBO',  department: 'hse',     department_head: 'Y',             meeting_date: '2026-06-02' },
    { site_it_lead: 'Other Guy',   department: 'finance', department_head: 'Old FM',        meeting_date: '2026-04-02' },
    { site_it_lead: 'Eric FEGBO',  department: 'finance', department_head: 'Johannes GOUS', meeting_date: '2026-07-02' },
  ];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: 'Eric FEGBO', fm_name: 'Johannes GOUS' });
});

test('no finance PV → fm_name null, coordinator still resolved', () => {
  const rows = [{ site_it_lead: 'Solo', department: 'hse', department_head: 'H', meeting_date: '2026-06-02' }];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: 'Solo', fm_name: null });
});

test('no rows → both null', () => {
  assert.deepStrictEqual(_pickContacts([]), { coordinator_name: null, fm_name: null });
});

test('blank/whitespace leads are ignored', () => {
  const rows = [{ site_it_lead: '  ', department: 'hse', department_head: '', meeting_date: '2026-06-02' }];
  assert.deepStrictEqual(_pickContacts(rows), { coordinator_name: null, fm_name: null });
});

// ── Part B/C: the two additive kpis on getSiteMonthlyMeetingSummary ────────
// Seeded via the module's own schema init. Site 'KPI' is dedicated to this
// block so it can't collide with any other seed.

let S;   // summary for KPI / 2026-06

before(async () => {
  (await mdb.loadLookups());
  const conn = mdb.getDB();
  const meeting = conn.prepare(
    `INSERT INTO md_meetings (reference, site_code, department, meeting_date, status,
                              dept_head_signed_at, site_it_signed_at)
     VALUES (?,?,?,?,?,?,?)`);
  const action = conn.prepare(
    'INSERT INTO md_actions (meeting_id, description, target_date, status) VALUES (?,?,?,?)');

  // 2 PVs held in June; only the first is BOTH-side signed → signoff_pct 50.
  const signed = (await meeting.run('KPI_Network_PV_2026-06', 'KPI', 'Network', '2026-06-10',
    'signed', '2026-06-11 09:00', '2026-06-11 10:00')).lastID;
  // Half-signed (dept head only) must NOT count as signed.
  (await meeting.run('KPI_Maintenance_PV_2026-06', 'KPI', 'Maintenance', '2026-06-12',
    'submitted', '2026-06-13 09:00', null));

  // Actions reach the site via their meeting. 2 overdue + non-terminal → 2.
  (await action.run(signed, 'overdue open',        '2020-01-01', 'open'));
  (await action.run(signed, 'overdue in_progress', '2020-02-01', 'in_progress'));
  (await action.run(signed, 'overdue but resolved','2020-03-01', 'resolved'));   // terminal → excluded
  (await action.run(signed, 'overdue but cancelled','2020-04-01', 'cancelled')); // terminal → excluded
  (await action.run(signed, 'open but not yet due','2099-12-31', 'open'));       // future → excluded

  S = (await mdb.getSiteMonthlyMeetingSummary('KPI', 2026, 6));
});

test('signoff_pct — 1 of 2 PVs fully signed → 50', () => {
  assert.strictEqual(S.kpis.pvs_held, 2);
  assert.strictEqual(S.kpis.signoff_pct, 50);
});

test('signoff_pct is 0 when no PVs were held that month', async () => {
  const none = (await mdb.getSiteMonthlyMeetingSummary('KPI', 2026, 3));
  assert.strictEqual(none.kpis.pvs_held, 0);
  assert.strictEqual(none.kpis.signoff_pct, 0);
});

test('overdue_actions_count counts overdue non-terminal actions only', () => {
  assert.strictEqual(S.kpis.overdue_actions_count, 2);
});

// The whole point of the separate-scalar-subquery rule: joining md_actions into
// the cadence/issue aggregates would fan out and inflate these.
test('the new kpis did not fan out the existing aggregates', () => {
  assert.strictEqual(S.kpis.pvs_held, 2, '5 actions must not multiply the PV count');
  assert.strictEqual(S.kpis.depts_with_pv, 2);
  assert.strictEqual(S.kpis.open_issues, 0);
});

test('getSiteContacts resolves against real PV rows (sqlite path)', async () => {
  const conn = mdb.getDB();
  const ins = conn.prepare(
    `INSERT INTO md_meetings (reference, site_code, department, meeting_date, status,
                              site_it_lead, department_head)
     VALUES (?,?,?,?,?,?,?)`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
  (await ins.run('CTC_Network_PV_a', 'CTC', 'Network', daysAgo(60), 'signed', 'Eric FEGBO', 'N Head'));
  (await ins.run('CTC_HSE_PV_b',     'CTC', 'HSE',     daysAgo(30), 'signed', 'Eric FEGBO', 'H Head'));
  (await ins.run('CTC_Finance_PV_c', 'CTC', 'finance', daysAgo(90), 'signed', 'Other Guy',  'Old FM'));
  (await ins.run('CTC_Finance_PV_d', 'CTC', 'finance', daysAgo(10), 'signed', 'Eric FEGBO', 'Johannes GOUS'));
  // Outside the 6-month window → must not sway the coordinator vote.
  (await ins.run('CTC_Old_PV_e', 'CTC', 'Network', daysAgo(400), 'signed', 'Ancient Lead', 'X'));

  assert.deepStrictEqual((await mdb.getSiteContacts('CTC')),
    { coordinator_name: 'Eric FEGBO', fm_name: 'Johannes GOUS' });
  // site_code match is case-insensitive (COLLATE NOCASE)
  assert.strictEqual((await mdb.getSiteContacts('ctc')).coordinator_name, 'Eric FEGBO');
  assert.deepStrictEqual((await mdb.getSiteContacts(null)), { coordinator_name: null, fm_name: null });
});
