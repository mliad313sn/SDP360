'use strict';
// Goal 01 (2027 programme) — the release version must be stated identically in package.json,
// package-lock.json, the README header and the newest CHANGELOG heading. Before this test the three
// had drifted to alpha.12 / alpha.1 / alpha.13 with nothing failing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

const pkg = JSON.parse(read('package.json'));

test('package.json carries a semver version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
});

test('package-lock.json root version matches package.json', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.strictEqual(lock.version, pkg.version);
  if (lock.packages && lock.packages['']) assert.strictEqual(lock.packages[''].version, pkg.version);
});

test('README header version matches package.json', () => {
  const m = read('README.md').match(/\*\*Version:\*\*\s*([0-9A-Za-z.\-]+)/);
  assert.ok(m, 'README must contain a "**Version:** x.y.z" line');
  assert.strictEqual(m[1], pkg.version);
});

test('newest CHANGELOG heading matches package.json', () => {
  const m = read('CHANGELOG.md').match(/^## ([0-9A-Za-z.\-]+)/m);
  assert.ok(m, 'CHANGELOG must contain a "## <version>" heading');
  assert.strictEqual(m[1], pkg.version);
});
