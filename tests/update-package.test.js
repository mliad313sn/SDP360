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

// F-ARCH-03 — the SBOM is generated before packaging, shipped in the zip and listed in the manifest.
test('packager ships sbom.cdx.json and lists its hash in the manifest; a tree without package.json says so', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { execFileSync } = require('child_process');
  const JSZip = require('jszip');
  const { buildPackage } = require('../tools/deploy/make-update-package');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-sbom-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'public', 'activity-tracker', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server.js'), 'x');
  fs.writeFileSync(path.join(root, 'public', 'activity-tracker', 'dist', 'app.js'), 'b');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  execFileSync('git', ['add', '-A'], { cwd: root });
  const logs = [];
  const none = await buildPackage({ outDir: path.join(root, 'd0'), version: '2.0.0', commit: 'abc', root, log: (l) => logs.push(l), signingKey: '' });
  assert.equal(none.sbom, false);
  assert.ok(logs.some((l) => /SBOM NOT shipped/.test(l)), 'the gap is said, not hidden');

  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sdp-dashboard', version: '2.0.0' }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/a': { version: '1.0.0', integrity: 'sha512-AAAA' }, 'node_modules/d': { version: '1.0.0', dev: true } } }));
  execFileSync('git', ['add', '-A'], { cwd: root });
  const r = await buildPackage({ outDir: path.join(root, 'd1'), version: '2.0.0', commit: 'abc', root, log: () => {}, signingKey: '' });
  assert.equal(r.sbom, true);
  const entry = r.manifest.files['sbom.cdx.json'];
  assert.ok(entry && /^[0-9a-f]{64}$/.test(entry.sha256));
  const zip = await JSZip.loadAsync(fs.readFileSync(r.out));
  const inZip = await zip.file('files/sbom.cdx.json').async('nodebuffer');
  assert.equal(u.sha256(inZip), entry.sha256);
  assert.equal(u.sha256(fs.readFileSync(path.join(root, 'd1', 'sbom.cdx.json'))), entry.sha256, 'the copy next to the zip is the same bytes');
  const bom = JSON.parse(inZip.toString('utf8'));
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.ok(bom.components.some((c) => c.name === 'a') && !bom.components.some((c) => c.name === 'd'));
  assert.ok(!bom.metadata.timestamp, 'deterministic: no timestamp');
});
