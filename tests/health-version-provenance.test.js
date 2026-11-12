'use strict';
// F-ARCH-03 — "which code is running": the source identity (package.json + git when there is a
// repository) next to the identity of the INSTALLED artifact (manifest.json: version, commit,
// signature checked against the embedded public key) and of the shipped SBOM. Unknown stays null.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const u = require('../services/updatePackage');
const prov = require('../services/runtimeProvenance');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SBOM = Buffer.from('{"bomFormat":"CycloneDX"}\n');
const manifest = (over = {}) => u.buildManifest(
  [{ path: 'server.js', data: Buffer.from('x') }, { path: 'sbom.cdx.json', data: SBOM }],
  { version: '2.0.0-alpha.14', commit: 'abc1234', builtAt: new Date('2026-11-12T00:00:00Z'), ...over });
const text = (m) => JSON.stringify(m, null, 2);

test('source identity: a git short SHA is a commit, the boot-time token is not', () => {
  assert.deepEqual(prov.compute({ pkgVersion: '2.0.0', build: 'abc1234' }).source, { version: '2.0.0', commit: 'abc1234', commit_source: 'git' });
  assert.deepEqual(prov.compute({ pkgVersion: '2.0.0', build: 'tm9x2k1' }).source, { version: '2.0.0', commit: null, commit_source: 'none' });
  assert.deepEqual(prov.compute({ pkgVersion: '2.0.0', build: null }).source, { version: '2.0.0', commit: null, commit_source: 'none' });
});

test('no installed manifest: artifact, sbom and consistent are unknown (null), never guessed', () => {
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: 'abc1234', manifestText: null, publicKeyPem: PUB });
  assert.equal(p.artifact, null); assert.equal(p.sbom, null); assert.equal(p.consistent, null);
});

test('unreadable manifest: artifact null', () => {
  assert.equal(prov.compute({ pkgVersion: '2.0.0', build: null, manifestText: '{not json', publicKeyPem: PUB }).artifact, null);
});

test('signed manifest that verifies: signed + signature_verified true, sha of the manifest bytes', () => {
  const t = text(u.signManifest(manifest(), PRIV));
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: 'tzzz', manifestText: t, publicKeyPem: PUB, sbomBuf: SBOM });
  assert.equal(p.artifact.version, '2.0.0-alpha.14'); assert.equal(p.artifact.commit, 'abc1234');
  assert.equal(p.artifact.built_at, '2026-11-12T00:00:00.000Z');
  assert.equal(p.artifact.manifest_sha256, u.sha256(Buffer.from(t, 'utf8')));
  assert.equal(p.artifact.signed, true); assert.equal(p.artifact.signature_verified, true);
  assert.match(p.artifact.key_id, /^[0-9a-f]{16}$/);
  assert.deepEqual(p.sbom, { present: true, sha256: u.sha256(SBOM), matches_manifest: true });
  assert.equal(p.consistent, true);
});

test('unsigned manifest: signed false, signature_verified null (nothing was verified)', () => {
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: null, manifestText: text(manifest()), publicKeyPem: PUB });
  assert.equal(p.artifact.signed, false); assert.equal(p.artifact.signature_verified, null); assert.equal(p.artifact.key_id, null);
  assert.deepEqual(p.sbom, { present: false, sha256: null, matches_manifest: null });
});

test('tampered manifest or foreign key: signed true, signature_verified false, and not consistent', () => {
  const m = u.signManifest(manifest(), PRIV); m.commit = 'fffffff';
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: null, manifestText: text(m), publicKeyPem: PUB });
  assert.equal(p.artifact.signed, true); assert.equal(p.artifact.signature_verified, false);
  assert.equal(p.consistent, false);
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.equal(prov.compute({ pkgVersion: '2.0.0-alpha.14', build: null, manifestText: text(u.signManifest(manifest(), PRIV)), publicKeyPem: other }).artifact.signature_verified, false);
});

test('signed manifest but no public key to check it with: signature_verified null, never true', () => {
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: null, manifestText: text(u.signManifest(manifest(), PRIV)), publicKeyPem: null });
  assert.equal(p.artifact.signed, true); assert.equal(p.artifact.signature_verified, null);
});

test('version or commit mismatch between source and artifact: consistent false', () => {
  const t = text(u.signManifest(manifest(), PRIV));
  assert.equal(prov.compute({ pkgVersion: '2.0.0-alpha.13', build: null, manifestText: t, publicKeyPem: PUB }).consistent, false);
  assert.equal(prov.compute({ pkgVersion: '2.0.0-alpha.14', build: 'def5678', manifestText: t, publicKeyPem: PUB }).consistent, false);
  assert.equal(prov.compute({ pkgVersion: '2.0.0-alpha.14', build: 'abc1234', manifestText: t, publicKeyPem: PUB }).consistent, true);
});

test('an SBOM that differs from the one the manifest lists is reported, not hidden', () => {
  const t = text(u.signManifest(manifest(), PRIV));
  const p = prov.compute({ pkgVersion: '2.0.0-alpha.14', build: null, manifestText: t, publicKeyPem: PUB, sbomBuf: Buffer.from('other') });
  assert.equal(p.sbom.present, true); assert.equal(p.sbom.matches_manifest, false);
});

test('load() reads manifest.json, sbom.cdx.json and the public key from an install directory; no path in the answer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0-alpha.14' }));
  fs.writeFileSync(path.join(dir, 'tools', 'manifest-public.pem'), PUB);
  assert.equal(prov.load(dir, { build: 'tabc' }).artifact, null);
  fs.writeFileSync(path.join(dir, 'manifest.json'), text(u.signManifest(manifest(), PRIV)));
  fs.writeFileSync(path.join(dir, 'sbom.cdx.json'), SBOM);
  const p = prov.load(dir, { build: 'tabc' });
  assert.equal(p.artifact.signature_verified, true); assert.equal(p.sbom.matches_manifest, true); assert.equal(p.consistent, true);
  assert.ok(!JSON.stringify(p).includes(dir), 'no directory in the answer');
  assert.match(prov.line(p), /artifact 2\.0\.0-alpha\.14 commit abc1234 signature verified/);
  assert.match(prov.line(prov.load(os.tmpdir() + '/does-not-exist', { build: null })), /artifact unknown/);
});
