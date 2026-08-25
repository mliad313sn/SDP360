'use strict';
// SP1.5 — business-only detection. True iff every role the user holds is a business viewer role
// (site-business / group-business); any hierarchy or other feature role makes them non-business-only.
const { test } = require('node:test');
const assert = require('node:assert');
const { isBusinessOnly } = require('../public/lib/businessRoles');

test('a lone business role → business-only', () => {
  assert.equal(isBusinessOnly(['site-business']), true);
  assert.equal(isBusinessOnly(['group-business']), true);
  assert.equal(isBusinessOnly(['site-business', 'group-business']), true);
});

test('a mixed role set is NOT business-only (keeps full access)', () => {
  assert.equal(isBusinessOnly(['site-business', 'viewer']), false);
  assert.equal(isBusinessOnly(['site-business', 'report-author']), false);
  assert.equal(isBusinessOnly(['group-business', 'admin']), false);
});

test('non-business roles → not business-only', () => {
  assert.equal(isBusinessOnly(['viewer']), false);
  assert.equal(isBusinessOnly(['executive']), false);
  assert.equal(isBusinessOnly(['super_admin']), false);
});

test('empty / missing roles → not business-only (fails safe: no forced redirect)', () => {
  assert.equal(isBusinessOnly([]), false);
  assert.equal(isBusinessOnly(null), false);
  assert.equal(isBusinessOnly(undefined), false);
});
