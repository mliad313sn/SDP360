'use strict';
// V1a Task 3 — weekOf(date) buckets an arbitrary date into its Monday-anchored ISO week.
const { test } = require('node:test');
const assert = require('node:assert');
const { weekOf } = require('../services/siteReportDeps');

test('Wednesday → its Monday..Sunday', () => {
  const w = weekOf('2026-07-22');            // Wed
  assert.equal(w.period_start, '2026-07-20'); // Mon
  assert.equal(w.period_end,   '2026-07-26'); // Sun
});
test('Monday maps to itself; Sunday maps back to its Monday', () => {
  assert.equal(weekOf('2026-07-20').period_start, '2026-07-20');
  assert.equal(weekOf('2026-07-26').period_start, '2026-07-20');
});
test('tolerates a datetime string (slices to date)', () => {
  assert.equal(weekOf('2026-07-22T12:00:00Z').period_start, '2026-07-20');
});
