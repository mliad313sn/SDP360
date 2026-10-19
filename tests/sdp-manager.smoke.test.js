'use strict';
// Step 5 — the manager's apply/rollback core on a throwaway install directory. No pm2, no npm,
// no migrator, no PostgreSQL: those steps are switched off; the file logic is what is proven.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const u = require('../services/updatePackage');
const mgr = require('../tools/sdp-manager');

const OFF = { backup: false, npm: false, migrate: false, restart: false, probe: false, out: () => {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-mgr-'));

async function makePackage(dir, version, files, { corrupt } = {}) {
  const list = Object.entries(files).map(([p, s]) => ({ path: p, data: Buffer.from(s) }));
  const manifest = u.buildManifest(list, { version, commit: 'deadbee' });
  const zip = new JSZip();
  for (const f of list) zip.file('files/' + f.path, corrupt === f.path ? Buffer.from(f.data + '!') : f.data);
  zip.file('manifest.json', JSON.stringify(manifest));
  const out = path.join(dir, `pkg-${version}.zip`);
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
  return out;
}
const read = (dir, p) => fs.readFileSync(path.join(dir, p), 'utf8');

test('fresh install, then upgrade keeps a rollback point and never touches .env / data/', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  fs.mkdirSync(path.join(inst, 'data'), { recursive: true });
  fs.writeFileSync(path.join(inst, '.env'), 'DASH_PASS=secret\n');
  fs.writeFileSync(path.join(inst, 'data', 'reports.db'), 'DB');
  const v1 = await makePackage(work, '2.0.0', { 'server.js': 'v1', 'package-lock.json': 'lock1', 'public/a.js': 'a1' });
  const r1 = await mgr.applyPackage(v1, { dir: inst, ...OFF });
  assert.equal(r1.ok, true);
  assert.equal(mgr.installedVersion(inst), '2.0.0');
  assert.equal(read(inst, 'server.js'), 'v1');
  const v2 = await makePackage(work, '2.1.0', { 'server.js': 'v2', 'package-lock.json': 'lock1', 'public/b.js': 'b2' });
  const r2 = await mgr.applyPackage(v2, { dir: inst, ...OFF });
  assert.equal(r2.ok, true);
  assert.equal(read(inst, 'server.js'), 'v2');
  assert.equal(fs.existsSync(path.join(inst, 'public', 'a.js')), true, 'files dropped from the package are left in place (never deleted blindly)');
  assert.equal(read(inst, '.env'), 'DASH_PASS=secret\n');
  assert.equal(read(inst, 'data/reports.db'), 'DB');
  assert.equal(read(path.join(r2.rollback), 'files/server.js'), 'v1');
  // rollback restores v1 byte for byte and removes what 2.1.0 added
  await mgr.rollback({ dir: inst, restart: false, out: () => {} });
  assert.equal(read(inst, 'server.js'), 'v1');
  assert.equal(mgr.installedVersion(inst), '2.0.0');
  assert.equal(fs.existsSync(path.join(inst, 'public', 'b.js')), false);
});

test('a corrupt package, a downgrade and a same-version package are refused before any write', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const v1 = await makePackage(work, '2.0.0', { 'server.js': 'v1', 'package-lock.json': 'l' });
  await mgr.applyPackage(v1, { dir: inst, ...OFF });
  const bad = await makePackage(work, '2.0.1', { 'server.js': 'v2', 'package-lock.json': 'l' }, { corrupt: 'server.js' });
  await assert.rejects(mgr.applyPackage(bad, { dir: inst, ...OFF }), /package refused.*corrupt server\.js/);
  assert.equal(read(inst, 'server.js'), 'v1');
  const old = await makePackage(work, '1.9.0', { 'server.js': 'old', 'package-lock.json': 'l' });
  await assert.rejects(mgr.applyPackage(old, { dir: inst, ...OFF }), /downgrade/);
  await assert.rejects(mgr.applyPackage(v1, { dir: inst, ...OFF }), /already installed/);
  assert.equal((await mgr.applyPackage(v1, { dir: inst, ...OFF, reinstall: true })).version, '2.0.0');
});

test('a failure after the copy rolls the installation back by itself', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const v1 = await makePackage(work, '2.0.0', { 'server.js': 'v1', 'package-lock.json': 'l' });
  await mgr.applyPackage(v1, { dir: inst, ...OFF });
  const v2 = await makePackage(work, '2.0.1', { 'server.js': 'v2', 'package-lock.json': 'l', 'new.js': 'n' });
  await assert.rejects(mgr.applyPackage(v2, { dir: inst, ...OFF, afterCopy: () => { throw new Error('migrator exploded'); } }),
    e => e.rolledBack === true && /migrator exploded/.test(e.message));
  assert.equal(read(inst, 'server.js'), 'v1');
  assert.equal(mgr.installedVersion(inst), '2.0.0');
  assert.equal(fs.existsSync(path.join(inst, 'new.js')), false);
});

test('a package listing a protected path is refused', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  const evil = await makePackage(work, '2.0.0', { 'server.js': 'v', '.env': 'DASH_PASS=pwned' });
  await assert.rejects(mgr.applyPackage(evil, { dir: inst, ...OFF }), /protected paths/);
  assert.equal(fs.existsSync(path.join(inst, '.env')), false);
});

test('support bundle carries env KEYS only, never a value', async () => {
  const work = tmp(), inst = path.join(work, 'app');
  fs.mkdirSync(inst, { recursive: true });
  fs.writeFileSync(path.join(inst, '.env'), 'DASH_PASS=TopSecret42\nPG_URL=postgres://u:pw@h/db\n');
  const file = await mgr.supportBundle({ dir: inst, out: () => {}, url: 'http://127.0.0.1:1', env: mgr.readEnv(inst) });
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const keys = await zip.file('env-keys.txt').async('string');
  assert.equal(keys, 'DASH_PASS\nPG_URL\n');
  for (const name of Object.keys(zip.files)) {
    const f = zip.file(name); if (!f) continue;
    assert.ok(!(await f.async('string')).includes('TopSecret42'), name);
  }
});
