'use strict';
// Step 2 (SDP-DASH-2.0) — nightly ENCRYPTED PostgreSQL backup, run by the sync runner (job
// 'db.backup', 02:30). pg_dump → gzip → AES-256-GCM → <dir>/sdp_dashboard_<stamp>.sql.gz.enc.
//
//   SDP_BACKUP_DIR              enables the job (unset → the job reports "not configured")
//   SDP_BACKUP_KEY              passphrase (≥ 16 chars); falls back to SDP_CONFIG_KEY. NEVER stored
//                               next to the backups: without it a backup cannot be read.
//   SDP_BACKUP_RETENTION_DAYS   default 14; older *.sql.gz.enc files in the dir are removed
//   PG_DUMP                     path to pg_dump (else the newest C:\Program Files\PostgreSQL\*\bin,
//                               else pg_dump on PATH)
//
// A plaintext backup is never written: no key → the run fails. The password travels to pg_dump
// through PGPASSWORD only (never on a command line, never logged). Restore: tools/pg/restore-backup.js
// and docs/ops/RESTORE-DRILL.md.
//
// File format: "SDPBK1" (6 bytes) · salt (16) · iv (12) · ciphertext · GCM tag (16, at the end).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

const MAGIC = Buffer.from('SDPBK1');
const SUFFIX = '.sql.gz.enc';

function keyFrom(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function backupKey(env = process.env) {
  const k = String(env.SDP_BACKUP_KEY || env.SDP_CONFIG_KEY || '');
  return k.length >= 16 ? k : null;
}

function findPgDump(env = process.env) {
  if (env.PG_DUMP && fs.existsSync(env.PG_DUMP)) return env.PG_DUMP;
  for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
    try {
      const vers = fs.readdirSync(root).sort((a, b) => parseFloat(b) - parseFloat(a));
      for (const v of vers) { const p = path.join(root, v, 'bin', 'pg_dump.exe'); if (fs.existsSync(p)) return p; }
    } catch (_) { /* not installed there */ }
  }
  return 'pg_dump';
}

/** Connection URL → pg_dump args + env (password out of argv). */
function pgDumpInvocation(url, { schemaOnly = false, schema } = {}) {
  const u = new URL(url);
  const args = ['--no-owner', '--no-privileges', '--format=plain',
    '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.replace(/^\//, '')];
  if (schemaOnly) args.push('--schema-only');
  if (schema) args.push('--schema', schema);
  return { args, env: { PGPASSWORD: decodeURIComponent(u.password || '') } };
}

function _stamp(d = new Date()) { return d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-'); }

/** Encrypt a readable stream of plaintext into `file`. */
async function encryptStreamToFile(readable, file, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(readable, zlib.createGzip(), cipher, out);
  fs.appendFileSync(tmp, cipher.getAuthTag());
  fs.renameSync(tmp, file);
  return fs.statSync(file).size;
}

/** Decrypt an encrypted backup to plain SQL at `outFile`. Throws on a wrong key or a damaged file. */
async function decryptFileToFile(file, outFile, passphrase) {
  const buf = fs.readFileSync(file);
  if (buf.length < 50 || !buf.subarray(0, 6).equals(MAGIC)) throw new Error('not an SDP backup file');
  const salt = buf.subarray(6, 22), iv = buf.subarray(22, 34), tag = buf.subarray(buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(buf.subarray(34, buf.length - 16)), decipher.final()]);
  fs.writeFileSync(outFile, zlib.gunzipSync(plain));
  return fs.statSync(outFile).size;
}

function purgeOld(dir, days, nowMs = Date.now()) {
  const cutoff = nowMs - Math.max(1, Number(days) || 14) * 86400000;
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(SUFFIX)) continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); n++; }
  }
  return n;
}

/**
 * One backup run. Returns {skipped} when SDP_BACKUP_DIR is unset; throws on failure (the runner
 * records and alerts). deps.spawn is injectable for tests.
 */
async function runBackup({ env = process.env, spawnFn = spawn, now = new Date(), dumpOpts } = {}) {
  const dir = env.SDP_BACKUP_DIR;
  if (!dir) return { skipped: 'not configured (SDP_BACKUP_DIR)' };
  const key = backupKey(env);
  if (!key) { const e = new Error('backup key missing: set SDP_BACKUP_KEY (≥ 16 characters) — no plaintext backup is written'); e.transient = false; throw e; }
  const url = env.PG_URL || env.DATABASE_URL;
  if (!url) { const e = new Error('PG_URL / DATABASE_URL is not set'); e.transient = false; throw e; }
  fs.mkdirSync(dir, { recursive: true });
  const inv = pgDumpInvocation(url, dumpOpts);
  const child = spawnFn(findPgDump(env), inv.args, { env: { ...process.env, ...inv.env }, windowsHide: true });
  let stderr = '';
  child.stderr && child.stderr.on('data', d => { stderr += d; if (stderr.length > 4000) stderr = stderr.slice(-4000); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  const file = path.join(dir, `sdp_dashboard_${_stamp(now)}${SUFFIX}`);
  let bytes;
  try {
    // Count plaintext bytes on the way through: an empty dump must not count as a backup.
    let plainBytes = 0;
    const counter = new Transform({ transform(chunk, _e, cb) { plainBytes += chunk.length; cb(null, chunk); } });
    const enc = encryptStreamToFile(child.stdout.pipe(counter), file, key);
    const [size, code] = await Promise.all([enc, exited]);
    if (code !== 0) throw new Error(`pg_dump exited with code ${code}: ${stderr.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
    if (plainBytes < 100) throw new Error('pg_dump produced an empty dump');
    bytes = size;
  } catch (e) {
    try { fs.unlinkSync(file); } catch (_) {}
    try { fs.unlinkSync(file + '.part'); } catch (_) {}
    throw e;
  }
  const purged = purgeOld(dir, env.SDP_BACKUP_RETENTION_DAYS || 14, now.getTime());
  return { file: path.basename(file), bytes, purged };
}

module.exports = { runBackup, encryptStreamToFile, decryptFileToFile, pgDumpInvocation, findPgDump, backupKey, purgeOld, SUFFIX };
