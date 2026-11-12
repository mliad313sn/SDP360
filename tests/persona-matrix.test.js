'use strict';
// F-UX-07 — the persona × task × screen matrix is generated from its sources (vision personas, head workspaces,
// journeys, protocol tasks), names only pages that exist, maps every journey, and is up to date (--check).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const P = require('../tools/agent/persona-matrix');
const ROOT = path.join(__dirname, '..');

test('seven vision personas; review.1 profiles stay NEEDS-REVIEW.1-ARTIFACT; gaps are named, not filled', () => {
  assert.equal(P.PERSONAS.length, 7);
  const { md, shell } = P.build();
  assert.equal((md.match(/NEEDS-REVIEW\.1-ARTIFACT \|/g) || []).length, 7);
  for (const g of ['Department Member', 'Validator', 'Guest / Invited User']) assert.match(md, new RegExp('\\*\\*' + g.replace(/[/]/g, '\\/') + '\\*\\*: no workspace'));
  for (const p of P.PERSONAS) for (const id of p.workspaces) assert.ok(shell.WORKSPACES.some((w) => w.id === id), 'workspace exists: ' + id);
});

test('every page named exists; every journey of PERSONA-JOURNEYS.md and every T1-T12 task is in the matrix', () => {
  const { md, journeys, tasks } = P.build();
  for (const m of md.matchAll(/`([a-z0-9/_-]+\.html)(\?[^`]*)?`/g)) assert.ok(fs.existsSync(path.join(ROOT, 'public', m[1].replace(/^public\//, ''))), 'page exists: ' + m[1]);
  assert.ok(journeys.length >= 30, 'journeys parsed: ' + journeys.length);
  for (const j of journeys) assert.ok(md.includes(j.journey.replace(/\|/g, '/')), 'journey mapped: ' + j.journey);
  assert.deepEqual(tasks.map((t) => t.id), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12']);
  for (const spec of fs.readdirSync(path.join(ROOT, 'tests', 'e2e')).filter((f) => f.endsWith('.spec.js'))) {
    if (journeys.some((j) => j.test.includes(spec))) assert.ok(md.includes(spec), spec);
  }
});

test('the committed matrix is up to date (--check)', () => {
  assert.strictEqual(fs.readFileSync(P.OUT, 'utf8'), P.build().md, 'run node tools/agent/persona-matrix.js');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'agent', 'persona-matrix.js'), '--check']);
});

test('first-click sheet: T1-T12, expected answers UNKNOWN (decision D4), results empty, pages exist', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'pilot', 'FIRST-CLICK-SHEET.csv'), 'utf8').trim().split(/\r?\n/);
  const head = csv[0].split(',');
  assert.deepEqual(head, ['task', 'persona', 'landing_page', 'candidate_page', 'expected_page', 'participant', 'first_click', 'correct', 'time_s', 'notes']);
  const rows = csv.slice(1).map((l) => l.split(','));
  assert.equal(rows.length, 12);
  const pages = require('../routes/pageUsage').knownPages(path.join(ROOT, 'public'));
  for (const r of rows) {
    assert.equal(r[4], 'UNKNOWN', 'expected answer not invented: ' + r[0]);
    assert.ok(r.slice(5).every((x) => x === ''), 'no result claimed: ' + r[0]);
    for (const p of [r[2], r[3]]) assert.ok(pages.has(p.split(':')[0]), 'page id exists: ' + p);
  }
  const A = require('../tools/pilot/adoption-report');
  assert.equal(A.parseExpected(csv.join('\n')).size, 0, 'nothing expected until D4 fills the column');
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'FIRST-CLICK-PROTOCOL.md'), 'utf8'), /protocol only — not run/);
});
