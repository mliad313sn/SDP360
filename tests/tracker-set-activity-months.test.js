'use strict';
// TDD for tracker-db.setActivityMonthsByName — the targeted per-activity input
// writer behind Piste 1's dept-meetings auto-import. A fresh SDP_DATA_DIR makes
// tracker-db auto-seed 2026 from tracker-init.json (which already contains the
// "Monthly Department Meeting" activity in the Business Partnership pillar), so
// we write against the REAL seeded activity and assert the v2 upsert.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-'));
process.env.TRACKER_BACKEND = 'sqlite';
process.env.TRACKER_PER_YEAR_EDITS = '1';
const td = require('../tracker-db');
const db = td.getDB();

// Seed a dedicated test year (2099) so it can't collide with the auto-seeded
// current year: year → pillar → activity "Monthly Department Meeting".
const ACT = 'Monthly Department Meeting';
const YEAR = 2099;
db.prepare('INSERT OR IGNORE INTO tracker_years (year) VALUES (?)').run(YEAR);
const pid = Number(db.prepare(
  'INSERT INTO tracker_pillars (year, code, name, weight, display_order) VALUES (?,?,?,?,?)'
).run(YEAR, 'PZ', 'Business Partner (test)', 0.35, 2).lastInsertRowid);
const aid = Number(db.prepare(
  'INSERT INTO tracker_activities (pillar_id, code, name, kpi_type, start_month, end_month, display_order) VALUES (?,?,?,?,?,?,?)'
).run(pid, 'act-md', ACT, 'COUNT', 3, 10, 0).lastInsertRowid);

const readMonths = (site) => {
  const r = db.prepare('SELECT months_json FROM tracker_inputs_v2 WHERE year=? AND site=? AND activity_id=?').get(YEAR, site, aid);
  return r ? JSON.parse(r.months_json) : null;
};

test('the test activity is resolvable', () => {
  assert.ok(aid, 'activity id');
});

test('writes the 12-month array for the named activity', () => {
  const r = td.setActivityMonthsByName(YEAR, 'HGO', ACT, [0, 0, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.ok, true);
  assert.equal(r.activity_id, aid);
  assert.deepEqual(readMonths('HGO'), [0, 0, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0]);
});

test('re-run upserts (overwrites) the same row', () => {
  td.setActivityMonthsByName(YEAR, 'HGO', ACT, [9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readMonths('HGO'), [9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('activity name match is case-insensitive', () => {
  const r = td.setActivityMonthsByName(YEAR, 'MGO', 'monthly department MEETING', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.ok, true);
  assert.deepEqual(readMonths('MGO'), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('unknown activity → ok:false, nothing written', () => {
  const r = td.setActivityMonthsByName(YEAR, 'HGO', 'No Such Activity', [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'activity-not-found');
});

test('writing one site does not clobber another', () => {
  td.setActivityMonthsByName(YEAR, 'SGO', ACT, [2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readMonths('HGO'), [9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);  // unchanged
  assert.deepEqual(readMonths('SGO'), [2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
