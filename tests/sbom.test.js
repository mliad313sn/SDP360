'use strict';
// G03 — the SBOM names every shipped production package (no dev dependency), carries its lockfile hash, and
// lists the components Setup.exe embeds.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { build, hashOf, purl } = require('../tools/release/sbom');

const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
const prod = Object.entries(lock.packages).filter(([p, v]) => p.startsWith('node_modules/') && !v.dev);
const dev = Object.entries(lock.packages).filter(([p, v]) => p.startsWith('node_modules/') && v.dev);

test('CycloneDX 1.5 shape, deterministic without --timestamp', () => {
  const a = build(), b = build();
  assert.strictEqual(a.bomFormat, 'CycloneDX'); assert.strictEqual(a.specVersion, '1.5');
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.ok(!a.metadata.timestamp);
});

test('every production package is listed, no dev dependency is', () => {
  const names = new Set(build().components.filter((c) => c.purl).map((c) => c.name));
  for (const [p] of prod) assert.ok(names.has(p.replace(/^.*node_modules\//, '')), p);
  for (const [p] of dev) { const n = p.replace(/^.*node_modules\//, ''); if (!prod.some(([q]) => q.endsWith('/' + n))) assert.ok(!names.has(n), 'dev dependency in SBOM: ' + n); }
});

test('lockfile integrity becomes a hex hash; bundled installer components are present', () => {
  assert.deepStrictEqual(hashOf('sha512-AAAA'), [{ alg: 'SHA-512', content: '000000' }]);
  assert.deepStrictEqual(hashOf(''), []);
  assert.strictEqual(purl('@scope/x', '1.0.0'), 'pkg:npm/%40scope/x@1.0.0');
  const bom = build();
  assert.ok(bom.components.some((c) => /PostgreSQL 17/.test(c.name)));
  assert.ok(bom.components.filter((c) => c.purl).every((c) => !c.hashes || c.hashes[0].content.length >= 40));
});
