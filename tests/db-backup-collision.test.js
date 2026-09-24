'use strict';
// G-13 (audit 2026-09-24, found while re-running the suite) — the same-second
// collision retry in db-backup.js was dead code.
//
// Backup filenames carry a timestamp with NO sub-second precision, so two backups of the
// same database inside one second collide. The handler has a retry for exactly that, but
// it tested for /file exists/ while SQLite says "output file already exists" — which does
// not contain that substring. So the retry never fired and the caller got a hard throw.
//
// It surfaced as the documented inspection-blobs flake ("fails on a leftover backup
// file"): deleteInspection() backs up first, and a second delete in the same second blew
// up. A delete that fails because a BACKUP name is taken is a bad trade — the backup is
// there to make the delete safe, not to block it.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-collision-'));
const Database = require('better-sqlite3');
const { backupDatabase } = require('../db-backup');

function tinyDb() {
  const db = new Database(path.join(process.env.SDP_DATA_DIR, 'tiny.db'));
  db.exec('CREATE TABLE IF NOT EXISTS t (a INTEGER)');
  db.prepare('INSERT INTO t (a) VALUES (1)').run();
  return db;
}

test('two backups in the same second both succeed', () => {
  const db = tinyDb();
  const first = backupDatabase(db, 'tiny', 'collision-test');
  assert.ok(fs.existsSync(first), 'first backup written');
  const second = backupDatabase(db, 'tiny', 'collision-test');
  assert.ok(fs.existsSync(second), 'second backup written despite the name collision');
  assert.notStrictEqual(first, second, 'the second one gets its own path');
});

test('a failure that is NOT a name collision still throws — the retry is not a catch-all', () => {
  const db = tinyDb();
  db.close();                      // any other VACUUM failure must still surface
  assert.throws(() => backupDatabase(db, 'tiny', 'closed-db'), /Backup failed/);
});
