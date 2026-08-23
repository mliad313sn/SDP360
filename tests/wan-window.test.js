'use strict';
// merakiWindow — the single window definition for WAN Health, mirroring Meraki's Summary Report
// presets read from the live selector on 2026-08-23 (asOf that day):
//   Past Day   2026-08-22 → 2026-08-22   (1 complete day, ending yesterday)
//   Past Week  2026-08-16 → 2026-08-22   (7 complete days, ending yesterday; NOT ISO Mon–Sun)
//   Past Month 2026-07-24 → 2026-08-22   (30 complete days, ending yesterday; NOT calendar month)
// Uniform rule: to = start of today (00:00 UTC), from = to − N days. Every preset ends yesterday.
const { test } = require('node:test');
const assert = require('node:assert');
const { merakiWindow } = require('../services/wanWindow');

// asOf = 2026-08-23, mid-day (time-of-day must be ignored → windows snap to UTC day starts).
const ASOF = Date.parse('2026-08-23T09:41:00Z');

test('week = last 7 complete days ending yesterday (Aug16 00:00 → Aug23 00:00)', () => {
  const w = merakiWindow('week', ASOF);
  assert.equal(w.toISO, '2026-08-23T00:00:00.000Z');
  assert.equal(w.fromISO, '2026-08-16T00:00:00.000Z');
  assert.equal(w.days, 7);
  assert.equal(w.period, 'week');
});

test('day = yesterday only (Aug22 00:00 → Aug23 00:00)', () => {
  const w = merakiWindow('day', ASOF);
  assert.equal(w.fromISO, '2026-08-22T00:00:00.000Z');
  assert.equal(w.toISO, '2026-08-23T00:00:00.000Z');
  assert.equal(w.days, 1);
});

test('month = last 30 complete days ending yesterday (Jul24 00:00 → Aug23 00:00)', () => {
  const w = merakiWindow('month', ASOF);
  assert.equal(w.fromISO, '2026-07-24T00:00:00.000Z');
  assert.equal(w.toISO, '2026-08-23T00:00:00.000Z');
  assert.equal(w.days, 30);
});

test('unknown/absent period defaults to week', () => {
  assert.equal(merakiWindow('bogus', ASOF).days, 7);
  assert.equal(merakiWindow(undefined, ASOF).days, 7);
});

test('to is always start-of-today regardless of the time-of-day in asOf', () => {
  const early = merakiWindow('week', Date.parse('2026-08-23T00:00:01Z'));
  const late = merakiWindow('week', Date.parse('2026-08-23T23:59:59Z'));
  assert.equal(early.toISO, late.toISO);
  assert.equal(early.toISO, '2026-08-23T00:00:00.000Z');
});

test('fromMs/toMs are the numeric mirrors of fromISO/toISO', () => {
  const w = merakiWindow('week', ASOF);
  assert.equal(w.fromMs, Date.parse(w.fromISO));
  assert.equal(w.toMs, Date.parse(w.toISO));
  assert.equal(w.toMs - w.fromMs, 7 * 86400000);
});
