'use strict';

const { test } = require('node:test');
const assert   = require('node:assert');
const path     = require('path');
const { safeJoin } = require('../services/safeFilename');

const DIR = path.join('/srv', 'app', 'data');

test('keeps a normal filename inside dir', () => {
  const out = safeJoin(DIR, 'export.pptx');
  assert.strictEqual(path.dirname(out), path.resolve(DIR));
  assert.strictEqual(path.basename(out), 'export.pptx');
});

test('strips traversal — ../../etc/passwd cannot escape dir', () => {
  const out = safeJoin(DIR, '../../etc/passwd');
  assert.strictEqual(path.dirname(out), path.resolve(DIR));
  // basename of the traversal is "passwd"; it stays directly under DIR
  assert.strictEqual(path.basename(out), 'passwd');
});

test('strips an absolute path down to its basename', () => {
  const out = safeJoin(DIR, 'C:/Windows/System32/evil.dll');
  assert.strictEqual(path.dirname(out), path.resolve(DIR));
  assert.ok(!out.toLowerCase().includes('system32'));
});

test('sanitises unusual characters', () => {
  const out = safeJoin(DIR, 'a b;rm -rf.pptx');
  assert.strictEqual(path.dirname(out), path.resolve(DIR));
  assert.match(path.basename(out), /^[A-Za-z0-9._-]+$/);
});

test('forces the requested extension', () => {
  const out = safeJoin(DIR, 'report', { ext: '.pptx' });
  assert.strictEqual(path.extname(out), '.pptx');
  const out2 = safeJoin(DIR, 'report.txt', { ext: 'pptx' });
  assert.strictEqual(path.extname(out2), '.pptx');
});

test('empty / dotty names fall back', () => {
  assert.strictEqual(path.basename(safeJoin(DIR, '', { fallback: 'export.pptx' })), 'export.pptx');
  assert.strictEqual(path.basename(safeJoin(DIR, '..', { fallback: 'export.pptx' })), 'export.pptx');
  assert.strictEqual(path.basename(safeJoin(DIR, '   ', { fallback: 'x.bin' })), 'x.bin');
});

test('result always lives directly under dir (never a subdir or outside)', () => {
  for (const name of ['../x', 'a/b/c', '....//x', 'foo/../../bar', '%2e%2e/x']) {
    const out = safeJoin(DIR, name);
    assert.strictEqual(path.dirname(out), path.resolve(DIR), 'escaped for input: ' + name);
  }
});
