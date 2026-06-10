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

// ── PALIER 1 — Activity code helper (additive, 2026-06-05) ──────────────────
// Today activities are referenced by their position in D.activities[]
// (activity_ix). That index is fragile: any reorder / splice silently
// misaligns tracker_targets and tracker_inputs.
//
// This helper derives a STABLE, READABLE code from (pillar, name) for
// each activity. Used by loadTracker() to enrich the returned D object
// with `D.activities[i].code`. Stored data and existing call sites are
// untouched — the code is a NEW field that future features can opt in
// to (e.g. for audit logs, cross-year activity tracking, or as a
// future replacement for activity_ix).
//
// Format: 'P{1-4}-{ALPHA12}'
//   pillar  "1-Network Infrast"   →  P1
//   pillar  "3-Risk & Compliance" →  P3
//   name    "Backup verification" →  BACKUPVERIFI
//   result  P1-BACKUPVERIFI
//
// If the activity already has a `code` field (set by a future admin UI),
// it is preserved.
function getActivityCode(activity) {
  if (!activity) return null;
  if (activity.code && typeof activity.code === 'string') return activity.code;
  // Pillar string variants seen in production: "1-Network Infrast" OR "P1-Network Infrast".
  // The regex accepts an optional leading 'P' so both forms yield the same digit.
  const pMatch = String(activity.pillar || '').match(/^P?(\d+)/i);
  const p = pMatch ? `P${pMatch[1]}` : 'PX';
  // Slice at 20 chars: shorter (12) collides on near-identical activity names
  // ("Radio Infrastructure Upgrade" vs "Radio Infrastructure Monitoring" both
  // truncate to RADIOINFRAST). 20 chars is collision-free for the current 31
  // activities and stays readable (P1-RADIOINFRASTRUCTUREM).
  const n = String(activity.name || 'untitled')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 20) || 'UNTITLED';
  return `${p}-${n}`;
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

  // ══════════════════════════════════════════════════════════════════
  //  PHASE 0 (ADR-001) — additive normalised schema, dual-write ready
  //  Added 2026-06-09. These tables coexist with the legacy
  //  tracker_config singleton. loadTracker() and saveTracker() are
  //  NOT changed at this phase — they still read/write the legacy
  //  schema. _backfillFromLegacy() (below) populates these tables
  //  at boot from the legacy data. Phase 1 will introduce dual-write
  //  in saveTracker(); Phase 2 will switch reads.
  // ══════════════════════════════════════════════════════════════════
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracker_years (
      year       INTEGER PRIMARY KEY,
      active     INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracker_pillars (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      year          INTEGER NOT NULL,
      code          TEXT    NOT NULL,            -- 'P1' .. 'P4' (derived from legacy "1-Network Infrast")
      name          TEXT    NOT NULL,            -- 'Network Infrast' (the part after the leading digit)
      weight        REAL    NOT NULL,            -- 0.30 etc.
      display_order INTEGER DEFAULT 0,
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (year) REFERENCES tracker_years(year) ON DELETE CASCADE,
      UNIQUE (year, code)
    );
    CREATE INDEX IF NOT EXISTS ix_track_pil_year ON tracker_pillars(year);

    CREATE TABLE IF NOT EXISTS tracker_activities (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pillar_id     INTEGER NOT NULL,
      code          TEXT    NOT NULL,            -- from getActivityCode() helper (Palier 1)
      name          TEXT    NOT NULL,
      kpi_type      TEXT    NOT NULL,            -- BOOLEAN | PERCENT | MILESTONE | CURRENCY | RATING | COUNT
      start_month   INTEGER,                     -- 1..12
      end_month     INTEGER,                     -- 1..12
      display_order INTEGER DEFAULT 0,
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (pillar_id) REFERENCES tracker_pillars(id) ON DELETE CASCADE,
      UNIQUE (pillar_id, code)
    );
    CREATE INDEX IF NOT EXISTS ix_track_act_pillar ON tracker_activities(pillar_id);
    CREATE INDEX IF NOT EXISTS ix_track_act_code   ON tracker_activities(code);
  `);

  // PHASE 0 — additive columns on legacy tables for activity_id mapping
  // These let us correlate legacy (site, activity_ix) tuples to the new
  // activity_id during the backfill. Wrapped in try/catch for idempotence.
  try { db.exec(`ALTER TABLE tracker_targets ADD COLUMN activity_id INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE tracker_inputs  ADD COLUMN activity_id INTEGER`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS ix_track_tgt_actid ON tracker_targets(activity_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS ix_track_inp_actid ON tracker_inputs(activity_id)`); } catch(e) {}

  // PHASE 2 — additive columns on tracker_activities to preserve the
  // legacy-side fields that aren't part of the normalised schema. They
  // let _loadFromNewSchema() return a D.activities[] with byte-identical
  // shape to what _loadFromLegacy() produces. Idempotent.
  try { db.exec(`ALTER TABLE tracker_activities ADD COLUMN legacy_id  INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE tracker_activities ADD COLUMN legacy_num INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE tracker_activities ADD COLUMN weight     REAL DEFAULT 0`); } catch(e) {}
  try { db.exec(`ALTER TABLE tracker_activities ADD COLUMN shared     INTEGER DEFAULT 0`); } catch(e) {}

  // Seed on first run (empty tracker_config)
  const n = db.prepare('SELECT COUNT(*) as n FROM tracker_config').get().n;
  if (n === 0) {
    console.log('[tracker-db] First run — seeding default data…');
    _seed(db);
    console.log('[tracker-db] ✅ Default data seeded');
  }

  // PHASE 0 — backfill the new normalised tables from the legacy
  // singleton. Idempotent: skips rows already present, updates pillar
  // weights if they drifted. Runs at every boot for now (Phase 1 will
  // move this to saveTracker dual-write).
  try {
    const result = _backfillFromLegacy(db);
    const totalChanges = result.years_inserted + result.pillars_inserted +
                         result.pillars_updated + result.activities_inserted +
                         result.targets_backfilled + result.inputs_backfilled;
    if (totalChanges > 0) {
      console.log('[Tracker-DB] _backfillFromLegacy:', JSON.stringify(result));
    }
  } catch (e) {
    console.error('[Tracker-DB] _backfillFromLegacy failed:', e.message);
    // Non-fatal — legacy schema is still in place and serves the app
  }
}

// ══════════════════════════════════════════════════════════════════
//  PHASE 0 (ADR-001) — _backfillFromLegacy
//  ------------------------------------------------------------------
//  Reads the legacy singleton (tracker_config) and populates the new
//  normalised tables (tracker_years / tracker_pillars / tracker_activities)
//  + back-fills the activity_id column on tracker_targets and
//  tracker_inputs.
//
//  IDEMPOTENT: re-running picks up only what is missing.
//  NON-DESTRUCTIVE: never deletes from the legacy schema.
//
//  Pillar code derivation: the legacy pillar string is "1-Network Infrast"
//  (or "P1-Network Infrast" depending on the seed variant). We extract
//  the leading digit as 'P{1-4}' and the remainder as the display name.
//
//  Activity code derivation: uses getActivityCode() from Palier 1, which
//  produces a stable 'P{1-4}-{ALPHA12}' identifier from (pillar, name).
//
//  Year scoping: legacy has no year dimension for pillars / activities.
//  We copy the SAME pillar/activity set into every year listed in
//  years_json. This freezes the current shape per year. Future user edits
//  in any year will be tracked separately once Phase 1 dual-write ships.
//
//  Targets scoping: legacy targets have no year. We map them to the
//  LATEST year's activity_id (the canonical "current" set of targets).
// ══════════════════════════════════════════════════════════════════
function _backfillFromLegacy(db) {
  const cfg = db.prepare('SELECT * FROM tracker_config WHERE id=1').get();
  if (!cfg) {
    return { years_inserted: 0, pillars_inserted: 0, pillars_updated: 0,
             activities_inserted: 0, targets_backfilled: 0, inputs_backfilled: 0 };
  }

  const activities    = JSON.parse(cfg.activities_json     || '[]');
  const pillarWeights = JSON.parse(cfg.pillar_weights_json || '{}');
  const years         = JSON.parse(cfg.years_json          || '[]');

  // Parse a legacy pillar string like "1-Network Infrast" or "P2-Business Partner"
  // into { code: 'P1', name: 'Network Infrast' }.
  function parsePillar(pillarStr) {
    if (!pillarStr) return null;
    const s = String(pillarStr).trim();
    const m = s.match(/^P?(\d+)\s*[-–—]?\s*(.*)$/);
    if (m) return { code: 'P' + m[1], name: (m[2] || '').trim() || s };
    // Fallback: take first 4 alphanum chars as code
    return { code: s.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'PX', name: s };
  }

  const insertYear   = db.prepare(`INSERT OR IGNORE INTO tracker_years (year) VALUES (?)`);
  const findPillar   = db.prepare(`SELECT id, weight, name FROM tracker_pillars WHERE year = ? AND code = ?`);
  const insertPillar = db.prepare(`INSERT INTO tracker_pillars (year, code, name, weight, display_order) VALUES (?, ?, ?, ?, ?)`);
  const updatePillar = db.prepare(`UPDATE tracker_pillars SET name=?, weight=?, updated_at=datetime('now') WHERE id=?`);
  const findActivity = db.prepare(`SELECT id FROM tracker_activities WHERE pillar_id = ? AND code = ?`);
  const insertActivity = db.prepare(`
    INSERT INTO tracker_activities
      (pillar_id, code, name, kpi_type, start_month, end_month, display_order,
       legacy_id, legacy_num, weight, shared)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // PHASE 2 — also UPDATE non-key fields if they drift on an existing
  // activity (legacy_id/num/weight/shared can change as the admin
  // tweaks the legacy JSON; we want the new schema to follow).
  const updateActivityFields = db.prepare(`
    UPDATE tracker_activities
       SET name = ?, kpi_type = ?, start_month = ?, end_month = ?,
           legacy_id = ?, legacy_num = ?, weight = ?, shared = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `);

  let years_inserted = 0, pillars_inserted = 0, pillars_updated = 0, activities_inserted = 0;

  const tx = db.transaction(() => {
    for (const year of years) {
      const r = insertYear.run(year);
      if (r.changes > 0) years_inserted++;

      // Pillar id map for this year: legacy pillar string → pillar_id
      const pillarIdMap = {};
      const orderedPillars = Object.keys(pillarWeights);
      orderedPillars.forEach((pillarStr, order) => {
        const parsed = parsePillar(pillarStr);
        if (!parsed) return;
        const weight = Number(pillarWeights[pillarStr]) || 0;
        const existing = findPillar.get(year, parsed.code);
        if (existing) {
          // Update only if name or weight drifted
          if (existing.weight !== weight || existing.name !== parsed.name) {
            updatePillar.run(parsed.name, weight, existing.id);
            pillars_updated++;
          }
          pillarIdMap[pillarStr] = existing.id;
        } else {
          const ins = insertPillar.run(year, parsed.code, parsed.name, weight, order);
          pillarIdMap[pillarStr] = Number(ins.lastInsertRowid);
          pillars_inserted++;
        }
      });

      // Activities under each pillar
      activities.forEach((act, ix) => {
        if (!act || !act.pillar) return;
        const pillarId = pillarIdMap[act.pillar];
        if (!pillarId) return;  // legacy activity references unknown pillar — skip
        const code   = getActivityCode(act);
        // Capture the 4 extra legacy fields that Phase 2 must preserve.
        const legId  = (act.id  != null) ? Number(act.id)  : null;
        const legNum = (act.num != null) ? Number(act.num) : null;
        const weight = (act.weight != null) ? Number(act.weight) : 0;
        const shared = act.shared ? 1 : 0;
        const existing = findActivity.get(pillarId, code);
        if (existing) {
          // PHASE 2 — refresh non-key fields so the new schema follows
          // any drift from the legacy singleton.
          updateActivityFields.run(
            String(act.name || 'Untitled'),
            String(act.kpi  || 'BOOLEAN'),
            Number(act.start) || 1,
            Number(act.end)   || 12,
            legId, legNum, weight, shared,
            existing.id
          );
          return;
        }
        insertActivity.run(
          pillarId,
          code,
          String(act.name || 'Untitled'),
          String(act.kpi || 'BOOLEAN'),
          Number(act.start) || 1,
          Number(act.end)   || 12,
          ix,
          legId, legNum, weight, shared
        );
        activities_inserted++;
      });
    }
  });
  tx();

  // Backfill activity_id on tracker_inputs (per-year mapping) and
  // tracker_targets (mapped to the latest year). Both honor the
  // existing (site, activity_ix) primary key — we never modify the
  // legacy key, only fill the NEW activity_id column.
  const ixMeta = activities.map(act => ({
    pillarStr: act && act.pillar ? act.pillar : null,
    code: act ? getActivityCode(act) : null,
  }));

  let inputs_backfilled = 0;
  const findPillarByYearCode = db.prepare(`SELECT id FROM tracker_pillars WHERE year = ? AND code = ?`);
  const findActivityByPillarCode = db.prepare(`SELECT id FROM tracker_activities WHERE pillar_id = ? AND code = ?`);
  const updateInputActivityId = db.prepare(`
    UPDATE tracker_inputs SET activity_id = ?
    WHERE year = ? AND site = ? AND activity_ix = ? AND activity_id IS NULL
  `);

  const inputRows = db.prepare(`SELECT year, site, activity_ix FROM tracker_inputs WHERE activity_id IS NULL`).all();
  const txInputs = db.transaction(() => {
    for (const row of inputRows) {
      const meta = ixMeta[row.activity_ix];
      if (!meta || !meta.pillarStr || !meta.code) continue;
      const parsed = parsePillar(meta.pillarStr);
      if (!parsed) continue;
      const pillarRow = findPillarByYearCode.get(row.year, parsed.code);
      if (!pillarRow) continue;
      const actRow = findActivityByPillarCode.get(pillarRow.id, meta.code);
      if (!actRow) continue;
      const r = updateInputActivityId.run(actRow.id, row.year, row.site, row.activity_ix);
      if (r.changes > 0) inputs_backfilled++;
    }
  });
  txInputs();

  let targets_backfilled = 0;
  const latestYear = years.length > 0 ? Math.max(...years.map(Number)) : null;
  if (latestYear) {
    const updateTargetActivityId = db.prepare(`
      UPDATE tracker_targets SET activity_id = ?
      WHERE site = ? AND activity_ix = ? AND activity_id IS NULL
    `);
    const targetRows = db.prepare(`SELECT site, activity_ix FROM tracker_targets WHERE activity_id IS NULL`).all();
    const txTargets = db.transaction(() => {
      for (const row of targetRows) {
        const meta = ixMeta[row.activity_ix];
        if (!meta || !meta.pillarStr || !meta.code) continue;
        const parsed = parsePillar(meta.pillarStr);
        if (!parsed) continue;
        const pillarRow = findPillarByYearCode.get(latestYear, parsed.code);
        if (!pillarRow) continue;
        const actRow = findActivityByPillarCode.get(pillarRow.id, meta.code);
        if (!actRow) continue;
        const r = updateTargetActivityId.run(actRow.id, row.site, row.activity_ix);
        if (r.changes > 0) targets_backfilled++;
      }
    });
    txTargets();
  }

  return { years_inserted, pillars_inserted, pillars_updated,
           activities_inserted, targets_backfilled, inputs_backfilled };
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
// ══════════════════════════════════════════════════════════════════
//  PHASE 2 (ADR-001) — switchable read source with shadow mode
//  Added 2026-06-09. Three modes:
//    TRACKER_READ_SOURCE=legacy (default)
//      → _loadFromLegacy() — reads tracker_config singleton (unchanged)
//    TRACKER_READ_SOURCE=new
//      → _loadFromNewSchema() — reads tracker_years/pillars/activities
//    TRACKER_READ_SHADOW=1  (orthogonal, can be combined with either)
//      → after returning from the active source, runs the OTHER source
//        in shadow and logs any structural differences. Zero UX impact.
//
//  Default (legacy + no shadow) = strict pre-Phase-2 behaviour.
//  Recommended progression:
//    1. Deploy this commit with default (legacy). No change for users.
//    2. Flip TRACKER_READ_SHADOW=1 on prod (+ pm2 reload --update-env).
//    3. Watch pm2 logs for [Tracker-DB] shadow diff messages over 1 week.
//    4. When diffs are 0 (or all expected/documented), flip
//       TRACKER_READ_SOURCE=new. Rollback is instant via env-var flip.
// ══════════════════════════════════════════════════════════════════
function loadTracker() {
  const source = String(process.env.TRACKER_READ_SOURCE || 'legacy').toLowerCase();
  const shadow = String(process.env.TRACKER_READ_SHADOW || '').trim() === '1';

  const primary   = source === 'new' ? 'new' : 'legacy';
  const secondary = primary === 'new' ? 'legacy' : 'new';

  let D;
  try {
    D = primary === 'new' ? _loadFromNewSchema() : _loadFromLegacy();
  } catch (e) {
    // Primary backend failed — fall back to legacy for safety
    console.error('[Tracker-DB] loadTracker(' + primary + ') threw:', e.message, '— falling back to legacy');
    D = _loadFromLegacy();
  }

  if (shadow) {
    try {
      const Dshadow = secondary === 'new' ? _loadFromNewSchema() : _loadFromLegacy();
      const diffs = _diffTrackerD(D, Dshadow);
      if (diffs.length > 0) {
        console.warn('[Tracker-DB] shadow diff (' + primary + ' vs ' + secondary + '):', JSON.stringify(diffs).slice(0, 4000));
      }
    } catch (e) {
      console.error('[Tracker-DB] shadow load failed:', e.message);
    }
  }

  return D;
}

// Legacy backend — verbatim copy of the pre-Phase-2 loadTracker body.
function _loadFromLegacy() {
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

  // PALIER 1 — read-time enrichment with stable activity code.
  for (const a of activities) {
    if (!a.code) a.code = getActivityCode(a);
  }

  // Targets — rebuild per-site arrays indexed by activity_ix
  const targetRows = db.prepare('SELECT * FROM tracker_targets ORDER BY site, activity_ix').all();
  const targets    = {};
  INIT.sites.forEach(s => {
    targets[s] = activities.map(() => ({ target: 0, active: false }));
  });
  targetRows.forEach(row => {
    if (!targets[row.site]) {
      targets[row.site] = activities.map(() => ({ target: 0, active: false }));
    }
    if (row.activity_ix >= activities.length) return; // skip historical residuals
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
    if (row.activity_ix >= activities.length) return; // skip historical residuals
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

// PHASE 2 — Normalised-schema backend.
// Returns the SAME shape as _loadFromLegacy() so App.jsx is oblivious.
// Strategy:
//   - years: from tracker_years
//   - canonical year = latest year (matches legacy convention)
//   - activities: from tracker_activities under canonical year's pillars
//   - pillarWeights: reconstructed from tracker_pillars (canonical year)
//                    in the legacy key format "P1-Network Infrast"
//   - activeSites + current_month: still read from tracker_config
//     (these singletons don't have a year dimension and are not
//     normalised yet — out of scope for ADR-001)
//   - targets + inputs: read from legacy tables, same as Phase 0/1
//     (activity_id column is available but not used until a later
//      phase switches the writers AND every legacy splice path)
function _loadFromNewSchema() {
  const db = getDB();
  const cfg = db.prepare('SELECT active_sites_json, current_month FROM tracker_config WHERE id=1').get();
  if (!cfg) return JSON.parse(JSON.stringify(INIT));

  const yearsRow = db.prepare('SELECT year FROM tracker_years ORDER BY year').all();
  const years = yearsRow.map(r => r.year);
  if (years.length === 0) {
    // No data in new schema yet — degrade to legacy for safety
    return _loadFromLegacy();
  }
  const currentYear = years[years.length - 1];

  // Pillars for the canonical year. Reconstruct the legacy key format
  // "<code>-<name>" so App.jsx and downstream code see identical keys.
  const pillarRows = db.prepare(
    'SELECT code, name, weight FROM tracker_pillars WHERE year = ? ORDER BY display_order'
  ).all(currentYear);
  const pillarWeights = {};
  for (const p of pillarRows) {
    const legacyKey = p.name ? (p.code + '-' + p.name) : p.code;
    pillarWeights[legacyKey] = p.weight;
  }

  // Activities for the canonical year, joined to their pillar so we can
  // rebuild the legacy 'pillar' string. Order by display_order to keep
  // activity_ix stable when the legacy reader is replaced later.
  // The 4 PHASE-2 columns (legacy_id, legacy_num, weight, shared) are
  // re-injected to preserve the byte-identical shape.
  const actRows = db.prepare(`
    SELECT a.code, a.name, a.kpi_type, a.start_month, a.end_month, a.display_order,
           a.legacy_id, a.legacy_num, a.weight, a.shared,
           p.code AS pillar_code, p.name AS pillar_name
    FROM tracker_activities a
    JOIN tracker_pillars p ON p.id = a.pillar_id
    WHERE p.year = ?
    ORDER BY a.display_order, a.id
  `).all(currentYear);
  const activities = actRows.map(a => {
    // Field ordering matches the legacy shape produced by the JSON
    // parse path (id, num, pillar, name, kpi, weight, start, end,
    // shared, code) — getting the order identical means
    // JSON.stringify() comparisons in the shadow diff stay clean.
    const obj = {};
    if (a.legacy_id  != null) obj.id  = a.legacy_id;
    if (a.legacy_num != null) obj.num = a.legacy_num;
    obj.pillar = a.pillar_name ? (a.pillar_code + '-' + a.pillar_name) : a.pillar_code;
    obj.name   = a.name;
    obj.kpi    = a.kpi_type;
    if (a.weight != null) obj.weight = a.weight;
    obj.start  = a.start_month;
    obj.end    = a.end_month;
    obj.shared = a.shared === 1;
    obj.code   = a.code;
    return obj;
  });

  const activeSites = JSON.parse(cfg.active_sites_json || '[]');

  // Targets — same as legacy (we still read from tracker_targets indexed by activity_ix)
  const targetRows = db.prepare('SELECT * FROM tracker_targets ORDER BY site, activity_ix').all();
  const targets = {};
  INIT.sites.forEach(s => {
    targets[s] = activities.map(() => ({ target: 0, active: false }));
  });
  targetRows.forEach(row => {
    if (!targets[row.site]) {
      targets[row.site] = activities.map(() => ({ target: 0, active: false }));
    }
    if (row.activity_ix >= activities.length) return; // skip historical residuals
    const rawTarget = row.target;
    targets[row.site][row.activity_ix] = {
      target: rawTarget === 'TRUE/FALSE' ? rawTarget : (isNaN(rawTarget) ? rawTarget : parseFloat(rawTarget)),
      active: row.active === 1
    };
  });

  // Inputs — same as legacy
  const inputRows = db.prepare('SELECT * FROM tracker_inputs ORDER BY year, site, activity_ix').all();
  const inputs = {};
  inputRows.forEach(row => {
    const yr = row.year;
    if (!inputs[yr]) inputs[yr] = {};
    if (!inputs[yr][row.site]) inputs[yr][row.site] = [];
    if (row.activity_ix >= activities.length) return;
    inputs[yr][row.site][row.activity_ix] = JSON.parse(row.months_json || '[0,0,0,0,0,0,0,0,0,0,0,0]');
  });

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

// Tiny structural diff between two D objects. Returns an array of
// short string descriptors (no JSON dump — keeps log line bounded).
// Used by the shadow mode to surface drift without flooding logs.
function _diffTrackerD(A, B) {
  const out = [];
  const compareScalar = (k) => {
    if (A[k] !== B[k]) out.push(k + ':' + JSON.stringify(A[k]) + '!=' + JSON.stringify(B[k]));
  };
  const compareJson = (k) => {
    const ja = JSON.stringify(A[k]);
    const jb = JSON.stringify(B[k]);
    if (ja !== jb) out.push(k + ':differ(len ' + ja.length + ' vs ' + jb.length + ')');
  };
  for (const k of ['currentMonth', 'year']) compareScalar(k);
  for (const k of ['years', 'activeSites', 'activities', 'pillarWeights', 'targets', 'inputs']) compareJson(k);
  return out;
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

  // ── PHASE 1 (ADR-001) — DUAL-WRITE to normalised tables ─────────────
  // After every successful legacy save, propagate to the new schema by
  // running the existing idempotent backfill. ADDs (new year, new
  // pillar, new activity) appear in the new tables; UPDATEs (pillar
  // weight changed) flow through too; new tracker_inputs / tracker_targets
  // rows get their activity_id mapped. Deletions are NOT handled here —
  // they're handled explicitly in deleteTrackerYear() per ADR-001 §8.5.
  // Idempotent + silent: no-op when nothing changed; logs a summary
  // line when something did.
  try {
    const r = _backfillFromLegacy(db);
    const total = r.years_inserted + r.pillars_inserted + r.pillars_updated +
                  r.activities_inserted + r.targets_backfilled + r.inputs_backfilled;
    if (total > 0) {
      console.log('[Tracker-DB] saveTracker dual-write:', JSON.stringify(r));
    }
  } catch (e) {
    // Dual-write failure is logged but does NOT bubble up — the legacy
    // save already succeeded, the new schema can be re-synced later by
    // the boot-time _backfillFromLegacy. Failing here would mislead the
    // user into thinking their save was lost.
    console.error('[Tracker-DB] saveTracker dual-write failed (legacy save was OK):', e.message);
  }
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
  // Legacy wipe
  db.exec('DELETE FROM tracker_config; DELETE FROM tracker_targets; DELETE FROM tracker_inputs;');
  // PHASE 1 — wipe the normalised schema too. Order matters: activities
  // → pillars → years respects the FK CASCADE chain (CASCADE would
  // handle it via DELETE FROM tracker_years alone, but being explicit
  // makes the intent obvious to any future reader).
  db.exec(`
    DELETE FROM tracker_activities;
    DELETE FROM tracker_pillars;
    DELETE FROM tracker_years;
  `);
  _seed(db);
  // Re-populate normalised schema from the freshly-seeded legacy state.
  try {
    const r = _backfillFromLegacy(db);
    console.log('[Tracker-DB] resetTracker — repopulated normalised schema:', JSON.stringify(r));
  } catch (e) {
    console.error('[Tracker-DB] resetTracker — backfill failed (legacy was reset OK):', e.message);
  }
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

  // PHASE 1 — DUAL-DELETE in one atomic transaction.
  // 1) Wipe legacy tracker_inputs rows for the year being deleted.
  // 2) Update legacy tracker_config.years_json.
  // 3) NULL-out activity_id pointers in tracker_targets that reference
  //    activities under the year's pillars (orphan avoidance — see
  //    ADR-001 §8.5). tracker_inputs activity_id is implicitly cleaned
  //    by step 1's row deletion.
  // 4) DELETE FROM tracker_years — FK CASCADE wipes tracker_pillars
  //    (year=y) and then tracker_activities under those pillars.
  // If any step throws, the entire transaction rolls back; the backup
  // taken earlier is still there for manual recovery.
  const tx = db.transaction(() => {
    // Step 1 — legacy
    const r = db.prepare('DELETE FROM tracker_inputs WHERE year = ?').run(y);
    // Step 2 — legacy
    db.prepare(`
      UPDATE tracker_config
      SET years_json = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(JSON.stringify(newYears));
    // Step 3 — new schema: cleanup tracker_targets activity_id orphans
    const orphanTargets = db.prepare(`
      UPDATE tracker_targets
      SET activity_id = NULL
      WHERE activity_id IN (
        SELECT a.id FROM tracker_activities a
        JOIN tracker_pillars p ON p.id = a.pillar_id
        WHERE p.year = ?
      )
    `).run(y);
    // Step 4 — new schema: cascade delete
    const deletedYears = db.prepare('DELETE FROM tracker_years WHERE year = ?').run(y);
    return {
      inputs_deleted_legacy:     r.changes,
      targets_orphans_cleaned:   orphanTargets.changes,
      years_deleted_new_schema:  deletedYears.changes,
    };
  });
  const txResult = tx();

  console.log('[Tracker-DB] deleteTrackerYear', y, '— dual-delete:', JSON.stringify(txResult));

  return {
    year:                       y,
    inputs_deleted:             txResult.inputs_deleted_legacy,
    targets_orphans_cleaned:    txResult.targets_orphans_cleaned,
    years_deleted_new_schema:   txResult.years_deleted_new_schema,
    years_after:                newYears,
    backup_path:                backupPath,  // operator can restore from this if needed
  };
}

module.exports = { loadTracker, saveTracker, resetTracker, deleteTrackerYear, previewDeleteTrackerYear, backupDatabase, siteNameToCode, getActivityCode };
