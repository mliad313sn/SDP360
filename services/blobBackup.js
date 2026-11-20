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

/** Relative refs (forward slashes) of every regular file under root, sorted; null when root does not exist. */
function listStore(root, { fsx = fs } = {}) {
  if (!root || !fsx.existsSync(root)) return null;
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
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
function writeArchive({ root, file, key = null, fsx = fs, now = new Date() }) {
  const refs = listStore(root, { fsx }) || [];
  const part = file + '.part';
  const fd = fsx.openSync(part, 'w');
  const files = []; let total = 0;
  try {
    fsx.writeSync(fd, key ? MAGIC_ENC : MAGIC_PLAIN);
    for (const ref of refs) {
      const data = fsx.readFileSync(path.join(root, ...ref.split('/')));
      const r = Buffer.from(ref, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32BE(r.length, 0);
      _writeRecord(fsx, fd, T_FILE, _box(Buffer.concat([len, r, data]), key));
      files.push({ ref, size: data.length, sha256: sha256(data) }); total += data.length;
    }
    const manifest = { version: 1, created_at: now.toISOString(), count: files.length, total_bytes: total, files };
    _writeRecord(fsx, fd, T_MANIFEST, _box(Buffer.from(JSON.stringify(manifest), 'utf8'), key));
  } finally { fsx.closeSync(fd); }
  fsx.renameSync(part, file);
  return { file, count: files.length, total_bytes: total, encrypted: !!key, manifest: { count: files.length, total_bytes: total, files } };
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

function pruneArchives(dir, { keep = 14, prefix = PREFIX, fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => isArchiveName(n, prefix)); } catch (_) { return []; }
  names.sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
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
function backupStore({ root, dir, stamp, key = null, offsitePath = '', fsx = fs, now = new Date() }) {
  const refs = listStore(root, { fsx });
  if (refs == null) return { present: false, root };
  const file = path.join(dir, archiveNameFor(stamp, { encrypted: !!key }));
  const w = writeArchive({ root, file, key, fsx, now });
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
  return { present: true, file, count: w.count, total_bytes: w.total_bytes, encrypted: w.encrypted, offsite };
}

module.exports = { PREFIX, isArchiveName, archiveNameFor, stampOf, defaultBlobRoot, listStore, writeArchive, readArchive,
  compareWithManifest, verifyArchive, restoreArchive, pruneArchives, archiveFor, backupStore };
