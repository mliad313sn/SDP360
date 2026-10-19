'use strict';
// Step 5 — the pure half of the update package: manifest build/verify, SemVer, apply rules.
const test = require('node:test');
const assert = require('node:assert');
const u = require('../services/updatePackage');

const files = () => [
  { path: 'server.js', data: Buffer.from('console.log(1)') },
  { path: 'public/app.js', data: Buffer.from('x') },
  { path: './routes\\meetings.js', data: Buffer.from('y') },   // normalised
];

test('buildManifest hashes every file, sorts paths, normalises separators', () => {
  const m = u.buildManifest(files(), { version: '2.0.0-alpha.6', commit: 'abc1234' });
  assert.equal(m.format, 1);
  assert.deepEqual(Object.keys(m.files), ['public/app.js', 'routes/meetings.js', 'server.js']);
  assert.equal(m.files['server.js'].sha256, u.sha256(Buffer.from('console.log(1)')));
  assert.equal(m.files['server.js'].size, 14);
  assert.match(m.built_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildManifest refuses traversal, duplicates and non-SemVer versions', () => {
  assert.throws(() => u.buildManifest([{ path: '../x', data: Buffer.alloc(1) }], { version: '1.0.0' }), /unsafe/);
  assert.throws(() => u.buildManifest([{ path: 'a', data: Buffer.alloc(1) }, { path: './a', data: Buffer.alloc(1) }], { version: '1.0.0' }), /duplicate/);
  assert.throws(() => u.buildManifest(files(), { version: 'latest' }), /SemVer/);
});

test('verifyManifest: one corrupt byte or one missing file refuses the WHOLE package', () => {
  const m = u.buildManifest(files(), { version: '2.0.0' });
  const good = { 'server.js': Buffer.from('console.log(1)'), 'public/app.js': Buffer.from('x'), 'routes/meetings.js': Buffer.from('y') };
  assert.equal(u.verifyManifest(m, p => good[p] || null).ok, true);
  const bad = { ...good, 'public/app.js': Buffer.from('X') };
  const r = u.verifyManifest(m, p => bad[p] || null);
  assert.equal(r.ok, false); assert.deepEqual(r.mismatched, ['public/app.js']);
  const partial = { ...good }; delete partial['server.js'];
  const r2 = u.verifyManifest(m, p => partial[p] || null);
  assert.equal(r2.ok, false); assert.deepEqual(r2.missing, ['server.js']);
  assert.equal(u.verifyManifest({ format: 2, files: {} }, () => null).ok, false);
});

test('SemVer: pre-release ordering, release outranks pre-release', () => {
  assert.equal(u.compareVersions('2.0.0-alpha.6', '2.0.0-beta.1'), -1);
  assert.equal(u.compareVersions('2.0.0-alpha.10', '2.0.0-alpha.9'), 1);
  assert.equal(u.compareVersions('2.0.0', '2.0.0-rc.1'), 1);
  assert.equal(u.compareVersions('v2.1.0', '2.0.9'), 1);
  assert.equal(u.compareVersions('1.11.0', '1.11.0'), 0);
  assert.throws(() => u.compareVersions('x', '1.0.0'));
});

test('canApply: upgrade yes, same version only on reinstall, downgrade only when explicit', () => {
  assert.deepEqual(u.canApply(null, '2.0.0'), { ok: true, kind: 'install' });
  assert.equal(u.canApply('2.0.0-alpha.5', '2.0.0-alpha.6').kind, 'upgrade');
  assert.equal(u.canApply('2.0.0', '2.0.0').ok, false);
  assert.equal(u.canApply('2.0.0', '2.0.0', { allowSame: true }).kind, 'reinstall');
  assert.match(u.canApply('2.1.0', '2.0.0').reason, /rollback/);
  assert.equal(u.canApply('2.1.0', '2.0.0', { allowDowngrade: true }).kind, 'downgrade');
});

test('install state is protected: .env, data/, node_modules/, logs/', () => {
  for (const p of ['.env', 'data/reports.db', 'node_modules/x/index.js', 'logs/out.log', 'backups/a.sql']) assert.ok(u.isProtected(p), p);
  for (const p of ['server.js', 'public/.env.example', 'tools/data/x']) assert.ok(!u.isProtected(p), p);
});
