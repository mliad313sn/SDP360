'use strict';
// Restore one of the server's own database backups (services/backup.js format) in place.
// Used by `sdp-manager restore` and the Windows Manager's Backups screen.
//
// Safety rules (the same as the console installer's red screen, Manage-SDP.ps1 -Restore):
//   • the operator types the exact phrase `RESTORE <yyyymmdd>` of the dump — a typed phrase, not a click;
//   • the dump is decrypted / unzipped in memory and must end with pg_dump's completion trailer;
//   • the caller takes a `pre-restore` backup of the live database FIRST and refuses to continue
//     if that backup fails (a restore is then undoable with the same command);
//   • the whole restore runs in ONE transaction (`psql --single-transaction`, ON_ERROR_STOP): the
//     database ends either fully restored or exactly as it was — never half-restored;
//   • no password on a command line: PGPASSWORD only (tools/pg/pg-bin.js).
const fs = require('fs');
const path = require('path');
const B = require('./backup');

const STAMP_RE = /_(\d{8})T(\d{6})Z\.sql(?:\.gz\.enc|\.gz)?$/;

/** Backups in `dir`, newest first: { name, file, bytes, at (ISO), day (yyyymmdd), encrypted } */
function listBackups(dir, { fsx = fs } = {}) {
  let names = [];
  try { names = fsx.readdirSync(dir).filter((n) => B.isDumpName(n)); } catch (_) { return []; }
  return names.sort().reverse().map((name) => {
    const m = STAMP_RE.exec(name);
    const file = path.join(dir, name);
    let bytes = 0; try { bytes = fsx.statSync(file).size; } catch (_) { /* vanished */ }
    const at = m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z` : null;
    return { name, file, bytes, at, day: m ? m[1] : null, encrypted: name.endsWith('.enc') };
  });
}

/** The phrase the operator must type to restore this file. */
function confirmPhrase(file) {
  const m = STAMP_RE.exec(path.basename(String(file || '')));
  if (!m) throw new Error('not a dashboard backup file name (sdp_dashboard_<yyyymmdd>T<hhmmss>Z.sql[.gz[.enc]])');
  return `RESTORE ${m[1]}`;
}

/** The SQL stream handed to psql: empty the schema, then the dump — all inside one transaction. */
function restoreScript(sqlBuffer) {
  const head = Buffer.from('DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n', 'utf8');
  return Buffer.concat([head, sqlBuffer]);
}

/**
 * @param {object} o
 * @param {string} o.file     the backup file
 * @param {string} o.confirm  what the operator typed — must equal confirmPhrase(file)
 * @param {object} o.env      PG_URL (+ SDP_BACKUP_KEY for an encrypted dump)
 * @param {function} [o.spawn] (cmd, args, {input, env}) → { status, stdout, stderr } (injectable)
 */
function restoreDatabase({ file, confirm, env = process.env, spawn, out = () => {} }) {
  const want = confirmPhrase(file);
  if (String(confirm || '').trim() !== want) throw Object.assign(new Error(`confirmation refused — type exactly: ${want}`), { code: 'CONFIRM' });
  if (!env.PG_URL) throw new Error('PG_URL is not set in .env');
  const key = B.deriveKey(env.SDP_BACKUP_KEY);
  const sql = B.openDump(file, { key });
  if (!B.hasDumpTrailer(sql)) throw new Error('this backup is incomplete (pg_dump trailer missing) — refused');
  const { findPgBin, pgArgsFromUrl } = require('../tools/pg/pg-bin');
  const psql = findPgBin('psql', 'PG_PSQL', env);
  const { args, env: childEnv } = pgArgsFromUrl(env.PG_URL, { env });
  const run = spawn || ((cmd, a, o) => require('child_process').spawnSync(cmd, a, { input: o.input, env: o.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60 * 60 * 1000 }));
  out(`[restore] ${path.basename(file)} → ${new URL(env.PG_URL).pathname.slice(1)} (one transaction)…`);
  const r = run(psql, [...args, '--no-password', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], { input: restoreScript(sql), env: childEnv });
  if (!r || r.status !== 0) {
    const why = String((r && (r.stderr || r.stdout)) || 'psql did not run').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 400);
    throw new Error(`restore failed and was rolled back by PostgreSQL — the database is unchanged (${why})`);
  }
  out('[restore] database restored');
  return { ok: true, file };
}

module.exports = { listBackups, confirmPhrase, restoreScript, restoreDatabase };
