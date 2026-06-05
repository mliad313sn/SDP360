/**
 * tracker-db.js — SQLite persistence layer for the IT Activity Tracker
 *
 * Tables:
 *   tracker_config   — global config (activities, pillarWeights, activeSites, years, currentMonth)
 *   tracker_targets  — per-site, per-activity targets and active flags
 *   tracker_inputs   — monthly input values (year × site × activity_ix)
 *
 * Exports: loadTracker(), saveTracker(D, userSite), resetTracker()
 *
 * userSite (tracker code, e.g. 'MGO') — when set, saveTracker only writes
 * inputs for that site and skips global config/targets (admin RBAC enforcement).
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// ── Default seed data (same as INIT in activity-tracker.html) ──────────────
const INIT = require('./tracker-init.json');

// ── DB path resolution + auto-migration from legacy root location ──────────
// Historical: tracker.db lived at __dirname/tracker.db. Harmonised 2026-06-05
// to __dirname/data/tracker.db (same pattern as reports.db). The block below
// auto-migrates if it finds the DB at the old location — idempotent + safe.
const DATA_DIR  = path.join(__dirname, 'data');
const TRACKER_DB_PATH = path.join(DATA_DIR, 'tracker.db');
function _ensureDbLocation() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacyPath = path.join(__dirname, 'tracker.db');
  if (fs.existsSync(legacyPath) && !fs.existsSync(TRACKER_DB_PATH)) {
    try {
      fs.renameSync(legacyPath, TRACKER_DB_PATH);
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(legacyPath + ext)) {
          try { fs.renameSync(legacyPath + ext, TRACKER_DB_PATH + ext); } catch (e) { /* ignore */ }
        }
      }
      console.log('[Tracker-DB] Migrated tracker.db from root to data/ (one-time)');
    } catch (e) {
      console.error('[Tracker-DB] Could not migrate tracker.db to data/:', e.message);
    }
  }
}

// ── Site name → tracker code map (mirrors _SITE_MAP in the frontend) ───────
// v1.10.9: added Tanda → TND (new mining site).
const SITE_MAP = {
  'MANA':'MGO',   'Mana IT Agent':'MGO',
  'HOUNDE':'HGO', 'Hounde IT Agents':'HGO',
  'LAFIGUE':'SML','Lafigue IT Agents':'SML',
  'ITY':'ITY',    'ITY IT Agents':'ITY',
  'Sabodala':'SGO','Sabodala IT Agents':'SGO',
  'ABIDJAN':'ABJ','Abidjan IT Agents':'ABJ',
  'Dakar':'DKR',  'Dakar IT Agents':'DKR',
  'KALANA':'KLN', 'Kalana IT Agents':'KLN',
  'EXPLORATION':'EXP','Exploration BF Support':'EXP','Exploration CI Support':'EXP',
  'OUAGA':'EDV',  'Ouaga IT Agents':'EDV','Ouagadougou-EDV1':'EDV',
  'TANDA':'TND',  'Tanda IT Agents':'TND'
};

/** Convert a site_name from the users table to a tracker site code. */
function siteNameToCode(siteName) {
  return siteName ? (SITE_MAP[siteName] || null) : null;
}

// ── DB singleton ─────────────────────────────────────────────────────────────
let _tdb = null;

function getDB() {
  if (!_tdb) {
    _ensureDbLocation();
    _tdb = new Database(TRACKER_DB_PATH);
    _tdb.pragma('journal_mode = WAL');
    _tdb.pragma('foreign_keys = ON');
    _initSchema(_tdb);
  }
  return _tdb;
}

// ── Schema creation & seeding ────────────────────────────────────────────────
function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracker_config (
      id                  INTEGER PRIMARY KEY DEFAULT 1,
      activities_json     TEXT    NOT NULL DEFAULT '[]',
      pillar_weights_json TEXT    NOT NULL DEFAULT '{}',
      active_sites_json   TEXT    NOT NULL DEFAULT '[]',
      years_json          TEXT    NOT NULL DEFAULT '[]',
      current_month       INTEGER NOT NULL DEFAULT 4,
      updated_at          TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracker_targets (
      site        TEXT    NOT NULL,
      activity_ix INTEGER NOT NULL,
      target      TEXT    NOT NULL DEFAULT '0',
      active      INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT    DEFAULT (datetime('now')),
      PRIMARY KEY (site, activity_ix)
    );

    CREATE TABLE IF NOT EXISTS tracker_inputs (
      year        INTEGER NOT NULL,
      site        TEXT    NOT NULL,
      activity_ix INTEGER NOT NULL,
      months_json TEXT    NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
      updated_at  TEXT    DEFAULT (datetime('now')),
      PRIMARY KEY (year, site, activity_ix)
    );
  `);

  // Seed on first run (empty tracker_config)
  const n = db.prepare('SELECT COUNT(*) as n FROM tracker_config').get().n;
  if (n === 0) {
    console.log('[tracker-db] First run — seeding default data…');
    _seed(db);
    console.log('[tracker-db] ✅ Default data seeded');
  }
}

function _seed(db) {
  // Config row
  db.prepare(`
    INSERT OR REPLACE INTO tracker_config
      (id, activities_json, pillar_weights_json, active_sites_json, years_json, current_month)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(
    JSON.stringify(INIT.activities),
    JSON.stringify(INIT.pillarWeights || { 'P1-Network Infrast':0.30,'P2-Business Partner':0.35,'P3-Risk & Compliance':0.20,'P4-Manage People':0.15 }),
    JSON.stringify(INIT.activeSites || []),
    JSON.stringify(INIT.years || [new Date().getFullYear()]),
    INIT.currentMonth || new Date().getMonth() + 1
  );

  // Targets
  const insTarget = db.prepare(`
    INSERT OR REPLACE INTO tracker_targets (site, activity_ix, target, active)
    VALUES (?, ?, ?, ?)
  `);
  const seedTargets = db.transaction(() => {
    for (const [site, arr] of Object.entries(INIT.targets || {})) {
      (arr || []).forEach((t, ix) => {
        if (t) insTarget.run(site, ix, String(t.target ?? 0), t.active ? 1 : 0);
      });
    }
  });
  seedTargets();

  // Inputs
  const insInput = db.prepare(`
    INSERT OR REPLACE INTO tracker_inputs (year, site, activity_ix, months_json)
    VALUES (?, ?, ?, ?)
  `);
  const seedInputs = db.transaction(() => {
    for (const [yr, sites] of Object.entries(INIT.inputs || {})) {
      for (const [site, activities] of Object.entries(sites)) {
        (activities || []).forEach((months, ix) => {
          if (Array.isArray(months)) {
            insInput.run(parseInt(yr, 10), site, ix, JSON.stringify(months));
          }
        });
      }
    }
  });
  seedInputs();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the full tracker state and assemble a D object identical in shape
 * to the INIT/localStorage D object used by the frontend.
 */
function loadTracker() {
  const db  = getDB();
  const cfg = db.prepare('SELECT * FROM tracker_config WHERE id=1').get();

  if (!cfg) {
    // Safety fallback — return deep copy of INIT
    return JSON.parse(JSON.stringify(INIT));
  }

  const activities    = JSON.parse(cfg.activities_json     || '[]');
  const pillarWeights = JSON.parse(cfg.pillar_weights_json || '{}');
  const activeSites   = JSON.parse(cfg.active_sites_json   || '[]');
  const years         = JSON.parse(cfg.years_json          || '[]');

  // Targets — rebuild per-site arrays indexed by activity_ix
  const targetRows = db.prepare('SELECT * FROM tracker_targets ORDER BY site, activity_ix').all();
  const targets    = {};
  // Initialize all known sites with null-filled arrays
  INIT.sites.forEach(s => {
    targets[s] = activities.map(() => ({ target: 0, active: false }));
  });
  targetRows.forEach(row => {
    if (!targets[row.site]) {
      targets[row.site] = activities.map(() => ({ target: 0, active: false }));
    }
    const rawTarget = row.target;
    targets[row.site][row.activity_ix] = {
      target: rawTarget === 'TRUE/FALSE' ? rawTarget : (isNaN(rawTarget) ? rawTarget : parseFloat(rawTarget)),
      active: row.active === 1
    };
  });

  // Inputs — rebuild nested structure: inputs[year][site][activity_ix] = [12 values]
  const inputRows = db.prepare('SELECT * FROM tracker_inputs ORDER BY year, site, activity_ix').all();
  const inputs    = {};
  inputRows.forEach(row => {
    const yr = row.year;
    if (!inputs[yr])         inputs[yr] = {};
    if (!inputs[yr][row.site]) inputs[yr][row.site] = [];
    inputs[yr][row.site][row.activity_ix] = JSON.parse(row.months_json || '[0,0,0,0,0,0,0,0,0,0,0,0]');
  });

  const currentYear = years.length ? years[years.length - 1] : new Date().getFullYear();

  return {
    sites:        INIT.sites,
    siteNames:    INIT.siteNames,
    siteColors:   INIT.siteColors,
    activeSites,
    currentMonth: cfg.current_month,
    activities,
    targets,
    inputs,
    year:         currentYear,
    years,
    pillarWeights
  };
}

/**
 * Save tracker state to SQLite.
 *
 * @param {object} D        — the full D object from the frontend
 * @param {string|null} userSite — tracker site code (e.g. 'MGO') for admin users,
 *                                 null for executive/super_admin (unrestricted).
 *
 * If userSite is set (admin role):
 *   - Only input data for that site is written
 *   - Config (activities, pillarWeights, activeSites) is NOT changed
 *   - Targets are NOT changed
 * If userSite is null (exec/super_admin):
 *   - Everything is written
 */
function saveTracker(D, userSite) {
  const db = getDB();

  if (!userSite) {
    // ── Executive save: update global config ──────────────────────────────
    db.prepare(`
      UPDATE tracker_config
      SET activities_json=?, pillar_weights_json=?, active_sites_json=?,
          years_json=?, current_month=?, updated_at=datetime('now')
      WHERE id=1
    `).run(
      JSON.stringify(D.activities    || []),
      JSON.stringify(D.pillarWeights || {}),
      JSON.stringify(D.activeSites   || []),
      JSON.stringify(D.years         || []),
      D.currentMonth || 4
    );

    // Targets — replace all rows for all sites
    const insTarget = db.prepare(`
      INSERT OR REPLACE INTO tracker_targets (site, activity_ix, target, active, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    const saveTargets = db.transaction(() => {
      for (const [site, arr] of Object.entries(D.targets || {})) {
        (arr || []).forEach((t, ix) => {
          if (t) insTarget.run(site, ix, String(t.target ?? 0), t.active ? 1 : 0);
        });
      }
    });
    saveTargets();
  }

  // ── Inputs — write per-site (admin restricted to own site) ──────────────
  const insInput = db.prepare(`
    INSERT OR REPLACE INTO tracker_inputs (year, site, activity_ix, months_json, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const saveInputs = db.transaction(() => {
    for (const [yr, sites] of Object.entries(D.inputs || {})) {
      for (const [site, activities] of Object.entries(sites)) {
        // Admin site restriction
        if (userSite && site !== userSite) continue;
        (activities || []).forEach((months, ix) => {
          if (Array.isArray(months)) {
            insInput.run(parseInt(yr, 10), site, ix, JSON.stringify(months));
          }
        });
      }
    }
  });
  saveInputs();
}

/**
 * Reset the tracker database to INIT defaults.
 * Executive/super_admin only — enforced by the route handler.
 */
function resetTracker() {
  const db = getDB();
  // Backup BEFORE destruction — reset wipes EVERYTHING including
  // every year's data + config, so an automatic backup is even more
  // critical here than for a single-year delete.
  const backupPath = backupDatabase('pre-reset');
  db.exec('DELETE FROM tracker_config; DELETE FROM tracker_targets; DELETE FROM tracker_inputs;');
  _seed(db);
  return { backup_path: backupPath };
}

// Thin wrapper around the shared backup helper. Keeps the existing
// API surface (resetTracker / deleteTrackerYear call backupDatabase
// without arguments other than `reason`) while delegating the actual
// file-snapshot mechanics to db-backup.js so every module backs up
// consistently — same path convention, same VACUUM INTO mechanism.
function backupDatabase(reason) {
  const { backupDatabase: doBackup } = require('./db-backup.js');
  return doBackup(getDB(), 'tracker', reason);
}

/**
 * Delete a single reporting year from the tracker.
 *
 * What gets deleted:
 *   - Every row in `tracker_inputs` where year = N (monthly progress
 *     values for that year, across every site × activity).
 *   - The year N entry in `tracker_config.years_json` (so it stops
 *     appearing in the Year dropdown).
 *
 * What is PRESERVED:
 *   - Every other year's `tracker_inputs` rows (the schema's PK keys
 *     each row by year, so rows for year M are independent of N).
 *   - `tracker_targets` (which is keyed by site × activity, NOT year
 *     — targets are global per activity across all reporting years).
 *   - `tracker_config.activities_json`, `pillar_weights_json`,
 *     `active_sites_json` (all global, unchanged).
 *
 * Guardrails:
 *   - Throws if the year array would become empty (the tracker UI
 *     needs at least one year to function).
 *   - Idempotent: removing a year that's already absent is a no-op
 *     for the years_json update; tracker_inputs delete reports 0
 *     rows changed in that case.
 *
 * Returns a diagnostic object with the inputs_deleted count and the
 * post-deletion years array. Callers (route handler) log this for
 * audit purposes.
 */
/**
 * Preview a year delete WITHOUT mutating anything.
 *
 * Returns the same shape the API route exposes — counts of rows that
 * WOULD be removed, list of years untouched, guardrail flags — so the
 * UI's confirmation modal can show real cascade impact before the
 * operator commits. Same DB connection as deleteTrackerYear so there's
 * no path-mismatch risk (the bug previewDeleteYear in the route handler
 * originally hit on 2026-05-31, fixed by routing through this function).
 */
function previewDeleteTrackerYear(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error('Invalid year: ' + year);
  }
  const db = getDB();
  const cfg = db.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  let years;
  try { years = JSON.parse((cfg && cfg.years_json) || '[]'); }
  catch (_) { years = []; }
  if (!Array.isArray(years)) years = [];

  const inputsForYear = db.prepare('SELECT COUNT(*) c FROM tracker_inputs WHERE year = ?').get(y);
  const otherYears = db.prepare(`
    SELECT year, COUNT(*) c
    FROM tracker_inputs
    WHERE year != ?
    GROUP BY year
    ORDER BY year
  `).all(y);

  return {
    year:                    y,
    years_current:           years,
    years_after:             years.filter(x => x !== y),
    inputs_will_be_deleted:  inputsForYear ? inputsForYear.c : 0,
    other_years_untouched:   otherYears,
    is_in_config:            years.includes(y),
    would_leave_zero_years:  years.filter(x => x !== y).length === 0,
  };
}

function deleteTrackerYear(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error('Invalid year: ' + year);
  }
  const db = getDB();
  const cfg = db.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  if (!cfg) throw new Error('tracker_config row id=1 not found');
  let years;
  try { years = JSON.parse(cfg.years_json || '[]'); }
  catch (_) { years = []; }
  if (!Array.isArray(years)) years = [];

  const newYears = years.filter(x => x !== y);
  if (newYears.length === 0) {
    throw new Error('Cannot delete the last remaining year — at least one must be kept.');
  }

  // Backup FIRST, before any destructive write. If the backup throws,
  // the delete never happens — the operator gets a clear error and
  // can investigate (disk full, perms, etc.) before retrying.
  const backupPath = backupDatabase('pre-delete-year-' + y);

  const tx = db.transaction(() => {
    const r = db.prepare('DELETE FROM tracker_inputs WHERE year = ?').run(y);
    db.prepare(`
      UPDATE tracker_config
      SET years_json = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(JSON.stringify(newYears));
    return r.changes;
  });
  const inputsDeleted = tx();

  return {
    year:           y,
    inputs_deleted: inputsDeleted,
    years_after:    newYears,
    backup_path:    backupPath,    // operator can restore from this if needed
  };
}

module.exports = { loadTracker, saveTracker, resetTracker, deleteTrackerYear, previewDeleteTrackerYear, backupDatabase, siteNameToCode };
