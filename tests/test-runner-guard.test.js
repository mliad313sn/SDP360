'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseEvents, summarize, check } = require('../tools/test/guard');

const A = path.resolve('/x/a.test.js'), B = path.resolve('/x/b.test.js');
const ev = (file, ok = true, kind = 'test') => ({ file, ok, kind });

test('parseEvents ignores blank and torn lines', () => {
  assert.strictEqual(parseEvents('{"ok":true,"file":"/a"}\n\n{"ok":tr\n').length, 1);
});

test('summarize counts tests, not suites, and failures', () => {
  const s = summarize([ev(A), ev(A, false), ev(B, true, 'suite')]);
  assert.strictEqual(s.tests, 2);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.files.size, 2);
});

test('check names a test file that reported nothing', () => {
  const r = check({ expectedFiles: [A, B], events: [ev(A)], minTests: 1 });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, [B]);
  assert.match(r.problems[0], /b\.test\.js/);
});

test('check fails under the floor, passes at it, fails without a floor', () => {
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A)], minTests: 2 }).ok, false);
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A), ev(A)], minTests: 2 }).ok, true);
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A)], minTests: NaN }).ok, false);
});
