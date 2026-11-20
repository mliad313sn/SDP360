'use strict';
// P11 r5 N-14 — restore the file store (photos, signatures, field uploads, project documents) from the archive a
// backup run writes next to the database dump (services/blobBackup.js).
//
//   node tools/pg/restore-blobs.js --verify  [--archive <file> | --dir <backupDir>]
//   node tools/pg/restore-blobs.js --restore --target <empty dir> [--archive <file> | --dir <backupDir>]
//
// --verify reads every record back (decrypt with SDP_BACKUP_KEY, gunzip, SHA-256) and compares with the manifest;
// nothing is written. --restore writes the files into an EMPTY target directory, then re-reads them from disk and
// checks count + size + SHA-256 against the manifest; exit 1 on any difference. It never writes over the live
// store: restore into a new directory, check it, then move it into place as <DATA_DIR>/blobs (server stopped).
// Without --archive, the newest archive of the backup directory (SDP_BACKUP_DIR, default <data>/backups) is used.
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(ROOT, '.env') });

const BB = require('../../services/blobBackup');
const backup = require('../../services/backup');

function argOf(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

function main(argv = process.argv.slice(2), env = process.env, log = (m) => console.log(m)) {
  const dir = argOf(argv, '--dir') || env.SDP_BACKUP_DIR || path.join(env.SDP_DATA_DIR || path.join(ROOT, 'data'), 'backups');
  const archive = argOf(argv, '--archive') || BB.archiveFor(dir, null);
  if (!archive) throw new Error(`no file-store archive found in ${dir}`);
  const key = backup.deriveKey(env.SDP_BACKUP_KEY);
  if (argv.includes('--restore')) {
    const target = argOf(argv, '--target');
    if (!target) throw new Error('--restore needs --target <empty directory>');
    const r = BB.restoreArchive(archive, { key, target: path.resolve(target) });
    log(`[restore-blobs] ${r.ok ? 'OK' : 'FAILED'} — ${r.count} file(s) restored into ${r.target} and verified against the manifest${r.ok ? '' : ': ' + r.problems.slice(0, 5).join('; ')}`);
    return r.ok ? 0 : 1;
  }
  const v = BB.verifyArchive(archive, { key });
  log(`[restore-blobs] ${v.ok ? 'OK' : 'FAILED'} — ${path.basename(archive)}: ${v.count == null ? '?' : v.count} file(s) read back${v.ok ? ', all matching the manifest' : ': ' + v.problems.slice(0, 5).join('; ')}`);
  return v.ok ? 0 : 1;
}

module.exports = { main };
if (require.main === module) {
  try { process.exit(main()); } catch (e) { console.error('[restore-blobs] ' + e.message); process.exit(1); }
}
