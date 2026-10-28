'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
// Activity Tracker — closed months (2026-10-16, user request): below super_admin only the
// current month — and the previous one until the 5th — can be changed. The server keeps the
// STORED value of a closed month whatever the page sends (public/lib/trackerMonthLock.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-lock-'));
process.env.TRACKER_PER_YEAR_EDITS = '1';
const ML = require('../public/lib/trackerMonthLock');
const td = require('../tracker-db');
const db = td.getDB();
const YEAR = 2099;
let pid, aid;
__bootChain(async () => {
  await db.prepare('INSERT INTO tracker_years (year) VALUES (?) ON CONFLICT DO NOTHING').run(YEAR);
  pid = Number((await db.prepare('INSERT INTO tracker_pillars (year, code, name, weight, display_order) VALUES (?,?,?,?,?)')
    .run(YEAR, 'PL', 'Lock pillar', 1, 1)).lastID);
  aid = Number((await db.prepare('INSERT INTO tracker_activities (pillar_id, code, name, kpi_type, start_month, end_month, display_order) VALUES (?,?,?,?,?,?,?)')
    .run(pid, 'act-lock', 'Monthly Department Meeting', 'COUNT', 1, 12, 0)).lastID);
});
const read = async (site) => {
  const r = (await db.prepare('SELECT months_json FROM tracker_inputs_v2 WHERE year=? AND site=? AND activity_id=?').get(YEAR, site, aid));
  return r ? JSON.parse(r.months_json) : null;
};
const at = (m, d) => new Date(YEAR, m, d, 10, 0, 0);   // local time, month 0-based

test('rule: previous month editable until the 5th, closed from the 6th', () => {
  assert.equal(ML.isClosed(YEAR, 4, at(5, 5)), false, 'May is still open on 5 June');
  assert.equal(ML.isClosed(YEAR, 4, at(5, 6)), true, 'May is closed on 6 June');
  assert.equal(ML.isClosed(YEAR, 3, at(5, 1)), true, 'April is closed on 1 June');
  assert.equal(ML.isClosed(YEAR, 5, at(5, 20)), false, 'the current month is open');
  assert.equal(ML.isClosed(YEAR, 11, at(5, 20)), false, 'future months are untouched');
  assert.equal(ML.isClosed(YEAR - 1, 11, new Date(YEAR, 0, 3)), false, 'December stays open until 5 January');
  assert.equal(ML.isClosed(YEAR - 1, 11, new Date(YEAR, 0, 6)), true);
});

test('mergeClosed keeps the stored value of closed months and counts the blocked edits', () => {
  const stored = [1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0];
  const incoming = [9, 2, 3, 4, 7, 8, 0, 0, 0, 0, 0, 0];
  const r = ML.mergeClosed(YEAR, incoming, stored, at(5, 10));   // closed: Jan..May
  assert.deepEqual(r.months, [1, 2, 3, 4, 5, 8, 0, 0, 0, 0, 0, 0]);
  assert.equal(r.blocked, 2);
  const none = ML.mergeClosed(YEAR, [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], null, at(5, 10));
  assert.equal(none.months[0], 0, 'no stored row: a closed month cannot be created');
});

test('saveTracker: lockClosed keeps closed months, super_admin (no lock) may change them', async () => {
  (await db.prepare('INSERT INTO tracker_inputs_v2 (year, site, activity_id, months_json) VALUES (?,?,?,?)')
    .run(YEAR, 'HGO', aid, JSON.stringify([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0])));
  const D = { inputs: { [YEAR]: { HGO: [[5, 5, 5, 5, 5, 6, 0, 0, 0, 0, 0, 0]] } } };
  const r = await td.saveTracker(D, ['HGO'], { lockClosed: true, now: at(5, 10) });
  assert.equal(r.blocked, 5);
  assert.deepEqual((await read('HGO')), [1, 1, 1, 1, 1, 6, 0, 0, 0, 0, 0, 0]);
  await td.saveTracker(D, ['HGO'], { now: at(5, 10) });
  assert.deepEqual((await read('HGO')), [5, 5, 5, 5, 5, 6, 0, 0, 0, 0, 0, 0], 'no lock: every month written');
});

test('import of department meetings respects the closed months too', async () => {
  (await db.prepare('INSERT INTO tracker_inputs_v2 (year, site, activity_id, months_json) VALUES (?,?,?,?) ON CONFLICT (year, site, activity_id) DO UPDATE SET months_json = excluded.months_json')
    .run(YEAR, 'MGO', aid, JSON.stringify([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
  const r = await td.setActivityMonthsByName(YEAR, 'MGO', 'Monthly Department Meeting',
    [3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0], { lockClosed: true, now: at(5, 3) });   // 3 June: May still open
  assert.equal(r.ok, true);
  assert.deepEqual((await read('MGO')), [2, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0]);
});

test('the page loads the rule and disables closed cells below super_admin', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'activity-tracker.html'), 'utf8');
  assert.match(page, /<script src="lib\/trackerMonthLock\.js"><\/script>/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'activity-tracker', 'App.jsx'), 'utf8');
  assert.match(app, /IS_SUPER\s*=\s*hasRole\('super_admin'\)/);
  assert.match(app, /disabled=\{!canSave \|\| isInactive \|\| closed\}/);
  assert.match(app, /closed_blocked/);
});
