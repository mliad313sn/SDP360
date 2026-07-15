'use strict';
process.env.MEETINGS_BACKEND = 'sqlite';

// meetings-db.getSiteScoreInputs — the windowed measurements behind 4 of the 6
// sbDims dimensions (reviews / resolution / signoff / overdue). The pure core is
// tested directly; ONE integration test proves the REAL sqlite reader agrees
// with it on the same data (the "test against the real reader" rule).

const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mtg-score-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const test = require('node:test');
const assert = require('node:assert');
const mdb = require('../meetings-db');
const { _effClose, _openAt, _computeMeetingsScoreInputs, MD_OPEN } = mdb;

test('MD_OPEN is exactly the user OPEN map', () => {
  assert.deepStrictEqual(Object.keys(MD_OPEN).sort(), ['blocked', 'in_progress', 'on_hold', 'open']);
});

test('_effClose: closed_at wins, sliced to a date', () => {
  assert.strictEqual(_effClose({ closed_at: '2026-06-10 08:30:00' }), '2026-06-10');
});
test('_effClose: resolved/cancelled fall back to updated_at', () => {
  assert.strictEqual(_effClose({ status: 'resolved', updated_at: '2026-06-11 09:00:00' }), '2026-06-11');
  assert.strictEqual(_effClose({ status: 'cancelled', updated_at: '2026-06-11 09:00:00' }), '2026-06-11');
});
test('_effClose: open issue has no close date', () => {
  assert.strictEqual(_effClose({ status: 'in_progress', updated_at: '2026-06-11 09:00:00' }), null);
});
test('_openAt: not yet raised → false', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-07-20', status: 'open' }, '2026-07-14'), false);
});
test('_openAt: raised and never closed → true', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'open' }, '2026-07-14'), true);
});
test('_openAt: closed after t → still open at t', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-08-01' }, '2026-07-14'), true);
});
test('_openAt: closed before t → closed at t', () => {
  assert.strictEqual(_openAt({ meeting_date: '2026-05-01', status: 'resolved', closed_at: '2026-06-01' }, '2026-07-14'), false);
});

test('_computeMeetingsScoreInputs: reviews/resolution/signoff over the window, overdue as-of to', () => {
  const W = { from: '2026-04-14', to: '2026-07-14' };
  const meetings = [
    { meeting_date: '2026-05-02', dept_head_signed_at: '2026-05-03 10:00:00', site_it_signed_at: '2026-05-03 10:01:00' },  // signed
    { meeting_date: '2026-06-02', dept_head_signed_at: '2026-06-03 10:00:00', site_it_signed_at: null },                    // half-signed
    { meeting_date: '2026-04-01', dept_head_signed_at: '2026-04-02 10:00:00', site_it_signed_at: '2026-04-02 10:00:00' },  // BEFORE from → excluded
    { meeting_date: '2026-08-01', dept_head_signed_at: null, site_it_signed_at: null },                                     // AFTER to → excluded
  ];
  const issues = [
    { meeting_date: '2026-05-02', status: 'resolved', closed_at: '2026-06-01 09:00:00', target_date: '2026-05-30' },
    { meeting_date: '2026-05-02', status: 'in_progress', closed_at: null, target_date: '2026-06-01' },   // overdue at 07-14
    { meeting_date: '2026-01-01', status: 'open', closed_at: null, target_date: '2026-02-01' },          // outside window BUT overdue as-of → counts in overdue only
  ];
  const actions = [
    { meeting_date: '2026-05-02', status: 'in_progress', closed_at: null, target_date: '2026-06-15' },   // overdue
    { meeting_date: '2026-05-02', status: 'resolved', closed_at: '2026-06-01 09:00:00', target_date: '2026-05-01' }, // closed → not overdue
  ];
  const r = _computeMeetingsScoreInputs({ meetings, issues, actions }, W);
  assert.strictEqual(r.reviews, 2);        // only the 2 in-window meetings
  assert.strictEqual(r.raised, 2);         // only the 2 in-window issues
  assert.strictEqual(r.resolved, 1);
  assert.strictEqual(r.resolution, 50);    // round(100*1/2)
  assert.strictEqual(r.signoff, 50);       // 1 of 2 in-window meetings fully signed
  assert.strictEqual(r.overdue, 3);        // 2 overdue issues (incl. the out-of-window one) + 1 overdue action
});

test('_computeMeetingsScoreInputs: no meetings → zeros, no divide-by-zero', () => {
  const r = _computeMeetingsScoreInputs({ meetings: [], issues: [], actions: [] }, { from: '2026-04-14', to: '2026-07-14' });
  assert.strictEqual(r.reviews, 0);
  assert.strictEqual(r.resolution, 0);
  assert.strictEqual(r.signoff, 0);
  assert.strictEqual(r.overdue, 0);
});

// ── Integration: the REAL sqlite reader must agree with the pure core ──────
// A stub proves the contract, never the wiring: this seeds a real meetings.db
// and asserts getSiteScoreInputs() returns exactly what the pure core returns
// for the same rows — so a mis-shaped SELECT (wrong column, lost JOIN, leaked
// other site) fails here rather than silently reading zeros in prod.
test('getSiteScoreInputs: seeded sqlite DB agrees with the pure core', () => {
  mdb.loadLookups();
  const conn = mdb.getDB();
  const meeting = conn.prepare(
    'INSERT INTO md_meetings (reference, site_code, department, meeting_date, status, dept_head_signed_at, site_it_signed_at) VALUES (?,?,?,?,?,?,?)');
  const issue = conn.prepare(
    'INSERT INTO md_issues (meeting_id, title, category, severity, status, target_date, closed_at, updated_at) VALUES (?,?,?,?,?,?,?,?)');
  const action = conn.prepare(
    'INSERT INTO md_actions (meeting_id, description, status, target_date, closed_at) VALUES (?,?,?,?,?)');

  // In-window, fully signed.
  const m1 = meeting.run('HGO_Network_PV_2026-05', 'HGO', 'Network', '2026-05-02', 'signed',
    '2026-05-03 10:00:00', '2026-05-03 10:01:00').lastInsertRowid;
  // In-window, half-signed.
  const m2 = meeting.run('HGO_Maintenance_PV_2026-06', 'HGO', 'Maintenance', '2026-06-02', 'submitted',
    '2026-06-03 10:00:00', null).lastInsertRowid;
  // Before the window → excluded from reviews/signoff.
  const m0 = meeting.run('HGO_Finance_PV_2026-04', 'HGO', 'Finance', '2026-04-01', 'signed',
    '2026-04-02 10:00:00', '2026-04-02 10:00:00').lastInsertRowid;
  // Another site → must never leak in.
  const mX = meeting.run('MGO_Network_PV_2026-05', 'MGO', 'Network', '2026-05-02', 'signed',
    '2026-05-03 10:00:00', '2026-05-03 10:01:00').lastInsertRowid;

  issue.run(m1, 'a', 'HW', 'MEDIUM', 'resolved',    '2026-05-30', '2026-06-01 09:00:00', '2026-06-01 09:00:00');
  issue.run(m1, 'b', 'HW', 'MEDIUM', 'in_progress', '2026-06-01', null,                  '2026-06-05 09:00:00');
  // resolved with NO closed_at → exercises _effClose's updated_at FALLBACK.
  issue.run(m2, 'c', 'HW', 'MEDIUM', 'resolved',    '2026-06-20', null,                  '2026-06-11 09:00:00');
  issue.run(m0, 'd', 'HW', 'MEDIUM', 'open',        '2026-02-01', null,                  '2026-04-02 09:00:00');
  issue.run(mX, 'x', 'HW', 'MEDIUM', 'open',        '2026-01-01', null,                  '2026-05-02 09:00:00');

  action.run(m1, 'act overdue', 'in_progress', '2026-06-15', null);
  action.run(m1, 'act closed',  'resolved',    '2026-05-01', '2026-06-01 09:00:00');
  action.run(mX, 'act other site', 'open',     '2026-01-01', null);

  const W = { from: '2026-04-14', to: '2026-07-14' };
  const got = mdb.getSiteScoreInputs('HGO', W.from, W.to);

  // The same rows, hand-mirrored, through the pure core.
  const expected = _computeMeetingsScoreInputs({
    meetings: [
      { meeting_date: '2026-05-02', dept_head_signed_at: '2026-05-03 10:00:00', site_it_signed_at: '2026-05-03 10:01:00' },
      { meeting_date: '2026-06-02', dept_head_signed_at: '2026-06-03 10:00:00', site_it_signed_at: null },
      { meeting_date: '2026-04-01', dept_head_signed_at: '2026-04-02 10:00:00', site_it_signed_at: '2026-04-02 10:00:00' },
    ],
    issues: [
      { meeting_date: '2026-05-02', status: 'resolved',    target_date: '2026-05-30', closed_at: '2026-06-01 09:00:00', updated_at: '2026-06-01 09:00:00' },
      { meeting_date: '2026-05-02', status: 'in_progress', target_date: '2026-06-01', closed_at: null,                  updated_at: '2026-06-05 09:00:00' },
      { meeting_date: '2026-06-02', status: 'resolved',    target_date: '2026-06-20', closed_at: null,                  updated_at: '2026-06-11 09:00:00' },
      { meeting_date: '2026-04-01', status: 'open',        target_date: '2026-02-01', closed_at: null,                  updated_at: '2026-04-02 09:00:00' },
    ],
    actions: [
      { meeting_date: '2026-05-02', status: 'in_progress', target_date: '2026-06-15', closed_at: null },
      { meeting_date: '2026-05-02', status: 'resolved',    target_date: '2026-05-01', closed_at: '2026-06-01 09:00:00' },
    ],
  }, W);

  assert.deepStrictEqual(got, expected);
  // Pin the numbers too, so a matching-but-wrong core can't hide behind the diff.
  assert.strictEqual(got.reviews, 2, 'the 2 in-window HGO PVs; MGO must not leak');
  assert.strictEqual(got.raised, 3);
  assert.strictEqual(got.resolved, 2, 'incl. the resolved issue closed via the updated_at fallback');
  assert.strictEqual(got.resolution, 67, 'round(100*2/3)');
  assert.strictEqual(got.signoff, 50);
  assert.strictEqual(got.overdue, 3, '2 overdue issues + 1 overdue action, HGO only');
});
