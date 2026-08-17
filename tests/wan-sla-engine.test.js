'use strict';

const assert = require('node:assert');
const { test } = require('node:test');
const { serviceSecondsBetween, clipToService } = require('../services/wanSla');
const { SILVER_OFFICE, SILVER_MINE } = require('./_wanSlaFixtures');

test('serviceSecondsBetween counts only in-window time (Mon–Fri 8h = 40h/week)', () => {
  const from = Date.parse('2026-08-10T00:00:00Z'); // Monday
  const to   = Date.parse('2026-08-17T00:00:00Z'); // next Monday
  assert.equal(serviceSecondsBetween(SILVER_OFFICE, from, to), 40 * 3600);
});
test('clipToService keeps only the in-window part of an outage', () => {
  // Fri 2026-08-14 16:30→18:00 → only 16:30–17:00 = 30 min
  const s = Date.parse('2026-08-14T16:30:00Z'), e = Date.parse('2026-08-14T18:00:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 30 * 60);
});
test('clipToService splits across the lunch gap', () => {
  // Fri 12:30→14:30 → 12:30–13:00 (30m) + 14:00–14:30 (30m) = 60 min
  const s = Date.parse('2026-08-14T12:30:00Z'), e = Date.parse('2026-08-14T14:30:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 60 * 60);
});
test('clipToService returns 0 for a fully out-of-hours outage (weekend, office)', () => {
  const s = Date.parse('2026-08-15T09:00:00Z'), e = Date.parse('2026-08-15T10:00:00Z'); // Saturday
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 0);
});
test('mine calendar (Mon–Sun) counts weekend service hours', () => {
  const s = Date.parse('2026-08-15T09:00:00Z'), e = Date.parse('2026-08-15T10:00:00Z'); // Saturday
  assert.equal(clipToService(SILVER_MINE, [s, e]), 3600);
});
test('clipToService spanning midnight into the next service day', () => {
  // Thu 16:30 → Fri 08:30 : Thu 16:30–17:00 (30m) + Fri 08:00–08:30 (30m) = 60 min
  const s = Date.parse('2026-08-13T16:30:00Z'), e = Date.parse('2026-08-14T08:30:00Z');
  assert.equal(clipToService(SILVER_OFFICE, [s, e]), 60 * 60);
});
