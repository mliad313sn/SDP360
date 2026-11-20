'use strict';
// P11 r6 — operations findings on the file-store backup (services/blobBackup.js):
//   O-1  the archive + verification ran synchronously inside the web server (900 MB froze it 54 s)
//   O-2  a folder reached through a symlink / junction was skipped by the backup AND by the drill (drill PASS)
//   O-3  a file deleted during the run aborted it and left a full-size `.part`; `.part` / `.rejected` never pruned
//   O-3b `sdp-manager backup --dir <install>` resolved the file store from the manager's own tree
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');
const BB = require('../services/blobBackup');
const B = require('../services/backup');
const D = require('../services/restoreDrill');

const KEY_TXT = 'blob-test-backup-passphrase-2026';
const KEY = B.deriveKey(KEY_TXT);
const DUMP = 'x'.repeat(5000) + '\n-- PostgreSQL database dump complete\n';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const put = (root, ref, body) => { const abs = path.join(root, ...ref.split('/')); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body); };
// an ASYNC dump stub, like the real (now asynchronous) pg_dump child
const spawnAsyncOk = (c, a) => new Promise((res) => setTimeout(() => { fs.writeFileSync(a[1], DUMP); res({ status: 0 }); }, 20));

test('O-1: a backup of thousands of files (tens of MB) never stalls the event loop — archive, verify and pack run in a child process', async () => {
  const t = tmp('bb-lag-');
  try {
    const dataDir = path.join(t, 'data'); const root = path.join(dataDir, 'blobs');
    const body = Buffer.alloc(12000); for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 0xff;
    for (let i = 0; i < 3000; i++) put(root, `inspection/EM-${Math.floor(i / 50)}/p-${i}.jpg`, body);   // 3 000 files, ~36 MB
    const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
    let last = Date.now(), maxGap = 0;
    const tick = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
    const dir = path.join(t, 'backups');
    const out = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: dataDir }, spawn: spawnAsyncOk, log: () => {} });
    const drill = await BB.drillFilesAsync({ root, archive: out.file_store.file, key: KEY });
    clearInterval(tick); h.disable();
    const p99 = h.percentile(99) / 1e6;
    assert.equal(out.file_store.count, 3000);
    assert.equal(drill.verify.ok, true, (drill.verify.problems || []).join('; '));
    assert.equal(drill.liveRefs.length, 3000);
    assert.equal(D.fileStoreStep({ liveRefs: drill.liveRefs, liveHashes: drill.liveHashes, archiveName: out.file_store.file, verify: drill.verify }).status, 'ok');
    assert.ok(out.file.endsWith('.sql.gz.enc') && fs.existsSync(out.file), 'the dump was packed (in the worker)');
    assert.ok(p99 < 500, `event-loop p99 lag ${p99.toFixed(1)} ms must stay below 500 ms`);
    assert.ok(maxGap < 1500, `longest event-loop gap ${maxGap} ms must stay below 1.5 s`);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('O-2: a linked folder INSIDE the data directory is archived and verified exactly as the app serves it', async () => {
  const t = tmp('bb-link-');
  try {
    const dataDir = path.join(t, 'data'); const root = path.join(dataDir, 'blobs');
    put(root, 'inspection/EM-1/p.jpg', Buffer.from('photo'));
    put(path.join(dataDir, 'moved'), 'ppm-doc/12/contract.pdf', Buffer.alloc(2000, 3));   // moved folder, same data dir
    fs.symlinkSync(path.join(dataDir, 'moved', 'ppm-doc'), path.join(root, 'ppm-doc'), 'dir');
    // the app reads through the link
    assert.equal(fs.readFileSync(path.join(root, 'ppm-doc', '12', 'contract.pdf')).length, 2000);
    assert.deepEqual(BB.listStore(root), ['inspection/EM-1/p.jpg', 'ppm-doc/12/contract.pdf']);
    const dir = path.join(t, 'backups');
    const out = await B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: dataDir }, spawn: spawnAsyncOk, log: () => {} });
    assert.equal(out.file_store.count, 2);
    assert.deepEqual(out.file_store.links, ['ppm-doc']);
    const r = BB.readArchive(out.file_store.file, { key: KEY });
    assert.ok(r.files['ppm-doc/12/contract.pdf'], 'the linked file is IN the archive');
    const dr = await BB.drillFilesAsync({ root, archive: out.file_store.file, key: KEY });
    assert.deepEqual(dr.liveRefs, ['inspection/EM-1/p.jpg', 'ppm-doc/12/contract.pdf'], 'the drill counts the linked file too');
    assert.equal(D.fileStoreStep({ ...dr, archiveName: out.file_store.file }).status, 'ok');
    // restore puts the file back as a regular file
    const back = BB.restoreArchive(out.file_store.file, { key: KEY, target: path.join(t, 'restored') });
    assert.equal(back.ok, true);
    assert.equal(fs.readFileSync(path.join(t, 'restored', 'ppm-doc', '12', 'contract.pdf')).length, 2000);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('O-2: a link OUTSIDE the data directory fails the backup loudly and fails the drill; a link cycle is refused', async () => {
  const t = tmp('bb-out-');
  const other = tmp('bb-otherdisk-');
  try {
    const dataDir = path.join(t, 'data'); const root = path.join(dataDir, 'blobs');
    put(root, 'inspection/EM-1/p.jpg', Buffer.from('photo'));
    put(other, 'ppm-doc/12/contract.pdf', Buffer.alloc(2000, 3));
    fs.symlinkSync(path.join(other, 'ppm-doc'), path.join(root, 'ppm-doc'), 'dir');
    const dir = path.join(t, 'backups');
    await assert.rejects(B.runBackup({ dir, env: { PG_URL: 'x', SDP_BACKUP_KEY: KEY_TXT, SDP_DATA_DIR: dataDir }, spawn: spawnAsyncOk, log: () => {} }),
      (e) => e.code === 'BLOB_LINK_OUTSIDE' && e.transient === false && /ppm-doc/.test(e.message) && /outside the data directory/.test(e.message));
    assert.equal(fs.readdirSync(dir).filter((n) => /\.blobs/.test(n)).length, 0, 'no archive, no .part left');
    const dr = await BB.drillFilesAsync({ root, archive: null, key: KEY });
    assert.match(dr.listError, /outside the data directory/);
    const step = D.fileStoreStep({ ...dr, archiveName: null });
    assert.equal(step.status, 'failed'); assert.match(step.detail, /cannot be listed/);
    // cycle
    fs.unlinkSync(path.join(root, 'ppm-doc'));
    fs.symlinkSync(root, path.join(root, 'inspection', 'loop'), 'dir');
    assert.throws(() => BB.listStore(root), (e) => e.code === 'BLOB_LINK_CYCLE');
    // a dangling link serves nothing: reported, not archived, not fatal
    fs.unlinkSync(path.join(root, 'inspection', 'loop'));
    fs.symlinkSync(path.join(t, 'gone'), path.join(root, 'dead'), 'dir');
    const det = BB.listStoreDetailed(root);
    assert.deepEqual(det.refs, ['inspection/EM-1/p.jpg']); assert.deepEqual(det.dangling, ['dead']);
  } finally { fs.rmSync(t, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); }
});

test('O-3: a file deleted during the run is recorded as vanished (no abort); any failure removes the .part', () => {
  const t = tmp('bb-van-');
  try {
    const root = path.join(t, 'blobs');
    put(root, 'a/1/x.jpg', Buffer.from('x')); put(root, 'a/1/y.jpg', Buffer.from('y')); put(root, 'a/2/z.jpg', Buffer.from('z'));
    const victim = path.join(root, 'a', '1', 'y.jpg');
    const fsx = { ...fs, readFileSync: (p, ...r) => { if (p === victim) { fs.rmSync(victim, { force: true }); } return fs.readFileSync(p, ...r); } };
    const file = path.join(t, BB.archiveNameFor('20261120T030000Z', { encrypted: true }));
    const w = BB.writeArchive({ root, file, key: KEY, fsx });
    assert.equal(w.count, 2); assert.deepEqual(w.vanished, ['a/1/y.jpg']);
    const v = BB.verifyArchive(file, { key: KEY });
    assert.equal(v.ok, true); assert.deepEqual(v.manifest.vanished, ['a/1/y.jpg']);
    // backupStore (the job path) succeeds too
    const bs = BB.backupStore({ root, dir: t, stamp: '20261120T030001Z', key: KEY, fsx: { ...fs } });
    assert.equal(bs.present, true); assert.equal(bs.count, 2);
    // a real read error aborts — and never leaves the full-size .part behind
    const bad = { ...fs, readFileSync: (p, ...r) => { if (String(p).endsWith('z.jpg')) { const e = new Error('EIO: i/o error'); e.code = 'EIO'; throw e; } return fs.readFileSync(p, ...r); } };
    const f2 = path.join(t, BB.archiveNameFor('20261120T030002Z', { encrypted: true }));
    assert.throws(() => BB.writeArchive({ root, file: f2, key: KEY, fsx: bad }), /EIO/);
    assert.equal(fs.existsSync(f2 + '.part'), false, '.part removed on failure');
    assert.equal(fs.existsSync(f2), false);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('O-3: retention prunes stale .part and old .rejected archives (and old .rejected dumps); a fresh .part is left alone', () => {
  const t = tmp('bb-prune-');
  try {
    const mk = (n, ageMs = 0) => { const p = path.join(t, n); fs.writeFileSync(p, 'x'); if (ageMs) { const s = (Date.now() - ageMs) / 1000; fs.utimesSync(p, s, s); } };
    for (const s of ['20261101T030000Z', '20261102T030000Z', '20261103T030000Z']) mk(`sdp_blobs_${s}.blobs.enc`);
    mk('sdp_blobs_20261001T030000Z.blobs.enc.rejected');         // older than the oldest kept → pruned
    mk('sdp_blobs_20261102T130000Z.blobs.enc.rejected');         // recent diagnosis → kept
    mk('sdp_blobs_20261003T030000Z.blobs.enc.part');             // crashed run, old stamp → pruned
    mk('sdp_blobs_20261103T040000Z.blobs.enc.part', 7 * 3600e3); // untouched for 7 h → pruned
    mk('sdp_blobs_20261103T050000Z.blobs.enc.part');             // a backup running right now → kept
    mk('operator-notes.txt');
    const gone = BB.pruneArchives(t, { keep: 2 });
    assert.deepEqual(gone.sort(), ['sdp_blobs_20261001T030000Z.blobs.enc.rejected', 'sdp_blobs_20261003T030000Z.blobs.enc.part',
      'sdp_blobs_20261101T030000Z.blobs.enc', 'sdp_blobs_20261103T040000Z.blobs.enc.part'].sort());
    const left = fs.readdirSync(t).sort();
    assert.ok(left.includes('sdp_blobs_20261102T130000Z.blobs.enc.rejected') && left.includes('sdp_blobs_20261103T050000Z.blobs.enc.part') && left.includes('operator-notes.txt'));
    // dumps: an old quarantined dump goes, a recent one stays
    for (const s of ['20261101T030000Z', '20261102T030000Z']) mk(`sdp_dashboard_${s}.sql.gz.enc`);
    mk('sdp_dashboard_20261001T030000Z.sql.rejected'); mk('sdp_dashboard_20261102T130000Z.sql.rejected');
    const g2 = B.prune(t, { keep: 2 });
    assert.deepEqual(g2, ['sdp_dashboard_20261001T030000Z.sql.rejected']);
    assert.ok(fs.existsSync(path.join(t, 'sdp_dashboard_20261102T130000Z.sql.rejected')));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('O-3b: sdp-manager resolves the file store from the TARGET install, not from the tree it runs from', () => {
  const M = require('../tools/sdp-manager');
  const inst = path.join(os.tmpdir(), 'fake-install');
  assert.equal(M.blobRootOf(inst, {}), path.join(inst, 'data', 'blobs'));
  assert.equal(M.blobRootOf(inst, { SDP_DATA_DIR: 'store' }), path.join(inst, 'store', 'blobs'), 'a relative SDP_DATA_DIR is relative to the install');
  assert.equal(M.blobRootOf(inst, { SDP_DATA_DIR: '/srv/sdp-data' }), path.resolve('/srv/sdp-data', 'blobs'));
  assert.equal(M.blobRootOf(inst, { SDP_BLOB_ROOT: '/mnt/photos' }), path.resolve('/mnt/photos'));
  // every runBackup call in the manager passes the install's blob root
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sdp-manager.js'), 'utf8').replace(/\r\n/g, '\n');
  const calls = src.split('\n').filter((l) => /runBackup\(\{ dir:/.test(l));
  assert.ok(calls.length >= 3, 'three backup call sites');
  for (const c of calls) assert.match(c, /blobRoot: blobRootOf\(dir, env\)/, c);
  assert.doesNotMatch(src, /file store: none on this server/);
});
