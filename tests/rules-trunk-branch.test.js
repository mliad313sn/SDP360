'use strict';
// P01 — one baseline, one truth. The rules and the truth/plan documents an agent reads first must name the
// trunk, not a branch the work no longer lands on (they named claude/sdp360-consolidation for weeks after
// the work moved). Allowed names: the trunk, and `main` (the protected trunk a human is asked to create).
// When the trunk changes, update TRUNK here AND the documents in one commit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRUNK = 'claude/sdp-dashboard-analysis-55b1oy';
const ALLOWED = new Set([TRUNK, 'main']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(md|json|txt)$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = [
  ...walk(path.join(ROOT, '.claude')),
  ...['TRUTH-MATRIX.md', 'RELEASE-GATES.md', 'MASTER-PLAN.md', 'RELEASE-RUNBOOK-2026-10-29.md']
    .map((f) => path.join(ROOT, 'docs/sdp360/completion', f)),
].filter((f) => fs.existsSync(f));

// A branch-shaped token: a known branch prefix not preceded by a path or word character (".claude/rules"
// is a path, not a branch).
const BRANCH_RE = /(?<![\w./-])(?:claude|qual|dependabot|feat|fix|audit|release|hotfix)\/[A-Za-z0-9._/-]*[A-Za-z0-9]/g;
// `main` written as a branch: in backticks.
const MAIN_RE = /`main`/;

test('rules and truth documents name only the trunk (or the proposed protected main)', () => {
  assert.ok(FILES.length >= 3, 'expected the rules + truth documents to exist');
  const bad = [];
  for (const f of FILES) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(BRANCH_RE)) {
      if (!ALLOWED.has(m[0])) bad.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
  assert.deepStrictEqual(bad, [], 'a rules/truth document names a branch that is not the trunk');
});

test('the boundaries rule names the trunk explicitly', () => {
  const src = fs.readFileSync(path.join(ROOT, '.claude/rules/SDP360_BOUNDARIES.md'), 'utf8');
  assert.ok(src.includes('`' + TRUNK + '`'), 'SDP360_BOUNDARIES.md must name the trunk');
  assert.ok(MAIN_RE.test(src), 'SDP360_BOUNDARIES.md must name the proposed protected main');
});

test('the scanner catches a stale branch (self-check)', () => {
  const sample = 'see `.claude/rules/x.md` on branch `claude/sdp360-consolidation`';
  const hits = [...sample.matchAll(BRANCH_RE)].map((m) => m[0]);
  assert.deepStrictEqual(hits, ['claude/sdp360-consolidation']);
});
