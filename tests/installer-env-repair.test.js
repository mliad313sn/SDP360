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
  assert.match(src, /writePlannedEnv\(envFile, plan, log\)/);
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

// A-04 — every .env and secrets check runs BEFORE the first change; the repaired .env is written before the
// sdp-manager update so its pre-update database backup sees SDP_BACKUP_KEY and is encrypted.
const ENV_1X = 'DASH_USER=admin\r\nDASH_PASS=' + 'p'.repeat(14) + '\r\nPG_URL=postgres://a@b/c\r\nDASHBOARD_API_KEY=short-key-12\r\nPORT=3456\r\n';
const WANTED = { NODE_ENV: 'production', PORT: '3456', BIND_HOST: '127.0.0.1', SDP_BACKUP_DIR: '/tmp/b', DASHBOARD_API_KEY: 'n'.repeat(64), SDP_SERVICE: 'windows' };

test('A-04: envPreflight repairs a 1.x .env in memory (API key, SDP_CONFIG_KEY, SDP_BACKUP_KEY) without writing any file', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdppre-'));
  const before = fs.readdirSync(d);
  const pre = pi.envPreflight(ENV_1X, { wanted: WANTED, minApiKey: 32 });
  const env = pi.readEnvText(pre.text);
  assert.ok(env.DASHBOARD_API_KEY.length >= 32 && env.DASHBOARD_API_KEY !== 'short-key-12');
  assert.ok(env.SDP_CONFIG_KEY.length >= 16 && env.SDP_BACKUP_KEY.length >= 16 && env.SDP_CONFIG_KEY !== env.SDP_BACKUP_KEY);
  assert.strictEqual(env.NODE_ENV, 'production');
  assert.strictEqual(env.PORT, '3456', 'an existing value is never changed');
  assert.deepStrictEqual(pre.fixed.sort(), ['DASHBOARD_API_KEY', 'SDP_BACKUP_KEY', 'SDP_CONFIG_KEY']);
  assert.deepStrictEqual(pre.problems, []);
  assert.ok(!pre.messages.join(' ').includes('short-key-12') && !pre.messages.join(' ').includes(env.SDP_CONFIG_KEY), 'messages name keys, never values');
  assert.deepStrictEqual(fs.readdirSync(d), before);
});

test('A-04: envPreflight names a DASH_PASS shorter than 12 as a problem and leaves the file alone', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdppre-')); const f = path.join(d, '.env');
  const text = ENV_1X.replace(/DASH_PASS=p+/, 'DASH_PASS=short');
  fs.writeFileSync(f, text);
  const pre = pi.envPreflight(fs.readFileSync(f, 'utf8'), { wanted: WANTED, minApiKey: 32 });
  assert.deepStrictEqual(pre.problems, ['DASH_PASS is shorter than 12 characters']);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), text);
});

test('A-04: in main(), the .env plan (secrets guard + envProblems) runs before the first change, swapNodeModules and the sdp-manager update (static)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'installer-v2', 'post-install.js'), 'utf8').replace(/\r\n/g, '\n');
  const main = src.slice(src.indexOf('async function main()'));
  const at = (s) => { const i = main.indexOf(s); assert.ok(i > 0, `main() contains ${s}`); return i; };
  assert.ok(at('await planEnv(') < at('touched = true'), 'planned before anything is touched');
  assert.ok(at('touched = true') < at('writePlannedEnv('), '.env written only once the run may change things');
  assert.ok(at('writePlannedEnv(') < at('swapNodeModules('), '.env written before step 1');
  assert.ok(at('writePlannedEnv(') < at("[mgr, 'update'"), '.env written before the sdp-manager update (its backup reads SDP_BACKUP_KEY)');
  const plan = src.slice(src.indexOf('async function planEnv('), src.indexOf('function writePlannedEnv('));
  assert.ok(plan.indexOf('secretsKeyGuard(') > 0 && plan.indexOf('secretsKeyGuard(') < plan.indexOf('envPreflight('), 'guard on the ORIGINAL .env, before a key is generated');
  assert.match(plan, /\.env would be refused by this version/);
});

test('A-04: the .env written before step 2 carries SDP_BACKUP_KEY, so the sdp-manager backup encrypts', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdpplan-')); const f = path.join(d, '.env');
  fs.writeFileSync(f, ENV_1X);
  const plan = await pi.planEnv(f, { wanted: WANTED, minApiKey: 32, connect: async () => { throw new Error('down'); } });
  assert.strictEqual(fs.readFileSync(f, 'utf8'), ENV_1X, 'planning writes nothing');
  pi.writePlannedEnv(f, plan, () => {});
  const mgr = require('../tools/sdp-manager.js');
  assert.ok(mgr.readEnv(d).SDP_BACKUP_KEY, 'sdp-manager readEnv(dir) — what applyPackage backs up with — sees SDP_BACKUP_KEY');
  assert.ok(fs.readdirSync(d).some((n) => n.startsWith('.env.before-setup-')), 'previous .env kept');
});

test('A-04: a secrets-guard refusal (encrypted rows, no key) leaves .env byte-identical', async () => {
  const cs = require('../services/configSecrets');
  const enc = cs.encryptValue('smtp-secret', cs.keyFrom('original-passphrase-123456'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdpplan-')); const f = path.join(d, '.env');
  fs.writeFileSync(f, ENV_1X);
  const before = fs.readFileSync(f);
  await assert.rejects(pi.planEnv(f, { wanted: WANTED, minApiKey: 32, connect: async () => ({ query: async () => ({ rows: [{ key: 'smtp_pass', value: enc }] }), end: async () => {} }) }), /no SDP_CONFIG_KEY/);
  assert.ok(fs.readFileSync(f).equals(before));
  assert.deepStrictEqual(fs.readdirSync(d), ['.env']);
});
