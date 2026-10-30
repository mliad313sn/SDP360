'use strict';
// Installer v2: an older .env must not stop the new version from starting, and a failed update must
// give back the previous version as it was run before (2026-10-30 field incident: 12-char
// DASHBOARD_API_KEY refused in production, then the rollback started 1.11.0 under the Windows service
// with the bundled Node.js and crashed on better-sqlite3).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-env-repair-'));
process.argv.push('--dir', dir);
const pi = require('../tools/installer-v2/post-install.js');

test('a DASHBOARD_API_KEY under 32 characters is replaced, the old .env is kept, other lines untouched', () => {
  const f = path.join(dir, '.env');
  fs.writeFileSync(f, 'PG_URL=postgres://x\r\nDASHBOARD_API_KEY=short-key-12\r\nPORT=3456\r\n');
  const logs = [];
  const fixed = pi.repairEnv(f, (m) => logs.push(m));
  assert.deepStrictEqual(fixed, ['DASHBOARD_API_KEY']);
  const env = pi.readEnv(f);
  assert.ok(env.DASHBOARD_API_KEY.length >= 32);
  assert.strictEqual(env.PG_URL, 'postgres://x');
  assert.strictEqual(env.PORT, '3456');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('.env.before-setup-')), 'previous .env kept');
  assert.ok(!logs.join(' ').includes('short-key-12'), 'the old key is never logged');
});

test('a long enough key, or no key at all, is left alone', () => {
  const f = path.join(dir, 'ok.env');
  const key = 'a'.repeat(40);
  fs.writeFileSync(f, `DASHBOARD_API_KEY=${key}\r\n`);
  assert.deepStrictEqual(pi.repairEnv(f, () => {}), []);
  assert.strictEqual(pi.readEnv(f).DASHBOARD_API_KEY, key);
  const g = path.join(dir, 'none.env');
  fs.writeFileSync(g, 'PORT=3456\r\n');
  assert.deepStrictEqual(pi.repairEnv(g, () => {}), []);
});

test('rollback restarts the previous host: an installation without SDP_SERVICE predates the Windows service', () => {
  assert.strictEqual(pi.previousServiceKind({}), 'pm2');
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'windows' }), 'windows');
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'pm2' }), 'pm2');
});

test('the rollback path restores the .env snapshot and passes the previous host (static)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer-v2', 'post-install.js'), 'utf8');
  assert.match(src, /envBefore[\s\S]*fs\.writeFileSync\(envFile, envBefore\)/);
  assert.match(src, /registerService\(kindBefore \|\| serviceKind\(prevEnv\), prevEnv\)/);
  assert.match(src, /repairEnv\(envFile, log\)/);
});
