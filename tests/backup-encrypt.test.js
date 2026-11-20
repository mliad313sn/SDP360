'use strict';
// E11 — backup hardening: AES-256-GCM round-trip, wrong key refused, pg_dump trailer check,
// pack/open across the three formats, runBackup (key present / absent / off-site copy).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const B = require('../services/backup');

const TRAILED = (n = 2000) => `--\n-- PostgreSQL database dump\n--\nCREATE TABLE public.users (id integer);\n${'COPY public.users (id) FROM stdin;\n1\n\\.\n'.repeat(Math.ceil(n / 30))}\n--\n-- PostgreSQL database dump complete\n--\n`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bk-enc-'));

test('deriveKey: 32 bytes, deterministic, refuses a short passphrase', () => {
  const k1 = B.deriveKey('a-long-enough-passphrase-1234');
  assert.ok(Buffer.isBuffer(k1) && k1.length === 32);
  assert.ok(k1.equals(B.deriveKey('a-long-enough-passphrase-1234')));
  assert.ok(!k1.equals(B.deriveKey('another-long-enough-passphrase')));
  assert.equal(B.deriveKey('short'), null);
  assert.equal(B.deriveKey(''), null);
  assert.equal(B.deriveKey(undefined), null);
});

test('encryptBuffer / decryptBuffer round-trip; wrong key and tampering are refused, never garbage', () => {
  const key = B.deriveKey('correct-horse-battery-staple-xyz');
  const plain = Buffer.from(TRAILED(500), 'utf8');
  const box = B.encryptBuffer(plain, key);
  assert.ok(B.isEncryptedBuffer(box));
  assert.ok(!box.includes(Buffer.from('CREATE TABLE')), 'ciphertext does not contain the plaintext');
  assert.ok(B.decryptBuffer(box, key).equals(plain));
  assert.throws(() => B.decryptBuffer(box, B.deriveKey('wrong-key-wrong-key-wrong-key')), /wrong SDP_BACKUP_KEY or corrupted/);
  const tampered = Buffer.from(box); tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => B.decryptBuffer(tampered, key), /wrong SDP_BACKUP_KEY or corrupted/);
  assert.throws(() => B.decryptBuffer(plain, key), /not an SDP encrypted backup/);
  assert.throws(() => B.encryptBuffer(plain, Buffer.alloc(16)), /32-byte key/);
});

test('hasDumpTrailer / verifyDumpFile: the trailer, not the size, decides', () => {
  assert.equal(B.hasDumpTrailer(TRAILED()), true);
  assert.equal(B.hasDumpTrailer(Buffer.from(TRAILED(), 'utf8')), true);
  assert.equal(B.hasDumpTrailer('x'.repeat(100000)), false, 'big but truncated');
  assert.equal(B.hasDumpTrailer(TRAILED().replace(/-- PostgreSQL database dump complete\n/, '')), false);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ok.sql'), TRAILED(50000));
  fs.writeFileSync(path.join(dir, 'cut.sql'), TRAILED(50000).slice(0, 40000));
  assert.deepEqual(B.verifyDumpFile(path.join(dir, 'ok.sql')).ok, true);
  assert.deepEqual(B.verifyDumpFile(path.join(dir, 'cut.sql')).ok, false);
});

test('packDump → .sql.gz (no key) / .sql.gz.enc (key); openDump reads all three formats', () => {
  const dir = tmp();
  const raw1 = path.join(dir, 'sdp_dashboard_20261021T030000Z.sql'); fs.writeFileSync(raw1, TRAILED(3000));
  const p1 = B.packDump(raw1);
  assert.ok(p1.file.endsWith('.sql.gz') && !p1.encrypted && !fs.existsSync(raw1));
  assert.ok(zlib.gunzipSync(fs.readFileSync(p1.file)).toString().includes(B.TRAILER));
  assert.ok(B.openDump(p1.file).toString().includes(B.TRAILER));

  const key = B.deriveKey('pack-open-roundtrip-passphrase-01');
  const raw2 = path.join(dir, 'sdp_dashboard_20261022T030000Z.sql'); fs.writeFileSync(raw2, TRAILED(3000));
  const p2 = B.packDump(raw2, { key });
  assert.ok(p2.file.endsWith('.sql.gz.enc') && p2.encrypted && p2.bytes > 2000);
  assert.ok(B.isEncryptedBuffer(fs.readFileSync(p2.file)));
  assert.ok(B.openDump(p2.file, { key }).toString().includes(B.TRAILER));
  assert.throws(() => B.openDump(p2.file), /SDP_BACKUP_KEY is required/);
  assert.throws(() => B.openDump(p2.file, { key: B.deriveKey('not-the-key-not-the-key-000') }), /wrong SDP_BACKUP_KEY/);

  const raw3 = path.join(dir, 'sdp_dashboard_20261023T030000Z.sql'); fs.writeFileSync(raw3, TRAILED(3000));
  assert.ok(B.openDump(raw3).toString().includes(B.TRAILER), 'plain .sql still opens (legacy dumps)');
  assert.equal(path.basename(B.latestDump(dir)), 'sdp_dashboard_20261023T030000Z.sql');
  assert.deepEqual(B.prune(dir, { keep: 1 }), ['sdp_dashboard_20261021T030000Z.sql.gz', 'sdp_dashboard_20261022T030000Z.sql.gz.enc'], 'prune sees every format');
});

test('runBackup: no key → REFUSED before pg_dump runs (P11 F-05); explicit override → plaintext gzip + loud warning; key → .enc, no warning; missing trailer → fails and removes the file', async () => {
  const dir = tmp(); const warned = [];
  let dumped = 0;
  const spawnOk = (c, a) => { dumped++; fs.writeFileSync(a[1], TRAILED(3000)); return { status: 0 }; };
  // no key, no override: refused, nothing dumped, nothing on disk, not retried (transient false)
  const errs = [];
  await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x' }, spawn: spawnOk, log: (m) => errs.push(m) }),
    (e) => /SDP_BACKUP_KEY is not set/.test(e.message) && /SDP_BACKUP_ALLOW_PLAINTEXT=1/.test(e.message) && e.transient === false && e.code === 'BACKUP_KEY_MISSING');
  assert.equal(errs.length, 1); assert.match(errs[0], /^\[backup\] ERROR: backup refused/);
  assert.equal(dumped, 0, 'pg_dump never ran — no plaintext dump was written');
  assert.deepEqual(fs.readdirSync(dir), []);
  await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: 'short' }, spawn: spawnOk, log: () => {} }), /too short/);
  await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: 'yes' }, spawn: spawnOk, log: () => {} }), /not set/, 'only the exact value 1 overrides');

  const out = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: spawnOk, log: (m) => warned.push(m) });
  assert.ok(out.file.endsWith('.sql.gz') && out.encrypted === false && out.trailer_ok === true && out.compressed === true);
  assert.equal(out.plaintext_override, true);
  assert.ok(out.bytes >= 3000 && out.stored_bytes < out.bytes, 'bytes = plain size, stored = gzip size');
  assert.equal(warned.length, 1); assert.match(warned[0], /SDP_BACKUP_KEY is not set.*PLAINTEXT.*SDP_BACKUP_ALLOW_PLAINTEXT=1/);

  const warned2 = [];
  const out2 = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: 'a-proper-backup-passphrase-2026' }, spawn: spawnOk, log: (m) => warned2.push(m) });
  assert.ok(out2.file.endsWith('.sql.gz.enc') && out2.encrypted === true);
  assert.equal(warned2.length, 0);
  assert.ok(B.openDump(out2.file, { key: B.deriveKey('a-proper-backup-passphrase-2026') }).toString().includes(B.TRAILER));

  const warned3 = [];
  await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: 'short', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: spawnOk, log: (m) => warned3.push(m) });
  assert.match(warned3[0], /too short/);

  const before = fs.readdirSync(dir).length;
  await assert.rejects(async () => B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: (c, a) => { fs.writeFileSync(a[1], 'x'.repeat(5000)); return { status: 0 }; }, log: () => {} }), /trailer missing/);
  assert.equal(fs.readdirSync(dir).length, before, 'the truncated dump is not kept');
});

test('runBackup: off-site copy when backup_offsite_path is set; a failing copy fails the run (transient) but keeps the local file', async () => {
  const dir = tmp(); const off = path.join(tmp(), 'offsite', 'sub');
  const spawnOk = (c, a) => { fs.writeFileSync(a[1], TRAILED(3000)); return { status: 0 }; };
  const out = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: spawnOk, offsitePath: off, log: () => {} });
  assert.equal(out.offsite, path.join(off, path.basename(out.file)));
  assert.ok(fs.existsSync(out.offsite));
  const none = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: spawnOk, offsitePath: '   ', log: () => {} });
  assert.equal(none.offsite, null);
  const bad = { ...fs, mkdirSync: (p, o) => { if (String(p).includes('unreachable')) throw new Error('ENOENT share'); return fs.mkdirSync(p, o); } };
  await assert.rejects(async () => B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1' }, spawn: spawnOk, offsitePath: '/unreachable/share', fsx: bad, log: () => {} }), (e) => /off-site copy failed/.test(e.message) && e.transient === true && fs.existsSync(e.file));
});

// P11 round 3 N-07 — latestDump/prune sorted every `sdp_dashboard_*` name, so an operator-named file
// (sdp_dashboard_before-upgrade.sql — letters sort after digits) counted as the newest: prune deleted the real
// backups and the nightly drill restored the manual file. Only the generator's exact name is managed now.
test('latestDump / prune manage only the generator pattern sdp_dashboard_<yyyymmdd>T<hhmmss>Z', () => {
  const dir = tmp();
  const real = ['sdp_dashboard_20261101T030000Z.sql.gz.enc', 'sdp_dashboard_20261102T030000Z.sql.gz'];
  const manual = ['sdp_dashboard_before-upgrade.sql', 'sdp_dashboard_20261199T999999Z_copy.sql', 'sdp_dashboard_zz.sql.gz'];
  for (const n of [...real, ...manual]) fs.writeFileSync(path.join(dir, n), 'x');
  assert.equal(path.basename(B.latestDump(dir)), 'sdp_dashboard_20261102T030000Z.sql.gz');
  assert.deepEqual(B.prune(dir, { keep: 1 }), ['sdp_dashboard_20261101T030000Z.sql.gz.enc']);
  for (const n of manual) assert.ok(fs.existsSync(path.join(dir, n)), `operator file ${n} is never touched`);
  assert.equal(B.isDumpName('sdp_dashboard_before-upgrade.sql'), false);
  assert.equal(B.isDumpName('sdp_dashboard_20261102T030000Z.sql'), true);
});

// P11 r4 — a key of 16 spaces was accepted as "encrypted"; a rejected undersized dump stayed on disk under a managed
// dump name, so latestDump / the restore drill could pick it.
test('r4: whitespace-only / low-entropy backup keys are refused; deriveKey (restore path) unchanged', async () => {
  assert.match(B.keyQualityProblem(' '.repeat(16)), /non-space/);
  assert.match(B.keyQualityProblem(' a b c d e f g h '), /non-space/);
  assert.match(B.keyQualityProblem('a'.repeat(32)), /distinct/);
  assert.equal(B.keyQualityProblem('a-proper-backup-passphrase-2026'), null);
  assert.equal(B.keyQualityProblem(''), 'not set');
  const dir = tmp(); let dumped = 0;
  const spawnOk = (c, a) => { dumped++; fs.writeFileSync(a[1], TRAILED(3000)); return { status: 0 }; };
  for (const k of [' '.repeat(16), '\t'.repeat(20), 'b'.repeat(32)]) {
    await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: k }, spawn: spawnOk, log: () => {} }), (e) => e.code === 'BACKUP_KEY_MISSING');
  }
  assert.equal(dumped, 0);
  assert.ok(B.deriveKey('b'.repeat(32)), 'an old backup made with a weak key can still be opened');
});

test('r4: an undersized dump is quarantined as .rejected and never selected as the newest backup', async () => {
  const dir = tmp();
  await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: 'a-proper-backup-passphrase-2026' },
    spawn: (c, a) => { fs.writeFileSync(a[1], 'tiny'); return { status: 0 }; }, log: () => {} }), /suspiciously small.*quarantined/);
  const names = fs.readdirSync(dir);
  assert.equal(names.length, 1);
  assert.ok(names[0].endsWith('.sql.rejected'), names[0]);
  assert.equal(B.isDumpName(names[0]), false);
  assert.equal(B.latestDump(dir), null);
  // P11 r6 O-3: kept for diagnosis within retention (keep >= 1), pruned beyond it (it used to be kept forever)
  assert.deepEqual(B.prune(dir, { keep: 1 }), [], 'kept within retention');
  assert.equal(B.prune(dir, { keep: 0 }).length, 1, 'pruned beyond retention');
});
