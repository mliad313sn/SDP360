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
  fs.writeFileSync(f, 'PG_URL=postgres://x\r\nDASHBOARD_API_KEY=short-key-12\r\nPORT=3456\r\nSDP_CONFIG_KEY=' + 'k'.repeat(32) + '\r\nSDP_BACKUP_KEY=' + 'b'.repeat(32) + '\r\n');
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
  fs.writeFileSync(f, `DASHBOARD_API_KEY=${key}\r\n` + 'SDP_CONFIG_KEY=' + 'k'.repeat(32) + '\r\nSDP_BACKUP_KEY=' + 'b'.repeat(32) + '\r\n');
  assert.deepStrictEqual(pi.repairEnv(f, () => {}), []);
  assert.strictEqual(pi.readEnv(f).DASHBOARD_API_KEY, key);
  const g = path.join(dir, 'none.env');
  fs.writeFileSync(g, 'PORT=3456\r\nSDP_CONFIG_KEY=' + 'k'.repeat(32) + '\r\nSDP_BACKUP_KEY=' + 'b'.repeat(32) + '\r\n');
  assert.deepStrictEqual(pi.repairEnv(g, () => {}), []);
});

test('rollback restarts the previous host: an installation without SDP_SERVICE predates the Windows service', () => {
  assert.strictEqual(pi.previousServiceKind({}), 'pm2');
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'windows' }), 'windows');
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'pm2' }), 'pm2');
});

test('a rolled-back 1.x application always goes back to pm2, even when an earlier failed Setup wrote SDP_SERVICE=windows', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdpv1-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '1.11.0' }));
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'windows' }, d), 'pm2');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ version: '2.0.0' }));
  assert.strictEqual(pi.previousServiceKind({ SDP_SERVICE: 'windows' }, d), 'windows');
});

test('the rollback path restores the .env snapshot and passes the previous host (static)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer-v2', 'post-install.js'), 'utf8');
  assert.match(src, /envBefore[\s\S]*fs\.writeFileSync\(envFile, envBefore\)/);
  assert.match(src, /const kindNow = previousServiceKind\(prevEnv, DIR\)/);
  assert.match(src, /registerService\(kindNow, /);
  assert.match(src, /serviceLogTail\(\)/, 'a failed health check copies the service log tail into the setup log');
  assert.match(src, /repairEnv\(envFile, log\)/);
});

test('repairEnv adds SDP_CONFIG_KEY and SDP_BACKUP_KEY when a 1.x .env lacks them, never replaces an existing key', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdpkey-'));
  const f = path.join(d, '.env');
  fs.writeFileSync(f, 'DASHBOARD_API_KEY=' + 'x'.repeat(40) + '\r\nPG_URL=postgres://a@b/c\r\n');
  const msgs = [];
  assert.deepStrictEqual(pi.repairEnv(f, (m) => msgs.push(m)).sort(), ['SDP_BACKUP_KEY', 'SDP_CONFIG_KEY']);
  const env = pi.readEnv(f);
  assert.ok(env.SDP_CONFIG_KEY.length >= 16 && env.SDP_BACKUP_KEY.length >= 16 && env.SDP_CONFIG_KEY !== env.SDP_BACKUP_KEY);
  assert.ok(!msgs.join(' ').includes(env.SDP_CONFIG_KEY), 'the key is never logged');
  const keep = env.SDP_CONFIG_KEY;
  assert.deepStrictEqual(pi.repairEnv(f, () => {}), []);
  assert.strictEqual(pi.readEnv(f).SDP_CONFIG_KEY, keep);
});

test('envProblems names every startup refusal of this version', () => {
  const ok = { NODE_ENV: 'production', DASH_USER: 'admin', DASH_PASS: 'x'.repeat(12), PG_URL: 'postgres://a@b/c', DASHBOARD_API_KEY: 'k'.repeat(32), SDP_CONFIG_KEY: 'c'.repeat(16) };
  assert.deepStrictEqual(pi.envProblems(ok), []);
  assert.strictEqual(pi.envProblems({ ...ok, SDP_CONFIG_KEY: '' }).length, 1);
  assert.strictEqual(pi.envProblems({ ...ok, DASH_PASS: 'short' }).length, 1);
  assert.strictEqual(pi.envProblems({}).length, 4);
});
