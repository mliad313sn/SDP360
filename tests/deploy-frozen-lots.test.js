'use strict';
// G-10 (audit 2026-09-24) — the packager must name the work a cumulative ZIP will
// never carry.
//
// Two lots sit BEHIND the deploy marker: the installer safety parity (578be34) and the
// frozen tracker RAG change (c97ae61 / e17b7b7). They were marked over with stripped
// ZIPs, so `git diff marker..HEAD` can never include them again and a future cumulative
// package silently omits them. The only thing standing between that and a lost safety
// feature today is a paragraph in CLAUDE.md that a hurried operator will not read.
//
// Run against the repository's REAL history: the two lots genuinely are ancestors of
// the current marker, and genuinely are not ancestors of the old 7fb62d9 baseline.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'deploy', 'Check-FrozenLots.ps1');
const LOTS = path.join(ROOT, 'tools', 'deploy', 'frozen-lots.json');

function run(base) {
  return execFileSync('powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Base', base, '-Root', ROOT],
    { encoding: 'utf8', cwd: ROOT });
}

test('the frozen-lot register exists and names both known lots', () => {
  const lots = JSON.parse(fs.readFileSync(LOTS, 'utf8')).lots;
  assert.ok(Array.isArray(lots) && lots.length >= 2);
  for (const l of lots) {
    assert.ok(l.id && l.commit && Array.isArray(l.paths) && l.paths.length, `lot ${l.id} is complete`);
    assert.ok(l.why, `lot ${l.id} says why it is frozen`);
  }
  assert.ok(lots.some(l => /installer/i.test(l.id)), 'the installer lot is registered');
  assert.ok(lots.some(l => /tracker/i.test(l.id)), 'the tracker lot is registered');
});

test('a lot behind the marker is named in the warning', () => {
  const marker = fs.readFileSync(path.join(ROOT, '.git', 'last-deployed'), 'utf8').trim();
  const out = run(marker);
  assert.match(out, /installer/i, 'the installer lot is reported as not carried');
  assert.match(out, /tracker/i, 'the tracker lot is reported as not carried');
  assert.match(out, /jamais|never|manuel|by hand/i, 'says the package will not carry it');
});

test('a base OLDER than the lots warns about nothing — the diff carries them', () => {
  const out = run('7fb62d9');
  assert.ok(!/installer-safety-parity/i.test(out), `nothing to warn about, got: ${out.trim()}`);
});

test('the check never fails the build — a warning is not a blocker', () => {
  const marker = fs.readFileSync(path.join(ROOT, '.git', 'last-deployed'), 'utf8').trim();
  run(marker);                    // execFileSync throws on a non-zero exit
  run('does-not-exist-at-all');   // an unusable base must not break packaging either
});

test('the packager calls the check', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'deploy', 'make-deploy-zip.ps1'), 'utf8');
  assert.match(src, /Check-FrozenLots\.ps1/, 'the packager runs the check');
});
