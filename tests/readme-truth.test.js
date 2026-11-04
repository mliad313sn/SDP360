'use strict';
// B-04 — documentation truth for the TEST operator. README.md is the first page an operator
// reads: it must describe the stack that actually ships (Node 22, PostgreSQL 17 only — SQLite was
// removed by PO-08 on 2026-10-28), the real test command and a test count that matches the
// reviewed suite manifest, and a file map whose paths exist. The pilot pages must link files
// that exist, and the pilot profile must agree with services/reportConfig.js DEFAULTS.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const readme = read('README.md');

test('README never mentions SQLite or Node.js 18', () => {
  assert.ok(!/sqlite/i.test(readme), 'README.md still mentions sqlite');
  assert.ok(!/node(\.js)?\s*18/i.test(readme), 'README.md still mentions Node.js 18');
});

test('README states Node 22 and PostgreSQL 17, matching package.json engines', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.engines.node, /22/);
  assert.match(readme, /Node\.js 22/);
  assert.match(readme, /PostgreSQL 17/);
});

test('README test count is within 10 % of the reviewed suite manifest', () => {
  const manifest = JSON.parse(read('tests/.suite-manifest.json'));
  const m = readme.match(/~\s*([\d\s,]+)\s+tests/);
  assert.ok(m, 'README.md must state an approximate test count ("~N tests")');
  const stated = Number(m[1].replace(/[\s,]/g, ''));
  assert.ok(Math.abs(stated - manifest.total) / manifest.total <= 0.10,
    `README states ~${stated} tests, manifest total is ${manifest.total}`);
  assert.match(readme, /PG_ADMIN_URL/, 'README must say the suite needs PostgreSQL (PG_ADMIN_URL)');
});

test('every path in the README repository layout exists', () => {
  const block = readme.split('## Repository layout')[1].split('```')[1];
  const paths = block.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
    .filter((p) => !p.includes('*'));
  assert.ok(paths.length >= 8);
  for (const p of paths) assert.ok(fs.existsSync(path.join(root, p)), `README layout lists missing path ${p}`);
});

test('routes/roadmap.js no longer claims it is not mounted', () => {
  assert.ok(!/NOT mounted/i.test(read('routes/roadmap.js')));
  assert.match(read('server.js'), /require\('\.\/routes\/roadmap'\)/);
});

test('TEST-INSTANCE.md links the runbooks in execution order, and every link resolves', () => {
  const doc = read('docs/ops/pilot/TEST-INSTANCE.md');
  const order = ['INSTALLATION.md', 'EXPLOITATION.md', 'RELEASE-RUNBOOK-2026-10-29.md', 'REPLICA-RESTORE.md'];
  const pos = order.map((f) => doc.indexOf(f));
  for (let i = 0; i < order.length; i++) assert.ok(pos[i] >= 0, `${order[i]} not linked`);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], `${order[i]} out of order`);
  for (const [, href] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (/^https?:/.test(href)) continue;
    assert.ok(fs.existsSync(path.resolve(root, 'docs/ops/pilot', href)), `broken link ${href}`);
  }
});

test('PILOT-PROFILE.md: every built switch exists in DEFAULTS with the stated default', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  const doc = read('docs/ops/pilot/PILOT-PROFILE.md');
  const rows = doc.split('\n').filter((l) => /^\|\s*`[a-z0-9_]+`/.test(l));
  assert.ok(rows.length >= 2);
  let built = 0;
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const key = cells[0].replace(/`/g, '');
    const status = cells[1];
    if (/planned/i.test(status)) continue;   // not built yet on this branch
    built++;
    assert.ok(key in DEFAULTS, `${key} marked built but missing from reportConfig DEFAULTS`);
    const stated = (cells[2].match(/`([^`]*)`/) || [])[1];
    assert.strictEqual(stated, DEFAULTS[key], `${key}: profile says default ${stated}, DEFAULTS has ${DEFAULTS[key]}`);
  }
  assert.ok(built >= 2, 'expected at least the A-08 switches as built');
});
