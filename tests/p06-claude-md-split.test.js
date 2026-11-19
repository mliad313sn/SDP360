'use strict';
// P06 — the CLAUDE.md split PROPOSAL is lossless (every line lands in exactly one archive) and never edits CLAUDE.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { split, check } = require('../tools/agent/claude-md-split');

test('splitting CLAUDE.md loses and duplicates no line', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  const parts = split(text);
  assert.ok(check(text, parts));
  assert.ok(parts.some((p) => p.file.startsWith('history/')) && parts.some((p) => p.file === 'reference/known-pitfalls.md'));
});

test('dated state sections go to history/<YYYY-MM>.md, the rest to reference/', () => {
  const parts = split('top\n## ⚡ Current state (as of 2026-10-16 — x)\na\n## ⚡ Prior state (as of 2026-05-12)\nb\n## Known Pitfalls\nc');
  assert.deepStrictEqual(parts.map((p) => p.file), ['reference/00-preamble.md', 'history/2026-10.md', 'history/2026-05.md', 'reference/known-pitfalls.md']);
});

test('the tool has no code path that writes CLAUDE.md', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'agent', 'claude-md-split.js'), 'utf8');
  assert.ok(!/writeFileSync\([^)]*CLAUDE\.md/.test(src));
});
