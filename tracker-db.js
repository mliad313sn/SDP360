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
const { inScope: _inScope } = require('./services/userSites');   // multi-site editors: a scope may be a list of codes


const path     = require('path');
const fs       = require('fs');

// ── Default seed data (same as INIT in activity-tracker.html) ──────────────
const INIT = require('./tracker-init.json');

// ── DB path resolution + auto-migration from legacy root location ──────────
// Historical: tracker.db lived at __dirname/tracker.db. Harmonised 2026-06-05
// to __dirname/data/tracker.db (same pattern as reports.db). The block below
// auto-migrates if it finds the DB at the old location — idempotent + safe.
// SDP_DATA_DIR override lets tests point the module at a throwaway temp
// directory; unset in prod so the default data/ path is unchanged.
const DATA_DIR  = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, 'data');
const TRACKER_DB_PATH = path.join(DATA_DIR, 'tracker.db');


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
  'OUAGADOUGOU':'EDV',
  'TANDA':'TND',  'Tanda IT Agents':'TND',
  // The Tanda network is owned by the ASSAFO site row in prod (zoho_group "Tanda IT Agents").
  'ASSAFO':'TND'
};

// Case-, accent- and suffix-insensitive form of a site label, so `Hounde`,
// `HOUNDE`, `Houndé` and `Hounde IT Agents` all meet the same key. Same rule as
// inspection-db's _normSite. Before this, the lookup was EXACT: the prod site rows
// are named `Hounde`, `Ity`, `Lafigue`… and 8 of the 11 sites could not save their
// tracker inputs (403 "no site assigned") — found 2026-10-02.
function _normSite(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(it agent|it agents|it support|office|support|bf|ci)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
const _NORM_SITE_MAP = (() => {
  const m = {};
  for (const [k, v] of Object.entries(SITE_MAP)) {
    const n = _normSite(k);
    if (n && !m[n]) m[n] = v;
  }
  return m;
})();

/** Convert a site label (sites.name, a Zoho group…) to a tracker site code, or null. */
function siteNameToCode(siteName) {
  if (!siteName) return null;
  const reg = require('./services/siteCodeRegistry').lookup('tracker', siteName); if (reg) return reg;   // DEC-4 switch (off by default)
  return hardSiteNameToCode(siteName);
}
/** The hard-coded map only (DEC-4 diff). */
function hardSiteNameToCode(siteName) {
  if (!siteName) return null;
  if (SITE_MAP[siteName]) return SITE_MAP[siteName];
  return _NORM_SITE_MAP[_normSite(siteName)] || null;
}

/**
 * Resolve a `sites` row to its tracker code: by name first, then by each entry of
 * its comma-separated `zoho_group` (a site renamed in Admin keeps resolving).
 * Returns null when nothing matches — the caller refuses the save in that case.
 */
function siteToCode(site) {
  if (!site) return null;
  const byName = siteNameToCode(site.name);
  if (byName) return byName;
  for (const g of String(site.zoho_group || '').split(',')) {
    const code = siteNameToCode(g.trim());
    if (code) return code;
  }
  return null;
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

// Parse a legacy pillar string like "1-Network Infrast" or "P2-Business Partner"
// into { code: 'P1', name: 'Network Infrast' }. Module-level (hoisted out of
// _backfillFromLegacy in Phase 3) because the prune logic needs the same
// derivation — single source of truth. The audit script
// (_audit_tracker_dualwrite.js) carries a mirrored copy: keep in sync.
function parsePillar(pillarStr) {
  if (!pillarStr) return null;
  const s = String(pillarStr).trim();
  const m = s.match(/^P?(\d+)\s*[-–—]?\s*(.*)$/);
  if (m) return { code: 'P' + m[1], name: (m[2] || '').trim() || s };
  // Fallback: take first 4 alphanum chars as code
  return { code: s.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'PX', name: s };
}



// PostgreSQL is the only database (PO-08): getDB() is the pg handle.
// PostgreSQL is the only database (PO-08): getDB() is the pg handle.
function getDB() { return pgHandle(); }

// ── PostgreSQL backend selector (Chunk 1) ────────────────────────────────────
// `sqlite` (default) keeps the better-sqlite3 path above, byte-for-byte.
// `postgres` routes the per-year v2 path through the async services/pgDb adapter.
const TRACKER_BACKEND = 'postgres';
let _pg = null;
// Connect the pool once at server boot and apply the tracker schema.
async function initPgTracker() {
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('TRACKER_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'tracker', '001_init.sql'), 'utf8'));
  await _seedFromInitPg();
  return _pg;
}

// Fresh database (no year at all): seed the shipped programme from tracker-init.json —
// years, pillars, activities, targets and inputs — through the normal per-year save path.
// The SQLite boot used to do this; on PostgreSQL a fresh install loaded the defaults but
// could not save them (no activity rows to attach inputs to). Never touches a populated DB.
async function _seedFromInitPg() {
  const n = Number((await _pg.prepare('SELECT COUNT(*) AS n FROM tracker_years').get()).n);
  if (n > 0) return;
  const D = JSON.parse(JSON.stringify(INIT));
  const years = (D.years && D.years.length ? D.years : [D.year]).filter(Boolean);
  D.years = years;
  D.byYear = {};
  for (const y of years) D.byYear[y] = { activities: D.activities, pillarWeights: D.pillarWeights, targets: D.targets };
  await _saveV2Pg(D, null, {});
  console.log('[Tracker-DB] seeded the default programme into PostgreSQL:', years.join(', '));
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgTracker() at boot');
  return _pg;
}

// ── Async PostgreSQL fork of the v2 (per-year) read/save path ────────────────
// Faithful ports of _loadFromNewSchema / _saveV2 / _syncYearStructure with:
//   getDB() → pgHandle(); db.prepare().get/all/run → await …; db.transaction()()
//   → await runTransaction(async …); .lastInsertRowid → .lastID;
//   INSERT OR REPLACE/IGNORE → ON CONFLICT; datetime('now') → now().
const _MONTHS0 = '[0,0,0,0,0,0,0,0,0,0,0,0]';

async function _loadFromNewSchemaPg() {
  const h = pgHandle();
  const cfg = await h.prepare('SELECT active_sites_json, current_month FROM tracker_config WHERE id=1').get();
  if (!cfg) return JSON.parse(JSON.stringify(INIT));

  const yearsRow = await h.prepare('SELECT year FROM tracker_years ORDER BY year').all();
  const years = yearsRow.map(r => r.year);
  if (years.length === 0) return JSON.parse(JSON.stringify(INIT));   // no legacy fallback in pg mode
  const currentYear = years[years.length - 1];
  // Per-year mode is the only mode (ADR-001 complete, legacy tables frozen; PostgreSQL-only since PO-08).
  const perYearEnabled = true;

  const activeSites = JSON.parse(cfg.active_sites_json || '[]');
  const coerceTarget = (raw) => raw === 'TRUE/FALSE' ? raw : (isNaN(raw) ? raw : parseFloat(raw));

  const qPillars = h.prepare('SELECT code, name, weight FROM tracker_pillars WHERE year = ? ORDER BY display_order');
  const qActs = h.prepare(`
    SELECT a.id AS db_id, a.code, a.name, a.kpi_type, a.start_month, a.end_month,
           a.legacy_id, a.legacy_num, a.weight, a.shared,
           p.code AS pillar_code, p.name AS pillar_name
    FROM tracker_activities a JOIN tracker_pillars p ON p.id = a.pillar_id
    WHERE p.year = ? ORDER BY a.display_order, a.id`);
  const qTargetsV2 = h.prepare('SELECT site, activity_id, target, active FROM tracker_targets_v2 WHERE year = ?');

  const shapeActivity = (a) => {
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
  };

  const byYear = {};
  const idToIxBy = {};
  for (const y of years) {
    const pw = {};
    for (const p of await qPillars.all(y)) pw[p.name ? (p.code + '-' + p.name) : p.code] = p.weight;
    const aRows = await qActs.all(y);
    const acts  = aRows.map(shapeActivity);
    const idToIx = new Map(aRows.map((a, ix) => [a.db_id, ix]));
    idToIxBy[y] = idToIx;

    const yTargets = {};
    INIT.sites.forEach(s => { yTargets[s] = acts.map(() => ({ target: 0, active: false })); });
    for (const r of await qTargetsV2.all(y)) {
      const ix = idToIx.get(r.activity_id);
      if (ix == null) continue;
      if (!yTargets[r.site]) yTargets[r.site] = acts.map(() => ({ target: 0, active: false }));
      yTargets[r.site][ix] = { target: coerceTarget(r.target), active: r.active === 1 };
    }
    byYear[y] = { activities: acts, pillarWeights: pw, targets: yTargets };
  }
  const canon = byYear[currentYear] || { activities: [], pillarWeights: {}, targets: {} };
  const activities    = canon.activities;
  const pillarWeights = canon.pillarWeights;

  let targets, inputs = {};
  targets = canon.targets;
  const qInputsV2 = h.prepare('SELECT site, activity_id, months_json FROM tracker_inputs_v2 WHERE year = ?');
  for (const y of years) {
    const idToIx = idToIxBy[y];
    const nActs  = byYear[y].activities.length;
    inputs[y] = {};
    for (const r of await qInputsV2.all(y)) {
      const ix = idToIx.get(r.activity_id);
      if (ix == null) continue;
      if (!inputs[y][r.site]) inputs[y][r.site] = [];
      inputs[y][r.site][ix] = JSON.parse(r.months_json || _MONTHS0);
    }
    for (const s of Object.keys(inputs[y])) {
      for (let i = 0; i < nActs; i++) if (inputs[y][s][i] === undefined) inputs[y][s][i] = undefined;
    }
  }


  return {
    sites: INIT.sites, siteNames: INIT.siteNames, siteColors: INIT.siteColors,
    activeSites, currentMonth: cfg.current_month, activities, targets, inputs,
    year: currentYear, years, pillarWeights, byYear, perYearEnabled,
  };
}

async function _syncYearStructurePg(year, yd) {
  const h = pgHandle();
  const acts = Array.isArray(yd.activities) ? yd.activities : [];
  const pw   = yd.pillarWeights || {};

  // ── Pillars ──
  const wantPillars = new Map();
  Object.keys(pw).forEach((k, order) => {
    const p = parsePillar(k);
    if (p) wantPillars.set(p.code, { name: p.name, weight: Number(pw[k]) || 0, order });
  });
  const havePillars = new Map(
    (await h.prepare('SELECT id, code, name, weight, display_order FROM tracker_pillars WHERE year = ?').all(year))
      .map(r => [r.code, r]));
  const insP = h.prepare('INSERT INTO tracker_pillars (year, code, name, weight, display_order) VALUES (?, ?, ?, ?, ?)');
  const updP = h.prepare(`UPDATE tracker_pillars SET name=?, weight=?, display_order=?, updated_at=now() WHERE id=?`);
  const delP = h.prepare('DELETE FROM tracker_pillars WHERE id=?');
  const pillarIdByCode = new Map();
  for (const [code, w] of wantPillars) {
    const have = havePillars.get(code);
    if (have) {
      if (have.name !== w.name || have.weight !== w.weight || have.display_order !== w.order) {
        await updP.run(w.name, w.weight, w.order, have.id);
      }
      pillarIdByCode.set(code, have.id);
    } else {
      const r = await insP.run(year, code, w.name, w.weight, w.order);
      pillarIdByCode.set(code, Number(r.lastID));
    }
  }
  for (const [code, have] of havePillars) {
    if (!wantPillars.has(code)) await delP.run(have.id);   // CASCADE wipes activities + v2 rows
  }

  // ── Activities ──
  const haveActs = new Map(
    (await h.prepare(`SELECT a.id, a.code FROM tracker_activities a
                      JOIN tracker_pillars p ON p.id = a.pillar_id WHERE p.year = ?`).all(year))
      .map(r => [r.code, r.id]));
  const insA = h.prepare(`
    INSERT INTO tracker_activities
      (pillar_id, code, name, kpi_type, start_month, end_month, display_order, legacy_id, legacy_num, weight, shared)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updA = h.prepare(`
    UPDATE tracker_activities
       SET pillar_id=?, name=?, kpi_type=?, start_month=?, end_month=?, display_order=?,
           legacy_id=?, legacy_num=?, weight=?, shared=?, updated_at=now()
     WHERE id=?`);
  const delA = h.prepare('DELETE FROM tracker_activities WHERE id=?');
  const actIdByIx = [];
  const seenCodes = new Set();
  for (let ix = 0; ix < acts.length; ix++) {
    const act = acts[ix];
    if (!act) { actIdByIx[ix] = null; continue; }
    const code = getActivityCode(act);
    seenCodes.add(code);
    const pParsed  = parsePillar(act.pillar);
    const pillarId = pParsed ? pillarIdByCode.get(pParsed.code) : null;
    if (!pillarId) { actIdByIx[ix] = null; continue; }
    const legId  = (act.id  != null) ? Number(act.id)  : null;
    const legNum = (act.num != null) ? Number(act.num) : null;
    const weight = (act.weight != null) ? Number(act.weight) : 0;
    const shared = act.shared ? 1 : 0;
    const haveId = haveActs.get(code);
    if (haveId) {
      await updA.run(pillarId, String(act.name || 'Untitled'), String(act.kpi || 'BOOLEAN'),
                     Number(act.start) || 1, Number(act.end) || 12, ix,
                     legId, legNum, weight, shared, haveId);
      actIdByIx[ix] = haveId;
    } else {
      const r = await insA.run(pillarId, code, String(act.name || 'Untitled'), String(act.kpi || 'BOOLEAN'),
                               Number(act.start) || 1, Number(act.end) || 12, ix,
                               legId, legNum, weight, shared);
      actIdByIx[ix] = Number(r.lastID);
    }
  }
  for (const [code, id] of haveActs) {
    if (!seenCodes.has(code)) await delA.run(id);
  }

  // ── Targets v2 (wipe + reinsert for the year) ──
  await h.prepare('DELETE FROM tracker_targets_v2 WHERE year = ?').run(year);
  const insT = h.prepare(`
    INSERT INTO tracker_targets_v2 (year, site, activity_id, target, active) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (year, site, activity_id) DO UPDATE SET target=EXCLUDED.target, active=EXCLUDED.active, updated_at=now()`);
  for (const [site, arr] of Object.entries(yd.targets || {})) {
    for (let ix = 0; ix < (arr || []).length; ix++) {
      const t = arr[ix];
      const aid = actIdByIx[ix];
      if (!t || !aid) continue;
      await insT.run(year, site, aid, String(t.target ?? 0), t.active ? 1 : 0);
    }
  }
  return actIdByIx;
}

async function _saveV2Pg(D, userSite, opts = {}) {
  const h = pgHandle();
  const lock = _lockFor(opts);
  const byYear = D.byYear || {};
  await h.runTransaction(async () => {
    const actIdMaps = {};
    if (!userSite) {
      await h.prepare(`
        UPDATE tracker_config SET active_sites_json=?, years_json=?, current_month=?, updated_at=now() WHERE id=1
      `).run(JSON.stringify(D.activeSites || []), JSON.stringify(D.years || []), D.currentMonth || 4);

      const insYear = h.prepare('INSERT INTO tracker_years (year) VALUES (?) ON CONFLICT (year) DO NOTHING');
      for (const y of (D.years || [])) {
        const yi = parseInt(y, 10);
        if (Number.isFinite(yi)) await insYear.run(yi);
      }
      for (const [yStr, yd] of Object.entries(byYear)) {
        const y = parseInt(yStr, 10);
        if (!Number.isFinite(y)) continue;
        await insYear.run(y);
        actIdMaps[y] = await _syncYearStructurePg(y, yd);
      }
    }

    const insI = h.prepare(`
      INSERT INTO tracker_inputs_v2 (year, site, activity_id, months_json) VALUES (?, ?, ?, ?)
      ON CONFLICT (year, site, activity_id) DO UPDATE SET months_json=EXCLUDED.months_json, updated_at=now()`);
    const qIds = h.prepare(`
      SELECT a.id FROM tracker_activities a JOIN tracker_pillars p ON p.id = a.pillar_id
      WHERE p.year = ? ORDER BY a.display_order, a.id`);
    const qOld = h.prepare('SELECT months_json FROM tracker_inputs_v2 WHERE year = ? AND site = ? AND activity_id = ?');
    for (const [yStr, sites] of Object.entries(D.inputs || {})) {
      const y = parseInt(yStr, 10);
      if (!Number.isFinite(y)) continue;
      const ids = actIdMaps[y] || (await qIds.all(y)).map(r => r.id);
      for (const [site, arr] of Object.entries(sites || {})) {
        if (userSite && !_inScope(site, userSite)) continue;
        for (let ix = 0; ix < (arr || []).length; ix++) {
          let months = arr[ix];
          const aid = ids[ix];
          if (!aid || !Array.isArray(months)) continue;
          if (lock && lock.touches(y)) months = lock.apply(y, months, _parseMonths(await qOld.get(y, site, aid)));
          await insI.run(y, site, aid, JSON.stringify(months));
        }
      }
    }
  });
  console.log('[Tracker-DB] saveTracker v2 (postgres per-year) — legacy untouched');
  return { blocked: lock ? lock.blocked : 0 };
}

async function _previewDeleteTrackerYearPg(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) throw new Error('Invalid year: ' + year);
  const h = pgHandle();
  const cfg = await h.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  let years;
  try { years = JSON.parse((cfg && cfg.years_json) || '[]'); } catch (_) { years = []; }
  if (!Array.isArray(years)) years = [];
  const inputsForYear = await h.prepare('SELECT COUNT(*)::int c FROM tracker_inputs_v2 WHERE year = ?').get(y);
  const otherYears = await h.prepare(
    `SELECT year, COUNT(*)::int c FROM tracker_inputs_v2 WHERE year != ? GROUP BY year ORDER BY year`).all(y);
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

async function _deleteTrackerYearPg(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) throw new Error('Invalid year: ' + year);
  const h = pgHandle();
  const cfg = await h.prepare('SELECT years_json FROM tracker_config WHERE id=1').get();
  if (!cfg) throw new Error('tracker_config row id=1 not found');
  let years;
  try { years = JSON.parse(cfg.years_json || '[]'); } catch (_) { years = []; }
  if (!Array.isArray(years)) years = [];
  const newYears = years.filter(x => x !== y);
  if (newYears.length === 0) throw new Error('Cannot delete the last remaining year — at least one must be kept.');

  // No SQLite VACUUM-INTO backup on the pg backend (that helper is file-snapshot
  // only). FK ON DELETE CASCADE does the structural work: tracker_years →
  // tracker_pillars → tracker_activities → tracker_targets_v2 / tracker_inputs_v2.
  let deletedYears = 0;
  await h.runTransaction(async () => {
    await h.prepare(`UPDATE tracker_config SET years_json = ?, updated_at = now() WHERE id = 1`)
      .run(JSON.stringify(newYears));
    const r = await h.prepare('DELETE FROM tracker_years WHERE year = ?').run(y);
    deletedYears = r.changes;
  });
  console.log('[Tracker-DB] deleteTrackerYear(pg)', y, '— cascade removed years:', deletedYears);
  return { year: y, years_after: newYears, years_deleted: deletedYears, backup_path: null };
}











// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the full tracker state and assemble a D object identical in shape
 * to the INIT/localStorage D object used by the frontend.
 */

function loadTracker() {
  return _loadFromNewSchemaPg();
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
// ══════════════════════════════════════════════════════════════════
//  PHASE 4c (ADR-001) — per-year write path. Added 2026-06-12.
//  Active only when TRACKER_PER_YEAR_EDITS=1 (the Phase 4d flip).
//  Writes D.byYear directly into the normalised tables; the legacy
//  singleton's activities_json / pillar_weights_json are FROZEN
//  (never written again). activeSites / years_json / current_month
//  keep living in tracker_config — they have no year dimension
//  (ADR-001 §9.1).
// ══════════════════════════════════════════════════════════════════





// Closed months (2026-10-16): below super_admin, a past month keeps its STORED value
// (public/lib/trackerMonthLock.js — same rule as the Input tab). opts.lockClosed = true
// turns the guard on; opts.now overrides the clock (tests).
const _monthLock = require('./public/lib/trackerMonthLock');
function _parseMonths(row) {
  if (!row || row.months_json == null) return null;
  try { const a = JSON.parse(row.months_json); return Array.isArray(a) ? a : null; } catch (_) { return null; }
}
function _lockFor(opts) {
  if (!opts || !opts.lockClosed) return null;
  const now = opts.now || new Date();
  const c = _monthLock.cutoff(now);
  const lock = {
    blocked: 0,
    touches: (y) => Number(y) * 12 < c,           // the year holds at least one closed month
    apply: (y, months, stored) => {
      const r = _monthLock.mergeClosed(y, months, stored, now);
      lock.blocked += r.blocked;
      return r.months;
    },
  };
  return lock;
}

function saveTracker(D, userSite, opts = {}) {
  return _saveV2Pg(D, userSite, opts);
}

/**
 * Reset the tracker database to INIT defaults.
 * Executive/super_admin only — enforced by the route handler.
 */
function resetTracker() {
  throw new Error('resetTracker is not supported on the postgres backend (Chunk 1 scope).');
}

// Thin wrapper around the shared backup helper. Keeps the existing
// API surface (resetTracker / deleteTrackerYear call backupDatabase
// without arguments other than `reason`) while delegating the actual
// file-snapshot mechanics to db-backup.js so every module backs up
// consistently — same path convention, same VACUUM INTO mechanism.
function backupDatabase(reason) {
  // PostgreSQL is the only database (PO-08): there is no file to snapshot here. Backups
  // are the encrypted pg_dump of the `db.backup` job (services/sync/jobs.js) and the
  // restore points of _sdp_admin.cmd; this stays as a no-op so callers keep their shape.
  return null;
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
  return _previewDeleteTrackerYearPg(year);
}

function deleteTrackerYear(year) {
  return _deleteTrackerYearPg(year);
}


async function _setActivityMonthsPg(year, siteCode, activityName, months, opts = {}) {
  const h = pgHandle();
  const act = await h.prepare(`
    SELECT a.id FROM tracker_activities a JOIN tracker_pillars p ON p.id = a.pillar_id
    WHERE p.year = ? AND lower(a.name) = lower(?) ORDER BY a.display_order, a.id LIMIT 1`
  ).get(year, activityName);
  if (!act) return { ok: false, reason: 'activity-not-found', activityName, year };
  const lock = _lockFor(opts);
  if (lock && lock.touches(year)) months = lock.apply(year, months, _parseMonths(
    await h.prepare('SELECT months_json FROM tracker_inputs_v2 WHERE year = ? AND site = ? AND activity_id = ?').get(year, siteCode, act.id)));
  await h.prepare(`
    INSERT INTO tracker_inputs_v2 (year, site, activity_id, months_json) VALUES (?, ?, ?, ?)
    ON CONFLICT (year, site, activity_id) DO UPDATE SET months_json=EXCLUDED.months_json, updated_at=now()`
  ).run(year, siteCode, act.id, JSON.stringify(months));
  return { ok: true, activity_id: act.id, year, site: siteCode, months, blocked: lock ? lock.blocked : 0 };
}
function setActivityMonthsByName(year, siteCode, activityName, months, opts = {}) {
  return (_setActivityMonthsPg(year, siteCode, activityName, months, opts));
}

module.exports = { loadTracker, saveTracker, resetTracker, deleteTrackerYear, previewDeleteTrackerYear, backupDatabase, siteNameToCode, hardSiteNameToCode, siteToCode, getActivityCode, setActivityMonthsByName, getDB, TRACKER_BACKEND, initPgTracker, pgHandle };
