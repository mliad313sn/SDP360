#!/usr/bin/env node
'use strict';
// P06 — PROPOSAL tooling for splitting CLAUDE.md (≈566 KB) into a short rules file plus dated archives.
// It never edits CLAUDE.md. Replacing CLAUDE.md is a human decision (it is the owner's project memory):
// the reviewed short file is docs/agent-execution/P06-CLAUDE-md-proposed.md; this script produces the
// archives it points to, and proves the split loses no line.
//
//   node tools/agent/claude-md-split.js --out=<dir>     write <dir>/history/<YYYY-MM>.md (dated "state"
//                                                        sections) + <dir>/reference/<slug>.md (the rest)
//   node tools/agent/claude-md-split.js --check         split into a temp dir and verify every line of
//                                                        CLAUDE.md lands in exactly one archive (exit 1 if not)
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'section';
}

/** Split CLAUDE.md text into [{file, lines}] — preamble, dated sections by month, reference sections by slug. */
function split(text) {
  const L = text.split('\n');
  const heads = [];
  L.forEach((l, i) => { if (/^## /.test(l)) heads.push(i); });
  const out = new Map();
  const put = (file, lines) => { if (!out.has(file)) out.set(file, []); out.get(file).push(...lines); };
  put('reference/00-preamble.md', L.slice(0, heads[0] === undefined ? L.length : heads[0]));
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1] : L.length;
    const title = L[h].replace(/^##\s*/, '');
    const m = /\b(?:as of|state \(as of)\s*(\d{4}-\d{2})-\d{2}/i.exec(title) || /\((?:as of )?(\d{4}-\d{2})-\d{2}/.exec(title);
    const dated = /^⚡\s*(Current|Prior) state/.test(title) && m;
    put(dated ? `history/${m[1]}.md` : `reference/${slug(title.replace(/^⚡\s*/, ''))}.md`, L.slice(h, end));
  });
  return [...out.entries()].map(([file, lines]) => ({ file, lines }));
}

function write(dir, parts) {
  for (const p of parts) {
    const f = path.join(dir, p.file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, p.lines.join('\n') + '\n');
  }
}

/** Lossless check: the multiset of lines across all parts equals CLAUDE.md's lines. */
function check(text, parts) {
  const all = parts.flatMap((p) => p.lines);
  const src = text.split('\n');
  return all.length === src.length && all.slice().sort().join('\n') === src.slice().sort().join('\n');
}

function main() {
  const text = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const parts = split(text);
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  if (process.argv.includes('--check')) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-split-'));
    try {
      write(tmp, parts);
      const ok = check(text, parts);
      console.log(`${parts.length} archive files, ${text.length} chars, lossless=${ok}`);
      process.exitCode = ok ? 0 : 1;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return;
  }
  if (!outArg) { console.error('usage: --out=<dir> | --check'); process.exitCode = 2; return; }
  write(path.resolve(outArg.split('=')[1]), parts);
  console.log(`wrote ${parts.length} files`);
}

if (require.main === module) main();
module.exports = { split, check, slug };
