'use strict';
// E-Q05 (audit Q-05, X-Q-02) — every package-lock entry resolved OUTSIDE registry.npmjs.org (a tarball URL,
// git, file) is invisible to `npm audit`: it must carry an `integrity` hash and be listed here with the
// reason and who reviews it by hand. A new non-registry source without an entry fails this test.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REGISTRY = /^https:\/\/registry\.npmjs\.org\//;
// package path in the lockfile → { source (exact resolved URL), reason, owner }
const ALLOWED = {
  'node_modules/xlsx': {
    source: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
    reason: 'SheetJS no longer publishes to npm after 0.18.5; 0.20.x fixes CVE-2023-30533 + ReDoS (SEC-01 1c)',
    owner: 'dependency owner — manual review of cdn.sheetjs.com advisories at each release (docs/agent-execution/DEPS-TRIAGE.md)',
  },
};

function nonRegistry(lock) {
  const out = [];
  for (const [k, v] of Object.entries(lock.packages || {})) {
    if (!k || v.link || v.inBundle) continue;          // root, workspace links and bundled deps carry no source
    if (v.resolved && !REGISTRY.test(v.resolved)) out.push({ path: k, resolved: v.resolved, integrity: v.integrity || null });
    else if (!v.resolved && k.startsWith('node_modules/')) out.push({ path: k, resolved: null, integrity: v.integrity || null });
  }
  return out;
}
function problems(entries, allowed = ALLOWED) {
  const p = [];
  for (const e of entries) {
    const a = allowed[e.path];
    if (!a) { p.push(`${e.path} resolved from ${e.resolved || '(nowhere)'} — not in the allow-list (add a reason + review owner)`); continue; }
    if (a.source !== e.resolved) p.push(`${e.path} moved from ${a.source} to ${e.resolved} — re-review`);
    if (!e.integrity || !/^sha(256|384|512)-/.test(e.integrity)) p.push(`${e.path} has no integrity hash`);
    if (!a.reason || !a.owner) p.push(`${e.path}: reason and owner are required`);
  }
  return p;
}

test('lockfile: every non-registry package is allow-listed, unmoved and integrity-pinned', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  const found = nonRegistry(lock);
  assert.deepEqual(found.map((e) => e.path), ['node_modules/xlsx'], 'today exactly one: xlsx from cdn.sheetjs.com');
  assert.deepEqual(problems(found), []);
  for (const k of Object.keys(ALLOWED)) assert.ok(found.some((e) => e.path === k), `${k} is allow-listed but no longer non-registry — remove the entry`);
});

test('a new non-registry package without a reason fails; a missing integrity fails; a moved URL fails', () => {
  const lock = { packages: { '': {}, 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-x' },
    'node_modules/evil': { resolved: 'https://example.com/evil-1.0.0.tgz', integrity: 'sha512-y' },
    'node_modules/xlsx': { resolved: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz' },
    'node_modules/gitdep': { resolved: 'git+ssh://git@github.com/x/y.git#abc' } } };
  const p = problems(nonRegistry(lock));
  assert.ok(p.some((m) => /node_modules\/evil .*not in the allow-list/.test(m)));
  assert.ok(p.some((m) => /node_modules\/gitdep .*not in the allow-list/.test(m)));
  assert.ok(p.some((m) => /xlsx has no integrity/.test(m)));
  assert.ok(problems(nonRegistry({ packages: { 'node_modules/xlsx': { resolved: 'https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz', integrity: 'sha512-z' } } })).some((m) => /moved/.test(m)));
});
