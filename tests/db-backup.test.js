'use strict';
// Step 2 (SDP-DASH-2.0) — "zero SQLite in production" guard + nightly encrypted backup (fake pg_dump).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const G = require('../services/backendGuard');
const B = require('../services/dbBackup');

const ALL_PG = { REPORTS_BACKEND: 'postgres', TRACKER_BACKEND: 'postgres', MEETINGS_BACKEND: 'postgres', INSPECTION_BACKEND: 'postgres', ASSETS_BACKEND: 'postgres' };

test('backend guard: warns by default, refuses to boot with REQUIRE_POSTGRES=1', () => {
  const partial = { ...ALL_PG, ASSETS_BACKEND: '' };
  assert.deepEqual(G.check(partial).sqlite, ['assets']);
  assert.equal(G.check(partial).ok, true, 'warning only without the flag');
  assert.throws(() => G.assertBootAllowed({ ...partial, REQUIRE_POSTGRES: '1' }), /assets/);
  assert.equal(G.assertBootAllowed({ ...ALL_PG, REQUIRE_POSTGRES: '1', SDP_CONFIG_KEY: 'a-production-passphrase' }).sqlite.length, 0);
  assert.match(G.check(partial).message, /ASSETS_BACKEND=postgres/);
});

test('step 4: the secrets key is mandatory in production mode, optional otherwise', () => {
  assert.throws(() => G.assertBootAllowed({ ...ALL_PG, REQUIRE_POSTGRES: '1' }), e => e.code === 'CONFIG_KEY_REQUIRED');
  assert.throws(() => G.assertBootAllowed({ ...ALL_PG, REQUIRE_POSTGRES: '1', SDP_CONFIG_KEY: 'short' }), e => e.code === 'CONFIG_KEY_REQUIRED');
  assert.throws(() => G.assertBootAllowed({ REQUIRE_CONFIG_KEY: '1' }), e => e.code === 'CONFIG_KEY_REQUIRED');
  assert.equal(G.assertBootAllowed({}).config_key.ok, true, 'dev / tests: no key needed');
  assert.deepEqual(G.checkConfigKey({ SDP_CONFIG_KEY: 'a-production-passphrase' }), { ok: true, required: false, set: true, message: 'secrets key set' });
});

function fakeSpawn(output, code = 0) {
  return (bin, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new PassThrough(); c.stderr = new PassThrough();
    c.calls = { bin, args, opts };
    fakeSpawn.last = c.calls;
    setImmediate(() => { c.stdout.end(output); c.stderr.end(code ? 'pg_dump: error: boom' : ''); setImmediate(() => c.emit('close', code)); });
    return c;
  };
}
const sql = '-- PostgreSQL database dump\n' + 'INSERT INTO t VALUES (1);\n'.repeat(500) + '-- PostgreSQL database dump complete\n';
const env = (dir, extra) => ({ SDP_BACKUP_DIR: dir, SDP_BACKUP_KEY: 'a-long-enough-passphrase', PG_URL: 'postgres://sdp_app:s3cr%40t@localhost:5432/sdp_dashboard', PG_DUMP: 'pg_dump', ...extra });

test('backup: skipped when not configured; refuses without a key (no plaintext ever)', async () => {
  assert.deepEqual(await B.runBackup({ env: {} }), { skipped: 'not configured (SDP_BACKUP_DIR)' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  await assert.rejects(() => B.runBackup({ env: { SDP_BACKUP_DIR: dir, PG_URL: 'postgres://u:p@h/d' }, spawnFn: fakeSpawn(sql) }), /key missing/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('backup: encrypted file, password only in the child env, round-trips with the key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const r = await B.runBackup({ env: env(dir), spawnFn: fakeSpawn(sql), now: new Date('2026-10-19T02:30:00Z') });
  assert.equal(r.file, 'sdp_dashboard_20261019-023000.sql.gz.enc');
  const raw = fs.readFileSync(path.join(dir, r.file));
  assert.ok(!raw.includes(Buffer.from('INSERT INTO')), 'not plaintext');
  assert.ok(!fakeSpawn.last.args.join(' ').includes('s3cr'), 'password not on the command line');
  assert.equal(fakeSpawn.last.opts.env.PGPASSWORD, 's3cr@t');
  const out = path.join(dir, 'restored.sql');
  await B.decryptFileToFile(path.join(dir, r.file), out, 'a-long-enough-passphrase');
  assert.equal(fs.readFileSync(out, 'utf8'), sql);
  await assert.rejects(() => B.decryptFileToFile(path.join(dir, r.file), out + '2', 'the-wrong-passphrase!!'));
});

test('backup: a failing or empty pg_dump leaves no file behind and fails the run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  await assert.rejects(() => B.runBackup({ env: env(dir), spawnFn: fakeSpawn('partial', 1) }), /code 1/);
  await assert.rejects(() => B.runBackup({ env: env(dir), spawnFn: fakeSpawn('') }), /empty dump/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('backup: retention removes old encrypted files only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const old = path.join(dir, 'sdp_dashboard_old.sql.gz.enc'), keep = path.join(dir, 'notes.txt');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(keep, 'x');
  const past = Date.now() / 1000 - 30 * 86400; fs.utimesSync(old, past, past); fs.utimesSync(keep, past, past);
  assert.equal(B.purgeOld(dir, 14), 1);
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']);
});

test('the backup is a registered runner job', () => {
  const j = require('../services/sync/jobs').buildJobs({}).find(x => x.key === 'db.backup');
  assert.ok(j && j.cron === '30 2 * * *');
});
