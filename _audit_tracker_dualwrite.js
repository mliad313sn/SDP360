/**
 * _audit_tracker_dualwrite.js
 * ADR-001 Phase 1 dual-write health check.
 *
 * Compares legacy tracker_config singleton against the normalised
 * tracker_years / tracker_pillars / tracker_activities tables.
 * Reports any drift. Read-only (never writes). Exit code:
 *   0 — fully in sync
 *   1 — drift detected
 *   2 — DB unreadable or tracker_config missing
 *
 * Invoked by _audit_tracker_dualwrite.cmd. Can also be run directly
 * with `node _audit_tracker_dualwrite.js [path/to/tracker.db]`.
 */
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.argv[2] || './data/tracker.db';
let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  console.log('  CRITICAL: cannot open ' + dbPath + ' — ' + e.message);
  process.exit(2);
}

let drift = 0;
const ok   = (msg) => console.log('  OK   ' + msg);
const warn = (msg) => { console.log('  WARN ' + msg); drift++; };

// ── Load legacy singleton ────────────────────────────────────────
const cfg = db.prepare(
  'SELECT activities_json, pillar_weights_json, years_json FROM tracker_config WHERE id = 1'
).get();
if (!cfg) {
  console.log('  CRITICAL: tracker_config row id=1 is missing');
  db.close();
  process.exit(2);
}
const legacyYears      = JSON.parse(cfg.years_json          || '[]');
const legacyPillars    = JSON.parse(cfg.pillar_weights_json || '{}');
const legacyActivities = JSON.parse(cfg.activities_json     || '[]');

// ── Years ───────────────────────────────────────────────────────
console.log('--- Years ---');
const newYears = db.prepare('SELECT year FROM tracker_years ORDER BY year').all().map(r => r.year);
const legacyYS = new Set(legacyYears.map(Number));
const newYS    = new Set(newYears.map(Number));
for (const y of legacyYS) {
  if (newYS.has(y)) ok('year ' + y + ' present in both');
  else              warn('year ' + y + ' in LEGACY but MISSING in tracker_years');
}
for (const y of newYS) {
  if (!legacyYS.has(y)) warn('year ' + y + ' in tracker_years but ABSENT from legacy years_json');
}

// ── Pillars per year ────────────────────────────────────────────
console.log('--- Pillars per year ---');
const pillarKeys = Object.keys(legacyPillars).sort();
for (const y of legacyYS) {
  const newP = db.prepare(
    'SELECT code, name, weight FROM tracker_pillars WHERE year = ? ORDER BY display_order'
  ).all(y);
  const newMap = Object.fromEntries(newP.map(p => [p.code, p]));
  for (const lk of pillarKeys) {
    const m = String(lk).match(/^(\d+)/);
    const expectedCode   = m ? 'P' + m[1] : lk.slice(0, 4).toUpperCase();
    const expectedWeight = legacyPillars[lk];
    const newRow         = newMap[expectedCode];
    if (!newRow) {
      warn('year ' + y + ': pillar ' + expectedCode + ' (' + lk + ') in legacy but MISSING in tracker_pillars');
      continue;
    }
    if (Math.abs(newRow.weight - expectedWeight) > 0.0001) {
      warn('year ' + y + ': pillar ' + expectedCode + ' weight LEGACY=' + expectedWeight + ' vs NEW=' + newRow.weight);
    } else {
      ok('year ' + y + ' / ' + expectedCode + ' weight=' + newRow.weight);
    }
  }
}

// ── Activities per year ─────────────────────────────────────────
console.log('--- Activities per year ---');
for (const y of legacyYS) {
  const newA = db.prepare(
    `SELECT COUNT(*) c
     FROM tracker_activities a
     JOIN tracker_pillars p ON p.id = a.pillar_id
     WHERE p.year = ?`
  ).get(y).c;
  if (newA < legacyActivities.length) {
    warn('year ' + y + ': ' + newA + ' activities in new schema vs ' + legacyActivities.length + ' in legacy (deficit ' + (legacyActivities.length - newA) + ')');
  } else {
    ok('year ' + y + ': ' + newA + ' activities (legacy has ' + legacyActivities.length + ')');
  }
}

// ── activity_id coverage on legacy rows ─────────────────────────
console.log('--- activity_id coverage on legacy rows ---');
const tNull = db.prepare('SELECT COUNT(*) c FROM tracker_targets WHERE activity_id IS NULL').get().c;
const tTot  = db.prepare('SELECT COUNT(*) c FROM tracker_targets').get().c;
if (tNull > 0) warn('tracker_targets: ' + tNull + ' / ' + tTot + ' rows have NULL activity_id');
else           ok  ('tracker_targets: all ' + tTot + ' rows mapped to activity_id');

const iNull = db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE activity_id IS NULL').get().c;
const iTot  = db.prepare('SELECT COUNT(*) c FROM tracker_inputs').get().c;
if (iNull > 0) warn('tracker_inputs : ' + iNull + ' / ' + iTot + ' rows have NULL activity_id');
else           ok  ('tracker_inputs : all ' + iTot + ' rows mapped to activity_id');

db.close();

console.log('');
if (drift === 0) {
  console.log('============================================================');
  console.log('   AUDIT PASSED -- legacy and normalised schema in sync');
  console.log('============================================================');
  process.exit(0);
} else {
  console.log('============================================================');
  console.log('   AUDIT FAILED -- ' + drift + ' drift item(s) above');
  console.log('   Resolution: pm2 reload endeavour-dashboard --update-env');
  console.log('   (the next boot _backfillFromLegacy fixes ADD/UPDATE drift)');
  console.log('   DELETE drift requires deleteTrackerYear() to be invoked');
  console.log('   via UI for legacy cleanup before new schema follows.');
  console.log('============================================================');
  process.exit(1);
}
