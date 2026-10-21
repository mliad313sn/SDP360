'use strict';
// E1 — the manifest signature: the pure half (services/updatePackage) and the Manager's apply
// path (tools/sdp-manager). The key pair is GENERATED here, per run — no key material is ever
// committed; tools/manifest-public.pem (the placeholder shipped with the Manager) is only checked
// for shape.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const u = require('../services/updatePackage');
const mgr = require('../tools/sdp-manager');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const OTHER_PUB = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });

const OFF = { backup: false, npm: false, migrate: false, restart: false, probe: false, out: () => {}, publicKeyPem: PUB };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-sig-'));
const FILES = { 'server.js': 'v1', 'package-lock.json': 'lock' };

async function makePackage(dir, version, { sign = true, tamper } = {}) {
  const list = Object.entries(FILES).map(([p, s]) => ({ path: p, data: Buffer.from(s) }));
  let manifest = u.buildManifest(list, { version, commit: 'deadbee' });
  if (sign) manifest = u.signManifest(manifest, PRIV);
  if (tamper) tamper(manifest);
  const zip = new JSZip();
  for (const f of list) zip.file('files/' + f.path, f.data);
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const out = path.join(dir, `pkg-${version}-${sign ? 's' : 'u'}.zip`);
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
  return out;
}

test('signManifest / verifyManifestSignature: round trip survives re-serialisation, one changed byte breaks it', () => {
  const m = u.buildManifest([{ path: 'a.js', data: Buffer.from('x') }], { version: '2.0.0', commit: 'abc' });
  const s = u.signManifest(m, PRIV);
  assert.equal(s.signature.alg, 'ed25519');
  assert.match(s.signature.key_id, /^[0-9a-f]{16}$/);
  assert.equal(u.verifyManifestSignature(s, PUB).ok, true);
  // pretty-printed, key order shuffled → still verifies (canonical bytes)
  const shuffled = JSON.parse(JSON.stringify({ files: s.files, version: s.version, signature: s.signature, built_at: s.built_at, commit: s.commit, name: s.name, format: s.format }, null, 2));
  assert.equal(u.verifyManifestSignature(shuffled, PUB).ok, true);
  // altered hash → refused with a reason
  const altered = JSON.parse(JSON.stringify(s)); altered.files['a.js'].sha256 = u.sha256(Buffer.from('y'));
  const r = u.verifyManifestSignature(altered, PUB);
  assert.deepEqual([r.signed, r.ok], [true, false]); assert.match(r.reason, /does not match/);
  // signed with another key → refused, reason names the key mismatch
  const foreign = u.verifyManifestSignature(s, OTHER_PUB);
  assert.deepEqual([foreign.signed, foreign.ok], [true, false]); assert.match(foreign.reason, /another key/);
  // no signature → signed:false (never ok)
  assert.deepEqual(u.verifyManifestSignature(m, PUB), { signed: false, ok: false, reason: null, key_id: u.verifyManifestSignature(s, PUB).key_id });
  // the original manifest object is not mutated by signing
  assert.equal(m.signature, undefined);
  // a non-Ed25519 key is refused up front (never a silent "unsigned")
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.throws(() => u.signManifest(m, rsa), /ed25519/);
});

test('manager: a signed package is accepted and the key id is reported', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const lines = [];
  const zip = await makePackage(work, '2.0.0');
  const r = await mgr.applyPackage(zip, { dir: inst, ...OFF, out: l => lines.push(l) });
  assert.equal(r.ok, true);
  assert.ok(lines.some(l => /manifest signature OK \(key [0-9a-f]{16}\)/.test(l)), lines.join('\n'));
  assert.equal(fs.existsSync(path.join(inst, 'logs', 'sdp-manager.log')), false, 'no audit line when nothing was overridden');
});

test('manager: an altered package is refused before any write — even with --allow-unsigned', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const altered = await makePackage(work, '2.0.0', { tamper: m => { m.version = '2.0.0'; m.files['server.js'].sha256 = m.files['package-lock.json'].sha256; m.files['server.js'].size = 4; } });
  // (the file hash check would also catch this; the signature check must fire FIRST in the message and not depend on it)
  await assert.rejects(mgr.applyPackage(altered, { dir: inst, ...OFF }), /manifest signature invalid/);
  await assert.rejects(mgr.applyPackage(altered, { dir: inst, ...OFF, allowUnsigned: true }), /manifest signature invalid/);
  const foreignKey = await makePackage(work, '2.0.1');
  await assert.rejects(mgr.applyPackage(foreignKey, { dir: inst, ...OFF, publicKeyPem: OTHER_PUB, allowUnsigned: true }), /manifest signature invalid: signature made with another key/);
  assert.equal(fs.existsSync(path.join(inst, 'server.js')), false);
  assert.equal(fs.existsSync(path.join(inst, 'manifest.json')), false);
});

test('manager: an unsigned package is refused; --allow-unsigned accepts it AND logs the decision', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const unsigned = await makePackage(work, '2.0.0', { sign: false });
  await assert.rejects(mgr.applyPackage(unsigned, { dir: inst, ...OFF }), /manifest is not signed.*--allow-unsigned/);
  assert.equal(fs.existsSync(path.join(inst, 'server.js')), false);
  const events = [], lines = [];
  const r = await mgr.applyPackage(unsigned, { dir: inst, ...OFF, allowUnsigned: true, systemLog: e => { events.push(e); return Promise.resolve(); }, out: l => lines.push(l) });
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(path.join(inst, 'server.js'), 'utf8'), 'v1');
  // audit: manager log file
  const log = fs.readFileSync(path.join(inst, 'logs', 'sdp-manager.log'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'package_unsigned_allowed');
  assert.equal(log[0].risk, 1);
  assert.equal(log[0].details.version, '2.0.0');
  // audit: system_log hook (the server's rdb.logEvent when injected)
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'config');
  assert.equal(events[0].action, 'package_unsigned_allowed');
  assert.ok(lines.some(l => /AUDIT package_unsigned_allowed/.test(l)));
  // verify-only path reports the same decision
  const v = await mgr.verifyPackage(unsigned, { publicKeyPem: PUB, allowUnsigned: true });
  assert.deepEqual([v.result.ok, v.result.signature.signed, v.result.signature.allowed_unsigned], [true, false, true]);
  const v2 = await mgr.verifyPackage(unsigned, { publicKeyPem: PUB });
  assert.equal(v2.result.ok, false);
});

test('manager: without an injected key it reads tools/manifest-public.pem (an Ed25519 SPKI PEM, no private material)', () => {
  const pem = mgr.loadPublicKey();
  assert.equal(mgr.DEFAULT_PUBLIC_KEY, path.join(path.dirname(require.resolve('../tools/sdp-manager')), 'manifest-public.pem'));
  assert.match(pem, /-----BEGIN PUBLIC KEY-----/);
  assert.doesNotMatch(pem, /PRIVATE KEY/);
  assert.equal(crypto.createPublicKey(pem).asymmetricKeyType, 'ed25519');
  // the packager ships it: the manager on a server needs the key next to itself
  const { listRuntimeFiles } = require('../tools/deploy/make-update-package');
  let files = null;
  try { files = listRuntimeFiles(); } catch (_) { /* no git in this checkout */ }
  if (files) assert.ok(files.includes('tools/manifest-public.pem'), 'tools/manifest-public.pem must travel in the package');
});

test('packager: buildPackage signs when a key is given and says so, builds unsigned (loudly) otherwise', async () => {
  const { buildPackage } = require('../tools/deploy/make-update-package');
  const root = tmp();
  // minimal fake repo root: listRuntimeFiles needs git; use a tiny real repo
  const { execFileSync } = require('node:child_process');
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'public', 'activity-tracker', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server.js'), 'x'); fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(root, 'public', 'activity-tracker', 'dist', 'app.js'), 'b');
  execFileSync('git', ['add', '-A'], { cwd: root });
  const logs = [];
  const signed = await buildPackage({ outDir: path.join(root, 'dist-s'), version: '2.0.0', commit: 'abc', root, log: l => logs.push(l), signingKey: PRIV });
  assert.equal(signed.signed, true);
  assert.equal(u.verifyManifestSignature(JSON.parse(fs.readFileSync(path.join(root, 'dist-s', 'manifest.json'), 'utf8')), PUB).ok, true);
  assert.ok(logs.some(l => /manifest signed \(ed25519/.test(l)));
  assert.ok(!logs.join('\n').includes('PRIVATE'), 'the key never reaches the log');
  const unsigned = await buildPackage({ outDir: path.join(root, 'dist-u'), version: '2.0.0', commit: 'abc', root, log: l => logs.push(l), signingKey: '' });
  assert.equal(unsigned.signed, false);
  assert.ok(logs.some(l => /manifest NOT signed/.test(l)));
  // and the manager refuses that unsigned zip without the flag
  await assert.rejects(mgr.verifyPackage(unsigned.out, { publicKeyPem: PUB }).then(r => { if (!r.result.ok) throw new Error(r.result.errors.join(';')); }), /not signed/);
});
