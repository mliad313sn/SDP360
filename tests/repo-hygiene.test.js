'use strict';
// G-02 — nothing machine-local may be tracked. On 2026-10-28 a `node_modules` symlink pointing at a
// developer path was committed (`.gitignore` had `node_modules/`, which matches a directory only).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let files;
try {
  files = execFileSync('git', ['ls-files', '-s'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\n').filter(Boolean)
    .map(l => { const [meta, p] = l.split('\t'); return { mode: meta.split(' ')[0], path: p }; });
} catch (_) { files = null; }

test('no symbolic link is tracked', { skip: files ? false : 'not a git checkout' }, () => {
  const links = files.filter(f => f.mode === '120000').map(f => f.path);
  assert.deepEqual(links, [], `tracked symlinks: ${links.join(', ')}`);
});

test('no dependency folder or local database is tracked', { skip: files ? false : 'not a git checkout' }, () => {
  const bad = files.map(f => f.path).filter(p =>
    /(^|\/)node_modules(\/|$)/.test(p) || /\.(db|sqlite|sqlite3)$/.test(p) || /(^|\/)\.env$/.test(p));
  assert.deepEqual(bad, [], `tracked local artefacts: ${bad.join(', ')}`);
});
