'use strict';
// 2026-10-15 — reports.html: the import window previews the week's actions (one checkbox per
// action, the reason when it cannot be imported), every action shows its group identity, and
// the automatic carry-over of a blank week only takes importable actions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const { fnSource } = require('./_fn-source');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8').replace(/\r\n/g, '\n');

test('the shared group helper is loaded', () => {
  assert.match(src, /<script src="lib\/actionGroups\.js"><\/script>/);
});

test('picking a week opens a preview with checkboxes instead of importing everything', () => {
  const body = fnSource(src, '_importFromWeek');
  assert.ok(!/forEach\(a => addActionRow/.test(body), 'no blind import of the whole week');
  assert.match(body, /_renderImportPreview/);
  const prev = fnSource(src, '_renderImportPreview');
  assert.match(prev, /type="checkbox"/);
  assert.match(prev, /importable/);
  assert.match(src, /Importer la sélection/);
});

test('every refusal reason has a label', () => {
  for (const r of ['déjà dans ce rapport', 'fermée depuis', 'annulée']) assert.ok(src.includes(r), r);
});

test('actions typed in the editor but not saved count as already in the report', () => {
  assert.match(fnSource(src, '_currentActionKeys'), /dataset\.lineage \|\| tr\.dataset\.uid/);
});

test('the merge window and the import preview show the group badge', () => {
  assert.match(fnSource(src, 'openMergeCleanup'), /_grpBadge\(/);
  assert.match(fnSource(src, '_renderImportPreview'), /_grpBadge\(/);
});

test('the automatic carry-over keeps only importable actions', () => {
  assert.match(fnSource(src, 'maybeReconductActions'), /importable !== false/);
});

test('every inline script still compiles', () => {
  const scripts = [...src.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
  for (const s of scripts) new Function(s);
});
