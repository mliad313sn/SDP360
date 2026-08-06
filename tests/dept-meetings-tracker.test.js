'use strict';
// TDD for services/deptMeetingsTracker.js — the pure reader that turns the
// Meetings module's real per-month PV counts into the 12-month array the
// Activity Tracker's "Monthly Department Meeting" activity expects. Pure:
// countFn is injected, so no DB is needed to test the mapping + windowing.
const test = require('node:test');
const assert = require('node:assert');
const { trackerToMeetingsCode, deptMeetingCounts } = require('../services/deptMeetingsTracker');

test('trackerToMeetingsCode maps the canonical divergences', () => {
  assert.equal(trackerToMeetingsCode('ITY'), 'SMI');   // Ity: tracker ITY → meetings SMI
  assert.equal(trackerToMeetingsCode('KLN'), 'KGO');   // Kalana
  assert.equal(trackerToMeetingsCode('EDV'), 'OUA');   // Ouagadougou
  assert.equal(trackerToMeetingsCode('SML'), 'SML');   // Lafigué (same)
  assert.equal(trackerToMeetingsCode('MGO'), 'MGO');   // Mana (same)
  assert.equal(trackerToMeetingsCode('mgo'), 'MGO');   // case-insensitive
});

test('sites with no meetings code resolve to null', () => {
  assert.equal(trackerToMeetingsCode('EXP'), null);    // Exploration — no meetings module
  assert.equal(trackerToMeetingsCode('TND'), null);    // Tanda — no meetings module
  assert.equal(trackerToMeetingsCode('ZZZ'), null);    // unknown
  assert.equal(trackerToMeetingsCode(''), null);
});

test('deptMeetingCounts returns a 12-slot array from injected countFn', async () => {
  const calls = [];
  // stub: return the month number as the count (Jan→1 … Dec→12)
  const countFn = ({ site, from, to }) => { calls.push({ site, from, to }); return parseInt(from.slice(5, 7), 10); };
  const r = await deptMeetingCounts({ trackerCode: 'ITY', year: 2026, countFn });
  assert.equal(r.applicable, true);
  assert.equal(r.meetingsCode, 'SMI');
  assert.deepEqual(r.months, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(calls.length, 12);
  assert.deepEqual(calls[0], { site: 'SMI', from: '2026-01-01', to: '2026-01-31' });
  assert.deepEqual(calls[6], { site: 'SMI', from: '2026-07-01', to: '2026-07-31' });
});

test('non-applicable site → applicable:false, zeros, countFn never called', async () => {
  let called = 0;
  const countFn = () => { called++; return 5; };
  const r = await deptMeetingCounts({ trackerCode: 'EXP', year: 2026, countFn });
  assert.equal(r.applicable, false);
  assert.equal(r.meetingsCode, null);
  assert.deepEqual(r.months, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(called, 0);
});

test('awaits an async countFn (postgres backend)', async () => {
  const countFn = async ({ from }) => (from.startsWith('2026-03') ? 3 : 0);
  const r = await deptMeetingCounts({ trackerCode: 'MGO', year: 2026, countFn });
  assert.deepEqual(r.months, [0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
