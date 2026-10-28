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

// Consolidation P0-C — per-file census against tests/.suite-manifest.json.
const { census, checkManifest, skipReport, buildManifest } = require('../tools/test/guard');
const evs = (file, n, skip) => Array.from({ length: n }, () => ({ file, ok: true, kind: 'test', skip: skip || null }));

test('census counts tests and skip reasons per file', () => {
  const c = census([...evs(A, 2), ...evs(A, 1, 'no pg'), ...evs(B, 1)]);
  assert.deepStrictEqual(c['a.test.js'], { tests: 3, skipped: 1, reasons: { 'no pg': 1 } });
  assert.strictEqual(c['b.test.js'].tests, 1);
});

test('checkManifest flags a file that silently lost tests', () => {
  const p = checkManifest({ manifest: { files: { 'a.test.js': 5, 'b.test.js': 1 } }, census: census([...evs(A, 3), ...evs(B, 1)]), expectedFiles: [A, B] });
  assert.strictEqual(p.length, 1); assert.match(p[0], /a\.test\.js reported 3 tests, manifest expects at least 5/);
});

test('checkManifest flags a deleted file and an unreviewed new file', () => {
  const p = checkManifest({ manifest: { files: { 'gone.test.js': 2, 'a.test.js': 1 } }, census: census([...evs(A, 1), ...evs(B, 1)]), expectedFiles: [A, B] });
  assert.ok(p.some((x) => /gone\.test\.js .*no longer exists/.test(x)));
  assert.ok(p.some((x) => /b\.test\.js is not in/.test(x)));
});

test('more tests than recorded is fine; buildManifest totals; skipReport groups by reason', () => {
  assert.deepStrictEqual(checkManifest({ manifest: { files: { 'a.test.js': 1 } }, census: census(evs(A, 4)), expectedFiles: [A] }), []);
  const m = buildManifest(census([...evs(A, 2), ...evs(B, 3)]));
  assert.strictEqual(m.total, 5); assert.deepStrictEqual(m.files, { 'a.test.js': 2, 'b.test.js': 3 });
  assert.deepStrictEqual(skipReport(census([...evs(A, 2, 'no pg'), ...evs(B, 1, 'no pg')]))[0], ['no pg', { tests: 3, files: ['a.test.js', 'b.test.js'] }]);
});
