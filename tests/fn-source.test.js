'use strict';
// G-01 (audit 2026-09-24) — the helper that slices a function's source out of an
// HTML page for the static editor tests. Two invariants, both learned the hard way:
//
//   1. It must be LINE-ENDING AGNOSTIC. Git for Windows ships core.autocrlf=true in
//      the SYSTEM gitconfig, so every fresh checkout materialises public/*.html as
//      CRLF while `git status` stays clean. An LF-only '\n}\n' probe then returns
//      -1 and the slice degrades to ''.
//   2. It must NEVER return an empty slice. An empty string makes every NEGATIVE
//      assertion (assert.ok(!code.includes(...))) pass vacuously — the guarantees
//      the caller thinks it is protecting silently stop being checked.
const test = require('node:test');
const assert = require('node:assert');
const { fnSource } = require('./_fn-source');

const LF = [
  '<script>',
  'async function submitReport() {',
  "  if (!confirm('sure?')) return;",
  '  const shape = { a: 1 };',
  '}',
  'function other() { return 2; }',
  '</script>',
].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');

test('extracts the function body from an LF source', () => {
  const s = fnSource(LF, 'submitReport');
  assert.ok(s.includes('confirm('), 'carries the body');
  assert.ok(!s.includes('function other'), 'stops at the closing brace');
});

test('extracts the SAME body from a CRLF source (Windows checkout)', () => {
  assert.strictEqual(fnSource(CRLF, 'submitReport'), fnSource(LF, 'submitReport'));
});

test('finds a plain (non-async) declaration too', () => {
  assert.ok(fnSource(LF, 'other').includes('return 2'));
});

test('throws instead of returning an empty slice', () => {
  assert.throws(() => fnSource(LF, 'noSuchFunction'), /noSuchFunction/);
  assert.throws(() => fnSource('function orphan() {\n  return 1;', 'orphan'), /orphan/);
});
