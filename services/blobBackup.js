'use strict';
// P11 r5 N-14 — the file store (inspection photos and signatures, field uploads, project documents: everything
// services/blobStore.js writes under <DATA_DIR>/blobs) is part of the backup, next to the database dump.
//
// One archive per backup run, same stamp as the dump, same key rules (SDP_BACKUP_KEY, refused without it unless
// SDP_BACKUP_ALLOW_PLAINTEXT=1), same retention count, same quarantine rule (a file that fails verification becomes
// `<name>.rejected`, never read, kept or pruned). Name: `sdp_blobs_<yyyymmdd>T<hhmmss>Z.blobs[.enc]`.
//
// Format (streamed — one file in memory at a time, photos and documents never pile up in RAM):
//   MAGIC(8: 'SDPBLOB1' encrypted / 'SDPBLOP1' plaintext) then records, each
//     type(1: 1 = file, 2 = manifest) | length(4, big-endian) | box
//   box = encryptBuffer(gzip(payload), key)        (services/backup.js AES-256-GCM — a tampered record throws)
//       = gzip(payload)                             (plaintext override)
//   file payload     = refLength(4) | ref (utf8, "module/owner/file") | bytes
//   manifest payload = JSON { version, created_at, count, total_bytes, files: [{ ref, size, sha256 }] } — LAST record.
// Verification reads every record back, recomputes size + SHA-256 of each file and compares with the manifest:
// same count, same files, same hashes, nothing extra — otherwise the archive is refused.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const backup = require('./backup');

const PREFIX = 'sdp_blobs';
const MAGIC_ENC = Buffer.from('SDPBLOB1', 'ascii');
const MAGIC_PLAIN = Buffer.from('SDPBLOP1', 'ascii');
const T_FILE = 1, T_MANIFEST = 2;

const _escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isArchiveName(name, prefix = PREFIX) {
  return new RegExp('^' + _escRe(prefix) + '_\\d{8}T\\d{6}Z\\.blobs(?:\\.enc)?$').test(String(name || ''));
}
function archiveNameFor(stamp, { encrypted, prefix = PREFIX } = {}) { return `${prefix}_${stamp}.blobs${encrypted ? '.enc' : ''}`; }
/** Stamp of a managed dump / archive name (`…_<yyyymmdd>T<hhmmss>Z.…`), or null. */
function stampOf(name) { const m = /_(\d{8}T\d{6}Z)\./.exec(path.basename(String(name || ''))); return m ? m[1] : null; }

function defaultBlobRoot(env = process.env) {
  if (env.SDP_BLOB_ROOT) return path.resolve(env.SDP_BLOB_ROOT);
  return path.join(env.SDP_DATA_DIR ? path.resolve(env.SDP_DATA_DIR) : path.join(__dirname, '..', 'data'), 'blobs');
}

/**
 * P11 r6 O-2 — enumerate the store EXACTLY as services/blobStore.js serves it: blobStore reads through links, so a
 * folder moved to another place and reached through a symlink / Windows junction is still served. The walk therefore
 * FOLLOWS a linked directory or file when its real path is inside `allowedRoot` (default: the data directory that holds
 * the store), and REFUSES (throws, code BLOB_LINK_OUTSIDE) a link that points outside it — a backup that silently
 * skipped a served subtree was the bug. A link back to one of its own ancestors is a cycle (code BLOB_LINK_CYCLE).
 * A dangling link serves nothing and is reported, not archived.
 * @returns {null|{ refs: string[], links: {ref:string,target:string}[], dangling: string[] }}
 */
function listStoreDetailed(root, { fsx = fs, allowedRoot = null } = {}) {
  if (!root || !fsx.existsSync(root)) return null;
  const real = (p) => (typeof fsx.realpathSync === 'function' ? fsx.realpathSync(p) : path.resolve(p));
  const rootReal = real(root);
  const allowed = real(allowedRoot || path.dirname(path.resolve(root)));
  const inside = (p) => { const r = path.relative(allowed, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  const refs = []; const links = []; const dangling = [];
  const walk = (dir, rel, ancestors) => {
    for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      const abs = path.join(dir, e.name);
      let isDir = e.isDirectory(), isFile = e.isFile(), dirReal = null;
      if (e.isSymbolicLink && e.isSymbolicLink()) {
        let st, target;
        try { st = fsx.statSync(abs); target = real(abs); } catch (_) { dangling.push(r); continue; }
        if (!inside(target)) {
          const err = new Error(`file store: "${r}" is a link to ${target}, outside the data directory ${allowed} — refusing to back up a store that is partly elsewhere (move the folder back, or point SDP_DATA_DIR at a directory that contains it)`);
          err.code = 'BLOB_LINK_OUTSIDE'; err.transient = false; throw err;
        }
        links.push({ ref: r, target });
        isDir = st.isDirectory(); isFile = st.isFile(); dirReal = isDir ? target : null;
      }
      if (isDir) {
        const dr = dirReal || real(abs);
        if (ancestors.has(dr)) { const err = new Error(`file store: "${r}" links back to one of its own parent folders (${dr}) — a link cycle cannot be archived`); err.code = 'BLOB_LINK_CYCLE'; err.transient = false; throw err; }
        const next = new Set(ancestors); next.add(dr);
        walk(abs, r, next);
      } else if (isFile) refs.push(r);
    }
  };
  walk(root, '', new Set([rootReal]));
  return { refs: refs.sort(), links, dangling };
}

/** Relative refs (forward slashes) of every file the app serves under root, sorted; null when root does not exist. */
function listStore(root, { fsx = fs, allowedRoot = null } = {}) {
  const d = listStoreDetailed(root, { fsx, allowedRoot });
  return d ? d.refs : null;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function _box(payload, key) { const gz = zlib.gzipSync(payload, { level: 6 }); return key ? backup.encryptBuffer(gz, key) : gz; }
function _unbox(box, key, encrypted) { return zlib.gunzipSync(encrypted ? backup.decryptBuffer(box, key) : box); }
function _writeRecord(fsx, fd, type, box) {
  const head = Buffer.alloc(5); head.writeUInt8(type, 0); head.writeUInt32BE(box.length, 1);
  fsx.writeSync(fd, head); fsx.writeSync(fd, box);
}

/**
 * Write the archive of `root` to `file` (atomically: `<file>.part` then rename).
 * @returns {{ file, count, total_bytes, encrypted, manifest }}
 */
function writeArchive({ root, file, key = null, fsx = fs, now = new Date(), allowedRoot = null }) {
  const listed = listStoreDetailed(root, { fsx, allowedRoot });
  const refs = listed ? listed.refs : [];
  const part = file + '.part';
  const fd = fsx.openSync(part, 'w');
  const files = []; const vanished = []; let total = 0; let closed = false;
  try {
    fsx.writeSync(fd, key ? MAGIC_ENC : MAGIC_PLAIN);
    for (const ref of refs) {
      let data;
      // P11 r6 O-3 — a file deleted between the walk and the read (an inspection delete during the backup) is normal
      // activity: it is recorded as vanished in the manifest, never a reason to abort the whole run.
      try { data = fsx.readFileSync(path.join(root, ...ref.split('/'))); }
      catch (e) { if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) { vanished.push(ref); continue; } throw e; }
      const r = Buffer.from(ref, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(r.length, 0);
      _writeRecord(fsx, fd, T_FILE, _box(Buffer.concat([len, r, data]), key));
      files.push({ ref, size: data.length, sha256: sha256(data) }); total += data.length;
    }
    const manifest = { version: 1, created_at: now.toISOString(), count: files.length, total_bytes: total, files,
      ...(vanished.length ? { vanished } : {}), ...(listed && listed.links.length ? { links: listed.links.map((l) => l.ref) } : {}), ...(listed && listed.dangling.length ? { dangling: listed.dangling } : {}) };
    _writeRecord(fsx, fd, T_MANIFEST, _box(Buffer.from(JSON.stringify(manifest), 'utf8'), key));
    fsx.closeSync(fd); closed = true;
    fsx.renameSync(part, file);
  } catch (e) {
    // P11 r6 O-3 — never leave a full-size `.part` behind a failed run
    if (!closed) { try { fsx.closeSync(fd); } catch (_) { /* already closed */ } }
    try { fsx.unlinkSync(part); } catch (_) { /* best effort */ }
    throw e;
  }
  return { file, count: files.length, total_bytes: total, encrypted: !!key, vanished, links: listed ? listed.links : [], dangling: listed ? listed.dangling : [],
    manifest: { count: files.length, total_bytes: total, files } };
}

/** ref → { size, sha256 } of every ref that still exists under root (read through links, like the app). */
function hashStore(root, refs, { fsx = fs } = {}) {
  const out = {};
  for (const ref of refs || []) {
    const abs = path.resolve(root, ...String(ref).split('/'));
    const rel = path.relative(path.resolve(root), abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    let b; try { b = fsx.readFileSync(abs); } catch (_) { continue; }
    out[ref] = { size: b.length, sha256: sha256(b) };
  }
  return out;
}

/**
 * Read an archive record by record. onFile(ref, bytes) is called for every file (optional).
 * Throws on a wrong key, a tampered record (GCM tag) or a truncated file.
 * @returns {{ manifest, files: Record<string,{size,sha256}>, order: string[], encrypted }}
 */
function readArchive(file, { key = null, onFile = null, fsx = fs } = {}) {
  const fd = fsx.openSync(file, 'r');
  try {
    const size = fsx.fstatSync(fd).size;
    const magic = Buffer.alloc(8); fsx.readSync(fd, magic, 0, 8, 0);
    const encrypted = magic.equals(MAGIC_ENC);
    if (!encrypted && !magic.equals(MAGIC_PLAIN)) throw new Error('not an SDP file-store archive');
    if (encrypted && !key) throw new Error('this file-store archive is encrypted — SDP_BACKUP_KEY is required to open it');
    let pos = 8; let manifest = null; const files = {}; const order = [];
    while (pos < size) {
      if (manifest) throw new Error('data after the manifest record — archive refused');
      const head = Buffer.alloc(5);
      if (fsx.readSync(fd, head, 0, 5, pos) !== 5) throw new Error('truncated archive (record header)');
      const type = head.readUInt8(0), len = head.readUInt32BE(1); pos += 5;
      if (pos + len > size) throw new Error('truncated archive (record body)');
      const box = Buffer.alloc(len); fsx.readSync(fd, box, 0, len, pos); pos += len;
      const payload = _unbox(box, key, encrypted);
      if (type === T_FILE) {
        const rl = payload.readUInt32BE(0); const ref = payload.subarray(4, 4 + rl).toString('utf8'); const data = payload.subarray(4 + rl);
        if (Object.prototype.hasOwnProperty.call(files, ref)) throw new Error(`file ${ref} twice in the archive`);
        files[ref] = { size: data.length, sha256: sha256(data) }; order.push(ref);
        if (onFile) onFile(ref, data);
      } else if (type === T_MANIFEST) manifest = JSON.parse(payload.toString('utf8'));
      else throw new Error(`unknown record type ${type}`);
    }
    if (!manifest) throw new Error('no manifest record — truncated archive');
    return { manifest, files, order, encrypted };
  } finally { fsx.closeSync(fd); }
}

/** Pure: content read back vs the manifest. */
function compareWithManifest(manifest, files) {
  const problems = [];
  const listed = Array.isArray(manifest && manifest.files) ? manifest.files : [];
  if (Number(manifest && manifest.count) !== listed.length) problems.push(`manifest count ${manifest && manifest.count} ≠ ${listed.length} listed`);
  const seen = new Set();
  for (const f of listed) {
    seen.add(f.ref);
    const got = files[f.ref];
    if (!got) problems.push(`missing: ${f.ref}`);
    else if (got.sha256 !== f.sha256 || Number(got.size) !== Number(f.size)) problems.push(`different: ${f.ref}`);
  }
  for (const ref of Object.keys(files)) if (!seen.has(ref)) problems.push(`not in the manifest: ${ref}`);
  return { ok: problems.length === 0, count: listed.length, problems };
}

/** Read back + compare. Never throws: a broken archive is { ok:false, problems:[…] }. */
function verifyArchive(file, { key = null, fsx = fs } = {}) {
  try {
    const r = readArchive(file, { key, fsx });
    const c = compareWithManifest(r.manifest, r.files);
    return { ...c, files: r.files, manifest: r.manifest, encrypted: r.encrypted };
  } catch (e) { return { ok: false, count: null, problems: [e.message], files: null, manifest: null }; }
}

function _safeTarget(target, ref) {
  const abs = path.resolve(target, ...String(ref).split('/'));
  const rel = path.relative(path.resolve(target), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`unsafe path in the archive: ${ref}`);
  return abs;
}

/**
 * Restore an archive into `target` (an EMPTY directory or a new one — never over the live store by default), then
 * verify the written files against the manifest (count + size + SHA-256 read from disk).
 * @returns {{ ok, count, problems, target }}
 */
function restoreArchive(file, { key = null, target, allowNonEmpty = false, fsx = fs } = {}) {
  if (!target) throw new Error('restoreArchive: target directory is required');
  if (fsx.existsSync(target) && fsx.readdirSync(target).length && !allowNonEmpty) throw new Error(`restore target ${target} is not empty — restore into an empty directory, then move it into place`);
  fsx.mkdirSync(target, { recursive: true });
  const r = readArchive(file, { key, fsx, onFile: (ref, data) => {
    const abs = _safeTarget(target, ref);
    fsx.mkdirSync(path.dirname(abs), { recursive: true });
    fsx.writeFileSync(abs, data);
  } });
  const onDisk = {};
  for (const f of r.manifest.files || []) {
    const abs = _safeTarget(target, f.ref);
    if (fsx.existsSync(abs)) { const b = fsx.readFileSync(abs); onDisk[f.ref] = { size: b.length, sha256: sha256(b) }; }
  }
  const c = compareWithManifest(r.manifest, onDisk);
  return { ...c, target };
}

const LEFTOVER_PART_AGE_MS = 6 * 3600 * 1000;
/**
 * Keep the newest `keep` archives. P11 r6 O-3 — leftovers of failed runs are pruned too: a `.rejected` archive older
 * than the oldest kept archive (and never more than `keep` of them), a `.part` older than that or untouched for 6 h
 * (a running backup's `.part` is fresh and is left alone).
 */
function pruneArchives(dir, { keep = 14, prefix = PREFIX, fsx = fs, nowMs = Date.now() } = {}) {
  let all = [];
  try { all = fsx.readdirSync(dir); } catch (_) { return []; }
  const names = all.filter((n) => isArchiveName(n, prefix)).sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  const kept = names.slice(doomed.length);
  const oldestKept = kept.length ? stampOf(kept[0]) : null;
  const leftRe = new RegExp('^' + _escRe(prefix) + '_\\d{8}T\\d{6}Z\\.blobs(?:\\.enc)?\\.(part|rejected)$');
  const rejected = all.filter((n) => leftRe.test(n) && n.endsWith('.rejected')).sort();
  const parts = all.filter((n) => leftRe.test(n) && n.endsWith('.part'));
  const older = (n) => oldestKept && stampOf(n) < oldestKept;
  rejected.forEach((n, i) => { if (older(n) || i < rejected.length - keep) doomed.push(n); });
  for (const n of parts) {
    let stale = older(n);
    if (!stale) { try { stale = nowMs - fsx.statSync(path.join(dir, n)).mtimeMs > LEFTOVER_PART_AGE_MS; } catch (_) { stale = false; } }
    if (stale) doomed.push(n);
  }
  for (const n of doomed) { try { fsx.unlinkSync(path.join(dir, n)); } catch (_) { /* best effort */ } }
  return doomed;
}

/** The archive of the same backup run as `dumpFile` (same stamp), else the newest archive; null when none. */
function archiveFor(dir, dumpFile, { prefix = PREFIX, fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => isArchiveName(n, prefix)); } catch (_) { return null; }
  if (!names.length) return null;
  const st = stampOf(dumpFile);
  const same = st ? names.find((n) => stampOf(n) === st) : null;
  names.sort();
  return path.join(dir, same || names[names.length - 1]);
}

/**
 * The file-store half of a backup run. Store absent → { present:false } (nothing to lose). Otherwise writes, verifies
 * (quarantining a bad archive as `.rejected`, non-transient failure), copies off-site when asked.
 */
function backupStore({ root, dir, stamp, key = null, offsitePath = '', fsx = fs, now = new Date(), allowedRoot = null }) {
  if (!root || !fsx.existsSync(root)) return { present: false, root };
  const file = path.join(dir, archiveNameFor(stamp, { encrypted: !!key }));
  const w = writeArchive({ root, file, key, fsx, now, allowedRoot });
  const v = verifyArchive(file, { key, fsx });
  if (!v.ok || v.count !== w.count) {
    let quarantined = null;
    try { fsx.renameSync(file, file + '.rejected'); quarantined = path.basename(file) + '.rejected'; } catch (_) { try { fsx.unlinkSync(file); } catch (_e) { /* best effort */ } }
    const e = new Error(`file-store archive failed verification (${v.problems.slice(0, 3).join('; ')})${quarantined ? ` — quarantined as ${quarantined}` : ''}`);
    e.transient = false; throw e;
  }
  let offsite = null;
  if (offsitePath && String(offsitePath).trim()) {
    try { offsite = backup.copyOffsite(file, String(offsitePath).trim(), { fsx }); }
    catch (e2) { const e = new Error(`off-site copy of the file-store archive failed (${String(offsitePath).trim()}): ${e2.message}`); e.transient = true; e.file = file; throw e; }
  }
  return { present: true, file, count: w.count, total_bytes: w.total_bytes, encrypted: w.encrypted, offsite, vanished: w.vanished, links: w.links.map((l) => l.ref), dangling: w.dangling };
}

// ── P11 r6 O-1 — off the server's event loop ──────────────────────────────────────────────────────────────────────
// db.backup and db.restore_drill run INSIDE the web server (services/sync/jobs.js). Reading, compressing, encrypting
// and hashing a multi-GB photo store synchronously froze every request and /ready for minutes. The heavy work runs in
// a child process (services/blobBackupWorker.js, same synchronous engine) while the server awaits it. The key travels
// on the child's stdin, never on a command line. An injected fsx (tests) keeps the in-process path.
const WORKER = path.join(__dirname, 'blobBackupWorker.js');
function runWorker(op, args = {}, { key = null, env = process.env, spawn = null } = {}) {
  return new Promise((resolve, reject) => {
    const cp = (spawn || require('child_process').spawn)(process.execPath, [WORKER], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = []; const err = [];
    cp.stdout.on('data', (d) => out.push(d));
    cp.stderr.on('data', (d) => { if (err.length < 64) err.push(d); });
    cp.on('error', (e) => { const x = new Error(`file-store worker could not start: ${e.message}`); x.transient = true; reject(x); });
    cp.on('close', (code) => {
      let msg = null;
      try { msg = JSON.parse(Buffer.concat(out).toString('utf8')); } catch (_) { msg = null; }
      if (msg && msg.ok) return resolve(msg.result);
      if (msg && msg.error) { const x = new Error(msg.error.message); for (const k of ['transient', 'code', 'file']) if (msg.error[k] !== undefined) x[k] = msg.error[k]; return reject(x); }
      const x = new Error(`file-store worker ${op} failed (exit ${code}): ${Buffer.concat(err).toString('utf8').trim().slice(-300)}`); x.transient = false; reject(x);
    });
    cp.stdin.on('error', () => { /* child died early — reported by close */ });
    cp.stdin.end(JSON.stringify({ op, args, keyHex: key ? Buffer.from(key).toString('hex') : null }));
  });
}
const _inProcess = (fsx) => fsx && fsx !== fs;
/** backupStore, run in a child process (or in-process when an fsx is injected). */
async function backupStoreAsync(o) {
  if (_inProcess(o.fsx)) return backupStore(o);
  const { key, fsx, env, spawn, now, ...rest } = o; void fsx; void now;
  return runWorker('backup-store', rest, { key, env, spawn });
}
/**
 * The drill's file-store inputs (live refs as the app serves them, their hashes, the archive read back), computed in a
 * child process. A link refused by the walk comes back as listError (the drill fails on it), never as "no store".
 */
async function drillFilesAsync({ root, archive = null, key = null, allowedRoot = null, fsx = null, env, spawn } = {}) {
  if (_inProcess(fsx)) return drillFiles({ root, archive, key, allowedRoot, fsx });
  return runWorker('drill-files', { root, archive, allowedRoot }, { key, env, spawn });
}
function drillFiles({ root, archive = null, key = null, allowedRoot = null, fsx = fs }) {
  let liveRefs = null, listError = null;
  try { liveRefs = listStore(root, { fsx, allowedRoot }); } catch (e) { listError = e.message; }
  const liveHashes = liveRefs ? hashStore(root, liveRefs, { fsx }) : {};
  const verify = archive ? verifyArchive(archive, { key, fsx }) : null;
  return { liveRefs, liveHashes, listError, verify };
}

module.exports = { PREFIX, isArchiveName, archiveNameFor, stampOf, defaultBlobRoot, listStore, listStoreDetailed, hashStore, writeArchive, readArchive,
  compareWithManifest, verifyArchive, restoreArchive, pruneArchives, archiveFor, backupStore, backupStoreAsync, drillFiles, drillFilesAsync, runWorker };
