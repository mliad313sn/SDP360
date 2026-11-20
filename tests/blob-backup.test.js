'use strict';
// P11 r5 N-14 — nothing backed up the file store (inspection photos / signatures, field uploads, project documents
// under <DATA_DIR>/blobs) and the restore drill could PASS while every file was lost. The backup run now archives the
// store next to the dump (same stamp, same key rules, same retention, same quarantine), and every drill reads the
// archive back and fails when a live file is missing from it or differs.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const zlib = require('zlib');
const BB = require('../services/blobBackup');
const B = require('../services/backup');
const D = require('../services/restoreDrill');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

const KEY_TXT = 'blob-test-backup-passphrase-2026';
const KEY = B.deriveKey(KEY_TXT);
const DUMP = 'x'.repeat(5000) + '\n-- PostgreSQL database dump complete\n';
const spawnOk = (c, a) => { fs.writeFileSync(a[1], DUMP); return { status: 0 }; };

function store(root, files) {
  for (const [ref, body] of Object.entries(files)) {
    const abs = path.join(root, ...ref.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const FILES = { 'inspection/EM-1/net-04-0.jpg': Buffer.from('photo-bytes'), 'inspection/EM-1/sig-inspector.png': Buffer.from('signature'),
  'field/u7/1-abc.jpg': Buffer.alloc(70000, 7), 'ppm-doc/12/charter.pdf': Buffer.from('%PDF-1.4 charter') };

test('archive round trip (encrypted and plaintext): every file read back, manifest count + SHA-256 match', () => {
  const t = tmp('bb-rt-');
  try {
    const root = path.join(t, 'blobs'); store(root, FILES);
    for (const key of [KEY, null]) {
      const file = path.join(t, BB.archiveNameFor('20261120T030000Z', { encrypted: !!key }));
      const w = BB.writeArchive({ root, file, key });
      assert.equal(w.count, 4);
      assert.ok(BB.isArchiveName(path.basename(file)));
      assert.ok(!fs.readFileSync(file).includes(Buffer.from('charter')) || !key, 'encrypted archive: no plaintext content');
      const v = BB.verifyArchive(file, { key });
      assert.equal(v.ok, true, v.problems.join('; '));
      assert.equal(v.count, 4);
      assert.deepEqual(Object.keys(v.files).sort(), Object.keys(FILES).sort());
    }
    assert.equal(BB.isArchiveName('sdp_blobs_before-upgrade.blobs'), false, 'only the generator\'s exact name is managed');
    assert.equal(BB.stampOf('/x/sdp_dashboard_20261120T030000Z.sql.gz.enc'), '20261120T030000Z');
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('verification refuses a wrong key, a tampered record, a truncated archive and a file missing from the manifest', () => {
  const t = tmp('bb-bad-');
  try {
    const root = path.join(t, 'blobs'); store(root, FILES);
    const file = path.join(t, BB.archiveNameFor('20261120T030000Z', { encrypted: true }));
    BB.writeArchive({ root, file, key: KEY });
    assert.match(BB.verifyArchive(file, { key: B.deriveKey('another-passphrase-of-enough-length') }).problems[0], /wrong SDP_BACKUP_KEY/);
    assert.match(BB.verifyArchive(file, { key: null }).problems[0], /SDP_BACKUP_KEY is required/);
    const buf = fs.readFileSync(file);
    const t1 = path.join(t, 'tampered.blobs.enc'); const c = Buffer.from(buf); c[60] ^= 0xff; fs.writeFileSync(t1, c);
    assert.equal(BB.verifyArchive(t1, { key: KEY }).ok, false);
    const t2 = path.join(t, 'trunc.blobs.enc'); fs.writeFileSync(t2, buf.subarray(0, buf.length - 40));
    assert.match(BB.verifyArchive(t2, { key: KEY }).problems[0], /truncated/);
    // manifest that lists a file the archive does not carry
    const r = BB.readArchive(file, { key: KEY });
    const res = BB.compareWithManifest({ ...r.manifest, count: r.manifest.count + 1, files: [...r.manifest.files, { ref: 'x/y/z.jpg', size: 1, sha256: 'ab' }] }, r.files);
    assert.equal(res.ok, false); assert.ok(res.problems.some((p) => /missing: x\/y\/z\.jpg/.test(p)));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('restoreArchive writes into an empty directory and verifies from disk; refuses a non-empty target and a path escape', () => {
  const t = tmp('bb-rs-');
  try {
    const root = path.join(t, 'blobs'); store(root, FILES);
    const file = path.join(t, BB.archiveNameFor('20261120T030000Z', { encrypted: true }));
    BB.writeArchive({ root, file, key: KEY });
    const target = path.join(t, 'restored');
    const r = BB.restoreArchive(file, { key: KEY, target });
    assert.equal(r.ok, true, r.problems.join('; ')); assert.equal(r.count, 4);
    for (const [ref, body] of Object.entries(FILES)) assert.ok(fs.readFileSync(path.join(target, ...ref.split('/'))).equals(body), ref);
    assert.throws(() => BB.restoreArchive(file, { key: KEY, target }), /not empty/);
    // hand-made archive with an escaping ref
    const evil = path.join(t, 'evil.blobs');
    const ref = Buffer.from('../../outside.txt'); const len = Buffer.alloc(4); len.writeUInt32BE(ref.length, 0);
    const rec = (type, payload) => { const box = zlib.gzipSync(payload); const h = Buffer.alloc(5); h.writeUInt8(type, 0); h.writeUInt32BE(box.length, 1); return Buffer.concat([h, box]); };
    fs.writeFileSync(evil, Buffer.concat([Buffer.from('SDPBLOP1'), rec(1, Buffer.concat([len, ref, Buffer.from('x')])), rec(2, Buffer.from(JSON.stringify({ count: 1, files: [] })))]));
    assert.throws(() => BB.restoreArchive(evil, { target: path.join(t, 'r2') }), /unsafe path/);
    assert.ok(!fs.existsSync(path.join(t, 'outside.txt')));
    // the CLI
    const lines = [];
    assert.equal(require('../tools/pg/restore-blobs').main(['--verify', '--archive', file], { SDP_BACKUP_KEY: KEY_TXT }, (m) => lines.push(m)), 0);
    assert.equal(require('../tools/pg/restore-blobs').main(['--restore', '--archive', file, '--target', path.join(t, 'r3')], { SDP_BACKUP_KEY: KEY_TXT }, (m) => lines.push(m)), 0);
    assert.ok(lines.every((l) => !l.includes(KEY_TXT)));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('runBackup archives the file store next to the dump: same stamp, same key, same retention; no store = nothing to archive', async () => {
  const t = tmp('bb-run-');
  try {
    const dataDir = path.join(t, 'data'); store(path.join(dataDir, 'blobs'), FILES);
    const dir = path.join(t, 'backups');
    const env = { PG_URL: 'x', SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: dataDir };
    const out = await B.runBackup({ dir, env, spawn: spawnOk, log: () => {} });
    assert.equal(out.file_store.present, true);
    assert.equal(out.file_store.count, 4);
    assert.equal(out.file_store.encrypted, true);
    assert.equal(BB.stampOf(out.file_store.file), BB.stampOf(out.file), 'same stamp as the dump');
    assert.ok(out.file_store.file.endsWith('.blobs.enc'));
    assert.equal(BB.archiveFor(dir, out.file), out.file_store.file);
    // plaintext override: .blobs, readable without a key
    const p = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_ALLOW_PLAINTEXT: '1', SDP_DATA_DIR: dataDir }, spawn: spawnOk, log: () => {} });
    assert.ok(p.file_store.file.endsWith('.blobs') && p.file_store.encrypted === false);
    // off-site copy carries the archive too
    const off = path.join(t, 'offsite');
    const o2 = await B.runBackup({ dir, env, spawn: spawnOk, offsitePath: off, log: () => {} });
    assert.ok(fs.existsSync(path.join(off, path.basename(o2.file_store.file))));
    // retention: keep 1 → one archive left (the newest)
    const o3 = await B.runBackup({ dir, keep: 1, env, spawn: spawnOk, log: () => {} });
    assert.deepEqual(fs.readdirSync(dir).filter((n) => BB.isArchiveName(n)), [path.basename(o3.file_store.file)]);
    // no store on this server → nothing archived, the run still succeeds
    const none = await B.runBackup({ dir, env: { ...env, SDP_DATA_DIR: path.join(t, 'empty-data') }, spawn: spawnOk, log: () => {} });
    assert.equal(none.file_store.present, false);
    // key rules are the dump's: no key, no override → refused before anything is written
    const before = fs.readdirSync(dir).length;
    await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_DATA_DIR: dataDir }, spawn: spawnOk, log: () => {} }), (e) => e.code === 'BACKUP_KEY_MISSING');
    assert.equal(fs.readdirSync(dir).length, before);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('an archive that fails verification is quarantined as .rejected (never managed) and fails the run', async () => {
  const t = tmp('bb-rej-');
  try {
    const dataDir = path.join(t, 'data'); store(path.join(dataDir, 'blobs'), FILES);
    const dir = path.join(t, 'backups');
    let corrupt = false;
    const fsx = { ...fs, writeSync: (fd, buf, ...rest) => {
      if (Buffer.isBuffer(buf) && buf.length > 40 && corrupt) { const c = Buffer.from(buf); c[c.length - 3] ^= 0xff; return fs.writeSync(fd, c, ...rest); }
      return fs.writeSync(fd, buf, ...rest);
    } };
    corrupt = true;
    await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: dataDir }, spawn: spawnOk, fsx, log: () => {} }),
      (e) => /file-store archive failed verification/.test(e.message) && e.transient === false && /quarantined/.test(e.message));
    const names = fs.readdirSync(dir);
    assert.equal(names.filter((n) => BB.isArchiveName(n)).length, 0, 'no managed archive left');
    assert.equal(names.filter((n) => n.endsWith('.blobs.enc.rejected')).length, 1);
    assert.equal(BB.archiveFor(dir, null), null);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('drill file-store step: files without an archive, a missing or different file → FAILED; an empty store passes', () => {
  const v = { ok: true, count: 2, problems: [], files: { 'a/1/x.jpg': { size: 1, sha256: 'aa' }, 'a/1/y.jpg': { size: 1, sha256: 'bb' } } };
  const live = { 'a/1/x.jpg': { size: 1, sha256: 'aa' }, 'a/1/y.jpg': { size: 1, sha256: 'bb' } };
  assert.equal(D.fileStoreStep({ liveRefs: Object.keys(live), liveHashes: live, archiveName: 'z', verify: v }).status, 'ok');
  assert.equal(D.fileStoreStep({ liveRefs: ['a/1/x.jpg'], liveHashes: live, archiveName: null, verify: null }).status, 'failed');
  assert.equal(D.fileStoreStep({ liveRefs: null, verify: null }).status, 'ok');
  assert.equal(D.fileStoreStep({ liveRefs: [], verify: null }).status, 'ok');
  const miss = D.fileStoreStep({ liveRefs: [...Object.keys(live), 'a/2/new.jpg'], liveHashes: live, archiveName: 'z', verify: v });
  assert.equal(miss.status, 'failed'); assert.deepEqual(miss.missing, ['a/2/new.jpg']);
  const diff = D.fileStoreStep({ liveRefs: Object.keys(live), liveHashes: { ...live, 'a/1/y.jpg': { size: 1, sha256: 'cc' } }, archiveName: 'z', verify: v });
  assert.equal(diff.status, 'failed'); assert.deepEqual(diff.different, ['a/1/y.jpg']);
  assert.equal(D.fileStoreStep({ liveRefs: Object.keys(live), liveHashes: live, archiveName: 'z', verify: { ok: false, count: null, problems: ['wrong key'], files: null } }).status, 'failed');
  // the report and the log row carry the verdict
  const md = D.renderReport({ date: '2026-11-20', comparison: D.compareCounts({ users: 1 }, { users: 1 }, ['users']), files: miss });
  assert.match(md, /\*\*Result: FAIL\*\*/); assert.match(md, /File store/); assert.match(md, /a\/2\/new\.jpg/);
  assert.equal(D.logDetails({ date: 'x', comparison: D.compareCounts({ users: 1 }, { users: 1 }, ['users']), files: miss }).ok, false);
});

test('PG: the restore drill (B4, --backup-first) passes with the file store, and FAILS when a live file is not in the archive', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx || ctx.schema) { t.skip(ctx ? 'needs a throwaway DATABASE (PG_ADMIN_URL with CREATEDB) to dump cleanly' : 'PostgreSQL unreachable'); return; }
  const work = tmp('bb-drill-');
  try {
    const { Client } = require('pg');
    const c = new Client({ connectionString: ctx.url }); await c.connect();
    await c.query("CREATE TABLE users (id serial primary key, name text); INSERT INTO users (name) VALUES ('a'), ('b')"); await c.end();
    const blobRoot = path.join(work, 'data', 'blobs'); store(blobRoot, FILES);
    const drill = require('../tools/pg/restore-drill');
    const env = { ...process.env, PG_URL: ctx.url, PG_ADMIN_URL: ctx.adminUrl, SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: path.join(work, 'data') };
    delete env.SDP_BLOB_BACKUP_DIR;
    const base = { env, dir: path.join(work, 'backups'), logEvent: () => {}, log: () => {}, actor: 'test', full: false };
    const ok = await drill.run({ ...base, reportDir: path.join(work, 'r1'), backupFirst: true });
    assert.equal(ok.ok, true); assert.equal(ok.files.status, 'ok'); assert.equal(ok.files.archive_count, 4);
    assert.match(fs.readFileSync(ok.reportFile, 'utf8'), /File store[^]*\| Status \| ok \|/);
    // a photo taken after the backup (or a backup that missed it) → the drill fails, it never reads as a green exercise
    store(blobRoot, { 'inspection/EM-2/new-photo.jpg': Buffer.from('later') });
    await assert.rejects(() => drill.run({ ...base, reportDir: path.join(work, 'r2') }), (e) => /file store does not restore/.test(e.message) && e.result.files.missing.includes('inspection/EM-2/new-photo.jpg'));
    // archives deleted → files on disk with no archive → FAIL
    for (const n of fs.readdirSync(base.dir)) if (BB.isArchiveName(n)) fs.rmSync(path.join(base.dir, n));
    await assert.rejects(() => drill.run({ ...base, reportDir: path.join(work, 'r3') }), /NO file-store archive/);
    // a fresh backup-first drill covers the new photo again
    const again = await drill.run({ ...base, reportDir: path.join(work, 'r4'), backupFirst: true });
    assert.equal(again.files.archive_count, 5);
  } finally { await dropTestDb(ctx); fs.rmSync(work, { recursive: true, force: true }); }
});
