'use strict';
// SDP-DASH-2.0 step 5 (lot 5.6, ADR-003) — release package manifest: build, verify, tamper detection.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../services/releaseManifest');

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-release-'));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  put('server.js', 'console.log(1)\n');
  put('routes/a.js', 'module.exports = 1\n');
  put('db/postgres/reports/001_init.sql', 'select 1;\n');
  put('db/postgres/reports/README.md', 'not a migration\n');
  put('node_modules/x/index.js', 'module.exports = 2\n');
  put('node_modules/x/package.json', '{}\n');
  const m = R.buildManifest(dir, { name: 'sdp-dashboard', version: '2.5.0', commit: 'abc1234', built_at: '2026-10-22T00:00:00Z', node_major: 24 });
  fs.writeFileSync(path.join(dir, R.MANIFEST), JSON.stringify(m, null, 2));
  return { dir, m, put };
}

test('the manifest lists every app file with its hash, migrations, and node_modules as one aggregate', () => {
  const { m } = tree();
  assert.deepStrictEqual(m.files.map(f => f.path), ['db/postgres/reports/001_init.sql', 'db/postgres/reports/README.md', 'routes/a.js', 'server.js']);
  assert.ok(m.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256) && f.size > 0));
  assert.deepStrictEqual(m.migrations, ['db/postgres/reports/001_init.sql']);
  assert.strictEqual(m.node_modules.count, 2);
  assert.strictEqual(m.version, '2.5.0');
});

test('an untouched tree verifies', () => {
  const { dir } = tree();
  const v = R.verifyTree(dir);
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.ok);
  assert.strictEqual(v.version, '2.5.0');
});

test('a changed, missing or added file fails verification and is named', () => {
  const { dir, put } = tree();
  put('routes/a.js', 'module.exports = 666\n');
  fs.unlinkSync(path.join(dir, 'server.js'));
  put('routes/evil.js', 'x\n');
  const v = R.verifyTree(dir);
  assert.ok(!v.ok);
  assert.deepStrictEqual(v.errors.sort(), ['changed: routes/a.js', 'missing: server.js', 'not in manifest: routes/evil.js']);
});

test('a change inside node_modules fails verification', () => {
  const { dir, put } = tree();
  put('node_modules/x/index.js', 'module.exports = 3\n');
  assert.deepStrictEqual(R.verifyTree(dir).errors, ['node_modules: content changed']);
  put('node_modules/y/index.js', 'y\n');
  assert.match(R.verifyTree(dir).errors[0], /node_modules: 3 files, manifest says 2/);
});

test('an unreadable manifest is reported, never thrown', () => {
  const { dir } = tree();
  fs.writeFileSync(path.join(dir, R.MANIFEST), '{not json');
  const v = R.verifyTree(dir);
  assert.ok(!v.ok);
  assert.match(v.errors[0], /manifest\.json unreadable/);
});

test('readInstalled gives the version inside a package and null outside', () => {
  const { dir } = tree();
  assert.deepStrictEqual(R.readInstalled(dir), { version: '2.5.0', commit: 'abc1234', built_at: '2026-10-22T00:00:00Z' });
  assert.strictEqual(R.readInstalled(os.tmpdir() + '/does-not-exist-sdp'), null);
});

const B = require('../tools/release/build-release');

test('the release ships the application, never the dev-only paths', () => {
  for (const p of ['server.js', 'routes/reports.js', 'public/activity-tracker/App.js', 'db/migrate.js', 'db/postgres/reports/001_init.sql',
    'tools/installer/Install-SDP.ps1', 'vendor/xlsx-0.20.3.tgz', 'package-lock.json']) assert.ok(B.isShipped(p), `${p} must ship`);
  for (const p of ['tests/a.test.js', 'docs/sop/SOP-deploy.md', '.github/workflows/ci.yml', 'tools/deploy/make-deploy-zip.ps1',
    'tools/installer/tests/run-all.ps1', 'tools/exec-pptx/fixtures/k.json', 'public/activity-tracker/App.jsx', 'sdp-deploy_x.zip']) assert.ok(!B.isShipped(p), `${p} must not ship`);
});

test('the package version is SemVer from the tag, or package.json + -dev', () => {
  assert.strictEqual(B.resolveVersion('v2.5.0'), '2.5.0');
  assert.strictEqual(B.resolveVersion('2.5.1-rc.1'), '2.5.1-rc.1');
  assert.throws(() => B.resolveVersion('v2.5'), /not SemVer/);
  const saved = process.env.RELEASE_VERSION; delete process.env.RELEASE_VERSION;
  try { assert.match(B.resolveVersion(null), /^\d+\.\d+\.\d+-dev$/); } finally { if (saved !== undefined) process.env.RELEASE_VERSION = saved; }
});
