/**
 * inspection-db.js — SQLite persistence layer for the IT Inspection module
 *
 * Tables (all prefixed insp_*, isolated in ./inspection.db so the file is
 * additive to the existing dashboard data — no migrations touch tracker.db
 * or reports.db).
 *
 *   insp_sites        — seeded lookup: form site codes (SGO/HGO/MGO/...)
 *   insp_areas        — seeded lookup: physical areas grouped by family
 *   insp_types        — seeded lookup: inspection types (Routine, Audit, ...)
 *   insp_inspections  — header + full state_json blob (round-trip safe)
 *   insp_findings     — per-checklist-item rows, denormalised item text
 *   insp_actions      — corrective actions linked to inspections
 *   insp_photos       — base64 photo blobs (TEXT) keyed by inspection
 *   insp_signatures   — inspector + site rep signatures
 *
 * Exports:
 *   loadLookups()                   → { sites, areas, types, statuses, categories, priorityMap, siteAliases }
 *   listInspections({ site,from,to,risk,status,limit,offset })  → array of header rows
 *   getInspection(id)               → full record (header + findings + actions + photos + sigs)
 *   saveInspection(state, userSiteCode)  → upsert; throws on cross-site write
 *   deleteInspection(id)            → cascading delete
 *   aggregate({ site,from,to })     → roll-up: counts by status, top findings
 *   resetLookups()                  → wipe + re-seed lookup tables only
 *   siteNameToCode(siteName)        → form code ('MANA' → 'MGO')
 *   parseSiteCode(formValue)        → extract code from dropdown text
 *
 * Site code authority: the inspection module owns its own code table (form
 * codes from IT_Inspection_SDP.html). siteAliases maps to the Activity
 * Tracker codes for cross-module queries.
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const INIT = require('./inspection-init.json');
const blobStore = require('./services/blobStore');
const BLOB_MODULE = 'inspection';

// ── DB path resolution + auto-migration from legacy root location ──────────
// Historical: inspection.db lived at __dirname/inspection.db. Harmonised
// 2026-06-05 to __dirname/data/inspection.db (same pattern as reports.db).
// The block below auto-migrates if it finds the DB at the old location —
// idempotent + safe.
// SDP_DATA_DIR override lets tests point the module at a throwaway temp
// directory; unset in prod so the default data/ path is unchanged.
const DATA_DIR  = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, 'data');
const INSPECTION_DB_PATH = path.join(DATA_DIR, 'inspection.db');
function _ensureDbLocation() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacyPath = path.join(__dirname, 'inspection.db');
  if (fs.existsSync(legacyPath) && !fs.existsSync(INSPECTION_DB_PATH)) {
    try {
      fs.renameSync(legacyPath, INSPECTION_DB_PATH);
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(legacyPath + ext)) {
          try { fs.renameSync(legacyPath + ext, INSPECTION_DB_PATH + ext); } catch (e) { /* ignore */ }
        }
      }
      console.log('[Inspection-DB] Migrated inspection.db from root to data/ (one-time)');
    } catch (e) {
      console.error('[Inspection-DB] Could not migrate inspection.db to data/:', e.message);
    }
  }
}

// ── Site-name → inspection code map ─────────────────────────────────────────
// Mirrors the structure of tracker-db.js SITE_MAP. Names come from the
// `sites` table in reports.db (user.site_name). Anything not in this map
// resolves to null (= no scoped writes).
const SITE_MAP = {
  // Mines
  'MANA':'MGO',        'Mana IT Agent':'MGO',
  'HOUNDE':'HGO',      'Hounde IT Agents':'HGO',
  'LAFIGUE':'SML',     'Lafigue IT Agents':'SML',
  'ITY':'SMI',         'ITY IT Agents':'SMI',
  'Sabodala':'SGO',    'Sabodala IT Agents':'SGO',
  'KALANA':'KGO',      'Kalana IT Agents':'KGO',
  // Regional offices
  'ABIDJAN':'ABJ',     'Abidjan IT Agents':'ABJ',
  'Dakar':'DKR',       'Dakar IT Agents':'DKR',
  'OUAGA':'OUA',       'Ouaga IT Agents':'OUA',  'Ouagadougou-EDV1':'OUA',
};

// Normalised lookup table built once: every SITE_MAP key plus every
// `name_en` from inspection-init.json indexed by their accent-stripped,
// case-folded, suffix-stripped form. Lets `Hounde`, `HOUNDE`,
// `Houndé IT Agents`, `Hounde` all resolve to the same code.
const _NORM_SITE_MAP = (() => {
  const m = {};
  const add = (key, code) => { if (key && !m[key]) m[key] = code; };
  for (const [k, v] of Object.entries(SITE_MAP)) add(_normSite(k), v);
  for (const s of (INIT.sites || [])) {
    add(_normSite(s.name_en), s.code);
    add(_normSite(s.name_fr), s.code);
    add(_normSite(s.code),    s.code);
  }
  return m;
})();

function _normSite(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(it agent|it agents|office|support|bf|ci)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function siteNameToCode(siteName) {
  if (!siteName) return null;
  // Fast path — exact key match (preserves any case-specific quirks)
  if (SITE_MAP[siteName]) return SITE_MAP[siteName];
  // Slow path — normalised match
  return _NORM_SITE_MAP[_normSite(siteName)] || null;
}

// Extract the bracketed code from a form value like
// "Sabodala (SGO) — Senegal" → "SGO". Returns null if no bracket.
// Office options ("Dakar Office") have no bracket — match by prefix.
function parseSiteCode(formValue) {
  if (!formValue) return null;
  const m = String(formValue).match(/\(([A-Z]{2,4})\)/);
  if (m) return m[1];
  // Office fallbacks
  const s = String(formValue).toLowerCase();
  if (s.startsWith('dakar'))        return 'DKR';
  if (s.startsWith('abidjan'))      return 'ABJ';
  if (s.startsWith('ouagadougou'))  return 'OUA';
  if (s.startsWith('other'))        return 'OTH';
  return null;
}

// ── DB singleton ────────────────────────────────────────────────────────────
let _idb = null;

function getDB() {
  if (!_idb) {
    _ensureDbLocation();
    _idb = new Database(INSPECTION_DB_PATH);
    _idb.pragma('journal_mode = WAL');
    _idb.pragma('foreign_keys = ON');
    _initSchema(_idb);
  }
  return _idb;
}

// ── PostgreSQL backend selector + handle (Chunk 3) ──────────────────────────
// INSPECTION_BACKEND=postgres routes every DB function through an async pg
// fork; default 'sqlite' is a no-op (existing better-sqlite3 path unchanged).
// The blobStore (filesystem) + all pure-JS helpers are backend-agnostic and
// reused verbatim, so the save/load contract is byte-identical across backends.
const INSPECTION_BACKEND = (process.env.INSPECTION_BACKEND || 'sqlite').toLowerCase();
let _pg = null;

// Connect the pool once at boot, apply the schema, and seed lookups on first run.
async function initPgInspection() {
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('INSPECTION_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'inspection', '001_init.sql'), 'utf8'));
  await _seedLookupsPg(_pg);
  return _pg;
}
function pgHandle() {
  if (!_pg) throw new Error('inspection pgDb not initialised — await initPgInspection() at boot');
  return _pg;
}

// Seed lookups on a fresh pg DB. Idempotent — only fills empty tables, so a
// boot against an already-populated DB is a no-op (mirrors the sqlite seed-gate).
async function _seedLookupsPg(H) {
  const n = (await H.prepare('SELECT COUNT(*) AS n FROM insp_sites').get()).n;
  if (Number(n) === 0) {
    await H.runTransaction(async () => {
      for (const s of (INIT.sites || [])) {
        await H.prepare(`INSERT INTO insp_sites (code, name_en, name_fr, country, site_type, display_order, active)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`)
          .run(s.code, s.name_en, s.name_fr || s.name_en, s.country || '', s.site_type || 'mine',
               s.display_order || 0, s.active === 0 ? 0 : 1);
      }
      for (const a of (INIT.areas || [])) {
        await H.prepare(`INSERT INTO insp_areas (code, name_en, name_fr, area_group, display_order, active)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`)
          .run(a.code, a.name_en, a.name_fr || a.name_en, a.area_group || '', a.display_order || 0,
               a.active === 0 ? 0 : 1);
      }
      for (const t of (INIT.types || [])) {
        await H.prepare(`INSERT INTO insp_types (code, label_en, label_fr, display_order)
          VALUES (?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`)
          .run(t.code, t.label_en, t.label_fr || t.label_en, t.display_order || 0);
      }
    });
  }
  const catN = (await H.prepare('SELECT COUNT(*) AS n FROM insp_categories').get()).n;
  if (Number(catN) === 0 && Array.isArray(INIT.categories)) {
    await H.runTransaction(async () => {
      let i = 0;
      for (const c of INIT.categories) {
        await H.prepare(`INSERT INTO insp_categories (code, name_en, name_fr, icon, display_order, active)
          VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT (code) DO NOTHING`)
          .run(c.id || c.code, c.name_en || c.id, c.name_fr || c.name_en || c.id,
               c.icon || null, c.display_order != null ? c.display_order : i);
        i++;
      }
    });
  }
}

// ── Schema creation & seeding ───────────────────────────────────────────────
function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS insp_sites (
      code           TEXT PRIMARY KEY,
      name_en        TEXT NOT NULL,
      name_fr        TEXT,
      country        TEXT,
      site_type      TEXT DEFAULT 'mine',
      display_order  INTEGER DEFAULT 0,
      active         INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS insp_areas (
      code           TEXT PRIMARY KEY,
      name_en        TEXT NOT NULL,
      name_fr        TEXT,
      area_group     TEXT,
      display_order  INTEGER DEFAULT 0,
      active         INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS insp_types (
      code           TEXT PRIMARY KEY,
      label_en       TEXT NOT NULL,
      label_fr       TEXT,
      display_order  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS insp_inspections (
      id                   TEXT PRIMARY KEY,
      label                TEXT,
      inspection_date      TEXT,
      inspection_time      TEXT,
      inspection_type      TEXT,
      site_code            TEXT,
      area_code            TEXT,
      area_text            TEXT,
      specific_location    TEXT,
      inspector_name       TEXT,
      inspector_role       TEXT,
      accompanied_by       TEXT,
      weather              TEXT,
      last_inspection_date TEXT,
      scope                TEXT,
      overall_risk         TEXT,
      operational_impact   TEXT,
      key_observations     TEXT,
      positive_findings    TEXT,
      distribution         TEXT,
      state_json           TEXT,
      status               TEXT DEFAULT 'draft',
      created_by           INTEGER,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now')),
      submitted_at         TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_insp_site_date
      ON insp_inspections(site_code, inspection_date);
    CREATE INDEX IF NOT EXISTS ix_insp_status
      ON insp_inspections(status);

    CREATE TABLE IF NOT EXISTS insp_findings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id   TEXT NOT NULL,
      category        TEXT NOT NULL,
      item_index      INTEGER NOT NULL,
      item_code       TEXT,
      item_text_en    TEXT,
      item_text_fr    TEXT,
      status          TEXT,
      notes           TEXT,
      UNIQUE(inspection_id, category, item_index),
      FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ix_insp_findings_status
      ON insp_findings(status);

    CREATE TABLE IF NOT EXISTS insp_actions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id   TEXT NOT NULL,
      ord             INTEGER NOT NULL DEFAULT 0,
      description     TEXT,
      linked_item     TEXT,
      priority        TEXT,
      owner           TEXT,
      due_date        TEXT,
      status          TEXT DEFAULT 'Open',
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      closed_at       TEXT,
      FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ix_insp_actions_inspection
      ON insp_actions(inspection_id);

    -- Audit trail for corrective-action status changes. Lets the Actions
    -- Register close/track an action from a flat list (who/when/comment),
    -- independent of the parent inspection's lifecycle (a corrective action
    -- routinely outlives a submitted/closed inspection).
    CREATE TABLE IF NOT EXISTS insp_action_updates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id     INTEGER NOT NULL,
      author_id     INTEGER, author_name TEXT,
      body          TEXT,
      status_change TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (action_id) REFERENCES insp_actions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ix_insp_action_updates_action
      ON insp_action_updates(action_id);

    CREATE TABLE IF NOT EXISTS insp_photos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id   TEXT NOT NULL,
      finding_key     TEXT,
      action_id       INTEGER,
      caption         TEXT,
      mime_type       TEXT DEFAULT 'image/jpeg',
      data_b64        TEXT,
      file_ref        TEXT,
      size_bytes      INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ix_insp_photos_inspection
      ON insp_photos(inspection_id);

    CREATE TABLE IF NOT EXISTS insp_signatures (
      inspection_id   TEXT NOT NULL,
      signer_type     TEXT NOT NULL,
      signer_name     TEXT,
      signer_date     TEXT,
      signature_b64   TEXT,
      file_ref        TEXT,
      signed_at       TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (inspection_id, signer_type),
      FOREIGN KEY (inspection_id) REFERENCES insp_inspections(id) ON DELETE CASCADE
    );

    -- ── PALIER 1 — Canonical category catalogue (additive, 2026-06-05) ──
    -- Until 2026-06-05 the 17 inspection categories existed only in
    -- inspection-init.json AND in an inline 'const CATEGORIES' in
    -- inspection.html (documented as a footgun in CLAUDE.md). This
    -- table makes the catalogue queryable from SQL. NO foreign key is
    -- added to insp_findings.category for compatibility — that table
    -- continues to accept any string. Future features can JOIN against
    -- this catalogue when they need the canonical EN/FR labels.
    CREATE TABLE IF NOT EXISTS insp_categories (
      code          TEXT PRIMARY KEY,
      name_en       TEXT NOT NULL,
      name_fr       TEXT,
      icon          TEXT,
      display_order INTEGER DEFAULT 0,
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // Idempotent ALTERs — add file_ref to existing DBs (blobs-on-filesystem).
  // SQLite has no "ADD COLUMN IF NOT EXISTS"; probe table_info first.
  const _hasCol = (table, col) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  if (!_hasCol('insp_photos', 'file_ref'))
    db.exec('ALTER TABLE insp_photos ADD COLUMN file_ref TEXT');
  if (!_hasCol('insp_signatures', 'file_ref'))
    db.exec('ALTER TABLE insp_signatures ADD COLUMN file_ref TEXT');

  // Seed lookup tables on first run only
  const n = db.prepare('SELECT COUNT(*) AS n FROM insp_sites').get().n;
  if (n === 0) {
    console.log('[inspection-db] First run — seeding lookup tables…');
    _seedLookups(db);
    console.log('[inspection-db] ✅ Lookups seeded');
  }

  // ── PALIER 1 — Seed insp_categories independently ─────────────────
  // Seeded separately because v1 DBs may already have insp_sites
  // populated (so the seed-gate above won't fire). Idempotent: skips
  // rows that already exist.
  try {
    const catCount = db.prepare('SELECT COUNT(*) AS n FROM insp_categories').get().n;
    if (catCount === 0 && Array.isArray(INIT.categories)) {
      const insCat = db.prepare(
        `INSERT OR IGNORE INTO insp_categories (code, name_en, name_fr, icon, display_order, active)
         VALUES (?, ?, ?, ?, ?, 1)`
      );
      const seed = db.transaction(() => {
        INIT.categories.forEach((c, i) => insCat.run(
          c.id || c.code,
          c.name_en || c.id,
          c.name_fr || c.name_en || c.id,
          c.icon || null,
          c.display_order != null ? c.display_order : i
        ));
      });
      seed();
      console.log(`[inspection-db] ✅ Seeded ${INIT.categories.length} insp_categories (Palier 1)`);
    }
  } catch (e) {
    console.error('[inspection-db] insp_categories seed failed:', e.message);
  }
}

function _seedLookups(db) {
  const insSite = db.prepare(`
    INSERT OR REPLACE INTO insp_sites
      (code, name_en, name_fr, country, site_type, display_order, active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insArea = db.prepare(`
    INSERT OR REPLACE INTO insp_areas
      (code, name_en, name_fr, area_group, display_order, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insType = db.prepare(`
    INSERT OR REPLACE INTO insp_types
      (code, label_en, label_fr, display_order)
    VALUES (?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    (INIT.sites || []).forEach(s => insSite.run(
      s.code, s.name_en, s.name_fr || s.name_en,
      s.country || '', s.site_type || 'mine',
      s.display_order || 0, s.active === 0 ? 0 : 1
    ));
    (INIT.areas || []).forEach(a => insArea.run(
      a.code, a.name_en, a.name_fr || a.name_en,
      a.area_group || '', a.display_order || 0,
      a.active === 0 ? 0 : 1
    ));
    (INIT.types || []).forEach(t => insType.run(
      t.code, t.label_en, t.label_fr || t.label_en, t.display_order || 0
    ));
  });
  seed();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * One call hydrates the entire form: sites + areas + types + categories.
 *
 * The site list is sourced from the canonical `sites` table in reports.db
 * (the same table that auth/RBAC and the rest of the dashboard use), enriched
 * with the form-only metadata (FR name, country, site_type) from
 * inspection-init.json by code match. Sites only known to the inspection
 * module — currently just "Other / Autre" — are appended at the end.
 *
 * Falls back to the static `insp_sites` table if reports-db isn't loadable
 * (which would only happen in isolated unit tests).
 */
function loadLookups() {
  if (INSPECTION_BACKEND === 'postgres') return _loadLookupsPg();
  const db = getDB();

  // ── Canonical site list from reports.db, merged with form metadata ──
  let sites;
  try {
    const rdb = require('./reports-db.js');
    const canonical = rdb.listSites() || [];
    if (canonical.length) {
      const metaByCode = {};
      (INIT.sites || []).forEach(s => { metaByCode[s.code] = s; });

      sites = canonical.map(cs => {
        const code = siteNameToCode(cs.name) || cs.name; // fall back to raw name if unmapped
        const meta = metaByCode[code] || {};
        return {
          id:            cs.id,
          code,
          name_en:       meta.name_en || cs.name,
          name_fr:       meta.name_fr || cs.name,
          country:       meta.country || '',
          site_type:     meta.site_type || (meta.country ? 'mine' : ''),
          display_order: meta.display_order || cs.sort_order || 99,
          zoho_group:    cs.zoho_group || null,
          source:        'reports-db',
          active:        cs.active === 0 ? 0 : 1,
        };
      });

      // Append inspection-only sites (e.g. "Other") that don't appear in reports.db
      const seenCodes = new Set(sites.map(s => s.code));
      (INIT.sites || []).forEach(s => {
        if (!seenCodes.has(s.code) && s.site_type === 'other') {
          sites.push({ ...s, source: 'init', active: 1 });
        }
      });

      sites.sort((a, b) => (a.display_order || 99) - (b.display_order || 99));
    }
  } catch(e) {
    // reports-db not available — fall through to the static seed
  }

  if (!sites) {
    sites = db.prepare(`
      SELECT code, name_en, name_fr, country, site_type, display_order
        FROM insp_sites WHERE active = 1 ORDER BY display_order, name_en
    `).all().map(s => ({ ...s, source: 'init' }));
  }

  const areas = db.prepare(`
    SELECT code, name_en, name_fr, area_group, display_order
      FROM insp_areas WHERE active = 1 ORDER BY display_order, name_en
  `).all();
  const types = db.prepare(`
    SELECT code, label_en, label_fr FROM insp_types ORDER BY display_order
  `).all();

  return {
    sites,
    areas,
    types,
    statuses:     INIT.statuses    || [],
    categories:   INIT.categories  || [],
    priorityMap:  INIT.priorityMap || {},
    siteAliases:  INIT.siteAliases || {}
  };
}

/**
 * Suggested people for the inspector / accompanied-by fields. Pulls active
 * users from reports.db and projects only the columns the form needs.
 * Returns [] if reports-db is unavailable so the form silently falls back
 * to plain free-text.
 *
 * @param {object} opts
 * @param {string|null} opts.site_code  — if set, surface that site's users
 *                                        first (the rest are still returned
 *                                        below them for cross-site visits)
 */
// async because rdb.listUsers is a Promise under REPORTS_BACKEND=postgres
// (await is a no-op on the sqlite path). Callers (the /people routes) await it.
async function listPeople(opts = {}) {
  try {
    const rdb   = require('./reports-db.js');
    const users = (await rdb.listUsers() || []).filter(u => u.active && u.full_name);

    // Roles that plausibly perform or witness an inspection.
    const allowed = new Set([
      'super_admin', 'executive', 'admin', 'editor', 'viewer',
      'tracker-admin', 'tracker-editor', 'report-author',
    ]);
    const fits = users.filter(u =>
      (u.role && allowed.has(u.role)) ||
      (Array.isArray(u.roles) && u.roles.some(r => allowed.has(r)))
    );

    // Order: requested site first (mine site members), then alphabetic by name
    const wantedCode = opts.site_code || null;
    return fits
      .map(u => ({
        id:         u.id,
        full_name:  u.full_name,
        role:       u.role || (Array.isArray(u.roles) ? u.roles[0] : ''),
        site_name:  u.site_name || '',
        site_code:  siteNameToCode(u.site_name) || null,
      }))
      .sort((a, b) => {
        const aHere = wantedCode && a.site_code === wantedCode ? 0 : 1;
        const bHere = wantedCode && b.site_code === wantedCode ? 0 : 1;
        if (aHere !== bHere) return aHere - bHere;
        return a.full_name.localeCompare(b.full_name);
      });
  } catch(e) {
    return [];
  }
}

/** Paginated header list. Filters all optional. */
function listInspections(opts = {}) {
  if (INSPECTION_BACKEND === 'postgres') return _listInspectionsPg(opts);
  const db = getDB();
  const where  = [];
  const params = {};
  if (opts.site)   { where.push('site_code = @site');                     params.site   = opts.site; }
  if (opts.from)   { where.push('inspection_date >= @from');              params.from   = opts.from; }
  if (opts.to)     { where.push('inspection_date <= @to');                params.to     = opts.to; }
  if (opts.risk)   { where.push("overall_risk LIKE '%' || @risk || '%'"); params.risk   = opts.risk; }
  if (opts.status) { where.push('status = @status');                      params.status = opts.status; }

  const sql = `
    SELECT id, label, inspection_date, inspection_time, inspection_type,
           site_code, area_code, area_text, specific_location,
           inspector_name, overall_risk, operational_impact,
           status, created_at, updated_at, submitted_at
      FROM insp_inspections
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY inspection_date DESC, updated_at DESC
      LIMIT @limit OFFSET @offset
  `;
  params.limit  = opts.limit  || 200;
  params.offset = opts.offset || 0;
  return db.prepare(sql).all(params);
}

/** Full record including findings / actions / photos / signatures. */
// Re-inflate filesystem-backed blobs in a state blob so callers see the same
// shape they always did (photos[].dataUrl, signatures.sig_*). Dual-read:
// blobs externalized to the filesystem carry an `__blob` ref; legacy rows keep
// their inline dataUrl strings and pass through untouched.
function _inflateState(state) {
  if (!state || typeof state !== 'object') return state;
  for (const val of Object.values(state.items || {})) {
    if (!val || !Array.isArray(val.photos)) continue;
    val.photos = val.photos.map(p => {
      if (p && typeof p === 'object' && p.__blob) {
        const dataUrl = blobStore.getDataUrl(p.__blob, p.mime);
        const out = { ...p, dataUrl: dataUrl || '' };
        delete out.__blob;
        return out;
      }
      return p;
    });
  }
  const sig = state.signatures || {};
  for (const k of ['sig_inspector', 'sig_site']) {
    const v = sig[k];
    if (v && typeof v === 'object' && v.__blob) {
      sig[k] = blobStore.getDataUrl(v.__blob, v.mime) || '';
    }
  }
  return state;
}

function getInspection(id) {
  if (INSPECTION_BACKEND === 'postgres') return _getInspectionPg(id);
  const db = getDB();
  const header = db.prepare('SELECT * FROM insp_inspections WHERE id = ?').get(id);
  if (!header) return null;

  // Round-trip safe — return the state blob alongside denormalised fields.
  let stateBlob = null;
  try { stateBlob = header.state_json ? JSON.parse(header.state_json) : null; }
  catch(e) { console.warn('[inspection-db] state_json parse failed for', id, e.message); }
  stateBlob = _inflateState(stateBlob);

  const findings = db.prepare(`
    SELECT category, item_index, item_code, item_text_en, item_text_fr, status, notes
      FROM insp_findings WHERE inspection_id = ?
      ORDER BY category, item_index
  `).all(id);

  const actions = db.prepare(`
    SELECT id, ord, description, linked_item, priority, owner, due_date,
           status, notes, created_at, updated_at, closed_at
      FROM insp_actions WHERE inspection_id = ?
      ORDER BY ord, id
  `).all(id);

  const photos = db.prepare(`
    SELECT id, finding_key, action_id, caption, mime_type, data_b64, file_ref, size_bytes
      FROM insp_photos WHERE inspection_id = ?
      ORDER BY id
  `).all(id).map(p => {
    // Dual-read: prefer the filesystem blob, fall back to legacy inline b64.
    if (p.file_ref) p.data_b64 = blobStore.getB64(p.file_ref) || p.data_b64 || '';
    delete p.file_ref;
    return p;
  });

  const signatures = db.prepare(`
    SELECT signer_type, signer_name, signer_date, signature_b64, file_ref, signed_at
      FROM insp_signatures WHERE inspection_id = ?
  `).all(id).map(s => {
    if (s.file_ref) s.signature_b64 = blobStore.getB64(s.file_ref) || s.signature_b64 || '';
    delete s.file_ref;
    return s;
  });

  return { header, findings, actions, photos, signatures, state: stateBlob };
}

// Move inline base64 photo/signature payloads out of `state` onto the
// filesystem (blobStore), mutating `state` in place so the stored state_json
// carries lightweight `__blob` refs instead of multi-MB data: URLs. Idempotent
// — entries already carrying `__blob` are left alone. Called BEFORE the save
// transaction so state_json is stringified in its stripped form.
function _externalizeBlobs(state, id) {
  for (const [key, val] of Object.entries(state.items || {})) {
    if (!val || !Array.isArray(val.photos)) continue;
    val.photos = val.photos.map((raw, i) => {
      if (!raw) return raw;
      const p = (typeof raw === 'string') ? { dataUrl: raw } : raw;
      if (p.__blob) return p;                       // already externalized
      if (!p.dataUrl || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:')) return p;
      const { mime, b64 } = blobStore._splitDataUrl(p.dataUrl);
      const { ref, size } = blobStore.putB64(BLOB_MODULE, id, `${key}-${i}`, mime, b64);
      const out = { ...p, __blob: ref, mime, sizeBytes: size };
      delete out.dataUrl;
      return out;
    });
  }
  const sig = state.signatures || {};
  for (const [k, name] of [['sig_inspector', 'sig-inspector'], ['sig_site', 'sig-site']]) {
    const v = sig[k];
    if (!v) continue;
    if (typeof v === 'object' && v.__blob) continue;       // already externalized
    if (typeof v !== 'string' || !v.startsWith('data:')) continue;
    const { mime, b64 } = blobStore._splitDataUrl(v);
    const { ref } = blobStore.putB64(BLOB_MODULE, id, name, mime, b64);
    sig[k] = { __blob: ref, mime };
  }
}

/**
 * Upsert an inspection from the frontend `state` shape.
 *
 * @param {object} state              { meta, items, actions, signatures }
 * @param {string|null} userSiteCode  if set, write only allowed when
 *                                    state.meta.f_site resolves to the same code
 * @param {number|null} createdBy     user id for audit (optional)
 * @returns {{id:string, created:boolean}}
 */
function saveInspection(state, userSiteCode, createdBy) {
  if (INSPECTION_BACKEND === 'postgres') return _saveInspectionPg(state, userSiteCode, createdBy);
  if (!state || !state.meta) throw new Error('Missing state.meta');
  const db   = getDB();
  const meta = state.meta;
  const id   = meta.f_id || _genId();

  const siteCode = parseSiteCode(meta.f_site);
  if (userSiteCode && siteCode && siteCode !== userSiteCode) {
    throw new Error(`Cross-site save blocked: user is scoped to ${userSiteCode}, inspection is for ${siteCode}`);
  }

  // Externalize photo/signature blobs to the filesystem (mutates `state` so
  // state_json below stores refs, not multi-MB data: URLs). Done outside the
  // tx — FS writes are not transactional; orphaned files (if the tx later
  // fails, or a photo is removed on a re-save) are harmless and cleaned on
  // deleteInspection.
  _externalizeBlobs(state, id);

  // Area: store both the structured code (if we can resolve it) and the
  // free text — early adopters will paste in "Other" / custom strings.
  const areaText = meta.f_area || '';
  const areaCode = _resolveAreaCode(db, areaText);

  // Find existing row for upsert decision
  const existing = db.prepare('SELECT id FROM insp_inspections WHERE id = ?').get(id);

  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(`
        UPDATE insp_inspections SET
          label = @label,
          inspection_date = @date,
          inspection_time = @time,
          inspection_type = @type,
          site_code = @siteCode,
          area_code = @areaCode,
          area_text = @areaText,
          specific_location = @loc,
          inspector_name = @inspector,
          inspector_role = @role,
          accompanied_by = @witness,
          weather = @weather,
          last_inspection_date = @lastdate,
          scope = @scope,
          overall_risk = @risk,
          operational_impact = @impact,
          key_observations = @obs,
          positive_findings = @pos,
          distribution = @dist,
          state_json = @stateJson,
          status = @status,
          updated_at = datetime('now'),
          submitted_at = CASE WHEN @status = 'submitted' AND submitted_at IS NULL
                              THEN datetime('now') ELSE submitted_at END
        WHERE id = @id
      `).run(_headerParams(id, meta, siteCode, areaCode, areaText, state));
    } else {
      db.prepare(`
        INSERT INTO insp_inspections
          (id, label, inspection_date, inspection_time, inspection_type,
           site_code, area_code, area_text, specific_location,
           inspector_name, inspector_role, accompanied_by,
           weather, last_inspection_date, scope,
           overall_risk, operational_impact,
           key_observations, positive_findings, distribution,
           state_json, status, created_by,
           submitted_at)
        VALUES
          (@id, @label, @date, @time, @type,
           @siteCode, @areaCode, @areaText, @loc,
           @inspector, @role, @witness,
           @weather, @lastdate, @scope,
           @risk, @impact,
           @obs, @pos, @dist,
           @stateJson, @status, @createdBy,
           CASE WHEN @status = 'submitted' THEN datetime('now') ELSE NULL END)
      `).run({ ..._headerParams(id, meta, siteCode, areaCode, areaText, state), createdBy: createdBy || null });
    }

    // Findings — wipe + re-insert per save (small payload, atomic via tx)
    db.prepare('DELETE FROM insp_findings WHERE inspection_id = ?').run(id);
    const insFind = db.prepare(`
      INSERT INTO insp_findings
        (inspection_id, category, item_index, item_code, item_text_en, item_text_fr, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [key, val] of Object.entries(state.items || {})) {
      if (!val) continue;
      const [cat, ixStr] = String(key).split('__');
      const ix = parseInt(ixStr, 10);
      if (isNaN(ix)) continue;
      const itemDef  = _findItemDef(cat, ix);
      const itemCode = `${cat.toUpperCase()}-${String(ix + 1).padStart(2, '0')}`;
      insFind.run(
        id, cat, ix, itemCode,
        itemDef ? itemDef.l  : null,
        itemDef ? itemDef.fr : null,
        val.status || null,
        val.notes  || null
      );
    }

    // Actions — wipe + re-insert
    db.prepare('DELETE FROM insp_actions WHERE inspection_id = ?').run(id);
    const insAct = db.prepare(`
      INSERT INTO insp_actions
        (inspection_id, ord, description, linked_item, priority, owner, due_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    (state.actions || []).forEach((a, ix) => {
      insAct.run(
        id, ix,
        a.desc || a.description || '',
        a.link || a.linked_item || '',
        a.priority || 'Medium',
        a.owner    || '',
        a.due      || a.due_date || null,
        a.status   || 'Open',
        a.notes    || ''
      );
    });

    // Photos — wipe + re-insert. The browser may send each photo as
    // either:
    //   • a raw dataUrl string  (legacy shape from the original PWA)
    //   • { dataUrl, caption, ts, gps, w, h, sizeKB }  (current shape)
    // Normalise so the DB always sees the latter.
    // _externalizeBlobs (above, pre-tx) has already moved every photo to the
    // filesystem and set p.__blob; we store the file_ref (data_b64 stays NULL).
    // The dataUrl branch is a defensive fallback for any photo that slipped
    // through un-externalized.
    db.prepare('DELETE FROM insp_photos WHERE inspection_id = ?').run(id);
    const insPhoto = db.prepare(`
      INSERT INTO insp_photos
        (inspection_id, finding_key, caption, mime_type, data_b64, file_ref, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [key, val] of Object.entries(state.items || {})) {
      if (!val || !Array.isArray(val.photos)) continue;
      for (const raw of val.photos) {
        if (!raw) continue;
        const p = (typeof raw === 'string') ? { dataUrl: raw, caption: '' } : raw;
        if (p.__blob) {
          insPhoto.run(id, key, p.caption || '', p.mime || 'image/jpeg', null, p.__blob, p.sizeBytes || null);
        } else if (p.dataUrl) {
          const { mime, b64 } = _splitDataUrl(p.dataUrl);
          insPhoto.run(id, key, p.caption || '', mime, b64, null, b64.length);
        }
      }
    }

    // Signatures — replace both rows
    db.prepare('DELETE FROM insp_signatures WHERE inspection_id = ?').run(id);
    const insSig = db.prepare(`
      INSERT INTO insp_signatures
        (inspection_id, signer_type, signer_name, signer_date, signature_b64, file_ref)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const _runSig = (type, name, date, v) => {
      if (v && typeof v === 'object' && v.__blob) insSig.run(id, type, name, date, null, v.__blob);
      else { const { b64 } = _splitDataUrl(v); insSig.run(id, type, name, date, b64, null); }
    };
    const sigInsp = state.signatures && state.signatures.sig_inspector;
    if (sigInsp) _runSig('inspector', meta.sign_insp_name || meta.f_inspector || '', meta.sign_insp_date || null, sigInsp);
    const sigSite = state.signatures && state.signatures.sig_site;
    if (sigSite) _runSig('site', meta.sign_site_name || '', meta.sign_site_date || null, sigSite);
  });
  tx();

  return { id, created: !existing };
}

function deleteInspection(id) {
  if (INSPECTION_BACKEND === 'postgres') return _deleteInspectionPg(id);
  const db = getDB();
  // Snapshot the DB BEFORE the destructive write. Photos + signatures
  // for an inspection can be 10-30 MB inline; a full DB copy is the
  // simplest restore mechanism if the deletion turns out to be a
  // mistake. If the backup throws, the delete never runs.
  // Backup path is in pm2 logs ([Backup] inspection -> …); we keep
  // the API returning a boolean for compatibility with existing
  // route handlers.
  _backup(db, 'pre-delete-' + String(id || 'unknown').slice(0, 30));
  const info = db.prepare('DELETE FROM insp_inspections WHERE id = ?').run(id);
  if (info.changes > 0) {
    // Remove the filesystem blobs for this inspection (photos + signatures).
    try { blobStore.removeOwner(BLOB_MODULE, id); } catch (_) {}
  }
  return info.changes > 0;
}

// Shared backup wrapper — delegates to db-backup.js so every module
// produces backups with the same filename convention. Used by every
// destructive operation in this file (deleteInspection, resetLookups).
function _backup(db, reason) {
  const { backupDatabase } = require('./db-backup.js');
  return backupDatabase(db, 'inspection', reason);
}

// Returns the current status of an inspection row, or null if no such row.
// Used by the route handler to enforce submission-lock RBAC: an editor
// cannot modify a submitted/closed record; only admin+ can.
function getInspectionStatus(id) {
  if (!id) return null;
  if (INSPECTION_BACKEND === 'postgres') return _getInspectionStatusPg(id);
  const db  = getDB();
  const row = db.prepare('SELECT status FROM insp_inspections WHERE id = ?').get(id);
  return row ? (row.status || 'draft') : null;
}

/** Roll-up counts for the list page KPI tiles + simple time-series. */
function aggregate(opts = {}) {
  if (INSPECTION_BACKEND === 'postgres') return _aggregatePg(opts);
  const db = getDB();
  const where  = [];
  const params = {};
  if (opts.site) { where.push('i.site_code = @site'); params.site = opts.site; }
  if (opts.from) { where.push('i.inspection_date >= @from'); params.from = opts.from; }
  if (opts.to)   { where.push('i.inspection_date <= @to');   params.to   = opts.to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN overall_risk LIKE '%Critical%' THEN 1 ELSE 0 END) AS critical_count,
           SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) AS draft_count,
           SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
           SUM(CASE WHEN status = 'closed'    THEN 1 ELSE 0 END) AS closed_count,
           COUNT(DISTINCT site_code) AS sites_covered
      FROM insp_inspections i ${w}
  `).get(params);

  const findingStatus = db.prepare(`
    SELECT f.status, COUNT(*) AS n
      FROM insp_findings f
      JOIN insp_inspections i ON i.id = f.inspection_id
      ${w}
      GROUP BY f.status
  `).all(params);

  const actionsOpen = db.prepare(`
    SELECT COUNT(*) AS n
      FROM insp_actions a
      JOIN insp_inspections i ON i.id = a.inspection_id
      ${w} ${w ? 'AND' : 'WHERE'} a.status != 'Closed' AND a.status != 'Cancelled'
  `).get(params);

  const overdue = db.prepare(`
    SELECT COUNT(*) AS n
      FROM insp_actions a
      JOIN insp_inspections i ON i.id = a.inspection_id
      ${w} ${w ? 'AND' : 'WHERE'} a.due_date IS NOT NULL
            AND a.due_date < date('now')
            AND a.status != 'Closed' AND a.status != 'Cancelled'
  `).get(params);

  const monthly = db.prepare(`
    SELECT substr(inspection_date, 1, 7) AS ym, COUNT(*) AS n
      FROM insp_inspections i ${w}
      GROUP BY ym ORDER BY ym
  `).all(params);

  return {
    counts,
    findingStatus,
    open_actions:    actionsOpen ? actionsOpen.n : 0,
    overdue_actions: overdue     ? overdue.n     : 0,
    monthly
  };
}

/**
 * Append an audit update to one corrective action + optionally change its
 * status. Terminal statuses (Closed / Cancelled) stamp closed_at. Does NOT
 * care about the parent inspection's status — actions outlive a submitted/
 * closed inspection, and the register must be able to close a stale one.
 * (Site-scoping for editors is enforced at the route layer.)
 */
function addActionUpdate(actionId, opts = {}) {
  if (INSPECTION_BACKEND === 'postgres') return _addActionUpdatePg(actionId, opts);
  const db = getDB();
  const action = db.prepare('SELECT id, status FROM insp_actions WHERE id = ?').get(actionId);
  if (!action) throw new Error('Action not found');
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO insp_action_updates (action_id, author_id, author_name, body, status_change)
      VALUES (?, ?, ?, ?, ?)
    `).run(actionId, opts.author_id || null, opts.author_name || null, opts.body || null,
      opts.status_change || null);
    if (opts.status_change && opts.status_change !== action.status) {
      const terminal = (opts.status_change === 'Closed' || opts.status_change === 'Cancelled');
      db.prepare(`
        UPDATE insp_actions
          SET status = ?, closed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE closed_at END,
              updated_at = datetime('now')
        WHERE id = ?
      `).run(opts.status_change, terminal ? 1 : 0, actionId);
    }
  });
  tx();
}

/** Audit thread for one action (newest first). */
function listActionUpdates(actionId) {
  if (INSPECTION_BACKEND === 'postgres')
    return pgHandle().prepare('SELECT * FROM insp_action_updates WHERE action_id = ? ORDER BY id DESC').all(actionId);
  return getDB().prepare(
    'SELECT * FROM insp_action_updates WHERE action_id = ? ORDER BY id DESC'
  ).all(actionId);
}

/** Parent inspection's site + status for one action (route-layer site scoping). */
function getActionParent(actionId) {
  if (INSPECTION_BACKEND === 'postgres') return _getActionParentPg(actionId);
  return getDB().prepare(`
    SELECT i.site_code AS site_code, i.status AS inspection_status
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
     WHERE a.id = ?
  `).get(actionId) || null;
}
async function _getActionParentPg(actionId) {
  return (await pgHandle().prepare(`
    SELECT i.site_code AS site_code, i.status AS inspection_status
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
     WHERE a.id = ?
  `).get(actionId)) || null;
}

/**
 * Flat list of corrective actions across all inspections — drives the
 * Inspection Actions Register. Filters: site, status, owner, priority,
 * overdue, q. Joins the parent inspection for label / site / date / status.
 */
function listActions(opts = {}) {
  if (INSPECTION_BACKEND === 'postgres') return _listActionsPg(opts);
  const db = getDB();
  const where = [];
  const params = {};
  if (opts.site)     { where.push('i.site_code = @site COLLATE NOCASE'); params.site = opts.site; }
  if (opts.status)   { where.push('a.status = @status');                 params.status = opts.status; }
  if (opts.priority) { where.push('a.priority = @priority');             params.priority = opts.priority; }
  if (opts.owner)    { where.push('a.owner LIKE @owner');                params.owner = '%' + opts.owner + '%'; }
  if (opts.overdue) {
    where.push("a.due_date IS NOT NULL AND a.due_date < date('now') AND a.status != 'Closed' AND a.status != 'Cancelled'");
  }
  if (opts.from)     { where.push('i.inspection_date >= @from'); params.from = opts.from; }
  if (opts.to)       { where.push('i.inspection_date <= @to');   params.to = opts.to; }
  if (opts.q) {
    where.push('(a.description LIKE @q OR a.owner LIKE @q OR a.linked_item LIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT
      a.*,
      i.label            AS inspection_label,
      i.site_code        AS site_code,
      i.area_code        AS area_code,
      i.inspection_date  AS inspection_date,
      i.status           AS inspection_status
    FROM insp_actions a
    JOIN insp_inspections i ON i.id = a.inspection_id
    ${w}
    ORDER BY
      CASE WHEN a.status IN ('Closed','Cancelled') THEN 1 ELSE 0 END,
      CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END,
      a.due_date ASC,
      i.inspection_date DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = opts.limit || 1000;
  params.offset = opts.offset || 0;
  return db.prepare(sql).all(params);
}

/**
 * Full-table export for the "Download Excel" feature — every inspection,
 * every finding, every corrective action across ALL inspections (no filter,
 * no LIMIT). Excludes the state_json blob (photos/signatures live there and
 * would bloat the workbook). Backend-agnostic: `await handle.prepare(sql).all()`
 * resolves for both the sync sqlite handle and the async pg handle.
 */
async function exportRows() {
  const H = INSPECTION_BACKEND === 'postgres' ? pgHandle() : getDB();
  const inspections = await H.prepare(`
    SELECT id, label, inspection_date, inspection_time, inspection_type,
           site_code, area_code, area_text, specific_location,
           inspector_name, inspector_role, accompanied_by, weather,
           last_inspection_date, scope, overall_risk, operational_impact,
           key_observations, positive_findings, distribution,
           status, created_by, created_at, updated_at, submitted_at
      FROM insp_inspections
     ORDER BY inspection_date DESC, id`).all();
  const findings = await H.prepare(`
    SELECT f.inspection_id, i.label AS inspection_label, i.site_code,
           i.inspection_date, f.category, f.item_index, f.item_code,
           f.item_text_en, f.status, f.notes
      FROM insp_findings f JOIN insp_inspections i ON i.id = f.inspection_id
     ORDER BY i.inspection_date DESC, f.inspection_id, f.category, f.item_index`).all();
  const actions = await H.prepare(`
    SELECT a.id, a.inspection_id, i.label AS inspection_label, i.site_code,
           i.inspection_date, a.ord, a.description, a.linked_item, a.priority,
           a.owner, a.due_date, a.status, a.notes, a.created_at, a.closed_at
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
     ORDER BY CASE WHEN a.status IN ('Closed','Cancelled') THEN 1 ELSE 0 END, a.due_date, a.id`).all();
  return { inspections, findings, actions };
}

function resetLookups() {
  if (INSPECTION_BACKEND === 'postgres') return _resetLookupsPg();
  const db = getDB();
  // Backup BEFORE wiping the lookup tables. resetLookups doesn't
  // touch inspection rows themselves, but losing the site/area/type
  // lookups would break the form's dropdowns and the dashboard's
  // filters until the seed re-runs — a backup gives a quick rollback
  // if the seed file changed in an unexpected way. Backup path is
  // logged to pm2 — `findstr Backup` to find it.
  _backup(db, 'pre-reset-lookups');
  db.exec('DELETE FROM insp_sites; DELETE FROM insp_areas; DELETE FROM insp_types;');
  _seedLookups(db);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _genId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const r   = Math.floor(Math.random() * 9000 + 1000);
  return `EM-IT-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${r}`;
}

function _headerParams(id, meta, siteCode, areaCode, areaText, state) {
  return {
    id,
    label:     meta.f_label    || '',
    date:      meta.f_date     || null,
    time:      meta.f_time     || null,
    type:      meta.f_type     || 'Routine',
    siteCode:  siteCode        || null,
    areaCode:  areaCode        || null,
    areaText:  areaText        || '',
    loc:       meta.f_loc      || '',
    inspector: meta.f_inspector || '',
    role:      meta.f_role     || '',
    witness:   meta.f_witness  || '',
    weather:   meta.f_weather  || '',
    lastdate:  meta.f_lastdate || null,
    scope:     meta.f_scope    || '',
    risk:      meta.f_risk     || '',
    impact:    meta.f_impact   || '',
    obs:       meta.f_obs      || '',
    pos:       meta.f_pos      || '',
    dist:      meta.f_dist     || '',
    stateJson: JSON.stringify(state || {}),
    status:    state.status    || 'draft'
  };
}

function _resolveAreaCode(db, areaText) {
  if (!areaText) return null;
  // Exact match on English or French name, case-insensitive
  const row = db.prepare(`
    SELECT code FROM insp_areas
     WHERE LOWER(name_en) = LOWER(@t) OR LOWER(name_fr) = LOWER(@t)
     LIMIT 1
  `).get({ t: areaText });
  return row ? row.code : null;
}

function _findItemDef(catId, ix) {
  const cat = (INIT.categories || []).find(c => c.id === catId);
  if (!cat || !Array.isArray(cat.items)) return null;
  return cat.items[ix] || null;
}

function _splitDataUrl(dataUrl) {
  // Accept "data:image/jpeg;base64,XXXX" or a raw base64 string.
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: 'image/jpeg', b64: String(dataUrl) };
}

// ══════════════════════════════════════════════════════════════════════════
// PostgreSQL forks (INSPECTION_BACKEND=postgres). Pure-JS helpers
// (_inflateState, _externalizeBlobs, _headerParams, _findItemDef,
// _splitDataUrl, siteNameToCode, parseSiteCode) + blobStore (filesystem) are
// reused verbatim, so the save/load contract is byte-identical to sqlite.
// Dialect rewrites: datetime('now')->now() (TIMESTAMPTZ cols); date('now')->
// to_char(current_date,'YYYY-MM-DD') (lexical vs TEXT due_date); COLLATE NOCASE
// ->lower()=lower(); LIKE->ILIKE; closed_at CASE stamps to_char (TEXT col);
// db.transaction()() -> await runTransaction(async …).
// ══════════════════════════════════════════════════════════════════════════

async function _loadLookupsPg() {
  const H = pgHandle();
  let sites;
  try {
    const rdb = require('./reports-db.js');
    const canonical = (await rdb.listSites()) || [];   // await-safe for both sqlite (array) + future pg
    if (canonical.length) {
      const metaByCode = {};
      (INIT.sites || []).forEach(s => { metaByCode[s.code] = s; });
      sites = canonical.map(cs => {
        const code = siteNameToCode(cs.name) || cs.name;
        const meta = metaByCode[code] || {};
        return {
          id:            cs.id,
          code,
          name_en:       meta.name_en || cs.name,
          name_fr:       meta.name_fr || cs.name,
          country:       meta.country || '',
          site_type:     meta.site_type || (meta.country ? 'mine' : ''),
          display_order: meta.display_order || cs.sort_order || 99,
          zoho_group:    cs.zoho_group || null,
          source:        'reports-db',
          active:        cs.active === 0 ? 0 : 1,
        };
      });
      const seenCodes = new Set(sites.map(s => s.code));
      (INIT.sites || []).forEach(s => {
        if (!seenCodes.has(s.code) && s.site_type === 'other') sites.push({ ...s, source: 'init', active: 1 });
      });
      sites.sort((a, b) => (a.display_order || 99) - (b.display_order || 99));
    }
  } catch (e) { /* reports-db unavailable — fall through to seed */ }

  if (!sites) {
    sites = (await H.prepare(`SELECT code, name_en, name_fr, country, site_type, display_order
        FROM insp_sites WHERE active = 1 ORDER BY display_order, name_en`).all()).map(s => ({ ...s, source: 'init' }));
  }
  const areas = await H.prepare(`SELECT code, name_en, name_fr, area_group, display_order
      FROM insp_areas WHERE active = 1 ORDER BY display_order, name_en`).all();
  const types = await H.prepare(`SELECT code, label_en, label_fr FROM insp_types ORDER BY display_order`).all();
  return {
    sites, areas, types,
    statuses:    INIT.statuses    || [],
    categories:  INIT.categories  || [],
    priorityMap: INIT.priorityMap || {},
    siteAliases: INIT.siteAliases || {},
  };
}

async function _listInspectionsPg(opts = {}) {
  const H = pgHandle();
  const where = [], params = {};
  if (opts.site)   { where.push('site_code = @site');                     params.site   = opts.site; }
  if (opts.from)   { where.push('inspection_date >= @from');              params.from   = opts.from; }
  if (opts.to)     { where.push('inspection_date <= @to');                params.to     = opts.to; }
  if (opts.risk)   { where.push("overall_risk LIKE '%' || @risk || '%'"); params.risk   = opts.risk; }
  if (opts.status) { where.push('status = @status');                      params.status = opts.status; }
  params.limit  = opts.limit  || 200;
  params.offset = opts.offset || 0;
  return H.prepare(`
    SELECT id, label, inspection_date, inspection_time, inspection_type,
           site_code, area_code, area_text, specific_location,
           inspector_name, overall_risk, operational_impact,
           status, created_at, updated_at, submitted_at
      FROM insp_inspections
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY inspection_date DESC, updated_at DESC
      LIMIT @limit OFFSET @offset
  `).all(params);
}

async function _getInspectionPg(id) {
  const H = pgHandle();
  const header = await H.prepare('SELECT * FROM insp_inspections WHERE id = ?').get(id);
  if (!header) return null;

  let stateBlob = null;
  try { stateBlob = header.state_json ? JSON.parse(header.state_json) : null; }
  catch (e) { console.warn('[inspection-db] state_json parse failed for', id, e.message); }
  stateBlob = _inflateState(stateBlob);

  const findings = await H.prepare(`
    SELECT category, item_index, item_code, item_text_en, item_text_fr, status, notes
      FROM insp_findings WHERE inspection_id = ? ORDER BY category, item_index`).all(id);

  const actions = await H.prepare(`
    SELECT id, ord, description, linked_item, priority, owner, due_date,
           status, notes, created_at, updated_at, closed_at
      FROM insp_actions WHERE inspection_id = ? ORDER BY ord, id`).all(id);

  const photos = (await H.prepare(`
    SELECT id, finding_key, action_id, caption, mime_type, data_b64, file_ref, size_bytes
      FROM insp_photos WHERE inspection_id = ? ORDER BY id`).all(id)).map(p => {
    if (p.file_ref) p.data_b64 = blobStore.getB64(p.file_ref) || p.data_b64 || '';
    delete p.file_ref;
    return p;
  });

  const signatures = (await H.prepare(`
    SELECT signer_type, signer_name, signer_date, signature_b64, file_ref, signed_at
      FROM insp_signatures WHERE inspection_id = ?`).all(id)).map(s => {
    if (s.file_ref) s.signature_b64 = blobStore.getB64(s.file_ref) || s.signature_b64 || '';
    delete s.file_ref;
    return s;
  });

  return { header, findings, actions, photos, signatures, state: stateBlob };
}

async function _resolveAreaCodePg(H, areaText) {
  if (!areaText) return null;
  const row = await H.prepare(`SELECT code FROM insp_areas
     WHERE lower(name_en) = lower(@t) OR lower(name_fr) = lower(@t) LIMIT 1`).get({ t: areaText });
  return row ? row.code : null;
}

async function _saveInspectionPg(state, userSiteCode, createdBy) {
  if (!state || !state.meta) throw new Error('Missing state.meta');
  const H    = pgHandle();
  const meta = state.meta;
  const id   = meta.f_id || _genId();

  const siteCode = parseSiteCode(meta.f_site);
  if (userSiteCode && siteCode && siteCode !== userSiteCode) {
    throw new Error(`Cross-site save blocked: user is scoped to ${userSiteCode}, inspection is for ${siteCode}`);
  }

  _externalizeBlobs(state, id);                       // FS writes, pre-tx (not transactional)

  const areaText = meta.f_area || '';
  const areaCode = await _resolveAreaCodePg(H, areaText);
  const existing = await H.prepare('SELECT id FROM insp_inspections WHERE id = ?').get(id);

  await H.runTransaction(async () => {
    if (existing) {
      await H.prepare(`
        UPDATE insp_inspections SET
          label = @label, inspection_date = @date, inspection_time = @time, inspection_type = @type,
          site_code = @siteCode, area_code = @areaCode, area_text = @areaText, specific_location = @loc,
          inspector_name = @inspector, inspector_role = @role, accompanied_by = @witness,
          weather = @weather, last_inspection_date = @lastdate, scope = @scope,
          overall_risk = @risk, operational_impact = @impact,
          key_observations = @obs, positive_findings = @pos, distribution = @dist,
          state_json = @stateJson, status = @status, updated_at = now(),
          submitted_at = CASE WHEN @status = 'submitted' AND submitted_at IS NULL
                              THEN now() ELSE submitted_at END
        WHERE id = @id
      `).run(_headerParams(id, meta, siteCode, areaCode, areaText, state));
    } else {
      await H.prepare(`
        INSERT INTO insp_inspections
          (id, label, inspection_date, inspection_time, inspection_type,
           site_code, area_code, area_text, specific_location,
           inspector_name, inspector_role, accompanied_by,
           weather, last_inspection_date, scope,
           overall_risk, operational_impact,
           key_observations, positive_findings, distribution,
           state_json, status, created_by, submitted_at)
        VALUES
          (@id, @label, @date, @time, @type,
           @siteCode, @areaCode, @areaText, @loc,
           @inspector, @role, @witness,
           @weather, @lastdate, @scope,
           @risk, @impact,
           @obs, @pos, @dist,
           @stateJson, @status, @createdBy,
           CASE WHEN @status = 'submitted' THEN now() ELSE NULL END)
      `).run({ ..._headerParams(id, meta, siteCode, areaCode, areaText, state), createdBy: createdBy || null });
    }

    await H.prepare('DELETE FROM insp_findings WHERE inspection_id = ?').run(id);
    for (const [key, val] of Object.entries(state.items || {})) {
      if (!val) continue;
      const [cat, ixStr] = String(key).split('__');
      const ix = parseInt(ixStr, 10);
      if (isNaN(ix)) continue;
      const itemDef  = _findItemDef(cat, ix);
      const itemCode = `${cat.toUpperCase()}-${String(ix + 1).padStart(2, '0')}`;
      await H.prepare(`INSERT INTO insp_findings
          (inspection_id, category, item_index, item_code, item_text_en, item_text_fr, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cat, ix, itemCode, itemDef ? itemDef.l : null, itemDef ? itemDef.fr : null,
             val.status || null, val.notes || null);
    }

    await H.prepare('DELETE FROM insp_actions WHERE inspection_id = ?').run(id);
    let aix = 0;
    for (const a of (state.actions || [])) {
      await H.prepare(`INSERT INTO insp_actions
          (inspection_id, ord, description, linked_item, priority, owner, due_date, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, aix, a.desc || a.description || '', a.link || a.linked_item || '',
             a.priority || 'Medium', a.owner || '', a.due || a.due_date || null,
             a.status || 'Open', a.notes || '');
      aix++;
    }

    await H.prepare('DELETE FROM insp_photos WHERE inspection_id = ?').run(id);
    for (const [key, val] of Object.entries(state.items || {})) {
      if (!val || !Array.isArray(val.photos)) continue;
      for (const raw of val.photos) {
        if (!raw) continue;
        const p = (typeof raw === 'string') ? { dataUrl: raw, caption: '' } : raw;
        if (p.__blob) {
          await H.prepare(`INSERT INTO insp_photos
              (inspection_id, finding_key, caption, mime_type, data_b64, file_ref, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(id, key, p.caption || '', p.mime || 'image/jpeg', null, p.__blob, p.sizeBytes || null);
        } else if (p.dataUrl) {
          const { mime, b64 } = _splitDataUrl(p.dataUrl);
          await H.prepare(`INSERT INTO insp_photos
              (inspection_id, finding_key, caption, mime_type, data_b64, file_ref, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(id, key, p.caption || '', mime, b64, null, b64.length);
        }
      }
    }

    await H.prepare('DELETE FROM insp_signatures WHERE inspection_id = ?').run(id);
    const _runSig = async (type, name, date, v) => {
      if (v && typeof v === 'object' && v.__blob) {
        await H.prepare(`INSERT INTO insp_signatures
            (inspection_id, signer_type, signer_name, signer_date, signature_b64, file_ref)
          VALUES (?, ?, ?, ?, ?, ?)`).run(id, type, name, date, null, v.__blob);
      } else {
        const { b64 } = _splitDataUrl(v);
        await H.prepare(`INSERT INTO insp_signatures
            (inspection_id, signer_type, signer_name, signer_date, signature_b64, file_ref)
          VALUES (?, ?, ?, ?, ?, ?)`).run(id, type, name, date, b64, null);
      }
    };
    const sigInsp = state.signatures && state.signatures.sig_inspector;
    if (sigInsp) await _runSig('inspector', meta.sign_insp_name || meta.f_inspector || '', meta.sign_insp_date || null, sigInsp);
    const sigSite = state.signatures && state.signatures.sig_site;
    if (sigSite) await _runSig('site', meta.sign_site_name || '', meta.sign_site_date || null, sigSite);
  });

  return { id, created: !existing };
}

async function _deleteInspectionPg(id) {
  // No sqlite-style _backup (better-sqlite3 file copy) in pg mode — Postgres
  // backups are handled at the cluster level. Blobs are still cleaned up.
  const info = await pgHandle().prepare('DELETE FROM insp_inspections WHERE id = ?').run(id);
  if (info.changes > 0) { try { blobStore.removeOwner(BLOB_MODULE, id); } catch (_) {} }
  return info.changes > 0;
}

async function _getInspectionStatusPg(id) {
  const row = await pgHandle().prepare('SELECT status FROM insp_inspections WHERE id = ?').get(id);
  return row ? (row.status || 'draft') : null;
}

async function _aggregatePg(opts = {}) {
  const H = pgHandle();
  const where = [], params = {};
  if (opts.site) { where.push('i.site_code = @site'); params.site = opts.site; }
  if (opts.from) { where.push('i.inspection_date >= @from'); params.from = opts.from; }
  if (opts.to)   { where.push('i.inspection_date <= @to');   params.to   = opts.to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const counts = await H.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN overall_risk LIKE '%Critical%' THEN 1 ELSE 0 END) AS critical_count,
           SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) AS draft_count,
           SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
           SUM(CASE WHEN status = 'closed'    THEN 1 ELSE 0 END) AS closed_count,
           COUNT(DISTINCT site_code) AS sites_covered
      FROM insp_inspections i ${w}`).get(params);

  const findingStatus = await H.prepare(`
    SELECT f.status, COUNT(*) AS n
      FROM insp_findings f JOIN insp_inspections i ON i.id = f.inspection_id
      ${w} GROUP BY f.status`).all(params);

  const actionsOpen = await H.prepare(`
    SELECT COUNT(*) AS n
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
      ${w} ${w ? 'AND' : 'WHERE'} a.status != 'Closed' AND a.status != 'Cancelled'`).get(params);

  const overdue = await H.prepare(`
    SELECT COUNT(*) AS n
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
      ${w} ${w ? 'AND' : 'WHERE'} a.due_date IS NOT NULL
            AND a.due_date < to_char(current_date,'YYYY-MM-DD')
            AND a.status != 'Closed' AND a.status != 'Cancelled'`).get(params);

  const monthly = await H.prepare(`
    SELECT substr(inspection_date, 1, 7) AS ym, COUNT(*) AS n
      FROM insp_inspections i ${w} GROUP BY ym ORDER BY ym`).all(params);

  return {
    counts, findingStatus,
    open_actions:    actionsOpen ? actionsOpen.n : 0,
    overdue_actions: overdue     ? overdue.n     : 0,
    monthly,
  };
}

async function _addActionUpdatePg(actionId, opts = {}) {
  const H = pgHandle();
  const action = await H.prepare('SELECT id, status FROM insp_actions WHERE id = ?').get(actionId);
  if (!action) throw new Error('Action not found');
  await H.runTransaction(async () => {
    await H.prepare(`INSERT INTO insp_action_updates (action_id, author_id, author_name, body, status_change)
      VALUES (?, ?, ?, ?, ?)`)
      .run(actionId, opts.author_id || null, opts.author_name || null, opts.body || null, opts.status_change || null);
    if (opts.status_change && opts.status_change !== action.status) {
      const terminal = (opts.status_change === 'Closed' || opts.status_change === 'Cancelled');
      // closed_at is TEXT → stamp via to_char (now() is timestamptz; CASE branches must match the TEXT col).
      await H.prepare(`UPDATE insp_actions
          SET status = ?, closed_at = CASE WHEN ? = 1 THEN to_char(now(),'YYYY-MM-DD HH24:MI:SS') ELSE closed_at END,
              updated_at = now()
        WHERE id = ?`).run(opts.status_change, terminal ? 1 : 0, actionId);
    }
  });
}

async function _listActionsPg(opts = {}) {
  const H = pgHandle();
  const where = [], params = {};
  if (opts.site)     { where.push('lower(i.site_code) = lower(@site)'); params.site = opts.site; }
  if (opts.status)   { where.push('a.status = @status');                params.status = opts.status; }
  if (opts.priority) { where.push('a.priority = @priority');            params.priority = opts.priority; }
  if (opts.owner)    { where.push('a.owner ILIKE @owner');              params.owner = '%' + opts.owner + '%'; }
  if (opts.overdue) {
    where.push("a.due_date IS NOT NULL AND a.due_date < to_char(current_date,'YYYY-MM-DD') AND a.status != 'Closed' AND a.status != 'Cancelled'");
  }
  if (opts.from)     { where.push('i.inspection_date >= @from'); params.from = opts.from; }
  if (opts.to)       { where.push('i.inspection_date <= @to');   params.to = opts.to; }
  if (opts.q) {
    where.push('(a.description ILIKE @q OR a.owner ILIKE @q OR a.linked_item ILIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.limit = opts.limit || 1000;
  params.offset = opts.offset || 0;
  return H.prepare(`
    SELECT a.*,
      i.label AS inspection_label, i.site_code AS site_code, i.area_code AS area_code,
      i.inspection_date AS inspection_date, i.status AS inspection_status
    FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
    ${w}
    ORDER BY
      CASE WHEN a.status IN ('Closed','Cancelled') THEN 1 ELSE 0 END,
      CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END,
      a.due_date ASC, i.inspection_date DESC
    LIMIT @limit OFFSET @offset`).all(params);
}

async function _resetLookupsPg() {
  const H = pgHandle();
  await H.exec('DELETE FROM insp_sites; DELETE FROM insp_areas; DELETE FROM insp_types;');
  await _seedLookupsPg(H);
}

module.exports = {
  getDB,
  loadLookups,
  listPeople,
  listInspections,
  getInspection,
  getInspectionStatus,
  saveInspection,
  deleteInspection,
  aggregate,
  listActions, addActionUpdate, listActionUpdates, getActionParent,
  exportRows,
  resetLookups,
  siteNameToCode,
  parseSiteCode,
  INSPECTION_BACKEND, initPgInspection, pgHandle
};
