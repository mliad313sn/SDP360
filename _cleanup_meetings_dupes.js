/**
 * _cleanup_meetings_dupes.js  —  de-duplicate PVs.
 *
 * Collapses meetings that share a logical identity (site × department ×
 * month) but exist as separate rows due to reference/department drift
 * from the 2026-06-02 double-import. Keeps ONE survivor per group, deletes
 * the rest (children cascade via FK ON DELETE CASCADE).
 *
 * SURVIVOR RULE (reproduces the agreed table):
 *   1. most issue_updates (richest audit trail)
 *   2. tie → a copy edited after creation (updated_at != created_at) beats
 *      an untouched one
 *   3. several edited → most recently edited (updated_at DESC)
 *   4. none edited → lowest id (the original / first created)
 *
 * SAFETY:
 *   - DRY-RUN by default (read-only). Prints the full plan, writes a JSON
 *     archive of every row it WOULD delete. Nothing is removed.
 *   - --commit: makes a timestamped DB backup FIRST (WAL-checkpointed copy),
 *     writes the JSON archive, then deletes inside a transaction.
 *
 *   node _cleanup_meetings_dupes.js [path/to/meetings.db] [--commit]
 *
 * Default path: ./data/meetings.db
 */
'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

const args   = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const dbPath = args.find(a => !a.startsWith('--')) || path.join('.', 'data', 'meetings.db');

function stamp() {
  // No Date.now()/new Date() restriction here — this is a standalone CLI,
  // not a workflow script. Build a filesystem-safe timestamp.
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let db;
try {
  db = new Database(dbPath, { readonly: !COMMIT, fileMustExist: true });
} catch (e) {
  console.log('CRITICAL: cannot open ' + dbPath + ' — ' + e.message);
  process.exit(2);
}
db.pragma('foreign_keys = ON');

// ── Build logical groups (same key as the diagnostic) ────────────────
const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM md_issue_updates u
        JOIN md_issues i2 ON i2.id = u.issue_id WHERE i2.meeting_id = ?) AS issue_updates
`);
const rows = db.prepare(`
  SELECT id, reference, site_code, department, meeting_date, status, created_at, updated_at,
         LOWER(site_code) || '|' || LOWER(department) || '|' || substr(meeting_date,1,7) AS gkey
  FROM md_meetings
  ORDER BY gkey, id
`).all().map(r => ({ ...r, issue_updates: counts.get(r.id).issue_updates }));

const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.gkey)) groups.set(r.gkey, []);
  groups.get(r.gkey).push(r);
}
const dupeGroups = [...groups.values()].filter(g => g.length > 1);

// ── Survivor rule ────────────────────────────────────────────────────
function pickSurvivor(g) {
  const maxUpd = Math.max(...g.map(r => r.issue_updates));
  let cands = g.filter(r => r.issue_updates === maxUpd);
  if (cands.length === 1) return cands[0];
  const touched = cands.filter(r => r.created_at && r.updated_at && r.updated_at !== r.created_at);
  if (touched.length === 1) return touched[0];
  if (touched.length > 1) {
    touched.sort((a, b) => (b.updated_at > a.updated_at ? 1 : b.updated_at < a.updated_at ? -1 : a.id - b.id));
    return touched[0];
  }
  cands.sort((a, b) => a.id - b.id);
  return cands[0];
}

// ── Full-content reader for the archive ──────────────────────────────
function dumpMeeting(id) {
  const m  = db.prepare('SELECT * FROM md_meetings WHERE id = ?').get(id);
  const iss = db.prepare('SELECT * FROM md_issues WHERE meeting_id = ? ORDER BY id').all(id);
  const issIds = iss.map(i => i.id);
  const upd = issIds.length
    ? db.prepare(`SELECT * FROM md_issue_updates WHERE issue_id IN (${issIds.map(() => '?').join(',')}) ORDER BY id`).all(...issIds)
    : [];
  return {
    meeting:      m,
    issues:       iss,
    issue_updates: upd,
    actions:      db.prepare('SELECT * FROM md_actions WHERE meeting_id = ? ORDER BY id').all(id),
    projects:     db.prepare('SELECT * FROM md_meeting_projects WHERE meeting_id = ? ORDER BY id').all(id),
    attachments:  db.prepare('SELECT * FROM md_meeting_attachments WHERE meeting_id = ? ORDER BY id').all(id),
  };
}

console.log('============================================================');
console.log('  MEETINGS DE-DUP  ' + (COMMIT ? '*** COMMIT MODE ***' : '(DRY-RUN — no changes)'));
console.log('  DB: ' + dbPath);
console.log('============================================================');
console.log('Duplicate groups: ' + dupeGroups.length);

if (dupeGroups.length === 0) { console.log('Nothing to do.'); db.close(); process.exit(0); }

const toDelete = [];
const plan = [];
for (const g of dupeGroups) {
  const survivor = pickSurvivor(g);
  const losers = g.filter(r => r.id !== survivor.id);
  losers.forEach(l => toDelete.push(l.id));
  plan.push({ group: g[0].site_code + '·' + g[0].department + '·' + g[0].meeting_date.slice(0, 7), survivor, losers });
}

for (const p of plan) {
  console.log('');
  console.log('● ' + p.group);
  console.log('    KEEP   id=' + p.survivor.id + '  ref=' + p.survivor.reference
    + '  upd=' + p.survivor.issue_updates + '  updated=' + p.survivor.updated_at);
  for (const l of p.losers) {
    console.log('    DELETE id=' + l.id + '  ref=' + l.reference
      + '  upd=' + l.issue_updates + '  updated=' + l.updated_at);
  }
}

console.log('');
console.log('Rows to delete: ' + toDelete.length + '  (ids: ' + toDelete.join(', ') + ')');

// ── Archive every row that will be (or would be) deleted ─────────────
const archive = { generated_at: stamp(), db: dbPath, committed: COMMIT, deleted: toDelete.map(dumpMeeting) };
const archPath = path.join(path.dirname(dbPath),
  `meetings-dupes-archive_${stamp()}${COMMIT ? '' : '.preview'}.json`);
fs.writeFileSync(archPath, JSON.stringify(archive, null, 2), 'utf8');
console.log('Archived full content of deleted rows → ' + archPath);

if (!COMMIT) {
  console.log('');
  console.log('DRY-RUN complete. Review the plan above, then run with --commit:');
  console.log('   node _cleanup_meetings_dupes.js ' + dbPath + ' --commit');
  db.close();
  process.exit(0);
}

// ── COMMIT path ──────────────────────────────────────────────────────
db.pragma('wal_checkpoint(TRUNCATE)');                 // fold WAL into main file
const backupPath = dbPath.replace(/\.db$/, '') + '.pre-dedup-' + stamp() + '.db';
fs.copyFileSync(dbPath, backupPath);
console.log('');
console.log('Backup written → ' + backupPath);

const del = db.prepare('DELETE FROM md_meetings WHERE id = ?');
const tx = db.transaction(ids => { let n = 0; for (const id of ids) n += del.run(id).changes; return n; });
const removed = tx(toDelete);

const after = db.prepare('SELECT COUNT(*) c FROM md_meetings').get().c;
console.log('Deleted ' + removed + ' meeting row(s) (children cascaded).');
console.log('md_meetings now holds ' + after + ' rows.');
console.log('');
console.log('============================================================');
console.log('  DONE. Backup: ' + path.basename(backupPath));
console.log('        Archive: ' + path.basename(archPath));
console.log('  Restore if needed: stop pm2, copy the backup over');
console.log('  ' + path.basename(dbPath) + ', delete -wal/-shm, start pm2.');
console.log('============================================================');
db.close();
process.exit(0);
