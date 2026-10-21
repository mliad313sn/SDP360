'use strict';
// Goal 01 (2027 programme) — docs/sdp360/2027/feature-matrix.json is the machine-readable truth
// register. This test keeps it from rotting silently: schema, closed status vocabulary, and every
// cited path / test file must exist in the repository.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs/sdp360/2027/feature-matrix.json'), 'utf8'));
const STATUS_KEYS = ['documented', 'implemented_in_code', 'automated_test_passed', 'integrated_test_passed',
  'field_validated', 'security_approved', 'deployed', 'business_accepted'];
const VALUES = new Set(Object.keys(matrix.status_vocabulary || {}));

test('matrix header names the inspected commit and a non-empty feature list', () => {
  assert.match(String(matrix.inspected_head), /^[0-9a-f]{40}$/);
  assert.ok(Array.isArray(matrix.features) && matrix.features.length >= 15);
  assert.deepStrictEqual([...VALUES].sort(), ['documented_as_deployed', 'no', 'partial', 'unknown', 'yes']);
});

test('every feature has the full schema and only vocabulary statuses', () => {
  const names = new Set();
  for (const f of matrix.features) {
    assert.ok(typeof f.feature === 'string' && f.feature.length > 0);
    assert.ok(!names.has(f.feature), `duplicate feature ${f.feature}`); names.add(f.feature);
    assert.ok(Array.isArray(f.paths) && f.paths.length > 0, `${f.feature}: paths`);
    assert.ok(Array.isArray(f.tests), `${f.feature}: tests`);
    assert.strictEqual(typeof f.evidence, 'string');
    assert.strictEqual(typeof f.notes, 'string');
    assert.deepStrictEqual(Object.keys(f.statuses).sort(), [...STATUS_KEYS].sort(), `${f.feature}: status keys`);
    for (const k of STATUS_KEYS) assert.ok(VALUES.has(f.statuses[k]), `${f.feature}: ${k}=${f.statuses[k]}`);
  }
});

test('a feature claims automated_test_passed=yes only with at least one test file', () => {
  for (const f of matrix.features) {
    if (f.statuses.automated_test_passed === 'yes') assert.ok(f.tests.length > 0, f.feature);
  }
});

test('field validation, security approval and business acceptance are never asserted from this repo', () => {
  for (const f of matrix.features) {
    for (const k of ['field_validated', 'security_approved', 'business_accepted']) {
      assert.notStrictEqual(f.statuses[k], 'yes', `${f.feature}: ${k} cannot be proven from the repository`);
    }
    assert.notStrictEqual(f.statuses.deployed, 'yes', `${f.feature}: deployment cannot be verified here — use documented_as_deployed`);
  }
});

test('every cited path and test file exists', () => {
  for (const f of matrix.features) {
    for (const p of [...f.paths, ...f.tests]) {
      assert.ok(fs.existsSync(path.join(root, p)), `${f.feature}: missing ${p}`);
    }
    for (const t of f.tests) assert.match(t, /^tests\/.+\.test\.js$/, `${f.feature}: ${t} is not a test file`);
  }
});
