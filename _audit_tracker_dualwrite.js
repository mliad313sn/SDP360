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

try { require('dotenv').config(); } catch (_) { /* dotenv optional for the audit */ }

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

// ══════════════════════════════════════════════════════════════════
//  AUDIT v2 — per-year mode (ADR-001 Phase 4d)
//  Once TRACKER_PER_YEAR_EDITS=1 the legacy singleton is frozen and
//  legacy-parity checks become meaningless (legacy goes stale by
//  design). Instead, run internal-integrity checks on the normalised
//  schema: per-year structure summary, pillar weight sums, v2 row
//  coverage. FK constraints already guarantee referential integrity.
// ══════════════════════════════════════════════════════════════════
if (String(process.env.TRACKER_PER_YEAR_EDITS || '').trim() === '1') {
  console.log('--- MODE: per-year (legacy frozen — internal integrity checks) ---');
  const years = db.prepare('SELECT year FROM tracker_years ORDER BY year').all().map(r => r.year);
  if (years.length === 0) { console.log('  CRITICAL: tracker_years is empty'); db.close(); process.exit(2); }
  for (const y of years) {
    const pillars = db.prepare('SELECT code, weight FROM tracker_pillars WHERE year=? ORDER BY display_order').all(y);
    const nActs   = db.prepare(`SELECT COUNT(*) c FROM tracker_activities a JOIN tracker_pillars p ON p.id=a.pillar_id WHERE p.year=?`).get(y).c;
    const nTgt    = db.prepare('SELECT COUNT(*) c FROM tracker_targets_v2 WHERE year=?').get(y).c;
    const nInp    = db.prepare('SELECT COUNT(*) c FROM tracker_inputs_v2  WHERE year=?').get(y).c;
    const wSum    = pillars.reduce((s, p) => s + (p.weight || 0), 0);
    const wOk     = Math.abs(wSum - 1) < 0.005;
    (wOk ? ok : warn)('year ' + y + ': ' + pillars.length + ' pillars (weights sum ' + wSum.toFixed(2) + (wOk ? '' : ' ≠ 1.00') + '), ' + nActs + ' activities, ' + nTgt + ' targets_v2, ' + nInp + ' inputs_v2');
    if (nActs === 0) console.log('  INFO year ' + y + ' has no activities yet (new empty year — use Copy structure in Setup)');
  }
  // Duplicate activity codes within a year would break position mapping
  const dups = db.prepare(`
    SELECT p.year, a.code, COUNT(*) c FROM tracker_activities a
    JOIN tracker_pillars p ON p.id=a.pillar_id
    GROUP BY p.year, a.code HAVING c > 1`).all();
  if (dups.length) warn('duplicate activity codes: ' + JSON.stringify(dups).slice(0, 200));
  else ok('no duplicate activity codes within any year');

  db.close();
  console.log('');
  if (drift === 0) {
    console.log('============================================================');
    console.log('   AUDIT PASSED -- per-year schema internally consistent');
    console.log('============================================================');
    process.exit(0);
  } else {
    console.log('============================================================');
    console.log('   AUDIT FAILED -- ' + drift + ' issue(s) above');
    console.log('============================================================');
    process.exit(1);
  }
}

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
// Code-derivation logic MUST match _backfillFromLegacy() in tracker-db.js
// (function parsePillar). It accepts both '1-...' and 'P1-...' prefixes.
function parsePillarCode(pillarStr) {
  if (!pillarStr) return null;
  const s = String(pillarStr).trim();
  const m = s.match(/^P?(\d+)\s*[-–—]?\s*(.*)$/);
  if (m) return 'P' + m[1];
  return s.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'PX';
}
console.log('--- Pillars per year ---');
const pillarKeys = Object.keys(legacyPillars).sort();
for (const y of legacyYS) {
  const newP = db.prepare(
    'SELECT code, name, weight FROM tracker_pillars WHERE year = ? ORDER BY display_order'
  ).all(y);
  const newMap = Object.fromEntries(newP.map(p => [p.code, p]));
  for (const lk of pillarKeys) {
    const expectedCode   = parsePillarCode(lk);
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
// Distinguish BENIGN historical residuals (rows whose activity_ix is
// out of the current activities_json range — caused by a past UI delete
// that didn't splice the children) from REAL drift (activity_ix within
// range but somehow not mapped).
console.log('--- activity_id coverage on legacy rows ---');
const nLegacyAct = legacyActivities.length;

const tNullInRange   = db.prepare('SELECT COUNT(*) c FROM tracker_targets WHERE activity_id IS NULL AND activity_ix <  ?').get(nLegacyAct).c;
const tNullOutRange  = db.prepare('SELECT COUNT(*) c FROM tracker_targets WHERE activity_id IS NULL AND activity_ix >= ?').get(nLegacyAct).c;
const tTot           = db.prepare('SELECT COUNT(*) c FROM tracker_targets').get().c;
if (tNullInRange > 0) warn('tracker_targets: ' + tNullInRange + ' / ' + tTot + ' rows have NULL activity_id WITHIN current range (drift to fix)');
if (tNullOutRange > 0) console.log('  INFO tracker_targets: ' + tNullOutRange + ' / ' + tTot + ' rows are HISTORICAL RESIDUALS (activity_ix >= ' + nLegacyAct + ', i.e. point to activities deleted from legacy in the past). Benign — they are never read by the engine.');
if (tNullInRange + tNullOutRange === 0) ok('tracker_targets: all ' + tTot + ' rows mapped to activity_id');

const iNullInRange  = db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE activity_id IS NULL AND activity_ix <  ?').get(nLegacyAct).c;
const iNullOutRange = db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE activity_id IS NULL AND activity_ix >= ?').get(nLegacyAct).c;
const iTot          = db.prepare('SELECT COUNT(*) c FROM tracker_inputs').get().c;
if (iNullInRange > 0) warn('tracker_inputs : ' + iNullInRange + ' / ' + iTot + ' rows have NULL activity_id WITHIN current range (drift to fix)');
if (iNullOutRange > 0) console.log('  INFO tracker_inputs : ' + iNullOutRange + ' / ' + iTot + ' rows are HISTORICAL RESIDUALS (activity_ix >= ' + nLegacyAct + '). Benign.');
if (iNullInRange + iNullOutRange === 0) ok('tracker_inputs : all ' + iTot + ' rows mapped to activity_id');

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
