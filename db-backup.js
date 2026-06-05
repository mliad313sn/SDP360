/**
 * db-backup.js — universal SQLite snapshot helper
 *
 * Every destructive DB operation in this codebase (tracker year
 * delete, inspection delete, meeting delete, any /reset endpoint)
 * should call backupDatabase() BEFORE the destructive write so a
 * one-step rollback is always available.
 *
 * Uses SQLite's `VACUUM INTO` (3.27+) which produces a transactionally
 * consistent snapshot regardless of WAL state — no risk of a
 * half-written copy, no need to manually checkpoint, no race with
 * concurrent reads.
 *
 * Backup location: data/backups/<dbName>-YYYYMMDDTHHMMSS-<reason>.db
 *
 *   data/backups/tracker-20260531T143200-pre-delete-year-2027.db
 *   data/backups/inspection-20260531T143200-pre-delete-EM-IT-…99.db
 *   data/backups/meetings-20260531T143200-pre-delete-PV…03.db
 *   data/backups/reports-20260531T143200-pre-reset.db
 *
 * Restore recipe (any DB):
 *   1. pm2 stop endeavour-dashboard
 *   2. copy the backup file over the live .db
 *   3. pm2 start endeavour-dashboard
 *
 * Failure modes (all bubble up as thrown Error so the caller's
 * destructive operation is skipped):
 *   - data/backups/ can't be created (permissions, disk full)
 *   - VACUUM INTO fails (target file exists, disk full)
 *   - The DB itself is read-only or locked
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const BACKUPS_DIR = path.join('data', 'backups');

/**
 * Create a transactionally-consistent snapshot of a SQLite DB.
 *
 * @param {Database} db       a better-sqlite3 Database instance to back up
 * @param {string}   dbName   short label used in the filename (e.g. 'tracker',
 *                            'inspection', 'meetings', 'reports')
 * @param {string}   reason   kebab-case tag describing the trigger
 *                            (e.g. 'pre-delete-year-2027', 'pre-reset')
 * @returns {string} absolute path to the created backup file
 * @throws  if the backup cannot be completed (caller MUST abort their
 *          destructive operation when this throws)
 */
function backupDatabase(db, dbName, reason) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('backupDatabase: invalid db instance');
  }
  if (!dbName || typeof dbName !== 'string') {
    throw new Error('backupDatabase: dbName is required');
  }

  // Ensure the backups directory exists. Recursive mkdir is a no-op
  // if it already does, so this is safe to call on every invocation.
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });

  // Filename: <dbName>-<UTC timestamp>-<reason>.db
  // Stamp is YYYYMMDDTHHMMSS (compact ISO, no separators, no
  // sub-second precision). Reason is sanitised to safe filename
  // chars and capped to 40 chars.
  const stamp    = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const safeTag  = String(reason || 'manual').replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const safeName = String(dbName).replace(/[^a-z0-9-]/gi, '-').slice(0, 20);
  const filename = `${safeName}-${stamp}-${safeTag}.db`;
  const absPath  = path.resolve(BACKUPS_DIR, filename);

  // VACUUM INTO is the canonical SQLite mechanism for producing a
  // clean snapshot. It's atomic — the destination file either ends
  // up complete or doesn't exist at all (no half-written state).
  try {
    db.prepare(`VACUUM INTO ?`).run(absPath);
  } catch (e) {
    // Edge case: same-second collision. Retry once with a milli suffix.
    if (/file exists/i.test(e.message)) {
      const altPath = absPath.replace(/\.db$/, '-' + new Date().getMilliseconds() + '.db');
      db.prepare(`VACUUM INTO ?`).run(altPath);
      console.log(`[Backup] ${dbName} -> ${altPath} (collision, used millis suffix)`);
      return altPath;
    }
    throw new Error('Backup failed: ' + e.message);
  }

  console.log(`[Backup] ${dbName} -> ${absPath}`);
  return absPath;
}

module.exports = { backupDatabase };
