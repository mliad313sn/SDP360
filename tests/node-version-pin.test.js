'use strict';
// G01 — one Node.js major everywhere: package.json engines, .nvmrc, every workflow and the installer's
// embedded runtime. A drift means CI proves a runtime that production does not run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const MAJOR = read('.nvmrc').trim();

test('.nvmrc names a single major', () => assert.match(MAJOR, /^\d+$/));

test('package.json and the lockfile engines pin the same major', () => {
  const want = `>=${MAJOR} <${Number(MAJOR) + 1}`;
  assert.strictEqual(JSON.parse(read('package.json')).engines.node, want);
  const lock = JSON.parse(read('package-lock.json'));
  assert.strictEqual(lock.packages[''].engines.node, want);
});

test('every workflow that sets up Node uses that major', () => {
  const dir = path.join(root, '.github', 'workflows');
  let seen = 0;
  for (const f of fs.readdirSync(dir)) {
    for (const m of read('.github/workflows/' + f).matchAll(/node-version:\s*['"]?([\d.]+)/g)) {
      seen++;
      assert.strictEqual(m[1].split('.')[0], MAJOR, `${f} uses Node ${m[1]}`);
    }
  }
  assert.ok(seen >= 3, 'expected CI, installer and release to set up Node');
});

test('the installer embeds the same major', () => {
  const m = read('tools/installer-v2/build.ps1').match(/\[string\]\$NodeVersion\s*=\s*'([\d.]+)'/);
  assert.ok(m, 'NodeVersion default not found');
  assert.strictEqual(m[1].split('.')[0], MAJOR);
});

test('the running interpreter satisfies the pin (tests run on the pinned major)', () => {
  assert.strictEqual(process.versions.node.split('.')[0], MAJOR);
});
