'use strict';
// Step 2 — nightly PostgreSQL backup as a registry job (visible in /api/sync/health, alerted
// on failure like every other job). Spawns tools/pg/dump-db.js (pg_dump wrapper, password
// via PGPASSWORD only) and applies a simple retention. Pure core (`planBackup`, `prune`,
// the encrypt / verify / pack helpers) is unit-tested; the spawn is injectable.
//
// E11 (2026-10-21) — a dump is only a backup once it can be restored, and it only survives
// the loss of the server if it leaves the server:
//   • integrity  — the file must END with pg_dump's trailer `-- PostgreSQL database dump complete`
//                  (a size check alone accepts a dump truncated by a timeout / full disk);
//   • format     — gzip (`.sql.gz`), then AES-256-GCM with SDP_BACKUP_KEY (`.sql.gz.enc`).
//                  SDP_BACKUP_KEY is a DIFFERENT secret from SDP_CONFIG_KEY (a dump restored
//                  elsewhere needs the config key to read its secrets, the backup key to open
//                  the file — losing one must not lose the other). No key → the backup is
//                  REFUSED (P11 F-05) unless SDP_BACKUP_ALLOW_PLAINTEXT=1, which stores plaintext
//                  gzip with a loud warning on every run;
//   • off-site   — copied to `backup_offsite_path` (report_config, UNC or local path) when set.
//                  S3 / object storage is out of scope here (DECISIONS-EN-ATTENTE).
//   • file store — P11 r5 N-14: <DATA_DIR>/blobs (inspection photos / signatures, field uploads, project documents)
//                  is archived by the same run (services/blobBackup.js): `sdp_blobs_<stamp>.blobs[.enc]`, same key,
//                  same retention, verified (count + SHA-256 against its manifest) before the run succeeds.
// File layout of an encrypted dump: MAGIC(8) | iv(12) | tag(16) | ciphertext(gzip bytes).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TRAILER = '-- PostgreSQL database dump complete';
const MAGIC = Buffer.from('SDPBKUP1', 'ascii');   // 8 bytes
const MIN_KEY_CHARS = 16;
const SCRYPT_SALT = 'sdp-backup-key-v1';          // fixed salt: one key per passphrase, like configSecrets
const EXTENSIONS = ['.sql.gz.enc', '.sql.gz', '.sql'];   // longest first (suffix matching)

function planBackup({ dir, now = new Date(), prefix = 'sdp_dashboard' }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return { file: path.join(dir, `${prefix}_${stamp}.sql`), stamp };
}

// P11 r3 N-07 — only the generator's exact name is a managed dump: `<prefix>_<yyyymmdd>T<hhmmss>Z.sql[.gz[.enc]]`.
// A loose `startsWith` let an operator file (`sdp_dashboard_before-upgrade.sql`) sort after every stamp, be kept as
// "newest", get the real backups pruned and be restored by the nightly drill. With a fixed-width stamp, name order
// IS time order; anything else in the directory is never read, kept or deleted.
const _escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function isDumpName(name, prefix = 'sdp_dashboard') {
  return new RegExp('^' + _escRe(prefix) + '_\\d{8}T\\d{6}Z\\.sql(?:\\.gz(?:\\.enc)?)?$').test(String(name || ''));
}

// Keep the newest `keep` dumps matching the prefix (any of the three formats); return the deleted names.
function prune(dir, { keep = 14, prefix = 'sdp_dashboard', fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => isDumpName(n, prefix)); } catch (_) { return []; }
  names.sort();
  const doomed = names.slice(0, Math.max(0, names.length - keep));
  for (const n of doomed) { try { fsx.unlinkSync(path.join(dir, n)); } catch (_) { /* best effort */ } }
  return doomed;
}

// Newest dump in `dir` (by the UTC stamp in the name), or null.
function latestDump(dir, { prefix = 'sdp_dashboard', fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => isDumpName(n, prefix)); } catch (_) { return null; }
  if (!names.length) return null;
  names.sort();
  return path.join(dir, names[names.length - 1]);
}

// ── encryption (pure) ───────────────────────────────────────────────────────────────────
/** Passphrase → 32-byte key, or null when too short to be worth having. */
function deriveKey(passphrase) {
  const s = String(passphrase == null ? '' : passphrase);
  if (s.length < MIN_KEY_CHARS) return null;
  return crypto.scryptSync(s, SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
}
/**
 * P11 r4 — write-path key quality. A passphrase of 16 spaces passed deriveKey and was reported "encrypted".
 * The backup refuses a key with fewer than MIN_KEY_CHARS non-whitespace characters or fewer than MIN_KEY_DISTINCT
 * distinct characters ('aaaaaaaaaaaaaaaa'). Only the WRITE path checks it: deriveKey is unchanged, so an existing
 * backup made with any earlier key can still be opened. Returns the problem text, or null when the key is usable.
 */
const MIN_KEY_DISTINCT = 5;
function keyQualityProblem(passphrase) {
  if (passphrase == null || passphrase === '') return 'not set';
  const s = String(passphrase);
  const visible = s.replace(/\s+/g, '');
  if (visible.length < MIN_KEY_CHARS) return `too short (< ${MIN_KEY_CHARS} non-space chars)`;
  if (new Set(visible).size < MIN_KEY_DISTINCT) return `too weak (< ${MIN_KEY_DISTINCT} distinct chars)`;
  return null;
}

function encryptBuffer(plain, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('encryptBuffer: a 32-byte key is required');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function isEncryptedBuffer(buf) { return Buffer.isBuffer(buf) && buf.length > 36 && buf.subarray(0, 8).equals(MAGIC); }
/** Throws on a wrong key / tampered file (GCM tag) — never returns garbage. */
function decryptBuffer(box, key) {
  if (!isEncryptedBuffer(box)) throw new Error('decryptBuffer: not an SDP encrypted backup');
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('decryptBuffer: a 32-byte key is required');
  const iv = box.subarray(8, 20), tag = box.subarray(20, 36), body = box.subarray(36);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(body), d.final()]); }
  catch (e) { throw new Error('decryptBuffer: wrong SDP_BACKUP_KEY or corrupted backup'); }
}

// ── integrity (pure) ────────────────────────────────────────────────────────────────────
/** pg_dump plain output ends with the trailer; its absence = truncated / failed dump. */
function hasDumpTrailer(sqlTextOrBuffer) {
  const s = Buffer.isBuffer(sqlTextOrBuffer) ? sqlTextOrBuffer.subarray(Math.max(0, sqlTextOrBuffer.length - 4096)).toString('utf8') : String(sqlTextOrBuffer || '').slice(-4096);
  return s.includes(TRAILER);
}
/** Reads only the tail of a plain .sql file. */
function verifyDumpFile(file, { fsx = fs } = {}) {
  const st = fsx.statSync(file);
  const fd = fsx.openSync(file, 'r');
  try {
    const len = Math.min(4096, st.size);
    const buf = Buffer.alloc(len);
    fsx.readSync(fd, buf, 0, len, st.size - len);
    return { ok: hasDumpTrailer(buf), bytes: st.size };
  } finally { fsx.closeSync(fd); }
}

// ── pack / open ─────────────────────────────────────────────────────────────────────────
/** plain .sql → .sql.gz (or .sql.gz.enc with a key); the plain file is removed. */
function packDump(rawFile, { key = null, fsx = fs } = {}) {
  const plain = fsx.readFileSync(rawFile);
  const gz = zlib.gzipSync(plain, { level: 6 });
  const encrypted = !!key;
  const out = rawFile.replace(/\.sql$/, encrypted ? '.sql.gz.enc' : '.sql.gz');
  fsx.writeFileSync(out, encrypted ? encryptBuffer(gz, key) : gz);
  fsx.unlinkSync(rawFile);
  return { file: out, encrypted, bytes: plain.length, stored_bytes: fsx.statSync(out).size };
}
/** Any of the three formats → the plain SQL Buffer. `.enc` needs the key. */
function openDump(file, { key = null, fsx = fs } = {}) {
  let buf = fsx.readFileSync(file);
  if (file.endsWith('.enc') || isEncryptedBuffer(buf)) {
    if (!key) throw new Error('this backup is encrypted — SDP_BACKUP_KEY is required to open it');
    buf = decryptBuffer(buf, key);
  }
  if (file.endsWith('.gz') || file.endsWith('.gz.enc') || (buf[0] === 0x1f && buf[1] === 0x8b)) buf = zlib.gunzipSync(buf);
  return buf;
}

function copyOffsite(file, offsitePath, { fsx = fs } = {}) {
  fsx.mkdirSync(offsitePath, { recursive: true });
  const dest = path.join(offsitePath, path.basename(file));
  fsx.copyFileSync(file, dest);
  return dest;
}

/**
 * @param {object} o
 * @param {string} o.dir        backup directory (created if missing)
 * @param {number} [o.keep]     retention count
 * @param {function} [o.spawn]  (cmd, args) => { status, stdout, stderr } — defaults to child_process.spawnSync(node, [dump-db.js, file])
 * @param {string} [o.offsitePath]  report_config.backup_offsite_path ('' = no copy)
 * @param {function} [o.log]    warning sink (default console.warn)
 */
async function runBackup({ dir, keep = 14, spawn, env = process.env, fsx = fs, offsitePath = '', log = console.warn, blobRoot, blobs = true } = {}) {
  if (!env.PG_URL && !env.DATABASE_URL) return { skipped: true, reason: 'no PG_URL' };
  // P11 F-05 — a dump carries password hashes and the (config-key-encrypted) secrets table: never write one in
  // plaintext by default. Missing / short SDP_BACKUP_KEY → refused BEFORE pg_dump runs (nothing lands on disk), as a
  // non-transient job failure, so the runner records it and the sync alerting raises it. An operator who must have a
  // backup anyway sets SDP_BACKUP_ALLOW_PLAINTEXT=1 (exact value) — the run then warns loudly every time.
  const keyProblem = keyQualityProblem(env.SDP_BACKUP_KEY);
  const key = keyProblem ? null : deriveKey(env.SDP_BACKUP_KEY);
  const plaintextOverride = !key && String(env.SDP_BACKUP_ALLOW_PLAINTEXT || '') === '1';
  if (!key && !plaintextOverride) {
    const e = new Error(`backup refused: SDP_BACKUP_KEY is ${keyProblem} — a dump would be stored in plaintext. Set SDP_BACKUP_KEY in .env (>= ${MIN_KEY_CHARS} chars, distinct from SDP_CONFIG_KEY), or set SDP_BACKUP_ALLOW_PLAINTEXT=1 to accept plaintext backups explicitly.`);
    e.transient = false; e.code = 'BACKUP_KEY_MISSING';
    try { log('[backup] ERROR: ' + e.message); } catch (_) { /* log sink optional */ }
    throw e;
  }
  fsx.mkdirSync(dir, { recursive: true });
  // two backups in the same second (a pre-restore point right after a manual backup) must never
  // share a name — the second would silently overwrite the first
  let { file } = planBackup({ dir });
  for (let i = 0; i < 3 && EXTENSIONS.some((e) => fsx.existsSync(file.replace(/\.sql$/, e))); i++) {
    const until = Date.now() + 1100; while (Date.now() < until) { /* next second */ }
    ({ file } = planBackup({ dir }));
  }
  const run = spawn || ((cmd, args) => require('child_process').spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30 * 60 * 1000 }));
  const r = run(process.execPath, [path.join(__dirname, '..', 'tools', 'pg', 'dump-db.js'), file]);
  if (!r || r.status !== 0) {
    const e = new Error(`pg_dump failed (exit ${r && r.status}): ${String((r && (r.stderr || r.stdout)) || '').trim().slice(0, 300)}`);
    e.transient = true; // a locked file / busy server is worth one retry
    throw e;
  }
  let bytes = 0; try { bytes = fsx.statSync(file).size; } catch (_) {}
  if (bytes < 1024) {
    // P11 r4 — the rejected file kept a managed dump name, so latestDump / the restore drill could pick it. It is
    // quarantined under `<name>.rejected` (isDumpName ignores it; kept for diagnosis, never restored or pruned).
    let quarantined = null;
    try { if (fsx.existsSync(file)) { fsx.renameSync(file, file + '.rejected'); quarantined = file + '.rejected'; } } catch (_) {
      try { fsx.unlinkSync(file); } catch (_) { /* best effort */ }
    }
    const e = new Error(`backup file is suspiciously small (${bytes} bytes): ${file}${quarantined ? ` — quarantined as ${path.basename(quarantined)}` : ''}`);
    e.transient = false; throw e;
  }
  const v = verifyDumpFile(file, { fsx });
  if (!v.ok) {
    try { fsx.unlinkSync(file); } catch (_) {}    // never keep a dump that only LOOKS complete
    const e = new Error(`backup is incomplete — pg_dump trailer missing: ${file}`); e.transient = true; throw e;
  }
  if (!key) log(`[backup] WARNING: SDP_BACKUP_KEY is ${keyProblem} — the dump is stored as PLAINTEXT gzip because SDP_BACKUP_ALLOW_PLAINTEXT=1 is set. Set SDP_BACKUP_KEY in .env (distinct from SDP_CONFIG_KEY) and remove the override.`);
  const packed = packDump(file, { key, fsx });
  let offsite = null;
  if (offsitePath && String(offsitePath).trim()) {
    try { offsite = copyOffsite(packed.file, String(offsitePath).trim(), { fsx }); }
    catch (e2) { const e = new Error(`off-site copy failed (${String(offsitePath).trim()}): ${e2.message}`); e.transient = true; e.file = packed.file; throw e; }
  }
  // P11 r5 N-14 — the file store (photos, signatures, field uploads, project documents) is archived next to the dump,
  // same stamp, same key, same retention, verified before it counts (services/blobBackup.js).
  let fileStore = null;
  if (blobs !== false) {
    const BB = require('./blobBackup');
    const root = blobRoot || BB.defaultBlobRoot(env);
    fileStore = BB.backupStore({ root, dir, stamp: BB.stampOf(packed.file), key, offsitePath, fsx });
  }
  const pruned = prune(dir, { keep, fsx }).concat(blobs !== false ? require('./blobBackup').pruneArchives(dir, { keep, fsx }) : []);
  return { file: packed.file, bytes, stored_bytes: packed.stored_bytes, encrypted: packed.encrypted, plaintext_override: plaintextOverride, compressed: true, trailer_ok: true, offsite, pruned, file_store: fileStore, rows: 1 };
}

module.exports = {
  runBackup, planBackup, prune, latestDump, isDumpName,
  deriveKey, encryptBuffer, decryptBuffer, isEncryptedBuffer,
  hasDumpTrailer, verifyDumpFile, packDump, openDump, copyOffsite,
  TRAILER, MIN_KEY_CHARS, MIN_KEY_DISTINCT, keyQualityProblem,
};
