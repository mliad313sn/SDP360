/**
 * _diag_meetings_dupes.js  —  READ-ONLY diagnostic.
 *
 * Finds duplicate PVs that collapse to the same logical meeting
 * (site × department × month) but exist as separate rows because their
 * `reference` (the UNIQUE key) or `department` differs by case / spelling.
 *
 * NEVER writes. Opens the DB read-only. Safe to run on prod any time.
 *
 *   node _diag_meetings_dupes.js [path/to/meetings.db]
 *
 * Default path: ./data/meetings.db (correct on prod at C:\Apps\SDP-Dashboard).
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.argv[2] || path.join('.', 'data', 'meetings.db');
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (e) {
  console.log('CRITICAL: cannot open ' + dbPath + ' — ' + e.message);
  process.exit(2);
}

// Child-row counts per meeting id (issues / actions / projects / attachments)
const counts = db.prepare(`
  SELECT
    m.id,
    (SELECT COUNT(*) FROM md_issues             i WHERE i.meeting_id = m.id) AS issues,
    (SELECT COUNT(*) FROM md_actions            a WHERE a.meeting_id = m.id) AS actions,
    (SELECT COUNT(*) FROM md_meeting_projects   p WHERE p.meeting_id = m.id) AS projects,
    (SELECT COUNT(*) FROM md_meeting_attachments t WHERE t.meeting_id = m.id) AS attachments,
    (SELECT COUNT(*) FROM md_issue_updates u
        JOIN md_issues i2 ON i2.id = u.issue_id WHERE i2.meeting_id = m.id) AS issue_updates
  FROM md_meetings m WHERE m.id = ?
`);

// Group rows by a CASE-INSENSITIVE logical key: site + lower(department) + month
const rows = db.prepare(`
  SELECT id, reference, site_code, department, meeting_date,
         status, created_at, updated_at,
         LOWER(site_code) || '|' || LOWER(department) || '|' || substr(meeting_date,1,7) AS gkey
  FROM md_meetings
  ORDER BY gkey, meeting_date, id
`).all();

const groups = new Map();
for (const r of rows) {
  if (!groups.has(r.gkey)) groups.set(r.gkey, []);
  groups.get(r.gkey).push(r);
}

const dupeGroups = [...groups.values()].filter(g => g.length > 1);

console.log('============================================================');
console.log('  MEETINGS DUPLICATE DIAGNOSTIC  (read-only)');
console.log('  DB: ' + dbPath);
console.log('============================================================');
console.log('Total meetings rows        : ' + rows.length);
console.log('Logical meetings (distinct): ' + groups.size);
console.log('Duplicate groups (>1 row)  : ' + dupeGroups.length);
console.log('Redundant rows to resolve  : ' + dupeGroups.reduce((s, g) => s + (g.length - 1), 0));
console.log('');

if (dupeGroups.length === 0) {
  console.log('No duplicates. Nothing to clean.');
  db.close();
  process.exit(0);
}

// Per-site tally
const bySite = {};
for (const g of dupeGroups) {
  const site = g[0].site_code;
  bySite[site] = (bySite[site] || 0) + 1;
}
console.log('Duplicate groups by site:');
for (const [s, n] of Object.entries(bySite).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + s + ': ' + n);
}
console.log('');
console.log('------------------------------------------------------------');
console.log('DETAIL — each group is one logical meeting with >1 stored row');
console.log('------------------------------------------------------------');

for (const g of dupeGroups) {
  const depts = new Set(g.map(r => r.department));
  const refsCI = new Set(g.map(r => r.reference ? r.reference.toLowerCase() : ''));
  const diag = [];
  if (depts.size > 1)  diag.push('DEPARTMENT CASE/SPELLING DIFFERS: {' + [...depts].join(' | ') + '}');
  if (refsCI.size === 1 && g.length > 1) diag.push('references identical case-insensitively (pure case dupe)');
  if (refsCI.size > 1)  diag.push('references differ even case-insensitively (spelling, not just case)');

  console.log('');
  console.log('● ' + g[0].site_code + ' · ' + g[0].department + ' · ' + g[0].meeting_date.slice(0, 7)
              + '   (' + g.length + ' rows)   ' + (diag.length ? '⚠ ' + diag.join('; ') : ''));
  for (const r of g) {
    const c = counts.get(r.id);
    console.log('    id=' + r.id
      + '  ref=' + r.reference
      + '  dept="' + r.department + '"'
      + '  date=' + r.meeting_date
      + '  status=' + r.status);
    console.log('         children: issues=' + c.issues + ' actions=' + c.actions
      + ' projects=' + c.projects + ' attach=' + c.attachments + ' issue_updates=' + c.issue_updates
      + '   created=' + (r.created_at || '?') + '  updated=' + (r.updated_at || '?'));
  }
}

console.log('');
console.log('============================================================');
console.log('  Paste this whole output back. We then choose the merge');
console.log('  rule (which copy survives) before any cleanup runs.');
console.log('============================================================');
db.close();
process.exit(0);
