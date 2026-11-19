'use strict';
// P07 — xlsx is installed from a vendor tarball URL (not the npm registry): the lockfile must pin it with a
// sha512 integrity hash, the SBOM must carry that hash and the distribution URL, and the installer cache
// script must keep an offline copy verified against the lockfile before it is kept.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

test('package-lock pins xlsx to an https tarball with a sha512 integrity', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const x = lock.packages['node_modules/xlsx'];
  assert.ok(x, 'xlsx in the lockfile');
  assert.match(x.resolved, /^https:\/\/cdn\.sheetjs\.com\/xlsx-[\d.]+\/xlsx-[\d.]+\.tgz$/);
  assert.match(x.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.ok(x.resolved.includes(x.version), 'URL and version agree');
});

test('the SBOM lists xlsx with the lockfile hash and its distribution URL', () => {
  const { build } = require('../tools/release/sbom');
  const bom = build();
  const c = bom.components.find((k) => k.name === 'xlsx');
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages['node_modules/xlsx'];
  assert.equal(c.hashes[0].content, Buffer.from(lock.integrity.slice(7), 'base64').toString('hex'));
  assert.deepEqual(c.externalReferences, [{ type: 'distribution', url: lock.resolved }]);
});

test('download-cache.ps1 keeps an offline xlsx copy only after checking the lockfile sha512', () => {
  const s = fs.readFileSync(path.join(ROOT, 'tools', 'installer-build', 'download-cache.ps1'), 'utf8');
  assert.match(s, /\$lock\.packages\.'node_modules\/xlsx'/);
  assert.match(s, /SHA512/);
  assert.match(s, /\$got -ne \$xl\.integrity[\s\S]*Remove-Item \$xlDest/, 'a mismatching file is deleted');
  assert.ok(!/[^\x00-\x7F]/.test(s), 'pure ASCII (Windows PowerShell 5.1)');
});
