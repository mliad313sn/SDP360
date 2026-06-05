#!/usr/bin/env node
/*
 * Delete a year from the IT Activity Tracker without touching any
 * other year's data.
 *
 * Schema (confirmed from tracker-db.js):
 *   tracker_config (id=1, years_json TEXT, ...)    — JSON array column
 *   tracker_inputs (PK year, site, activity_ix)    — keyed by year
 *   tracker_targets (PK site, activity_ix)         — NOT keyed by year (shared)
 *
 * Removing year N:
 *   - DELETE FROM tracker_inputs WHERE year = N
 *   - UPDATE tracker_config SET years_json = ('years_json' minus N)
 *   - tracker_targets untouched (shared across years)
 *
 * Usage:
 *   node _delete_tracker_year.js 2027            # dry-run only
 *   node _delete_tracker_year.js 2027 --confirm  # actually does it
 *
 * Run from C:\Apps\SDP-Dashboard\ on the prod host.
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const targetYear = parseInt(process.argv[2], 10);
const confirm    = process.argv.includes('--confirm');

if (!targetYear || targetYear < 2000 || targetYear > 2100) {
  console.error('Usage: node _delete_tracker_year.js <year> [--confirm]');
  console.error('Example: node _delete_tracker_year.js 2027 --confirm');
  process.exit(1);
}

// tracker.db lives at the WORKTREE ROOT next to tracker-db.js, NOT
// under data/. data/ holds reports.db + the backups subdir. Same
// path resolution as tracker-db.js itself uses.
const dbPath = path.join(__dirname, 'tracker.db');
const db = new Database(dbPath);

// Load current config
const row = db.prepare('SELECT years_json FROM tracker_config WHERE id = 1').get();
if (!row) {
  console.error('ERROR: tracker_config row id=1 not found. Wrong DB?');
  process.exit(1);
}
let currentYears;
try {
  currentYears = JSON.parse(row.years_json || '[]');
} catch (e) {
  console.error('ERROR: years_json is not valid JSON:', row.years_json);
  process.exit(1);
}
if (!Array.isArray(currentYears)) currentYears = [];

console.log('\n=== Current state ===');
console.log('  years_json             :', JSON.stringify(currentYears));
console.log('  target to remove       :', targetYear);

if (!currentYears.includes(targetYear)) {
  console.log('\n⚠ Year', targetYear, 'is NOT in years_json. Nothing to remove from tracker_config.');
} else {
  const after = currentYears.filter(y => y !== targetYear);
  console.log('\nYear', targetYear, 'WILL be removed from tracker_config.years_json.');
  console.log('  After removal          :', JSON.stringify(after));
}

// Count rows that would be deleted from tracker_inputs
const cnt = db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE year = ?').get(targetYear);
console.log('\nRows in tracker_inputs for year', targetYear + ':', cnt.c);

// Verify isolation — show counts for OTHER years to prove untouched
const otherYears = db.prepare(`
  SELECT year, COUNT(*) c
  FROM tracker_inputs
  WHERE year != ?
  GROUP BY year
  ORDER BY year
`).all(targetYear);
console.log('Rows for OTHER years (will NOT be touched):');
if (otherYears.length === 0) {
  console.log('  (none — only year', targetYear, 'has tracker_inputs rows)');
} else {
  for (const y of otherYears) console.log('  ', y.year + ':', y.c, 'rows');
}

// tracker_targets sanity (shared across all years — not impacted)
const targetCnt = db.prepare('SELECT COUNT(*) c FROM tracker_targets').get();
console.log('\ntracker_targets rows (shared across all years, untouched):', targetCnt.c);

if (!confirm) {
  console.log('\n--- DRY RUN ---');
  console.log('No changes made. Re-run with --confirm to actually delete:');
  console.log('  node _delete_tracker_year.js', targetYear, '--confirm');
  process.exit(0);
}

// --- Backup BEFORE doing anything destructive ---
const fs = require('fs');
const backupsDir = path.join('data', 'backups');
fs.mkdirSync(backupsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const backupPath = path.resolve(backupsDir, `tracker-${stamp}-pre-delete-year-${targetYear}.db`);
try {
  db.prepare('VACUUM INTO ?').run(backupPath);
  console.log('\n🛟 Backup created: ' + backupPath);
} catch (e) {
  console.error('\nBackup failed:', e.message);
  console.error('Deletion ABORTED — DB is unchanged.');
  process.exit(1);
}

// --- Actually do it ---
console.log('\n=== Applying deletion ===');
const tx = db.transaction(() => {
  // 1. Remove from tracker_inputs
  const r = db.prepare('DELETE FROM tracker_inputs WHERE year = ?').run(targetYear);
  console.log('  Deleted', r.changes, 'rows from tracker_inputs');

  // 2. Update tracker_config.years_json
  const newYears = currentYears.filter(y => y !== targetYear);
  db.prepare('UPDATE tracker_config SET years_json = ?, updated_at = datetime(\'now\') WHERE id = 1')
    .run(JSON.stringify(newYears));
  console.log('  Updated tracker_config.years_json to:', JSON.stringify(newYears));
});

try {
  tx();
  console.log('\n✓ Done. Year', targetYear, 'fully removed.');
  console.log('  Other years (and tracker_targets) untouched.');
  console.log('  Backup file: ' + backupPath);
  console.log('  (If something went wrong, copy that file back over data/tracker.db on the server.)');
  console.log('\n  Reload the Activity Tracker page in the browser to see the change.');
  console.log('  (No pm2 restart needed — the next /api/tracker/load reads fresh from DB.)');
} catch (e) {
  console.error('\nERROR during deletion:', e.message);
  console.error('Transaction rolled back — DB is unchanged.');
  console.error('Backup at ' + backupPath + ' is still intact (untouched).');
  process.exit(1);
}
