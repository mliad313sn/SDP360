'use strict';
// Step 1 — the truncation guard that stands between a partial Zoho export and the reconcile
// (mass-delete) step. Pure function test + the error contract the runner relies on.
const test = require('node:test');
const assert = require('node:assert');
const { assertNotTruncated } = require('../zoho-sync');

test('accepts a fetch within tolerance of the stored count (and any fetch on an empty table)', () => {
  assert.doesNotThrow(() => assertNotTruncated('requests', 1000, 1000, 20));
  assert.doesNotThrow(() => assertNotTruncated('requests', 850, 1000, 20));   // −15 %
  assert.doesNotThrow(() => assertNotTruncated('requests', 1200, 1000, 20));  // growth is fine
  assert.doesNotThrow(() => assertNotTruncated('requests', 0, 0, 20));        // first run
  assert.doesNotThrow(() => assertNotTruncated('requests', 3, 0, 20));
});

test('refuses a fetch smaller than the stored count by more than the tolerance, marked transient', () => {
  let err = null;
  try { assertNotTruncated('requests', 700, 1000, 20); } catch (e) { err = e; }
  assert.ok(err, 'throws');
  assert.equal(err.transient, true, 'runner must retry instead of applying');
  assert.equal(err.truncation, true);
  assert.match(err.message, /truncated/);
  assert.throws(() => assertNotTruncated('requests', 0, 56000, 20), /truncated/);
});

test('tolerance is clamped to 0..90 %', () => {
  assert.throws(() => assertNotTruncated('j', 999, 1000, 0));     // 0 % → any shrink refused
  assert.doesNotThrow(() => assertNotTruncated('j', 200, 1000, 500)); // >90 clamps to 90 → 200 ≥ 100 ok
});
