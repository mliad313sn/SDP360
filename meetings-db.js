/**
 * meetings-db.js — Department Meetings & Council Escalations
 *
 * SQLite persistence layer for the Department Meeting / Mine IT Council
 * tracker. Schema derives directly from the canonical Endeavour Mining
 * operational templates:
 *
 *   - Guide_Operationnel_Reunions_Departementales.docx (May 2026)
 *   - Department_Meeting_Report_Template.docx (the signed PV)
 *   - Site_IT_Tracker_Template.xlsx (the quarterly site workbook)
 *
 * Model — one MEETING produces:
 *
 *     md_meetings  (PV header: site × department × month, signed)
 *      │
 *      ├── md_meeting_priorities    (3 priorities in dept's own words)
 *      ├── md_meeting_projects      (department projects in flight)
 *      ├── md_issues                (issues raised, with category/severity/escalate)
 *      │    └── md_issue_updates    (audit trail per issue)
 *      ├── md_actions               (IT commitments, linked to an issue)
 *      └── md_meeting_attachments   (inline base64 photos/docs)
 *
 * 8 seeded lookup tables (admin-extendable per the original requirement):
 *   md_intake_sources       — dept_meeting / survey / council / adhoc
 *   md_departments          — Mining / Maintenance / HSE / ...
 *   md_categories           — 9 canonical issue codes (CN/HW/IN/OT/AP/SC/DR/SD/LV)
 *   md_severities           — HIGH / MEDIUM / LOW
 *   md_statuses             — open / in_progress / blocked / on_hold / resolved / cancelled
 *   md_meeting_statuses     — draft / submitted / signed / closed
 *   md_escalation_reasons   — 6 criteria from the guide
 *   md_council_themes       — Connectivity / Hardware lifecycle / OT-IT / Licensing / Cybersecurity / Other
 *   md_project_phases       — Scoping / Design / Build / Deploy / Closeout
 *   md_it_involvement       — Lead / Co-deliver / Support / Advisory / None
 *   md_engagements          — the 5 non-negotiable engagements (for compliance monitor)
 *
 * RBAC enforcement happens at the route handler. This module accepts a
 * userSiteCode and refuses cross-site writes by editors.
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const INIT = require('./meetings-init.json');

// ── DB path resolution + auto-migration from legacy root location ──────────
// Historical: meetings.db lived at __dirname/meetings.db. Harmonised
// 2026-06-05 to __dirname/data/meetings.db (same pattern as reports.db).
// The block below auto-migrates if it finds the DB at the old location —
// idempotent + safe.
// SDP_DATA_DIR override lets tests point the module at a throwaway temp
// directory; unset in prod so the default data/ path is unchanged.
const DATA_DIR = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, 'data');
const MEETINGS_DB_PATH = path.join(DATA_DIR, 'meetings.db');
function _ensureDbLocation() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacyPath = path.join(__dirname, 'meetings.db');
  if (fs.existsSync(legacyPath) && !fs.existsSync(MEETINGS_DB_PATH)) {
    try {
      fs.renameSync(legacyPath, MEETINGS_DB_PATH);
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(legacyPath + ext)) {
          try { fs.renameSync(legacyPath + ext, MEETINGS_DB_PATH + ext); } catch (e) { /* ignore */ }
        }
      }
      console.log('[Meetings-DB] Migrated meetings.db from root to data/ (one-time)');
    } catch (e) {
      console.error('[Meetings-DB] Could not migrate meetings.db to data/:', e.message);
    }
  }
}

// ── DB singleton ────────────────────────────────────────────────────────────
let _mdb = null;

function getDB() {
  if (!_mdb) {
    _ensureDbLocation();
    _mdb = new Database(MEETINGS_DB_PATH);
    _mdb.pragma('journal_mode = WAL');
    _mdb.pragma('foreign_keys = ON');
    _initSchema(_mdb);
  }
  return _mdb;
}

// ── PostgreSQL backend selector (Chunk 2) ────────────────────────────────────
// `sqlite` (default) keeps the better-sqlite3 path above, byte-for-byte.
// `postgres` routes every DB function through the async services/pgDb adapter.
const MEETINGS_BACKEND = (process.env.MEETINGS_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgMeetings() {              // called once at server boot
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MEETINGS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'meetings', '001_init.sql'), 'utf8'));
  // Seed the 11 lookups on first run (data-driven from meetings-init.json).
  const seeded = await _pg.prepare('SELECT COUNT(*) AS n FROM md_categories').get();
  if (!seeded || !seeded.n) await _seedLookupsPg();
  // Idempotent label fix (parity with the sqlite path): survey → "IT Survey".
  await _pg.prepare(`UPDATE md_intake_sources SET name_en='IT Survey', name_fr='Enquête IT'
                     WHERE code='survey' AND (name_en='InfoTech Survey' OR name_fr='Enquête InfoTech')`).run();
  return _pg;
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgMeetings() at boot');
  return _pg;
}
// Generic pg seed — INSERT ... ON CONFLICT (code) DO UPDATE, named @col binding
// (the hardened adapter translates @name). Mirrors _seedTable's dynamic columns.
async function _seedTablePg(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const set  = cols.filter(c => c !== 'code').map(c => `${c}=EXCLUDED.${c}`).join(', ');
  const sql  = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')}) `
             + (set ? `ON CONFLICT (code) DO UPDATE SET ${set}` : `ON CONFLICT (code) DO NOTHING`);
  const stmt = pgHandle().prepare(sql);
  for (const r of rows) await stmt.run(r);
}
async function _seedLookupsPg() {
  await pgHandle().runTransaction(async () => {
    await _seedTablePg('md_intake_sources',     INIT.intake_sources);
    await _seedTablePg('md_departments',        INIT.departments);
    await _seedTablePg('md_categories',         INIT.categories);
    await _seedTablePg('md_severities',         INIT.severities);
    await _seedTablePg('md_statuses',           INIT.statuses);
    await _seedTablePg('md_meeting_statuses',   INIT.meeting_statuses);
    await _seedTablePg('md_escalation_reasons', INIT.escalation_reasons);
    await _seedTablePg('md_council_themes',     INIT.council_themes);
    await _seedTablePg('md_project_phases',     INIT.project_phases);
    await _seedTablePg('md_it_involvement',     INIT.it_involvement_levels);
    await _seedTablePg('md_engagements',        INIT.engagements);
  });
}

// ── Schema creation & seeding ───────────────────────────────────────────────
function _initSchema(db) {
  // Pre-step: if a v1 schema exists (with md_decisions), drop it cleanly.
  // v1 was never deployed to production so there's no data to migrate.
  // This block is idempotent and safe to ship.
  const v1Tables = ['md_decisions', 'md_decision_updates', 'md_decision_attachments'];
  v1Tables.forEach(t => db.exec(`DROP TABLE IF EXISTS ${t};`));
  // v1 also had md_categories / md_statuses / md_priorities with a
  // different shape — drop them so the v2 seed runs cleanly.
  const v1Lookups = ['md_categories', 'md_statuses', 'md_priorities'];
  v1Lookups.forEach(t => {
    // Only drop if a v1-shaped row exists (presence of 'priority' column
    // family) — but safest is just to drop and re-seed since the v2 init
    // ships the same canonical codes.
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  });

  db.exec(`
    -- ════════════════════════════════════════════════════════════════
    -- LOOKUP TABLES — bilingual EN/FR, all admin-extendable
    -- ════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS md_intake_sources (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      color TEXT, display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS md_departments (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS md_categories (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      color TEXT, icon TEXT,
      display_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS md_severities (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      description_en TEXT, description_fr TEXT,
      color TEXT, rank INTEGER, display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_statuses (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      color TEXT, is_terminal INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_meeting_statuses (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      color TEXT, display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_escalation_reasons (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      description_en TEXT, description_fr TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_council_themes (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      color TEXT, indicative_ask_en TEXT, indicative_ask_fr TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_project_phases (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_it_involvement (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      display_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS md_engagements (
      code TEXT PRIMARY KEY,
      name_en TEXT NOT NULL, name_fr TEXT,
      rule_en TEXT, rule_fr TEXT,
      display_order INTEGER DEFAULT 0
    );

    -- ════════════════════════════════════════════════════════════════
    -- CORE — meetings + nested children
    -- ════════════════════════════════════════════════════════════════
    CREATE TABLE IF NOT EXISTS md_meetings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      reference       TEXT UNIQUE,             -- e.g. HGO_Maintenance_PV_2026-05
      site_code       TEXT NOT NULL,
      department      TEXT NOT NULL,           -- FK md_departments.code
      meeting_date    TEXT NOT NULL,           -- ISO yyyy-mm-dd
      duration_min    INTEGER,
      department_head TEXT, department_head_title TEXT,
      site_it_lead    TEXT,
      other_attendees TEXT,
      intake_source   TEXT DEFAULT 'dept_meeting',
      priority_1      TEXT, priority_2 TEXT, priority_3 TEXT,
      next_meeting_date     TEXT,
      next_meeting_location TEXT,
      status          TEXT DEFAULT 'draft',   -- draft / submitted / signed / closed
      submitted_at    TEXT,
      dept_head_signed_at TEXT,
      site_it_signed_at   TEXT,
      created_by      INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_md_meetings_site_date ON md_meetings(site_code, meeting_date);
    CREATE INDEX IF NOT EXISTS ix_md_meetings_dept      ON md_meetings(department);
    CREATE INDEX IF NOT EXISTS ix_md_meetings_status    ON md_meetings(status);

    CREATE TABLE IF NOT EXISTS md_meeting_projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      INTEGER NOT NULL,
      ord             INTEGER DEFAULT 0,
      project_name    TEXT NOT NULL,
      phase           TEXT,                   -- FK md_project_phases.code
      it_involvement  TEXT,                   -- FK md_it_involvement.code
      status          TEXT,                   -- e.g. on_track / at_risk / blocked
      it_lead         TEXT,
      business_sponsor TEXT,
      start_date      TEXT,
      target_end      TEXT,
      notes           TEXT,
      FOREIGN KEY (meeting_id) REFERENCES md_meetings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS md_issues (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id        INTEGER NOT NULL,
      ord               INTEGER DEFAULT 0,
      title             TEXT NOT NULL,
      description       TEXT,
      category          TEXT NOT NULL,        -- FK md_categories.code
      severity          TEXT DEFAULT 'MEDIUM',-- FK md_severities.code
      affects           TEXT,                 -- people / process impact narrative
      champion          TEXT,                 -- mandatory per Engagement 3
      champion_email    TEXT,
      target_date       TEXT,
      status            TEXT DEFAULT 'open',  -- FK md_statuses.code
      escalate          INTEGER DEFAULT 0,    -- 0 = no, 1 = yes
      escalation_reason TEXT,                 -- FK md_escalation_reasons.code (when escalate=1)
      council_theme     TEXT,                 -- FK md_council_themes.code (when escalate=1)
      notes             TEXT,
      closed_at         TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES md_meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ix_md_issues_meeting   ON md_issues(meeting_id);
    CREATE INDEX IF NOT EXISTS ix_md_issues_category  ON md_issues(category);
    CREATE INDEX IF NOT EXISTS ix_md_issues_severity  ON md_issues(severity);
    CREATE INDEX IF NOT EXISTS ix_md_issues_status    ON md_issues(status);
    CREATE INDEX IF NOT EXISTS ix_md_issues_escalate  ON md_issues(escalate);

    CREATE TABLE IF NOT EXISTS md_issue_updates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id        INTEGER NOT NULL,
      author_id       INTEGER, author_name TEXT,
      body            TEXT,
      status_change   TEXT,
      escalate_change INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (issue_id) REFERENCES md_issues(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ix_md_updates_issue ON md_issue_updates(issue_id);

    CREATE TABLE IF NOT EXISTS md_actions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      INTEGER NOT NULL,
      ord             INTEGER DEFAULT 0,
      description     TEXT NOT NULL,
      owner_it        TEXT,                   -- IT Champion (Engagement 3)
      owner_email     TEXT,
      target_date     TEXT,
      status          TEXT DEFAULT 'open',
      linked_issue_id INTEGER,                -- FK md_issues.id (the linked issue #)
      closed_at       TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id)      REFERENCES md_meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (linked_issue_id) REFERENCES md_issues(id)   ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS ix_md_actions_meeting ON md_actions(meeting_id);
    CREATE INDEX IF NOT EXISTS ix_md_actions_issue   ON md_actions(linked_issue_id);

    -- Audit trail for action status changes (parity with md_issue_updates).
    -- Lets the Actions Register close/track an action from a flat list with a
    -- who/when/comment record, independent of the parent PV's lifecycle.
    CREATE TABLE IF NOT EXISTS md_action_updates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id     INTEGER NOT NULL,
      author_id     INTEGER, author_name TEXT,
      body          TEXT,
      status_change TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (action_id) REFERENCES md_actions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ix_md_action_updates_action ON md_action_updates(action_id);

    CREATE TABLE IF NOT EXISTS md_meeting_attachments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      INTEGER NOT NULL,
      filename        TEXT,
      mime_type       TEXT DEFAULT 'application/octet-stream',
      data_b64        TEXT,
      size_bytes      INTEGER,
      uploaded_by     INTEGER,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (meeting_id) REFERENCES md_meetings(id) ON DELETE CASCADE
    );
  `);

  // Seed lookups on first run
  const n = db.prepare('SELECT COUNT(*) AS n FROM md_categories').get().n;
  if (n === 0) {
    console.log('[meetings-db] First run — seeding lookups…');
    _seedLookups(db);
    console.log('[meetings-db] ✅ Lookups seeded');
  }

  // ── One-time label fixes ─────────────────────────────────────────
  // Idempotent: only updates rows that still carry the old label.
  // Safe to leave in place; each migration is a no-op once applied.
  //
  // 2026-05-23: rename "InfoTech Survey" → "IT Survey" per the team's
  // standard terminology. Same code (`survey`), same color, label only.
  const r = db.prepare(`
    UPDATE md_intake_sources
       SET name_en = 'IT Survey', name_fr = 'Enquête IT'
     WHERE code = 'survey'
       AND (name_en = 'InfoTech Survey' OR name_fr = 'Enquête InfoTech')
  `).run();
  if (r.changes) console.log('[meetings-db] ✅ Relabelled intake_source `survey` → "IT Survey"');
}

function _seedLookups(db) {
  const seed = db.transaction(() => {
    _seedTable(db, 'md_intake_sources',     INIT.intake_sources);
    _seedTable(db, 'md_departments',        INIT.departments);
    _seedTable(db, 'md_categories',         INIT.categories);
    _seedTable(db, 'md_severities',         INIT.severities);
    _seedTable(db, 'md_statuses',           INIT.statuses);
    _seedTable(db, 'md_meeting_statuses',   INIT.meeting_statuses);
    _seedTable(db, 'md_escalation_reasons', INIT.escalation_reasons);
    _seedTable(db, 'md_council_themes',     INIT.council_themes);
    _seedTable(db, 'md_project_phases',     INIT.project_phases);
    _seedTable(db, 'md_it_involvement',     INIT.it_involvement_levels);
    _seedTable(db, 'md_engagements',        INIT.engagements);
  });
  seed();
}

// Generic seed helper — takes an array of {code, ...} and writes every
// (code, value) pair into the given table. Uses INSERT OR REPLACE so
// running the seed twice is idempotent.
function _seedTable(db, table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  // Derive the column list from the first row's keys
  const cols = Object.keys(rows[0]);
  const placeholders = cols.map(c => '@' + c).join(', ');
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
  rows.forEach(r => stmt.run(r));
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _siteNameToCode(name) {
  try { return require('./inspection-db.js').siteNameToCode(name); }
  catch (e) { return null; }
}

// Reference format mirrors the canonical SharePoint naming:
//   [SITE]_[Department]_PV_[YYYY-MM]   →  HGO_Maintenance_PV_2026-05
// If the user re-saves a meeting whose meeting_date moves to a new month,
// the reference auto-updates (caller may pass a fixed reference to override).
function _buildReference(site_code, department, meeting_date) {
  if (!site_code || !department || !meeting_date) return null;
  const m = String(meeting_date).match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  // Title-case the department code (mining → Mining, mobile_maint → Mobile_Maint)
  const dept = department
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
  return `${site_code}_${dept}_PV_${m[1]}-${m[2]}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** All lookups in one call — drives every dropdown in the form. */
function loadLookups() {
  if (MEETINGS_BACKEND === 'postgres') return _loadLookupsPg();
  const db = getDB();
  const lookups = {
    intake_sources:     db.prepare('SELECT * FROM md_intake_sources       WHERE active = 1 ORDER BY display_order').all(),
    departments:        db.prepare('SELECT * FROM md_departments          WHERE active = 1 ORDER BY display_order').all(),
    categories:         db.prepare('SELECT * FROM md_categories           WHERE active = 1 ORDER BY display_order').all(),
    severities:         db.prepare('SELECT * FROM md_severities                            ORDER BY display_order').all(),
    statuses:           db.prepare('SELECT * FROM md_statuses                              ORDER BY display_order').all(),
    meeting_statuses:   db.prepare('SELECT * FROM md_meeting_statuses                      ORDER BY display_order').all(),
    escalation_reasons: db.prepare('SELECT * FROM md_escalation_reasons                    ORDER BY display_order').all(),
    council_themes:     db.prepare('SELECT * FROM md_council_themes                        ORDER BY display_order').all(),
    project_phases:     db.prepare('SELECT * FROM md_project_phases                        ORDER BY display_order').all(),
    it_involvement:     db.prepare('SELECT * FROM md_it_involvement                        ORDER BY display_order').all(),
    engagements:        db.prepare('SELECT * FROM md_engagements                           ORDER BY display_order').all(),
  };
  // Sites pulled from reports.db (canonical authority — same pattern as
  // the inspection module). Returns [] in isolated tests.
  let sites = [];
  try {
    const rdb = require('./reports-db.js');
    const canonical = rdb.listSites() || [];
    sites = canonical.map(cs => ({
      id:     cs.id,
      code:   _siteNameToCode(cs.name) || cs.name,
      name:   cs.name,
      active: cs.active === 0 ? 0 : 1,
    }));
  } catch (e) { /* offline */ }
  lookups.sites = sites;
  return lookups;
}

// ── Async postgres read-path forks (Chunk 2) ────────────────────────────────
async function _loadLookupsPg() {
  const h = pgHandle();
  const lookups = {
    intake_sources:     await h.prepare('SELECT * FROM md_intake_sources       WHERE active = 1 ORDER BY display_order').all(),
    departments:        await h.prepare('SELECT * FROM md_departments          WHERE active = 1 ORDER BY display_order').all(),
    categories:         await h.prepare('SELECT * FROM md_categories           WHERE active = 1 ORDER BY display_order').all(),
    severities:         await h.prepare('SELECT * FROM md_severities                            ORDER BY display_order').all(),
    statuses:           await h.prepare('SELECT * FROM md_statuses                              ORDER BY display_order').all(),
    meeting_statuses:   await h.prepare('SELECT * FROM md_meeting_statuses                      ORDER BY display_order').all(),
    escalation_reasons: await h.prepare('SELECT * FROM md_escalation_reasons                    ORDER BY display_order').all(),
    council_themes:     await h.prepare('SELECT * FROM md_council_themes                        ORDER BY display_order').all(),
    project_phases:     await h.prepare('SELECT * FROM md_project_phases                        ORDER BY display_order').all(),
    it_involvement:     await h.prepare('SELECT * FROM md_it_involvement                        ORDER BY display_order').all(),
    engagements:        await h.prepare('SELECT * FROM md_engagements                           ORDER BY display_order').all(),
  };
  let sites = [];
  try {
    const rdb = require('./reports-db.js');
    // MUST await: under REPORTS_BACKEND=postgres (live in prod) listSites() is
    // async — a bare call returns a Promise, .map() throws, the catch swallows
    // it, and the site dropdown ends up EMPTY on every meetings page. await is
    // safe under sqlite too (await on a sync array is a no-op). Mirrors the
    // inspection PG fork, which already did this correctly.
    const canonical = (await rdb.listSites()) || [];
    sites = canonical.map(cs => ({ id: cs.id, code: _siteNameToCode(cs.name) || cs.name, name: cs.name, active: cs.active === 0 ? 0 : 1 }));
  } catch (e) { /* offline */ }
  lookups.sites = sites;
  return lookups;
}

// Shared WHERE-builder for listMeetings/countMeetings (named @params; ILIKE for q).
function _meetingsWhere(opts) {
  const where = [], params = {};
  if (opts.site)       { where.push('m.site_code = @site');       params.site = opts.site; }
  if (opts.department) { where.push('m.department = @department'); params.department = opts.department; }
  if (opts.status)     { where.push('m.status = @status');         params.status = opts.status; }
  if (opts.intake)     { where.push('m.intake_source = @intake');  params.intake = opts.intake; }
  if (opts.from)       { where.push('m.meeting_date >= @from');    params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');      params.to = opts.to; }
  if (opts.q) {
    where.push('(m.reference ILIKE @q OR m.department_head ILIKE @q OR m.site_it_lead ILIKE @q OR m.priority_1 ILIKE @q OR m.priority_2 ILIKE @q OR m.priority_3 ILIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}
async function _listMeetingsPg(opts = {}) {
  const { w, params } = _meetingsWhere(opts);
  params.limit = opts.limit || 200; params.offset = opts.offset || 0;
  return pgHandle().prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id)                                 AS issue_count,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id AND i.severity = 'HIGH')         AS high_issue_count,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id AND i.escalate = 1)              AS escalated_count,
      (SELECT COUNT(*) FROM md_actions a WHERE a.meeting_id = m.id)                                 AS action_count,
      (SELECT COUNT(*) FROM md_actions a WHERE a.meeting_id = m.id AND a.status NOT IN ('resolved','cancelled')) AS open_action_count,
      (SELECT COUNT(*) FROM md_meeting_projects p WHERE p.meeting_id = m.id)                        AS project_count
    FROM md_meetings m ${w}
    ORDER BY m.meeting_date DESC, m.id DESC
    LIMIT @limit OFFSET @offset`).all(params);
}
async function _countMeetingsPg(opts = {}) {
  const { w, params } = _meetingsWhere(opts);
  const row = await pgHandle().prepare(`SELECT COUNT(*) AS n FROM md_meetings m ${w}`).get(params);
  return (row && row.n) || 0;
}
async function _getMeetingPg(id) {
  const h = pgHandle();
  const header = await h.prepare('SELECT * FROM md_meetings WHERE id = ?').get(id);
  if (!header) return null;
  const projects = await h.prepare('SELECT * FROM md_meeting_projects WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const issues   = await h.prepare('SELECT * FROM md_issues             WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const actions  = await h.prepare('SELECT * FROM md_actions            WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const attachments = await h.prepare(`SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
      FROM md_meeting_attachments WHERE meeting_id = ? ORDER BY id`).all(id);
  const issueIds = issues.map(i => i.id);
  let updates = [];
  if (issueIds.length) {
    updates = await h.prepare(`SELECT * FROM md_issue_updates
       WHERE issue_id IN (${issueIds.map(() => '?').join(',')})
       ORDER BY created_at DESC, id DESC`).all(...issueIds);
  }
  return { header, projects, issues, actions, updates, attachments };
}
async function _getMeetingStatusPg(id) {
  const row = await pgHandle().prepare('SELECT status, site_code FROM md_meetings WHERE id = ?').get(id);
  return row || null;
}
async function _getMeetingIdByReferencePg(reference) {
  if (!reference) return null;
  const row = await pgHandle().prepare('SELECT id FROM md_meetings WHERE reference = ?').get(String(reference).trim());
  return row ? row.id : null;
}

/**
 * Paginated meetings list with filters. Each row carries summary fields
 * (issue counts, action counts) so the list view doesn't need N+1 queries.
 */
function listMeetings(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _listMeetingsPg(opts);
  const db = getDB();
  const where  = [];
  const params = {};
  if (opts.site)        { where.push('m.site_code = @site');         params.site = opts.site; }
  if (opts.department)  { where.push('m.department = @department');  params.department = opts.department; }
  if (opts.status)      { where.push('m.status = @status');          params.status = opts.status; }
  if (opts.intake)      { where.push('m.intake_source = @intake');   params.intake = opts.intake; }
  if (opts.from)        { where.push('m.meeting_date >= @from');     params.from = opts.from; }
  if (opts.to)          { where.push('m.meeting_date <= @to');       params.to = opts.to; }
  if (opts.q) {
    where.push('(m.reference LIKE @q OR m.department_head LIKE @q OR m.site_it_lead LIKE @q OR m.priority_1 LIKE @q OR m.priority_2 LIKE @q OR m.priority_3 LIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT
      m.*,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id)                                 AS issue_count,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id AND i.severity = 'HIGH')         AS high_issue_count,
      (SELECT COUNT(*) FROM md_issues  i WHERE i.meeting_id = m.id AND i.escalate = 1)              AS escalated_count,
      (SELECT COUNT(*) FROM md_actions a WHERE a.meeting_id = m.id)                                 AS action_count,
      (SELECT COUNT(*) FROM md_actions a WHERE a.meeting_id = m.id AND a.status NOT IN ('resolved','cancelled')) AS open_action_count,
      (SELECT COUNT(*) FROM md_meeting_projects p WHERE p.meeting_id = m.id)                        AS project_count
    FROM md_meetings m
    ${w}
    ORDER BY m.meeting_date DESC, m.id DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit  = opts.limit  || 200;
  params.offset = opts.offset || 0;
  return db.prepare(sql).all(params);
}

/**
 * countMeetings — returns the row count that listMeetings WOULD return
 * with the same filters but NO pagination. Used by the list route so the
 * front-end can render "Showing 1–20 of 187" and gray out Next on the
 * last page. Mirrors the WHERE clauses in listMeetings exactly — keep
 * the two in sync.
 */
function countMeetings(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _countMeetingsPg(opts);
  const db = getDB();
  const where  = [];
  const params = {};
  if (opts.site)        { where.push('m.site_code = @site');         params.site = opts.site; }
  if (opts.department)  { where.push('m.department = @department');  params.department = opts.department; }
  if (opts.status)      { where.push('m.status = @status');          params.status = opts.status; }
  if (opts.intake)      { where.push('m.intake_source = @intake');   params.intake = opts.intake; }
  if (opts.from)        { where.push('m.meeting_date >= @from');     params.from = opts.from; }
  if (opts.to)          { where.push('m.meeting_date <= @to');       params.to = opts.to; }
  if (opts.q) {
    where.push('(m.reference LIKE @q OR m.department_head LIKE @q OR m.site_it_lead LIKE @q OR m.priority_1 LIKE @q OR m.priority_2 LIKE @q OR m.priority_3 LIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const row = db.prepare(`SELECT COUNT(*) AS n FROM md_meetings m ${w}`).get(params);
  return (row && row.n) || 0;
}

/** Full meeting record incl. children. */
function getMeeting(id) {
  if (MEETINGS_BACKEND === 'postgres') return _getMeetingPg(id);
  const db = getDB();
  const header = db.prepare('SELECT * FROM md_meetings WHERE id = ?').get(id);
  if (!header) return null;
  const projects = db.prepare('SELECT * FROM md_meeting_projects WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const issues   = db.prepare('SELECT * FROM md_issues             WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const actions  = db.prepare('SELECT * FROM md_actions            WHERE meeting_id = ? ORDER BY ord, id').all(id);
  const attachments = db.prepare(`
    SELECT id, filename, mime_type, size_bytes, uploaded_by, created_at
      FROM md_meeting_attachments WHERE meeting_id = ? ORDER BY id
  `).all(id);
  // Issue updates (audit trail) — flat list keyed by issue_id for convenience
  const issueIds = issues.map(i => i.id);
  let updates = [];
  if (issueIds.length) {
    updates = db.prepare(`
      SELECT * FROM md_issue_updates
       WHERE issue_id IN (${issueIds.map(() => '?').join(',')})
       ORDER BY created_at DESC, id DESC
    `).all(...issueIds);
  }
  return { header, projects, issues, actions, updates, attachments };
}

/**
 * Upsert a meeting + its nested children in one transaction.
 *
 * @param {object} state  { id?, header: {...}, projects: [...], issues: [...], actions: [...] }
 * @param {string|null} userSiteCode  if set, write blocked unless the meeting's site matches
 * @param {number|null} userId   for audit
 * @returns {{id, reference, created}}
 */
function saveMeeting(state, userSiteCode, userId) {
  if (MEETINGS_BACKEND === 'postgres') return _saveMeetingPg(state, userSiteCode, userId);
  if (!state || !state.header) throw new Error('Missing state.header');
  const db   = getDB();
  const h    = state.header;
  let   id   = state.id ? parseInt(state.id, 10) : null;
  let   exist = id ? db.prepare('SELECT * FROM md_meetings WHERE id = ?').get(id) : null;

  if (!h.site_code)    throw new Error('Missing site_code');
  if (!h.department)   throw new Error('Missing department');
  if (!h.meeting_date) throw new Error('Missing meeting_date');

  // 2026-06-02: when the caller hasn't supplied an internal id, also try a
  // lookup by `reference` before falling through to INSERT. CRITICAL for
  // bulk imports — the importer only knows references from the xlsx, not
  // the DB's auto-generated ids. The user-facing contract documented in
  // meetings-import.js + CLAUDE.md is "matching reference → UPDATE in
  // place, no duplicates". Without this fallback, every re-import of a
  // workbook whose meetings are already in DB throws
  // "UNIQUE constraint failed: md_meetings.reference" on saveMeeting's
  // INSERT branch and the row gets skipped.
  if (!exist && !id) {
    const incomingRef = (h.reference || '').trim()
      || _buildReference(h.site_code, h.department, h.meeting_date);
    if (incomingRef) {
      // Case-insensitive reference match — a re-import carrying an
      // UPPERCASE reference (MGO_FINANCE_PV_2026-05) must adopt the
      // existing title-cased row (MGO_Finance_PV_2026-05) instead of
      // inserting a parallel one.
      exist = db.prepare('SELECT * FROM md_meetings WHERE reference = ? COLLATE NOCASE').get(incomingRef);
      if (exist) id = exist.id;   // adopt existing id so the UPDATE branch runs
    }
    // Logical-identity fallback (2026-06-15): a PV is uniquely identified by
    // site × department × month — NOT by the free-form reference string. This
    // catches re-imports whose reference SPELLING drifted (RH vs Hr,
    // UNDERGROUND vs Mining, SP vs Other_Dept) or whose day-of-month moved
    // (04-01 vs 04-02). Without it, the 2026-06-02 double-import created 9
    // duplicate rows. site_code + department compared case-insensitively.
    if (!exist && h.site_code && h.department && h.meeting_date) {
      const month = String(h.meeting_date).slice(0, 7);
      exist = db.prepare(`
        SELECT * FROM md_meetings
         WHERE site_code = ? COLLATE NOCASE
           AND department = ? COLLATE NOCASE
           AND substr(meeting_date, 1, 7) = ?
         ORDER BY id LIMIT 1
      `).get(h.site_code, h.department, month);
      if (exist) id = exist.id;
    }
  }

  // Cross-site write guard. An editor (userSiteCode set) cannot:
  //   (a) edit a meeting that already belongs to a different site,
  //   (b) create or transfer a meeting to a different site.
  // Both the EXISTING record's site_code AND the INCOMING header.site_code
  // must match the editor's scope.
  if (userSiteCode) {
    const existingSite = exist && exist.site_code;
    const incomingSite = h.site_code || null;
    if (existingSite && existingSite !== userSiteCode) {
      throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, meeting is for ${existingSite}`);
    }
    if (incomingSite !== userSiteCode) {
      throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, cannot write site ${incomingSite}`);
    }
    if (exist && exist.status === 'closed') {
      throw new Error('Meeting is closed — only admin can re-open');
    }
  }

  // 2026-06-02: Reference resolution priority (CRITICAL — see screenshot in
  // the bulk-import session). Previously this only had two branches:
  //     (exist && exist.reference) || _buildReference(...)
  // …which silently DROPPED the file's explicit reference when no existing
  // row was found, and replaced it with an auto-generated one built from
  // site_code + department + meeting_date. The auto-build collapses different
  // department names that share the same word root (e.g. file says
  // "MGO_UNDERGROUND_PV_2026-04" but auto-build returns "MGO_Mining_PV_2026-04"
  // because the file's department field is "mining"). When DB already had the
  // auto-built collision, INSERT failed with "UNIQUE constraint failed:
  // md_meetings.reference" on EVERY row of the user's workbook.
  //
  // Correct precedence:
  //   1. Existing row's reference (we found a match — never rename)
  //   2. The reference the caller supplied (file's explicit value, trimmed)
  //   3. _buildReference() fallback when caller didn't supply one
  const reference = (exist && exist.reference)
                    || (h.reference != null ? String(h.reference).trim() : '')
                    || _buildReference(h.site_code, h.department, h.meeting_date);

  const tx = db.transaction(() => {
    // Header upsert
    const headerParams = {
      id,
      reference,
      site_code:       h.site_code,
      department:      h.department,
      meeting_date:    h.meeting_date,
      duration_min:    h.duration_min || null,
      department_head: h.department_head || '',
      department_head_title: h.department_head_title || '',
      site_it_lead:    h.site_it_lead || '',
      other_attendees: h.other_attendees || '',
      intake_source:   h.intake_source || 'dept_meeting',
      priority_1:      h.priority_1 || '',
      priority_2:      h.priority_2 || '',
      priority_3:      h.priority_3 || '',
      next_meeting_date:     h.next_meeting_date || null,
      next_meeting_location: h.next_meeting_location || '',
      status:          h.status || 'draft',
      submitted_at:        h.submitted_at        || (h.status === 'submitted' || h.status === 'signed' ? new Date().toISOString().replace('T',' ').slice(0,19) : null),
      // Signatures are SERVER-AUTHORITATIVE. The client only signals "stamp it"
      // by sending a truthy value; the actual timestamp is ours (the browser
      // clock is untrusted, and `signoff` is a SCORED dimension of the site
      // programme score). Combined with the COALESCE on UPDATE below, the
      // first stamp wins and a re-save never rewrites an existing signature.
      dept_head_signed_at: h.dept_head_signed_at ? new Date().toISOString().replace('T',' ').slice(0,19) : null,
      site_it_signed_at:   h.site_it_signed_at   ? new Date().toISOString().replace('T',' ').slice(0,19) : null,
      createdBy:       userId || null,
    };

    if (exist) {
      db.prepare(`
        UPDATE md_meetings SET
          reference = @reference,
          site_code = @site_code,
          department = @department,
          meeting_date = @meeting_date,
          duration_min = @duration_min,
          department_head = @department_head,
          department_head_title = @department_head_title,
          site_it_lead = @site_it_lead,
          other_attendees = @other_attendees,
          intake_source = @intake_source,
          priority_1 = @priority_1,
          priority_2 = @priority_2,
          priority_3 = @priority_3,
          next_meeting_date = @next_meeting_date,
          next_meeting_location = @next_meeting_location,
          status = @status,
          submitted_at = COALESCE(submitted_at, @submitted_at),
          dept_head_signed_at = COALESCE(dept_head_signed_at, @dept_head_signed_at),
          site_it_signed_at   = COALESCE(site_it_signed_at,   @site_it_signed_at),
          updated_at = datetime('now')
        WHERE id = @id
      `).run(headerParams);
    } else {
      const r = db.prepare(`
        INSERT INTO md_meetings
          (reference, site_code, department, meeting_date, duration_min,
           department_head, department_head_title, site_it_lead, other_attendees,
           intake_source, priority_1, priority_2, priority_3,
           next_meeting_date, next_meeting_location, status,
           submitted_at, dept_head_signed_at, site_it_signed_at, created_by)
        VALUES
          (@reference, @site_code, @department, @meeting_date, @duration_min,
           @department_head, @department_head_title, @site_it_lead, @other_attendees,
           @intake_source, @priority_1, @priority_2, @priority_3,
           @next_meeting_date, @next_meeting_location, @status,
           @submitted_at, @dept_head_signed_at, @site_it_signed_at, @createdBy)
      `).run(headerParams);
      headerParams.id = r.lastInsertRowid;
    }
    const meetingId = headerParams.id;

    // Children — wipe + re-insert in the same transaction, BUT only when the
    // caller explicitly supplies the array. A save with state.projects ===
    // undefined leaves the existing project rows alone (e.g. a "header-only"
    // PATCH that just flips status to 'signed'). A save with state.projects
    // = [] CLEARS the projects, which is also legitimate.
    if (state.projects !== undefined) {
      db.prepare('DELETE FROM md_meeting_projects WHERE meeting_id = ?').run(meetingId);
      const insProject = db.prepare(`
        INSERT INTO md_meeting_projects
          (meeting_id, ord, project_name, phase, it_involvement, status, it_lead, business_sponsor, start_date, target_end, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      (state.projects || []).forEach((p, ix) => {
        if (!p.project_name) return;
        insProject.run(meetingId, p.ord || ix, p.project_name, p.phase || null, p.it_involvement || null,
          p.status || null, p.it_lead || null, p.business_sponsor || null, p.start_date || null, p.target_end || null, p.notes || null);
      });
    }

    // Issues — same explicit-array contract. Only mutate when the caller
    // sends state.issues. Otherwise leave existing issues alone — preserves
    // their ids + audit history across header-only saves.
    if (state.issues !== undefined) {
    const oldIssues = db.prepare('SELECT id, status, escalate FROM md_issues WHERE meeting_id = ?').all(meetingId);
    const oldIssueById = {};
    oldIssues.forEach(o => { oldIssueById[o.id] = o; });
    const incomingIds = new Set();

    const updIssue = db.prepare(`
      UPDATE md_issues SET
        ord = ?, title = ?, description = ?, category = ?, severity = ?,
        affects = ?, champion = ?, champion_email = ?, target_date = ?, status = ?,
        escalate = ?, escalation_reason = ?, council_theme = ?, notes = ?,
        closed_at = ?,
        updated_at = datetime('now')
      WHERE id = ? AND meeting_id = ?
    `);
    const insIssue = db.prepare(`
      INSERT INTO md_issues
        (meeting_id, ord, title, description, category, severity, affects,
         champion, champion_email, target_date, status, escalate,
         escalation_reason, council_theme, notes, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insAudit = db.prepare(`
      INSERT INTO md_issue_updates (issue_id, author_id, author_name, body, status_change, escalate_change)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    (state.issues || []).forEach((iss, ix) => {
      if (!iss.title || !iss.category) return;
      const terminal = (iss.status === 'resolved' || iss.status === 'cancelled');
      const closed_at = terminal ? new Date().toISOString().replace('T',' ').slice(0,19) : null;
      const escalate1 = iss.escalate ? 1 : 0;

      if (iss.id && oldIssueById[iss.id]) {
        incomingIds.add(iss.id);
        updIssue.run(
          iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM',
          iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null,
          iss.status || 'open', escalate1, iss.escalation_reason || null, iss.council_theme || null,
          iss.notes || '', closed_at,
          iss.id, meetingId
        );
        const old = oldIssueById[iss.id];
        const statusChange = old.status !== (iss.status || 'open') ? (iss.status || 'open') : null;
        const escChange    = old.escalate !== escalate1 ? escalate1 : null;
        if (statusChange || escChange) {
          insAudit.run(iss.id, userId || null, state.author_name || null,
            iss.update_comment || null, statusChange, escChange);
        }
      } else {
        const r = insIssue.run(
          meetingId, iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM',
          iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null,
          iss.status || 'open', escalate1, iss.escalation_reason || null, iss.council_theme || null,
          iss.notes || '', closed_at
        );
        insAudit.run(r.lastInsertRowid, userId || null, state.author_name || null,
          iss.update_comment || 'Issue created.', iss.status || 'open', escalate1);
      }
    });

    // Delete issues that disappeared from the payload (cascade deletes their updates).
    oldIssues.forEach(o => { if (!incomingIds.has(o.id)) db.prepare('DELETE FROM md_issues WHERE id = ?').run(o.id); });
    } // end if (state.issues !== undefined)

    // Actions — same explicit-array contract.
    if (state.actions !== undefined) {
      db.prepare('DELETE FROM md_actions WHERE meeting_id = ?').run(meetingId);
      const insAction = db.prepare(`
        INSERT INTO md_actions
          (meeting_id, ord, description, owner_it, owner_email, target_date, status, linked_issue_id, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      // Map linked_issue_ord (1-based ord from the UI) to actual issue id.
      const issuesAfter = db.prepare('SELECT id, ord FROM md_issues WHERE meeting_id = ? ORDER BY ord, id').all(meetingId);
      (state.actions || []).forEach((a, ix) => {
        if (!a.description) return;
        let linked = null;
        if (a.linked_issue_id) linked = a.linked_issue_id;
        else if (a.linked_issue_ord) {
          const ord = parseInt(a.linked_issue_ord, 10);
          const match = issuesAfter[ord - 1];
          if (match) linked = match.id;
        }
        const terminal = (a.status === 'resolved' || a.status === 'cancelled');
        const closed_at = terminal ? new Date().toISOString().replace('T',' ').slice(0,19) : null;
        insAction.run(meetingId, a.ord || ix, a.description, a.owner_it || '', a.owner_email || '',
          a.target_date || null, a.status || 'open', linked, closed_at);
      });
    }
  });
  tx();

  // The transaction closure mutated headerParams.id — but it's local to the
  // function scope, not accessible here. Re-fetch the id by reference.
  const saved = db.prepare('SELECT id FROM md_meetings WHERE reference = ?').get(reference);
  return { id: saved && saved.id, reference, created: !exist };
}

// Async postgres fork of saveMeeting — faithful port: db.transaction→runTransaction,
// .lastInsertRowid→.lastID, COLLATE NOCASE→lower()=lower(), datetime('now')→now(),
// forEach→for..of (await), named @params header + positional children. Defensive
// children contract + two-sided cross-site guard preserved verbatim.
async function _saveMeetingPg(state, userSiteCode, userId) {
  if (!state || !state.header) throw new Error('Missing state.header');
  const H = pgHandle();
  const h = state.header;
  let id = state.id ? parseInt(state.id, 10) : null;
  let exist = id ? await H.prepare('SELECT * FROM md_meetings WHERE id = ?').get(id) : null;
  if (!h.site_code)    throw new Error('Missing site_code');
  if (!h.department)   throw new Error('Missing department');
  if (!h.meeting_date) throw new Error('Missing meeting_date');
  if (!exist && !id) {
    const incomingRef = (h.reference || '').trim() || _buildReference(h.site_code, h.department, h.meeting_date);
    if (incomingRef) {
      exist = await H.prepare('SELECT * FROM md_meetings WHERE lower(reference) = lower(?)').get(incomingRef);
      if (exist) id = exist.id;
    }
    if (!exist && h.site_code && h.department && h.meeting_date) {
      const month = String(h.meeting_date).slice(0, 7);
      exist = await H.prepare(`SELECT * FROM md_meetings
         WHERE lower(site_code) = lower(?) AND lower(department) = lower(?) AND substr(meeting_date, 1, 7) = ?
         ORDER BY id LIMIT 1`).get(h.site_code, h.department, month);
      if (exist) id = exist.id;
    }
  }
  if (userSiteCode) {
    const existingSite = exist && exist.site_code;
    const incomingSite = h.site_code || null;
    if (existingSite && existingSite !== userSiteCode) throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, meeting is for ${existingSite}`);
    if (incomingSite !== userSiteCode) throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, cannot write site ${incomingSite}`);
    if (exist && exist.status === 'closed') throw new Error('Meeting is closed — only admin can re-open');
  }
  const reference = (exist && exist.reference) || (h.reference != null ? String(h.reference).trim() : '') || _buildReference(h.site_code, h.department, h.meeting_date);

  await H.runTransaction(async () => {
    const hp = {
      id, reference, site_code: h.site_code, department: h.department, meeting_date: h.meeting_date,
      duration_min: h.duration_min || null, department_head: h.department_head || '', department_head_title: h.department_head_title || '',
      site_it_lead: h.site_it_lead || '', other_attendees: h.other_attendees || '', intake_source: h.intake_source || 'dept_meeting',
      priority_1: h.priority_1 || '', priority_2: h.priority_2 || '', priority_3: h.priority_3 || '',
      next_meeting_date: h.next_meeting_date || null, next_meeting_location: h.next_meeting_location || '',
      status: h.status || 'draft',
      submitted_at: h.submitted_at || (h.status === 'submitted' || h.status === 'signed' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null),
      // Signatures are SERVER-AUTHORITATIVE — see the sqlite fork's note. The
      // client's truthy value only means "stamp it"; the timestamp is ours,
      // and the COALESCE below makes the first stamp immutable.
      dept_head_signed_at: h.dept_head_signed_at ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      site_it_signed_at:   h.site_it_signed_at   ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      createdBy: userId || null,
    };
    if (exist) {
      await H.prepare(`UPDATE md_meetings SET reference=@reference, site_code=@site_code, department=@department, meeting_date=@meeting_date,
        duration_min=@duration_min, department_head=@department_head, department_head_title=@department_head_title, site_it_lead=@site_it_lead,
        other_attendees=@other_attendees, intake_source=@intake_source, priority_1=@priority_1, priority_2=@priority_2, priority_3=@priority_3,
        next_meeting_date=@next_meeting_date, next_meeting_location=@next_meeting_location, status=@status,
        submitted_at=COALESCE(submitted_at, @submitted_at), dept_head_signed_at=COALESCE(dept_head_signed_at, @dept_head_signed_at),
        site_it_signed_at=COALESCE(site_it_signed_at, @site_it_signed_at), updated_at=now() WHERE id=@id`).run(hp);
    } else {
      const r = await H.prepare(`INSERT INTO md_meetings
        (reference, site_code, department, meeting_date, duration_min, department_head, department_head_title, site_it_lead, other_attendees,
         intake_source, priority_1, priority_2, priority_3, next_meeting_date, next_meeting_location, status, submitted_at, dept_head_signed_at, site_it_signed_at, created_by)
        VALUES (@reference,@site_code,@department,@meeting_date,@duration_min,@department_head,@department_head_title,@site_it_lead,@other_attendees,
         @intake_source,@priority_1,@priority_2,@priority_3,@next_meeting_date,@next_meeting_location,@status,@submitted_at,@dept_head_signed_at,@site_it_signed_at,@createdBy)`).run(hp);
      hp.id = r.lastID;
    }
    const meetingId = hp.id;
    if (state.projects !== undefined) {
      await H.prepare('DELETE FROM md_meeting_projects WHERE meeting_id = ?').run(meetingId);
      const insP = H.prepare(`INSERT INTO md_meeting_projects (meeting_id, ord, project_name, phase, it_involvement, status, it_lead, business_sponsor, start_date, target_end, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      let ix = 0;
      for (const p of (state.projects || [])) { if (p.project_name) await insP.run(meetingId, p.ord || ix, p.project_name, p.phase || null, p.it_involvement || null, p.status || null, p.it_lead || null, p.business_sponsor || null, p.start_date || null, p.target_end || null, p.notes || null); ix++; }
    }
    if (state.issues !== undefined) {
      const oldIssues = await H.prepare('SELECT id, status, escalate FROM md_issues WHERE meeting_id = ?').all(meetingId);
      const oldById = {}; oldIssues.forEach(o => { oldById[o.id] = o; });
      const incoming = new Set();
      const updI = H.prepare(`UPDATE md_issues SET ord=?, title=?, description=?, category=?, severity=?, affects=?, champion=?, champion_email=?, target_date=?, status=?, escalate=?, escalation_reason=?, council_theme=?, notes=?, closed_at=?, updated_at=now() WHERE id=? AND meeting_id=?`);
      const insI = H.prepare(`INSERT INTO md_issues (meeting_id, ord, title, description, category, severity, affects, champion, champion_email, target_date, status, escalate, escalation_reason, council_theme, notes, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insA = H.prepare(`INSERT INTO md_issue_updates (issue_id, author_id, author_name, body, status_change, escalate_change) VALUES (?,?,?,?,?,?)`);
      let ix = 0;
      for (const iss of (state.issues || [])) {
        if (!iss.title || !iss.category) { ix++; continue; }
        const terminal = (iss.status === 'resolved' || iss.status === 'cancelled');
        const closed_at = terminal ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
        const esc = iss.escalate ? 1 : 0;
        if (iss.id && oldById[iss.id]) {
          incoming.add(iss.id);
          await updI.run(iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM', iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null, iss.status || 'open', esc, iss.escalation_reason || null, iss.council_theme || null, iss.notes || '', closed_at, iss.id, meetingId);
          const old = oldById[iss.id];
          const sc = old.status !== (iss.status || 'open') ? (iss.status || 'open') : null;
          const ec = old.escalate !== esc ? esc : null;
          if (sc || ec) await insA.run(iss.id, userId || null, state.author_name || null, iss.update_comment || null, sc, ec);
        } else {
          const r = await insI.run(meetingId, iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM', iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null, iss.status || 'open', esc, iss.escalation_reason || null, iss.council_theme || null, iss.notes || '', closed_at);
          await insA.run(r.lastID, userId || null, state.author_name || null, iss.update_comment || 'Issue created.', iss.status || 'open', esc);
        }
        ix++;
      }
      for (const o of oldIssues) { if (!incoming.has(o.id)) await H.prepare('DELETE FROM md_issues WHERE id = ?').run(o.id); }
    }
    if (state.actions !== undefined) {
      await H.prepare('DELETE FROM md_actions WHERE meeting_id = ?').run(meetingId);
      const insAc = H.prepare(`INSERT INTO md_actions (meeting_id, ord, description, owner_it, owner_email, target_date, status, linked_issue_id, closed_at) VALUES (?,?,?,?,?,?,?,?,?)`);
      const issuesAfter = await H.prepare('SELECT id, ord FROM md_issues WHERE meeting_id = ? ORDER BY ord, id').all(meetingId);
      let ix = 0;
      for (const a of (state.actions || [])) {
        if (!a.description) { ix++; continue; }
        let linked = null;
        if (a.linked_issue_id) linked = a.linked_issue_id;
        else if (a.linked_issue_ord) { const ord = parseInt(a.linked_issue_ord, 10); const m = issuesAfter[ord - 1]; if (m) linked = m.id; }
        const terminal = (a.status === 'resolved' || a.status === 'cancelled');
        const closed_at = terminal ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
        await insAc.run(meetingId, a.ord || ix, a.description, a.owner_it || '', a.owner_email || '', a.target_date || null, a.status || 'open', linked, closed_at);
        ix++;
      }
    }
  });
  const saved = await H.prepare('SELECT id FROM md_meetings WHERE reference = ?').get(reference);
  return { id: saved && saved.id, reference, created: !exist };
}

/** Append an audit-trail update to one issue. */
function addIssueUpdate(issueId, opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _addIssueUpdatePg(issueId, opts);
  const db = getDB();
  const issue = db.prepare('SELECT id, status, escalate FROM md_issues WHERE id = ?').get(issueId);
  if (!issue) throw new Error('Issue not found');
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO md_issue_updates (issue_id, author_id, author_name, body, status_change, escalate_change)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(issueId, opts.author_id || null, opts.author_name || null, opts.body || null,
      opts.status_change || null, opts.escalate_change ?? null);
    if (opts.status_change && opts.status_change !== issue.status) {
      const terminal = (opts.status_change === 'resolved' || opts.status_change === 'cancelled');
      db.prepare(`
        UPDATE md_issues
          SET status = ?, closed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE closed_at END,
              updated_at = datetime('now')
        WHERE id = ?
      `).run(opts.status_change, terminal ? 1 : 0, issueId);
    }
    if (opts.escalate_change !== null && opts.escalate_change !== undefined && opts.escalate_change !== issue.escalate) {
      db.prepare(`UPDATE md_issues SET escalate = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(opts.escalate_change ? 1 : 0, issueId);
    }
  });
  tx();
}

/** Flat list of all issues across all meetings — drives the Issues Log view. */
function listIssues(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _listIssuesPg(opts);
  const db = getDB();
  const where = [];
  const params = {};
  if (opts.site)        { where.push('m.site_code = @site');        params.site = opts.site; }
  if (opts.department)  { where.push('m.department = @department'); params.department = opts.department; }
  if (opts.category)    { where.push('i.category = @category');     params.category = opts.category; }
  if (opts.severity)    { where.push('i.severity = @severity');     params.severity = opts.severity; }
  if (opts.status)      { where.push('i.status = @status');         params.status = opts.status; }
  if (opts.escalate !== undefined) { where.push('i.escalate = @esc'); params.esc = opts.escalate ? 1 : 0; }
  if (opts.council_theme) { where.push('i.council_theme = @ct');    params.ct = opts.council_theme; }
  if (opts.from)        { where.push('m.meeting_date >= @from');    params.from = opts.from; }
  if (opts.to)          { where.push('m.meeting_date <= @to');      params.to = opts.to; }
  if (opts.q) {
    where.push('(i.title LIKE @q OR i.description LIKE @q OR i.champion LIKE @q OR i.affects LIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT
      i.*,
      m.reference     AS meeting_reference,
      m.site_code     AS site_code,
      m.department    AS department,
      m.meeting_date  AS meeting_date,
      m.id            AS meeting_id_ref
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    ${w}
    ORDER BY
      CASE WHEN i.status IN ('resolved','cancelled') THEN 1 ELSE 0 END,
      CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
      CASE WHEN i.target_date IS NULL THEN 1 ELSE 0 END,
      i.target_date ASC,
      m.meeting_date DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = opts.limit || 500;
  params.offset = opts.offset || 0;
  return db.prepare(sql).all(params);
}

/** Council Escalations view — all issues where escalate = 1, grouped at render-time by theme. */
function listEscalations(opts = {}) {
  return listIssues(Object.assign({}, opts, { escalate: true }));
}

/**
 * Append an audit update to one action + optionally change its status.
 * Mirrors addIssueUpdate. Terminal statuses (resolved / cancelled) stamp
 * closed_at. Intentionally does NOT care about the parent meeting's status:
 * actions are living commitments that routinely outlive a signed/closed PV,
 * so the Actions Register can close them even after the meeting is closed.
 * (Site-scoping for editors is enforced at the route layer.)
 */
function addActionUpdate(actionId, opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _addActionUpdatePg(actionId, opts);
  const db = getDB();
  const action = db.prepare('SELECT id, status FROM md_actions WHERE id = ?').get(actionId);
  if (!action) throw new Error('Action not found');
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO md_action_updates (action_id, author_id, author_name, body, status_change)
      VALUES (?, ?, ?, ?, ?)
    `).run(actionId, opts.author_id || null, opts.author_name || null, opts.body || null,
      opts.status_change || null);
    if (opts.status_change && opts.status_change !== action.status) {
      const terminal = (opts.status_change === 'resolved' || opts.status_change === 'cancelled' || opts.status_change === 'closed');
      db.prepare(`
        UPDATE md_actions
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
  if (MEETINGS_BACKEND === 'postgres') return _listActionUpdatesPg(actionId);
  return getDB().prepare(
    'SELECT * FROM md_action_updates WHERE action_id = ? ORDER BY id DESC'
  ).all(actionId);
}

/** Parent meeting's site + status for one issue (route-layer site scoping). */
function getIssueParent(issueId) {
  if (MEETINGS_BACKEND === 'postgres') return _getIssueParentPg(issueId);
  return getDB().prepare(`
    SELECT m.id AS id, m.site_code AS site_code, m.status AS status
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE i.id = ?
  `).get(issueId) || null;
}

/** Parent meeting's site + status for one action (route-layer site scoping). */
function getActionParent(actionId) {
  if (MEETINGS_BACKEND === 'postgres') return _getActionParentPg(actionId);
  return getDB().prepare(`
    SELECT m.site_code AS site_code, m.status AS meeting_status
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE a.id = ?
  `).get(actionId) || null;
}

// ── Async postgres forks: issue/action updates + parents (Chunk 2) ──────────
async function _addIssueUpdatePg(issueId, opts = {}) {
  const H = pgHandle();
  const issue = await H.prepare('SELECT id, status, escalate FROM md_issues WHERE id = ?').get(issueId);
  if (!issue) throw new Error('Issue not found');
  await H.runTransaction(async () => {
    await H.prepare(`INSERT INTO md_issue_updates (issue_id, author_id, author_name, body, status_change, escalate_change) VALUES (?,?,?,?,?,?)`)
      .run(issueId, opts.author_id || null, opts.author_name || null, opts.body || null, opts.status_change || null, opts.escalate_change ?? null);
    if (opts.status_change && opts.status_change !== issue.status) {
      const terminal = (opts.status_change === 'resolved' || opts.status_change === 'cancelled');
      await H.prepare(`UPDATE md_issues SET status = ?, closed_at = CASE WHEN ? = 1 THEN to_char(now(),'YYYY-MM-DD HH24:MI:SS') ELSE closed_at END, updated_at = now() WHERE id = ?`)
        .run(opts.status_change, terminal ? 1 : 0, issueId);
    }
    if (opts.escalate_change !== null && opts.escalate_change !== undefined && opts.escalate_change !== issue.escalate) {
      await H.prepare(`UPDATE md_issues SET escalate = ?, updated_at = now() WHERE id = ?`).run(opts.escalate_change ? 1 : 0, issueId);
    }
  });
}
async function _listIssuesPg(opts = {}) {
  const where = [], params = {};
  if (opts.site)        { where.push('m.site_code = @site');        params.site = opts.site; }
  if (opts.department)  { where.push('m.department = @department'); params.department = opts.department; }
  if (opts.category)    { where.push('i.category = @category');     params.category = opts.category; }
  if (opts.severity)    { where.push('i.severity = @severity');     params.severity = opts.severity; }
  if (opts.status)      { where.push('i.status = @status');         params.status = opts.status; }
  if (opts.escalate !== undefined) { where.push('i.escalate = @esc'); params.esc = opts.escalate ? 1 : 0; }
  if (opts.council_theme) { where.push('i.council_theme = @ct');    params.ct = opts.council_theme; }
  if (opts.from)        { where.push('m.meeting_date >= @from');    params.from = opts.from; }
  if (opts.to)          { where.push('m.meeting_date <= @to');      params.to = opts.to; }
  if (opts.q) {
    where.push('(i.title ILIKE @q OR i.description ILIKE @q OR i.champion ILIKE @q OR i.affects ILIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.limit = opts.limit || 500; params.offset = opts.offset || 0;
  return pgHandle().prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.site_code AS site_code, m.department AS department,
           m.meeting_date AS meeting_date, m.id AS meeting_id_ref
    FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id ${w}
    ORDER BY CASE WHEN i.status IN ('resolved','cancelled') THEN 1 ELSE 0 END,
             CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
             CASE WHEN i.target_date IS NULL THEN 1 ELSE 0 END, i.target_date ASC, m.meeting_date DESC
    LIMIT @limit OFFSET @offset`).all(params);
}
async function _addActionUpdatePg(actionId, opts = {}) {
  const H = pgHandle();
  const action = await H.prepare('SELECT id, status FROM md_actions WHERE id = ?').get(actionId);
  if (!action) throw new Error('Action not found');
  await H.runTransaction(async () => {
    await H.prepare(`INSERT INTO md_action_updates (action_id, author_id, author_name, body, status_change) VALUES (?,?,?,?,?)`)
      .run(actionId, opts.author_id || null, opts.author_name || null, opts.body || null, opts.status_change || null);
    if (opts.status_change && opts.status_change !== action.status) {
      const terminal = (opts.status_change === 'resolved' || opts.status_change === 'cancelled' || opts.status_change === 'closed');
      await H.prepare(`UPDATE md_actions SET status = ?, closed_at = CASE WHEN ? = 1 THEN to_char(now(),'YYYY-MM-DD HH24:MI:SS') ELSE closed_at END, updated_at = now() WHERE id = ?`)
        .run(opts.status_change, terminal ? 1 : 0, actionId);
    }
  });
}
async function _listActionUpdatesPg(actionId) {
  return pgHandle().prepare('SELECT * FROM md_action_updates WHERE action_id = ? ORDER BY id DESC').all(actionId);
}
async function _getIssueParentPg(issueId) {
  return (await pgHandle().prepare(`SELECT m.id AS id, m.site_code AS site_code, m.status AS status
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id WHERE i.id = ?`).get(issueId)) || null;
}
async function _getActionParentPg(actionId) {
  return (await pgHandle().prepare(`SELECT m.site_code AS site_code, m.status AS meeting_status
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id WHERE a.id = ?`).get(actionId)) || null;
}

/**
 * Flat list of all actions across all meetings — drives the Actions Register.
 * Filters: site, department, status, owner (LIKE on champion name/email),
 * overdue (boolean), q (free text). Joins the parent meeting for reference /
 * site / department / status, and the linked issue title when present.
 */
function listActions(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _listActionsPg(opts);
  const db = getDB();
  const where = [];
  const params = {};
  if (opts.site)       { where.push('m.site_code = @site COLLATE NOCASE');         params.site = opts.site; }
  if (opts.department) { where.push('m.department = @department COLLATE NOCASE');  params.department = opts.department; }
  if (opts.status)     { where.push('a.status = @status');                          params.status = opts.status; }
  if (opts.owner) {
    where.push('(a.owner_it LIKE @owner OR a.owner_email LIKE @owner)');
    params.owner = '%' + opts.owner + '%';
  }
  if (opts.overdue) {
    where.push("a.target_date IS NOT NULL AND a.target_date < date('now') AND a.status NOT IN ('resolved','cancelled','closed')");
  }
  if (opts.from)       { where.push('m.meeting_date >= @from'); params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');   params.to = opts.to; }
  if (opts.q) {
    where.push('(a.description LIKE @q OR a.owner_it LIKE @q OR a.owner_email LIKE @q)');
    params.q = '%' + opts.q + '%';
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `
    SELECT
      a.*,
      m.reference     AS meeting_reference,
      m.site_code     AS site_code,
      m.department    AS department,
      m.meeting_date  AS meeting_date,
      m.status        AS meeting_status,
      m.id            AS meeting_id_ref,
      li.title        AS linked_issue_title
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    LEFT JOIN md_issues li ON li.id = a.linked_issue_id
    ${w}
    ORDER BY
      CASE WHEN a.status IN ('resolved','cancelled','closed') THEN 1 ELSE 0 END,
      CASE WHEN a.target_date IS NULL THEN 1 ELSE 0 END,
      a.target_date ASC,
      m.meeting_date DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = opts.limit || 1000;
  params.offset = opts.offset || 0;
  return db.prepare(sql).all(params);
}

/**
 * Full-table export for the "Download Excel" feature — every PV, issue,
 * action and project across ALL meetings (no filter, no LIMIT). Backend-
 * agnostic: `await handle.prepare(sql).all()` resolves for both the sync
 * sqlite handle and the async pg handle. Attachments (base64 blobs) and
 * lookup tables are intentionally excluded.
 */
async function exportRows() {
  const H = MEETINGS_BACKEND === 'postgres' ? pgHandle() : getDB();
  const meetings = await H.prepare(`SELECT * FROM md_meetings ORDER BY meeting_date DESC, id`).all();
  const issues = await H.prepare(`
    SELECT iss.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_issues iss JOIN md_meetings m ON m.id = iss.meeting_id
     ORDER BY m.meeting_date DESC, iss.meeting_id, iss.ord`).all();
  const actions = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     ORDER BY m.meeting_date DESC, a.meeting_id, a.ord`).all();
  const projects = await H.prepare(`
    SELECT p.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_meeting_projects p JOIN md_meetings m ON m.id = p.meeting_id
     ORDER BY m.meeting_date DESC, p.meeting_id, p.ord`).all();
  return { meetings, issues, actions, projects };
}

async function _listActionsPg(opts = {}) {
  const where = [], params = {};
  if (opts.site)       { where.push('lower(m.site_code) = lower(@site)');        params.site = opts.site; }
  if (opts.department) { where.push('lower(m.department) = lower(@department)'); params.department = opts.department; }
  if (opts.status)     { where.push('a.status = @status');                       params.status = opts.status; }
  if (opts.owner)      { where.push('(a.owner_it ILIKE @owner OR a.owner_email ILIKE @owner)'); params.owner = '%' + opts.owner + '%'; }
  if (opts.overdue)    { where.push("a.target_date IS NOT NULL AND a.target_date < to_char(current_date,'YYYY-MM-DD') AND a.status NOT IN ('resolved','cancelled','closed')"); }
  if (opts.from)       { where.push('m.meeting_date >= @from'); params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');   params.to = opts.to; }
  if (opts.q)          { where.push('(a.description ILIKE @q OR a.owner_it ILIKE @q OR a.owner_email ILIKE @q)'); params.q = '%' + opts.q + '%'; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.limit = opts.limit || 1000; params.offset = opts.offset || 0;
  return pgHandle().prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.site_code AS site_code, m.department AS department,
           m.meeting_date AS meeting_date, m.status AS meeting_status, m.id AS meeting_id_ref, li.title AS linked_issue_title
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    LEFT JOIN md_issues li ON li.id = a.linked_issue_id ${w}
    ORDER BY CASE WHEN a.status IN ('resolved','cancelled','closed') THEN 1 ELSE 0 END,
             CASE WHEN a.target_date IS NULL THEN 1 ELSE 0 END, a.target_date ASC, m.meeting_date DESC
    LIMIT @limit OFFSET @offset`).all(params);
}

/**
 * Insights — chart-shaped analytical roll-up for the meetings-insights.html
 * dashboard. Returns 7 separate datasets in one trip so the front-end can
 * render the whole page with a single round-trip.
 *
 *   period          {from, to, months}      Echoed back for label rendering
 *   monthly         [{month, meetings, issues_opened, issues_closed, escalated}]
 *                                           — Backfilled with zero-rows for inactive
 *                                             months so the line chart doesn't
 *                                             skip gaps.
 *   by_month_site   [{month, site, n}]      Stacked-bar source.
 *   by_category     [{category, n, high_n, esc_n}]  Top 12, descending.
 *   by_severity     [{severity, n}]         Donut source.
 *   by_council_theme[{theme, n}]            Escalations only (escalate=1).
 *   compliance_heatmap [{site, e1..e5, raw…}]  Per-site 5-Engagements fraction
 *                                                in [0..1], or null when N/A.
 *                                                E4 is null (placeholder).
 *   site_leaderboard [{site, meetings, issues, high, escalations, overdue,
 *                       champion_pct, diffused_48h_pct, engagement_1,
 *                       escalation_disc, score}]
 *                                           — `score` = simple unweighted mean
 *                                             of the non-null engagement scores
 *                                             (Option A per user choice).
 *
 * Default period = last 6 calendar months including current (ITSM standard
 * visibility window per CLAUDE.md doctrine). `from` / `to` are inclusive
 * 'YYYY-MM-DD' bounds. `site` and `department` filter all 7 datasets so the
 * page can be sliced by site/department from the header filter bar without
 * extra round-trips.
 */
function insights(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _insightsPg(opts);
  const db = getDB();

  // Default period: trailing 6 months (current month inclusive).
  // Anchored on the 1st of the start month so the monthly time-series
  // doesn't truncate the first month of the window.
  const todayD = new Date();
  const sixMoStart = new Date(todayD.getFullYear(), todayD.getMonth() - 5, 1);
  const from = opts.from || sixMoStart.toISOString().slice(0, 10);
  const to   = opts.to   || todayD.toISOString().slice(0, 10);

  const extra = [];
  const params = { from, to };
  if (opts.site)       { extra.push('m.site_code = @site');         params.site = opts.site; }
  if (opts.department) { extra.push('m.department = @department');  params.department = opts.department; }
  const extraW = extra.length ? ' AND ' + extra.join(' AND ') : '';

  // ── 1. Monthly time-series ──────────────────────────────────
  // LEFT JOIN issues so months with PVs but zero issues still surface.
  const monthlyRaw = db.prepare(`
    SELECT
      strftime('%Y-%m', m.meeting_date) AS month,
      COUNT(DISTINCT m.id)              AS meetings,
      COUNT(i.id)                       AS issues_opened,
      SUM(CASE WHEN i.status IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS issues_closed,
      SUM(CASE WHEN i.escalate = 1                     THEN 1 ELSE 0 END) AS escalated
    FROM md_meetings m
    LEFT JOIN md_issues i ON i.meeting_id = m.id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY strftime('%Y-%m', m.meeting_date)
    ORDER BY month ASC
  `).all(params);
  const monthly = _backfillMonths(monthlyRaw, from, to);

  // ── 2. Meetings × site × month (stacked-bar source) ────────
  const byMonthSite = db.prepare(`
    SELECT
      strftime('%Y-%m', m.meeting_date) AS month,
      m.site_code                       AS site,
      COUNT(*)                          AS n
    FROM md_meetings m
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY month, m.site_code
    ORDER BY month ASC, m.site_code ASC
  `).all(params);

  // ── 3. Issues by category (top 12) ─────────────────────────
  const byCategory = db.prepare(`
    SELECT
      i.category                                                    AS category,
      COUNT(*)                                                      AS n,
      SUM(CASE WHEN i.severity = 'HIGH' THEN 1 ELSE 0 END)          AS high_n,
      SUM(CASE WHEN i.escalate = 1      THEN 1 ELSE 0 END)          AS esc_n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY i.category
    ORDER BY n DESC
    LIMIT 12
  `).all(params);

  // ── 4. Issues by severity (donut source) ───────────────────
  const bySeverity = db.prepare(`
    SELECT i.severity AS severity, COUNT(*) AS n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY i.severity
  `).all(params);

  // ── 5. Council escalations by theme ────────────────────────
  // Bucket missing themes as '_unset' so the bar chart can surface them.
  const byCouncilTheme = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(i.council_theme), ''), '_unset') AS theme,
      COUNT(*) AS n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW} AND i.escalate = 1
    GROUP BY theme
    ORDER BY n DESC
  `).all(params);

  // ── 6. Compliance heatmap raw data ─────────────────────────
  // 3 separate queries instead of correlated subqueries — avoids row
  // explosion from the m × i × a join and keeps SQL legible.
  const heatmapBase = db.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS meetings_count,
      SUM(CASE WHEN m.submitted_at IS NOT NULL
                AND julianday(m.submitted_at) - julianday(m.meeting_date) <= 2
               THEN 1 ELSE 0 END) AS diffused_48h
    FROM md_meetings m
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
  `).all(params);

  const actionStats = db.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS actions_total,
      SUM(CASE WHEN a.owner_it IS NOT NULL AND TRIM(a.owner_it) != ''
               THEN 1 ELSE 0 END) AS actions_with_champion
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
  `).all(params);

  const escDiscipline = db.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS escalated_total,
      SUM(CASE WHEN i.escalation_reason IS NOT NULL AND TRIM(i.escalation_reason) != ''
                AND i.council_theme    IS NOT NULL AND TRIM(i.council_theme)    != ''
               THEN 1 ELSE 0 END) AS escalated_complete
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW} AND i.escalate = 1
    GROUP BY m.site_code
  `).all(params);

  // Engagement #1 prorated target: 3 PVs per site per month.
  const numMonths = _diffMonthsInclusive(from, to);
  const actByS = Object.fromEntries(actionStats.map(r => [r.site, r]));
  const escByS = Object.fromEntries(escDiscipline.map(r => [r.site, r]));

  const complianceHeatmap = heatmapBase.map(r => {
    const a   = actByS[r.site] || { actions_total: 0, actions_with_champion: 0 };
    const e   = escByS[r.site] || { escalated_total: 0, escalated_complete: 0 };
    const e1  = numMonths > 0 ? Math.min(1, r.meetings_count / (3 * numMonths)) : null;
    const e2  = r.meetings_count   > 0 ? r.diffused_48h         / r.meetings_count   : null;
    const e3  = a.actions_total    > 0 ? a.actions_with_champion / a.actions_total    : null;
    // E4 — monthly feedback loop — placeholder until outbound comms log lands.
    const e4  = null;
    const e5  = e.escalated_total  > 0 ? e.escalated_complete    / e.escalated_total  : null;
    return {
      site: r.site, e1, e2, e3, e4, e5,
      meetings_count: r.meetings_count,
      diffused_48h:   r.diffused_48h,
      actions_total:  a.actions_total,
      actions_with_champion: a.actions_with_champion,
      escalated_total:       e.escalated_total,
      escalated_complete:    e.escalated_complete,
    };
  });

  // ── 7. Site leaderboard ─────────────────────────────────────
  const leaderboard = db.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(DISTINCT m.id) AS meetings,
      COUNT(i.id)          AS issues,
      SUM(CASE WHEN i.severity = 'HIGH' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN i.escalate = 1      THEN 1 ELSE 0 END) AS escalations,
      SUM(CASE WHEN i.target_date IS NOT NULL AND i.target_date < date('now')
                AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS overdue
    FROM md_meetings m
    LEFT JOIN md_issues i ON i.meeting_id = m.id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
    ORDER BY meetings DESC, site ASC
  `).all(params);

  // Composite score = simple mean of the non-null engagement scores
  // (Option A per user choice). E4 is excluded — it's a placeholder
  // until the outbound-comms log feature ships.
  const heatBySite = Object.fromEntries(complianceHeatmap.map(r => [r.site, r]));
  const siteLeaderboard = leaderboard.map(r => {
    const hm = heatBySite[r.site] || {};
    const scores = [hm.e1, hm.e2, hm.e3, hm.e5].filter(x => x != null && !isNaN(x));
    const score  = scores.length > 0 ? scores.reduce((a,b) => a+b, 0) / scores.length : null;
    return {
      ...r,
      engagement_1:     hm.e1     != null ? hm.e1     : null,
      diffused_48h_pct: hm.e2     != null ? hm.e2     : null,
      champion_pct:     hm.e3     != null ? hm.e3     : null,
      escalation_disc:  hm.e5     != null ? hm.e5     : null,
      score,
    };
  });

  return {
    period: { from, to, months: numMonths },
    monthly,
    by_month_site:      byMonthSite,
    by_category:        byCategory,
    by_severity:        bySeverity,
    by_council_theme:   byCouncilTheme,
    compliance_heatmap: complianceHeatmap,
    site_leaderboard:   siteLeaderboard,
  };
}

// ── Postgres fork of insights() ───────────────────────────────────────────
// Pure read path. Dialect rewrites vs the sqlite original:
//   strftime('%Y-%m', meeting_date)  → substr(meeting_date,1,7)  (TEXT col)
//   julianday(a)-julianday(b) <= 2   → (a::timestamptz - b::timestamptz) <= interval '2 days'
//   i.target_date < date('now')      → i.target_date < to_char(current_date,'YYYY-MM-DD') (lexical, TEXT col)
// The JS aggregation/scoring afterwards is identical to the sqlite path.
async function _insightsPg(opts = {}) {
  const H = pgHandle();

  const todayD = new Date();
  const sixMoStart = new Date(todayD.getFullYear(), todayD.getMonth() - 5, 1);
  const from = opts.from || sixMoStart.toISOString().slice(0, 10);
  const to   = opts.to   || todayD.toISOString().slice(0, 10);

  const extra = [];
  const params = { from, to };
  if (opts.site)       { extra.push('m.site_code = @site');        params.site = opts.site; }
  if (opts.department) { extra.push('m.department = @department'); params.department = opts.department; }
  const extraW = extra.length ? ' AND ' + extra.join(' AND ') : '';

  // 1. Monthly time-series
  const monthlyRaw = await H.prepare(`
    SELECT
      substr(m.meeting_date,1,7)        AS month,
      COUNT(DISTINCT m.id)              AS meetings,
      COUNT(i.id)                       AS issues_opened,
      SUM(CASE WHEN i.status IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS issues_closed,
      SUM(CASE WHEN i.escalate = 1                     THEN 1 ELSE 0 END) AS escalated
    FROM md_meetings m
    LEFT JOIN md_issues i ON i.meeting_id = m.id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY substr(m.meeting_date,1,7)
    ORDER BY month ASC
  `).all(params);
  const monthly = _backfillMonths(monthlyRaw, from, to);

  // 2. Meetings × site × month
  const byMonthSite = await H.prepare(`
    SELECT
      substr(m.meeting_date,1,7)        AS month,
      m.site_code                       AS site,
      COUNT(*)                          AS n
    FROM md_meetings m
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY substr(m.meeting_date,1,7), m.site_code
    ORDER BY month ASC, m.site_code ASC
  `).all(params);

  // 3. Issues by category (top 12)
  const byCategory = await H.prepare(`
    SELECT
      i.category                                                    AS category,
      COUNT(*)                                                      AS n,
      SUM(CASE WHEN i.severity = 'HIGH' THEN 1 ELSE 0 END)          AS high_n,
      SUM(CASE WHEN i.escalate = 1      THEN 1 ELSE 0 END)          AS esc_n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY i.category
    ORDER BY n DESC
    LIMIT 12
  `).all(params);

  // 4. Issues by severity
  const bySeverity = await H.prepare(`
    SELECT i.severity AS severity, COUNT(*) AS n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY i.severity
  `).all(params);

  // 5. Council escalations by theme
  const byCouncilTheme = await H.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(i.council_theme), ''), '_unset') AS theme,
      COUNT(*) AS n
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW} AND i.escalate = 1
    GROUP BY theme
    ORDER BY n DESC
  `).all(params);

  // 6. Compliance heatmap raw data
  const heatmapBase = await H.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS meetings_count,
      SUM(CASE WHEN m.submitted_at IS NOT NULL
                AND (m.submitted_at::timestamptz - m.meeting_date::timestamptz) <= interval '2 days'
               THEN 1 ELSE 0 END) AS diffused_48h
    FROM md_meetings m
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
  `).all(params);

  const actionStats = await H.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS actions_total,
      SUM(CASE WHEN a.owner_it IS NOT NULL AND TRIM(a.owner_it) != ''
               THEN 1 ELSE 0 END) AS actions_with_champion
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
  `).all(params);

  const escDiscipline = await H.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(*)    AS escalated_total,
      SUM(CASE WHEN i.escalation_reason IS NOT NULL AND TRIM(i.escalation_reason) != ''
                AND i.council_theme    IS NOT NULL AND TRIM(i.council_theme)    != ''
               THEN 1 ELSE 0 END) AS escalated_complete
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW} AND i.escalate = 1
    GROUP BY m.site_code
  `).all(params);

  const numMonths = _diffMonthsInclusive(from, to);
  const actByS = Object.fromEntries(actionStats.map(r => [r.site, r]));
  const escByS = Object.fromEntries(escDiscipline.map(r => [r.site, r]));

  const complianceHeatmap = heatmapBase.map(r => {
    const a   = actByS[r.site] || { actions_total: 0, actions_with_champion: 0 };
    const e   = escByS[r.site] || { escalated_total: 0, escalated_complete: 0 };
    const e1  = numMonths > 0 ? Math.min(1, r.meetings_count / (3 * numMonths)) : null;
    const e2  = r.meetings_count   > 0 ? r.diffused_48h         / r.meetings_count   : null;
    const e3  = a.actions_total    > 0 ? a.actions_with_champion / a.actions_total    : null;
    const e4  = null;
    const e5  = e.escalated_total  > 0 ? e.escalated_complete    / e.escalated_total  : null;
    return {
      site: r.site, e1, e2, e3, e4, e5,
      meetings_count: r.meetings_count,
      diffused_48h:   r.diffused_48h,
      actions_total:  a.actions_total,
      actions_with_champion: a.actions_with_champion,
      escalated_total:       e.escalated_total,
      escalated_complete:    e.escalated_complete,
    };
  });

  // 7. Site leaderboard
  const leaderboard = await H.prepare(`
    SELECT
      m.site_code AS site,
      COUNT(DISTINCT m.id) AS meetings,
      COUNT(i.id)          AS issues,
      SUM(CASE WHEN i.severity = 'HIGH' THEN 1 ELSE 0 END) AS high,
      SUM(CASE WHEN i.escalate = 1      THEN 1 ELSE 0 END) AS escalations,
      SUM(CASE WHEN i.target_date IS NOT NULL AND i.target_date < to_char(current_date,'YYYY-MM-DD')
                AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS overdue
    FROM md_meetings m
    LEFT JOIN md_issues i ON i.meeting_id = m.id
    WHERE m.meeting_date BETWEEN @from AND @to ${extraW}
    GROUP BY m.site_code
    ORDER BY meetings DESC, site ASC
  `).all(params);

  const heatBySite = Object.fromEntries(complianceHeatmap.map(r => [r.site, r]));
  const siteLeaderboard = leaderboard.map(r => {
    const hm = heatBySite[r.site] || {};
    const scores = [hm.e1, hm.e2, hm.e3, hm.e5].filter(x => x != null && !isNaN(x));
    const score  = scores.length > 0 ? scores.reduce((a,b) => a+b, 0) / scores.length : null;
    return {
      ...r,
      engagement_1:     hm.e1     != null ? hm.e1     : null,
      diffused_48h_pct: hm.e2     != null ? hm.e2     : null,
      champion_pct:     hm.e3     != null ? hm.e3     : null,
      escalation_disc:  hm.e5     != null ? hm.e5     : null,
      score,
    };
  });

  return {
    period: { from, to, months: numMonths },
    monthly,
    by_month_site:      byMonthSite,
    by_category:        byCategory,
    by_severity:        bySeverity,
    by_council_theme:   byCouncilTheme,
    compliance_heatmap: complianceHeatmap,
    site_leaderboard:   siteLeaderboard,
  };
}

// Number of calendar months a [from, to] window spans, inclusive of both
// endpoints. Used to prorate Engagement #1's "3 PVs per month" target.
function _diffMonthsInclusive(from, to) {
  const d1 = new Date(from);
  const d2 = new Date(to);
  if (isNaN(d1) || isNaN(d2)) return 0;
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
}

// Backfill the monthly time-series with zero rows for inactive months
// so charts render gaps as 0 instead of compressing the x-axis.
// Safety cap at 36 months to prevent runaway from a malformed range.
function _backfillMonths(rows, from, to) {
  const known = Object.fromEntries(rows.map(r => [r.month, r]));
  const out = [];
  const cursor = new Date(from);
  const end    = new Date(to);
  if (isNaN(cursor) || isNaN(end)) return rows;
  // Anchor cursor on the 1st of the month so date arithmetic doesn't drift
  // when from is e.g. the 31st (next-month +1 = March 3rd, skipping Feb).
  cursor.setDate(1);
  end.setDate(1);
  let guard = 0;
  while (cursor <= end && guard < 36) {
    const k = cursor.toISOString().slice(0, 7);
    out.push(known[k] || {
      month: k, meetings: 0, issues_opened: 0, issues_closed: 0, escalated: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
    guard++;
  }
  return out;
}

/** KPI aggregate for the meetings dashboard. */
function aggregate(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _aggregatePg(opts);
  const db = getDB();
  const where  = [];
  const params = {};
  if (opts.site)       { where.push('m.site_code = @site');         params.site = opts.site; }
  if (opts.department) { where.push('m.department = @department');  params.department = opts.department; }
  if (opts.from)       { where.push('m.meeting_date >= @from');     params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');       params.to = opts.to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const meetingCounts = db.prepare(`
    SELECT
      COUNT(*) AS total_meetings,
      SUM(CASE WHEN m.status = 'draft'     THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN m.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
      SUM(CASE WHEN m.status = 'signed'    THEN 1 ELSE 0 END) AS signed_count,
      SUM(CASE WHEN m.status = 'closed'    THEN 1 ELSE 0 END) AS closed_count,
      COUNT(DISTINCT m.department) AS departments_covered
    FROM md_meetings m ${w}
  `).get(params);

  const issueCounts = db.prepare(`
    SELECT
      COUNT(*) AS total_issues,
      SUM(CASE WHEN i.severity = 'HIGH'   THEN 1 ELSE 0 END) AS high_issues,
      SUM(CASE WHEN i.severity = 'MEDIUM' THEN 1 ELSE 0 END) AS medium_issues,
      SUM(CASE WHEN i.severity = 'LOW'    THEN 1 ELSE 0 END) AS low_issues,
      SUM(CASE WHEN i.status IN ('resolved','cancelled') THEN 0 ELSE 1 END) AS open_issues,
      SUM(CASE WHEN i.escalate = 1 AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS escalated_open,
      SUM(CASE WHEN i.escalate = 1 THEN 1 ELSE 0 END) AS total_escalated,
      SUM(CASE WHEN i.target_date IS NOT NULL AND i.target_date < date('now')
                AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS overdue_issues
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    ${w}
  `).get(params);

  const byCategory = db.prepare(`
    SELECT i.category, COUNT(*) AS n,
           SUM(CASE WHEN i.severity = 'HIGH' THEN 1 ELSE 0 END) AS high_n,
           SUM(CASE WHEN i.escalate = 1 THEN 1 ELSE 0 END) AS esc_n
    FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
    ${w}
    GROUP BY i.category
    ORDER BY n DESC
  `).all(params);

  const byTheme = db.prepare(`
    SELECT i.council_theme, COUNT(*) AS n
    FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
    ${w} ${w ? 'AND' : 'WHERE'} i.escalate = 1
    GROUP BY i.council_theme
    ORDER BY n DESC
  `).all(params);

  return {
    meetings: meetingCounts,
    issues:   issueCounts,
    by_category: byCategory,
    by_council_theme: byTheme,
  };
}

/**
 * Compliance monitor for the 5 Engagements. Returns per-site counts so
 * the UI can render a leaderboard. `month` parameter expected as 'YYYY-MM'.
 */
function compliance(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _compliancePg(opts);
  const db = getDB();
  const month = opts.month || new Date().toISOString().slice(0, 7);
  const monthFirst = `${month}-01`;
  const monthLast  = `${month}-31`;

  // Per-site meeting count for the month
  const perSite = db.prepare(`
    SELECT m.site_code,
           COUNT(*) AS meetings_this_month,
           SUM(CASE WHEN m.submitted_at IS NOT NULL
                     AND julianday(m.submitted_at) - julianday(m.meeting_date) <= 2 THEN 1 ELSE 0 END) AS diffused_in_48h,
           SUM(CASE WHEN m.status IN ('signed','closed') THEN 1 ELSE 0 END) AS signed_count
    FROM md_meetings m
    WHERE m.meeting_date BETWEEN ? AND ?
    GROUP BY m.site_code
    ORDER BY m.site_code
  `).all(monthFirst, monthLast);

  // Champion compliance: count actions with no owner_it
  const actionStats = db.prepare(`
    SELECT
      COUNT(*) AS total_actions,
      SUM(CASE WHEN a.owner_it IS NULL OR TRIM(a.owner_it) = '' THEN 1 ELSE 0 END) AS actions_without_champion
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    WHERE m.meeting_date BETWEEN ? AND ?
  `).get(monthFirst, monthLast);

  // Escalation discipline: count issues marked escalate=1 with no escalation_reason or no council_theme
  const escalationStats = db.prepare(`
    SELECT
      COUNT(*) AS total_escalated,
      SUM(CASE WHEN i.escalation_reason IS NULL OR TRIM(i.escalation_reason) = '' THEN 1 ELSE 0 END) AS missing_reason,
      SUM(CASE WHEN i.council_theme     IS NULL OR TRIM(i.council_theme)     = '' THEN 1 ELSE 0 END) AS missing_theme
    FROM md_issues i
    JOIN md_meetings m ON m.id = i.meeting_id
    WHERE m.meeting_date BETWEEN ? AND ? AND i.escalate = 1
  `).get(monthFirst, monthLast);

  return {
    month,
    per_site: perSite,
    actions: actionStats,
    escalations: escalationStats,
  };
}

// ── Async postgres forks: aggregate + compliance (Chunk 2) ──────────────────
async function _aggregatePg(opts = {}) {
  const H = pgHandle();
  const where = [], params = {};
  if (opts.site)       { where.push('m.site_code = @site');        params.site = opts.site; }
  if (opts.department) { where.push('m.department = @department'); params.department = opts.department; }
  if (opts.from)       { where.push('m.meeting_date >= @from');    params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');      params.to = opts.to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const meetings = await H.prepare(`SELECT COUNT(*) AS total_meetings,
      SUM(CASE WHEN m.status='draft' THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN m.status='submitted' THEN 1 ELSE 0 END) AS submitted_count,
      SUM(CASE WHEN m.status='signed' THEN 1 ELSE 0 END) AS signed_count,
      SUM(CASE WHEN m.status='closed' THEN 1 ELSE 0 END) AS closed_count,
      COUNT(DISTINCT m.department) AS departments_covered FROM md_meetings m ${w}`).get(params);
  const issues = await H.prepare(`SELECT COUNT(*) AS total_issues,
      SUM(CASE WHEN i.severity='HIGH' THEN 1 ELSE 0 END) AS high_issues,
      SUM(CASE WHEN i.severity='MEDIUM' THEN 1 ELSE 0 END) AS medium_issues,
      SUM(CASE WHEN i.severity='LOW' THEN 1 ELSE 0 END) AS low_issues,
      SUM(CASE WHEN i.status IN ('resolved','cancelled') THEN 0 ELSE 1 END) AS open_issues,
      SUM(CASE WHEN i.escalate=1 AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS escalated_open,
      SUM(CASE WHEN i.escalate=1 THEN 1 ELSE 0 END) AS total_escalated,
      SUM(CASE WHEN i.target_date IS NOT NULL AND i.target_date < to_char(current_date,'YYYY-MM-DD') AND i.status NOT IN ('resolved','cancelled') THEN 1 ELSE 0 END) AS overdue_issues
      FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id ${w}`).get(params);
  const by_category = await H.prepare(`SELECT i.category, COUNT(*) AS n,
      SUM(CASE WHEN i.severity='HIGH' THEN 1 ELSE 0 END) AS high_n,
      SUM(CASE WHEN i.escalate=1 THEN 1 ELSE 0 END) AS esc_n
      FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id ${w} GROUP BY i.category ORDER BY n DESC`).all(params);
  const by_council_theme = await H.prepare(`SELECT i.council_theme, COUNT(*) AS n
      FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id ${w} ${w ? 'AND' : 'WHERE'} i.escalate=1
      GROUP BY i.council_theme ORDER BY n DESC`).all(params);
  return { meetings, issues, by_category, by_council_theme };
}
async function _compliancePg(opts = {}) {
  const H = pgHandle();
  const month = opts.month || new Date().toISOString().slice(0, 7);
  const monthFirst = `${month}-01`, monthLast = `${month}-31`;
  const per_site = await H.prepare(`SELECT m.site_code, COUNT(*) AS meetings_this_month,
      SUM(CASE WHEN m.submitted_at IS NOT NULL AND (m.submitted_at::timestamptz - m.meeting_date::timestamptz) <= interval '2 days' THEN 1 ELSE 0 END) AS diffused_in_48h,
      SUM(CASE WHEN m.status IN ('signed','closed') THEN 1 ELSE 0 END) AS signed_count
      FROM md_meetings m WHERE m.meeting_date BETWEEN ? AND ? GROUP BY m.site_code ORDER BY m.site_code`).all(monthFirst, monthLast);
  const actions = await H.prepare(`SELECT COUNT(*) AS total_actions,
      SUM(CASE WHEN a.owner_it IS NULL OR TRIM(a.owner_it)='' THEN 1 ELSE 0 END) AS actions_without_champion
      FROM md_actions a JOIN md_meetings m ON m.id=a.meeting_id WHERE m.meeting_date BETWEEN ? AND ?`).get(monthFirst, monthLast);
  const escalations = await H.prepare(`SELECT COUNT(*) AS total_escalated,
      SUM(CASE WHEN i.escalation_reason IS NULL OR TRIM(i.escalation_reason)='' THEN 1 ELSE 0 END) AS missing_reason,
      SUM(CASE WHEN i.council_theme IS NULL OR TRIM(i.council_theme)='' THEN 1 ELSE 0 END) AS missing_theme
      FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id WHERE m.meeting_date BETWEEN ? AND ? AND i.escalate=1`).get(monthFirst, monthLast);
  return { month, per_site, actions, escalations };
}

function deleteMeeting(id) {
  if (MEETINGS_BACKEND === 'postgres') return _deleteMeetingPg(id);
  const db = getDB();
  // Snapshot DB BEFORE the destructive write. Meetings have nested
  // issues, actions, attachments, and audit-trail updates that all
  // cascade-delete with the parent — a backup is the only practical
  // way to recover if the deletion was a mistake. If backup throws,
  // the delete never runs. Path is logged to pm2 ([Backup] meetings -> …).
  _backup(db, 'pre-delete-meeting-' + String(id || 'unknown').slice(0, 30));
  const info = db.prepare('DELETE FROM md_meetings WHERE id = ?').run(id);
  return info.changes > 0;
}

// Shared backup wrapper — see db-backup.js. Same convention as
// tracker-db and inspection-db so backups across modules live
// side-by-side in data/backups/ with predictable filenames.
function _backup(db, reason) {
  const { backupDatabase } = require('./db-backup.js');
  return backupDatabase(db, 'meetings', reason);
}

function getMeetingStatus(id) {
  if (MEETINGS_BACKEND === 'postgres') return _getMeetingStatusPg(id);
  const db  = getDB();
  const row = db.prepare('SELECT status, site_code FROM md_meetings WHERE id = ?').get(id);
  return row || null;
}

function resetLookups() {
  if (MEETINGS_BACKEND === 'postgres') return _resetLookupsPg();
  const db = getDB();
  // Backup BEFORE wiping the lookup tables. Same rationale as the
  // inspection module's resetLookups — doesn't touch meeting rows
  // themselves but losing the lookups breaks the form UX until the
  // seed re-runs. Backup gives a one-step rollback if the seed
  // unexpectedly changed shape between releases.
  _backup(db, 'pre-reset-lookups');
  db.exec(`
    DELETE FROM md_intake_sources;
    DELETE FROM md_departments;
    DELETE FROM md_categories;
    DELETE FROM md_severities;
    DELETE FROM md_statuses;
    DELETE FROM md_meeting_statuses;
    DELETE FROM md_escalation_reasons;
    DELETE FROM md_council_themes;
    DELETE FROM md_project_phases;
    DELETE FROM md_it_involvement;
    DELETE FROM md_engagements;
  `);
  _seedLookups(db);
}

// ── Parametrable list helpers — admin can extend any lookup at runtime. ──
//
// The 11 lookup tables are the same set everywhere (POST add, PUT update,
// PATCH active, GET list). Centralise the allowlist so adding a new lookup
// is a one-line change.
const ALLOWED_LOOKUP_TABLES = [
  'md_intake_sources', 'md_departments', 'md_categories', 'md_severities',
  'md_statuses', 'md_meeting_statuses', 'md_escalation_reasons',
  'md_council_themes', 'md_project_phases', 'md_it_involvement', 'md_engagements',
];

function _assertLookupTable(table) {
  if (!ALLOWED_LOOKUP_TABLES.includes(table)) throw new Error('Disallowed lookup table');
}

// Discover the table's actual columns at runtime. Each lookup has a slightly
// different column set (md_categories has color+icon; md_severities has
// description_en/fr) — this lets the add/update functions silently drop
// any client-supplied keys that don't apply to the target table instead of
// crashing with "no such column".
function _lookupColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
}

/**
 * Insert ONE row into a lookup. Refuses to write if `code` already exists —
 * use updateLookupRow() to patch an existing row. (The underlying
 * _seedTable uses INSERT OR REPLACE which would silently clobber columns
 * absent from the patch back to their defaults, e.g. wiping display_order
 * to 0 or active to 1. Strict refuse here protects admins from that
 * surprise.)
 */
function addLookupRow(table, row) {
  if (MEETINGS_BACKEND === 'postgres') return _addLookupRowPg(table, row);
  _assertLookupTable(table);
  if (!row || typeof row !== 'object') throw new Error('Row body is required');
  if (!row.code || typeof row.code !== 'string') throw new Error('code is required');
  if (!row.name_en) throw new Error('name_en is required');

  const db = getDB();
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(row.code);
  if (exists) throw new Error(`Code "${row.code}" already exists in ${table.replace(/^md_/, '')} — use update instead.`);

  // Drop client keys that don't match an actual column on this table.
  const cols = _lookupColumns(db, table);
  const filtered = {};
  for (const k of Object.keys(row)) {
    if (cols.includes(k)) filtered[k] = row[k];
  }
  _seedTable(db, table, [filtered]);
  return { ok: true };
}

/**
 * List one lookup table. With { includeInactive: true } the admin sees
 * soft-deleted rows too (the dropdowns elsewhere in the app filter by
 * active=1 via loadLookups()). Sorted by display_order then code so the
 * admin UI is deterministic.
 */
function listLookupTable(table, opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _listLookupTablePg(table, opts);
  _assertLookupTable(table);
  const where = opts.includeInactive ? '' : 'WHERE active = 1';
  return getDB().prepare(`SELECT * FROM ${table} ${where} ORDER BY display_order, code`).all();
}

/**
 * Partial UPDATE — patch only the columns supplied. `code` itself is NOT
 * editable (it's the PK and the URL identifier); to rename a code, delete
 * the row and re-add with the new code.
 *
 * Editable columns are the universal four (name_en, name_fr, display_order,
 * active) plus per-table extras (color, icon, description_en/fr) when the
 * target table has them. Unknown keys are silently dropped so the client
 * doesn't have to know each table's schema.
 */
function updateLookupRow(table, code, patch) {
  if (MEETINGS_BACKEND === 'postgres') return _updateLookupRowPg(table, code, patch);
  _assertLookupTable(table);
  if (!code || typeof code !== 'string') throw new Error('code is required');

  const db = getDB();
  const cols = _lookupColumns(db, table);

  // Whitelist of columns the admin can touch (gates per-row tampering).
  const editable = ['name_en', 'name_fr', 'color', 'icon',
                    'description_en', 'description_fr',
                    'display_order', 'active'];

  const sets = [];
  const params = { code };
  for (const k of editable) {
    if (!cols.includes(k)) continue;                          // skip cols absent on this table
    if (!Object.prototype.hasOwnProperty.call(patch || {}, k)) continue;
    sets.push(`${k} = @${k}`);
    // Coerce active and display_order to integers (clients sometimes send strings/booleans).
    if (k === 'active')        params[k] = (patch[k] === 1 || patch[k] === true || patch[k] === '1') ? 1 : 0;
    else if (k === 'display_order') params[k] = parseInt(patch[k], 10) || 0;
    else                       params[k] = patch[k];
  }
  if (sets.length === 0) throw new Error('Nothing to update — supply at least one editable field');

  const r = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE code = @code`).run(params);
  if (r.changes === 0) throw new Error(`No row with code "${code}" in ${table.replace(/^md_/, '')}`);
  return { ok: true, changes: r.changes };
}

// ── Async postgres forks: delete / reset / lookup CRUD (Chunk 2) ────────────
// _backup is SQLite VACUUM-INTO only — skipped in pg mode (FK CASCADE handles
// children on delete; rely on PG-level backups). PRAGMA table_info → information_schema.
async function _deleteMeetingPg(id) {
  const r = await pgHandle().prepare('DELETE FROM md_meetings WHERE id = ?').run(id);
  return r.changes > 0;
}
async function _resetLookupsPg() {
  const h = pgHandle();
  await h.exec(`DELETE FROM md_intake_sources; DELETE FROM md_departments; DELETE FROM md_categories;
    DELETE FROM md_severities; DELETE FROM md_statuses; DELETE FROM md_meeting_statuses;
    DELETE FROM md_escalation_reasons; DELETE FROM md_council_themes; DELETE FROM md_project_phases;
    DELETE FROM md_it_involvement; DELETE FROM md_engagements;`);
  await _seedLookupsPg();
}
async function _lookupColumnsPg(table) {
  return (await pgHandle().prepare('SELECT column_name FROM information_schema.columns WHERE table_name = ?').all(table)).map(r => r.column_name);
}
async function _addLookupRowPg(table, row) {
  _assertLookupTable(table);
  if (!row || typeof row !== 'object') throw new Error('Row body is required');
  if (!row.code || typeof row.code !== 'string') throw new Error('code is required');
  if (!row.name_en) throw new Error('name_en is required');
  const h = pgHandle();
  const exists = await h.prepare(`SELECT 1 FROM ${table} WHERE code = ?`).get(row.code);
  if (exists) throw new Error(`Code "${row.code}" already exists in ${table.replace(/^md_/, '')} — use update instead.`);
  const cols = await _lookupColumnsPg(table);
  const filtered = {};
  for (const k of Object.keys(row)) if (cols.includes(k)) filtered[k] = row[k];
  await _seedTablePg(table, [filtered]);
  return { ok: true };
}
async function _listLookupTablePg(table, opts = {}) {
  _assertLookupTable(table);
  const where = opts.includeInactive ? '' : 'WHERE active = 1';
  return pgHandle().prepare(`SELECT * FROM ${table} ${where} ORDER BY display_order, code`).all();
}
async function _updateLookupRowPg(table, code, patch) {
  _assertLookupTable(table);
  if (!code || typeof code !== 'string') throw new Error('code is required');
  const cols = await _lookupColumnsPg(table);
  const editable = ['name_en', 'name_fr', 'color', 'icon', 'description_en', 'description_fr', 'display_order', 'active'];
  const sets = []; const params = { code };
  for (const k of editable) {
    if (!cols.includes(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(patch || {}, k)) continue;
    sets.push(`${k} = @${k}`);
    if (k === 'active') params[k] = (patch[k] === 1 || patch[k] === true || patch[k] === '1') ? 1 : 0;
    else if (k === 'display_order') params[k] = parseInt(patch[k], 10) || 0;
    else params[k] = patch[k];
  }
  if (sets.length === 0) throw new Error('Nothing to update — supply at least one editable field');
  const r = await pgHandle().prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE code = @code`).run(params);
  if (r.changes === 0) throw new Error(`No row with code "${code}" in ${table.replace(/^md_/, '')}`);
  return { ok: true, changes: r.changes };
}

// ── Department progress / inter-meeting diff ────────────────────────
/**
 * Find the most recent prior meeting in (site_code × department) before
 * `beforeDate`. If beforeDate is omitted, the very last meeting in the
 * pair is returned. Returns `null` if no prior meeting exists.
 */
function previousMeeting(site_code, department, beforeDate) {
  if (MEETINGS_BACKEND === 'postgres') return _previousMeetingPg(site_code, department, beforeDate);
  if (!site_code || !department) return null;
  const db = getDB();
  if (beforeDate) {
    return db.prepare(`
      SELECT * FROM md_meetings
       WHERE site_code = ? COLLATE NOCASE AND department = ? COLLATE NOCASE AND meeting_date < ?
       ORDER BY meeting_date DESC, id DESC LIMIT 1
    `).get(site_code, department, beforeDate);
  }
  return db.prepare(`
    SELECT * FROM md_meetings
     WHERE site_code = ? COLLATE NOCASE AND department = ? COLLATE NOCASE
     ORDER BY meeting_date DESC, id DESC LIMIT 1
  `).get(site_code, department);
}
async function _previousMeetingPg(site_code, department, beforeDate) {
  if (!site_code || !department) return null;
  const H = pgHandle();
  if (beforeDate) {
    return (await H.prepare(`SELECT * FROM md_meetings WHERE lower(site_code)=lower(?) AND lower(department)=lower(?) AND meeting_date < ?
      ORDER BY meeting_date DESC, id DESC LIMIT 1`).get(site_code, department, beforeDate)) || null;
  }
  return (await H.prepare(`SELECT * FROM md_meetings WHERE lower(site_code)=lower(?) AND lower(department)=lower(?)
    ORDER BY meeting_date DESC, id DESC LIMIT 1`).get(site_code, department)) || null;
}

/**
 * Pre-brief view for the IT coordinator running the NEXT meeting with a
 * given department. Two natural calling conventions:
 *
 *   compareDepartment({ site, department, current_id })
 *     — current_id is the meeting we're preparing TO RUN (e.g. a draft).
 *       The previous meeting is auto-derived as the most recent prior
 *       meeting in the same site × department.
 *
 *   compareDepartment({ site, department, asOf: 'YYYY-MM-DD' })
 *     — no current meeting yet (pure pre-brief). Previous = most recent
 *       meeting in (site × dept) before asOf. asOf defaults to today.
 *
 * Returns:
 *   {
 *     site, department, current: {id?, meeting_date, reference, status} | null,
 *     previous: {id, meeting_date, reference, status} | null,
 *     standing:  [issues that are still open in this site×dept],
 *     resolved:  [issues that closed since previous.meeting_date],
 *     new_items: [issues raised AFTER previous.meeting_date],
 *     actions_standing: [...], actions_resolved: [...], actions_new: [...],
 *     escalations: [open escalated issues in scope],
 *     meeting_history: [last 6 PV references for this site × dept],
 *   }
 *
 * Every item carries enough origin info (meeting_reference, meeting_id,
 * meeting_date) for the UI to deep-link back to the parent PV.
 */
function compareDepartment(opts = {}) {
  if (MEETINGS_BACKEND === 'postgres') return _compareDepartmentPg(opts);
  const db = getDB();
  const site_code = opts.site;
  const department = opts.department;
  if (!site_code || !department) throw new Error('site and department are required');

  // Resolve current + previous
  let current = null;
  if (opts.current_id) {
    current = db.prepare('SELECT * FROM md_meetings WHERE id = ?').get(parseInt(opts.current_id, 10));
    if (current && (current.site_code !== site_code || current.department !== department)) {
      throw new Error(`Meeting #${opts.current_id} does not match site/department scope`);
    }
  }
  const asOf = opts.asOf || (current && current.meeting_date) || new Date().toISOString().slice(0, 10);
  const previous = previousMeeting(site_code, department, current ? current.meeting_date : (opts.asOf ? null : null));
  // when current is supplied, "previous" is the meeting BEFORE current's date
  // when asOf is supplied, "previous" is the meeting BEFORE asOf
  // when neither, "previous" is just the most recent meeting overall

  // Reference date: what counts as "before" the next meeting
  const refDate = (previous && previous.meeting_date) || '1970-01-01';

  // ─ Standing issues: open in this site × dept (regardless of which
  //   meeting they came from)
  const standing = db.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.status NOT IN ('resolved','cancelled')
     ORDER BY
       CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
       CASE WHEN i.target_date IS NULL THEN 1 ELSE 0 END,
       i.target_date ASC, i.id ASC
  `).all(site_code, department);

  // ─ Resolved since previous meeting
  const resolved = db.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.status IN ('resolved','cancelled')
       AND (i.closed_at IS NULL OR date(i.closed_at) > date(?))
     ORDER BY i.closed_at DESC, i.id DESC
  `).all(site_code, department, refDate);

  // ─ New issues: raised AFTER previous.meeting_date (i.e. came up since)
  const newIssues = db.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND m.meeting_date > ?
     ORDER BY i.severity, i.id
  `).all(site_code, department, refDate);

  // ─ Actions in scope (standing / resolved / new — same split as issues)
  const actions_standing = db.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND a.status NOT IN ('resolved','cancelled')
     ORDER BY
       CASE WHEN a.target_date IS NULL THEN 1 ELSE 0 END,
       a.target_date ASC, a.id ASC
  `).all(site_code, department);
  const actions_resolved = db.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND a.status IN ('resolved','cancelled')
       AND (a.closed_at IS NULL OR date(a.closed_at) > date(?))
     ORDER BY a.closed_at DESC, a.id DESC
  `).all(site_code, department, refDate);
  const actions_new = db.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND m.meeting_date > ?
     ORDER BY a.id
  `).all(site_code, department, refDate);

  // ─ Escalations (open + flagged) in scope
  const escalations = db.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.escalate = 1 AND i.status NOT IN ('resolved','cancelled')
     ORDER BY i.severity, i.id
  `).all(site_code, department);

  // ─ Audit updates since previous meeting (helps explain transitions)
  // Pull every audit row whose issue belongs to this scope and dated >
  // refDate. Keep newest 25 so the UI doesn't get flooded.
  const updates_since = db.prepare(`
    SELECT u.*, i.title AS issue_title, m.reference AS meeting_reference, m.id AS meeting_id_ref
      FROM md_issue_updates u
      JOIN md_issues   i ON i.id = u.issue_id
      JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND date(u.created_at) > date(?)
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT 25
  `).all(site_code, department, refDate);

  // ─ Last 6 meetings in scope (history strip for UI breadcrumbs)
  const meeting_history = db.prepare(`
    SELECT id, reference, meeting_date, status, department_head, site_it_lead
      FROM md_meetings
     WHERE site_code = ? AND department = ?
     ORDER BY meeting_date DESC, id DESC LIMIT 6
  `).all(site_code, department);

  return {
    site: site_code, department,
    current,
    previous,
    as_of: asOf,
    standing, resolved, new_items: newIssues,
    actions_standing, actions_resolved, actions_new,
    escalations,
    updates_since,
    meeting_history,
    summary: {
      standing_total:    standing.length,
      standing_high:     standing.filter(i => i.severity === 'HIGH').length,
      resolved_total:    resolved.length,
      new_total:         newIssues.length,
      escalated_open:    escalations.length,
      actions_standing:  actions_standing.length,
      actions_resolved:  actions_resolved.length,
      actions_new:       actions_new.length,
    },
  };
}

// ── Postgres fork of compareDepartment() ──────────────────────────────────
// Pure read path + an awaited previousMeeting() (which itself dispatches to
// the pg fork). Dialect rewrites vs the sqlite original:
//   date(closed_at) > date(?)   → substr(closed_at,1,10) > ?   (closed_at TEXT, ? = 'YYYY-MM-DD')
//   date(u.created_at) > date(?)→ u.created_at::date > ?::date (created_at TIMESTAMPTZ)
async function _compareDepartmentPg(opts = {}) {
  const H = pgHandle();
  const site_code = opts.site;
  const department = opts.department;
  if (!site_code || !department) throw new Error('site and department are required');

  let current = null;
  if (opts.current_id) {
    current = await H.prepare('SELECT * FROM md_meetings WHERE id = ?').get(parseInt(opts.current_id, 10));
    if (current && (current.site_code !== site_code || current.department !== department)) {
      throw new Error(`Meeting #${opts.current_id} does not match site/department scope`);
    }
  }
  const asOf = opts.asOf || (current && current.meeting_date) || new Date().toISOString().slice(0, 10);
  const previous = await previousMeeting(site_code, department, current ? current.meeting_date : (opts.asOf ? null : null));
  const refDate = (previous && previous.meeting_date) || '1970-01-01';

  const standing = await H.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.status NOT IN ('resolved','cancelled')
     ORDER BY
       CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
       CASE WHEN i.target_date IS NULL THEN 1 ELSE 0 END,
       i.target_date ASC, i.id ASC
  `).all(site_code, department);

  const resolved = await H.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.status IN ('resolved','cancelled')
       AND (i.closed_at IS NULL OR substr(i.closed_at,1,10) > ?)
     ORDER BY i.closed_at DESC, i.id DESC
  `).all(site_code, department, refDate);

  const newIssues = await H.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND m.meeting_date > ?
     ORDER BY i.severity, i.id
  `).all(site_code, department, refDate);

  const actions_standing = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND a.status NOT IN ('resolved','cancelled')
     ORDER BY
       CASE WHEN a.target_date IS NULL THEN 1 ELSE 0 END,
       a.target_date ASC, a.id ASC
  `).all(site_code, department);
  const actions_resolved = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND a.status IN ('resolved','cancelled')
       AND (a.closed_at IS NULL OR substr(a.closed_at,1,10) > ?)
     ORDER BY a.closed_at DESC, a.id DESC
  `).all(site_code, department, refDate);
  const actions_new = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND m.meeting_date > ?
     ORDER BY a.id
  `).all(site_code, department, refDate);

  const escalations = await H.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.escalate = 1 AND i.status NOT IN ('resolved','cancelled')
     ORDER BY i.severity, i.id
  `).all(site_code, department);

  const updates_since = await H.prepare(`
    SELECT u.*, i.title AS issue_title, m.reference AS meeting_reference, m.id AS meeting_id_ref
      FROM md_issue_updates u
      JOIN md_issues   i ON i.id = u.issue_id
      JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND u.created_at::date > ?::date
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT 25
  `).all(site_code, department, refDate);

  const meeting_history = await H.prepare(`
    SELECT id, reference, meeting_date, status, department_head, site_it_lead
      FROM md_meetings
     WHERE site_code = ? AND department = ?
     ORDER BY meeting_date DESC, id DESC LIMIT 6
  `).all(site_code, department);

  return {
    site: site_code, department,
    current,
    previous,
    as_of: asOf,
    standing, resolved, new_items: newIssues,
    actions_standing, actions_resolved, actions_new,
    escalations,
    updates_since,
    meeting_history,
    summary: {
      standing_total:    standing.length,
      standing_high:     standing.filter(i => i.severity === 'HIGH').length,
      resolved_total:    resolved.length,
      new_total:         newIssues.length,
      escalated_open:    escalations.length,
      actions_standing:  actions_standing.length,
      actions_resolved:  actions_resolved.length,
      actions_new:       actions_new.length,
    },
  };
}

// ── Per-site contact discovery ────────────────────────────────────────────
// Pure core — exported for tests. rows = md_meetings rows for one site,
// last 6 months, ordered by meeting_date DESC.
function _pickContacts(rows) {
  const freq = new Map();
  let fm = null, fmDate = '';
  for (const r of rows || []) {
    const lead = String(r.site_it_lead || '').trim();
    if (lead) freq.set(lead, (freq.get(lead) || 0) + 1);
    if (String(r.department || '').toLowerCase() === 'finance') {
      const head = String(r.department_head || '').trim();
      const d = String(r.meeting_date || '');
      if (head && d >= fmDate) { fm = head; fmDate = d; }   // ISO dates compare lexically
    }
  }
  let coordinator = null, best = 0;
  for (const [name, n] of freq) if (n > best) { best = n; coordinator = name; }
  return { coordinator_name: coordinator, fm_name: fm };
}

/**
 * getSiteContacts(siteCode) — best-effort contact discovery from PV data:
 * coordinator ≈ most frequent site_it_lead over the last 6 months;
 * FM ≈ department_head of the most recent finance-department PV.
 * These are FREE-TEXT names with no emails — reportDirectory only ever uses
 * them to PRE-FILL blank fields; an admin confirms before anything is sent.
 */
function getSiteContacts(siteCode) {
  if (MEETINGS_BACKEND === 'postgres') return _getSiteContactsPg(siteCode);
  if (!siteCode) return { coordinator_name: null, fm_name: null };
  const db = getDB();
  const rows = db.prepare(`
    SELECT site_it_lead, department, department_head, meeting_date
      FROM md_meetings
     WHERE site_code = ? COLLATE NOCASE AND date(meeting_date) >= date('now', '-6 months')
     ORDER BY meeting_date DESC`).all(siteCode);
  return _pickContacts(rows);
}
async function _getSiteContactsPg(siteCode) {
  if (!siteCode) return { coordinator_name: null, fm_name: null };
  const rows = await pgHandle().prepare(`
    SELECT site_it_lead, department, department_head, meeting_date
      FROM md_meetings
     WHERE lower(site_code) = lower(?) AND meeting_date::date >= (current_date - interval '6 months')
     ORDER BY meeting_date DESC`).all(siteCode);
  return _pickContacts(rows);
}

// ── Site score inputs (the user's sbDims model — see the score-alignment plan) ──
// All date logic is ISO STRING comparison, exactly as the source model. Do not
// convert to Date: '2026-07-01' <= '2026-07-14' is the contract.
const MD_OPEN = { open: 1, in_progress: 1, on_hold: 1, blocked: 1 };
const _d10 = (v) => (v ? String(v).slice(0, 10) : null);

function _effClose(i) {
  if (i.closed_at) return _d10(i.closed_at);
  if (i.status === 'resolved' || i.status === 'cancelled') return i.updated_at ? _d10(i.updated_at) : null;
  return null;
}
function _openAt(i, t) {
  const raised = i.meeting_date;
  if (!raised || raised > t) return false;
  const c = _effClose(i);
  return !c || c > t;
}
// rows: { meetings, issues, actions } already scoped to ONE site.
// meetings/issues are windowed [from,to]; overdue is a point-in-time snapshot at `to`.
function _computeMeetingsScoreInputs({ meetings, issues, actions }, { from, to }) {
  const meets = (meetings || []).filter(m => m.meeting_date >= from && m.meeting_date <= to);
  const isss  = (issues || []).filter(i => i.meeting_date >= from && i.meeting_date <= to);
  const reviews = meets.length;
  const resolved = isss.filter(i => { const c = _effClose(i); return i.status === 'resolved' && c && c <= to; }).length;
  const resolution = isss.length ? Math.round((100 * resolved) / isss.length) : 0;
  const signed = meets.filter(m => m.dept_head_signed_at && m.site_it_signed_at && _d10(m.dept_head_signed_at) <= to && _d10(m.site_it_signed_at) <= to).length;
  const signoff = meets.length ? Math.round((100 * signed) / meets.length) : 0;
  // overdue = open AND past target, AS OF `to` — NOT windowed (matches the source).
  const odIss = (issues || []).filter(i => _openAt(i, to) && i.target_date && i.target_date < to).length;
  const odAct = (actions || []).filter(a => a.meeting_date && a.meeting_date <= to && (!a.closed_at || _d10(a.closed_at) > to) && MD_OPEN[a.status] && a.target_date && a.target_date < to).length;
  return { reviews, raised: isss.length, resolved, resolution, signed, signoff, overdue: odIss + odAct, odIss, odAct };
}

/**
 * getSiteScoreInputs(siteCode, from, to) — measures 4 of the 6 sbDims
 * dimensions for one site: reviews / resolution / signoff over the window
 * [from, to], and overdue as a point-in-time snapshot at `to`.
 *
 * Fetches ALL rows for the site (no SQL date filtering) — the pure core does
 * the windowing, so the semantics live in ONE place and stay testable.
 * `md_actions` has no site_code; it reaches the site via meeting_id →
 * md_meetings. Each collection is its own query, so the JOINs cannot fan out.
 */
function getSiteScoreInputs(siteCode, from, to) {
  if (MEETINGS_BACKEND === 'postgres') return _getSiteScoreInputsPg(siteCode, from, to);
  const db = getDB();
  const meetings = db.prepare(`SELECT meeting_date, dept_head_signed_at, site_it_signed_at FROM md_meetings WHERE site_code = ? COLLATE NOCASE`).all(siteCode);
  const issues = db.prepare(`SELECT i.status, i.target_date, i.closed_at, i.updated_at, m.meeting_date FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id WHERE m.site_code = ? COLLATE NOCASE`).all(siteCode);
  const actions = db.prepare(`SELECT a.status, a.target_date, a.closed_at, m.meeting_date FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id WHERE m.site_code = ? COLLATE NOCASE`).all(siteCode);
  return _computeMeetingsScoreInputs({ meetings, issues, actions }, { from, to });
}

async function _getSiteScoreInputsPg(siteCode, from, to) {
  const H = pgHandle();
  const meetings = await H.prepare(
    `SELECT meeting_date, dept_head_signed_at, site_it_signed_at
       FROM md_meetings WHERE lower(site_code) = lower(?)`).all(siteCode);
  // ⚠ LOAD-BEARING CAST: md_issues.updated_at is TIMESTAMPTZ (every other date
  // column here is TEXT). pgDb registers type parsers only for NUMERIC/BIGINT,
  // so node-pg would hand back a JS Date and _d10 would yield 'Wed Jun 11' —
  // which loses every ISO string compare ('W' > '2'). That would silently
  // collapse `resolution` toward 0 and inflate `overdue`, on prod only, with no
  // error. to_char keeps it a comparable ISO string. Do NOT cast closed_at /
  // target_date / meeting_date / *_signed_at — those are already TEXT.
  const issues = await H.prepare(
    `SELECT i.status, i.target_date, i.closed_at,
            to_char(i.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at,
            m.meeting_date
       FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
      WHERE lower(m.site_code) = lower(?)`).all(siteCode);
  const actions = await H.prepare(
    `SELECT a.status, a.target_date, a.closed_at, m.meeting_date
       FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
      WHERE lower(m.site_code) = lower(?)`).all(siteCode);
  return _computeMeetingsScoreInputs({ meetings, issues, actions }, { from, to });
}

// ── Per-site monthly meeting summary ──────────────────────────────────────
// Feeds the "Department Meetings — Monthly Status" slide on the weekly report
// deck. Returns a calendar-month snapshot for one site: cadence KPIs, a
// per-department breakdown with a RAG status, a 3-month opened/closed trend,
// and an auto-generated "why progress stalled" commentary line.
//
// `open` = issues whose status is not resolved/cancelled (standing backlog,
// regardless of which month's PV raised them). `resolved_month` / `new_month`
// are keyed on closed_at / created_at within the target month.
const _OPEN_SQL = "i.status NOT IN ('resolved','cancelled')";
function getSiteMonthlyMeetingSummary(siteCode, year, month) {
  if (MEETINGS_BACKEND === 'postgres') return _getSiteMonthlyMeetingSummaryPg(siteCode, year, month);
  const db = getDB();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = `${MON[month - 1]} ${year}`;
  if (!siteCode) {
    return { site_code: null, year, month, month_label: monthLabel, available: false,
             kpis: {}, departments: [], trend: { months: [], opened: [], closed: [] }, commentary: '' };
  }

  // Cadence (PVs held this month) + the site-wide standing/flow issue counts.
  const cad = db.prepare(
    `SELECT COUNT(*) pvs, COUNT(DISTINCT department) depts
       FROM md_meetings WHERE site_code=@site AND substr(meeting_date,1,7)=@ym`
  ).get({ site: siteCode, ym });

  const iss = db.prepare(
    `SELECT
        SUM(CASE WHEN ${_OPEN_SQL} THEN 1 ELSE 0 END)                                  open,
        SUM(CASE WHEN ${_OPEN_SQL} AND i.severity='HIGH' THEN 1 ELSE 0 END)            high_open,
        SUM(CASE WHEN ${_OPEN_SQL} AND i.escalate=1 THEN 1 ELSE 0 END)                 esc_open,
        SUM(CASE WHEN substr(i.closed_at,1,7)=@ym THEN 1 ELSE 0 END)                   resolved_m,
        SUM(CASE WHEN substr(i.created_at,1,7)=@ym THEN 1 ELSE 0 END)                  new_m
       FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id
      WHERE m.site_code=@site`
  ).get({ site: siteCode, ym }) || {};

  // Sign-off discipline: PVs held this month that are BOTH-side signed.
  // SEPARATE scalar query — never joined into `cad`/`iss` (a join would fan out
  // and inflate pvs_held / open_issues, moving the report decks' golden).
  const sign = db.prepare(
    `SELECT COUNT(*) signed
       FROM md_meetings
      WHERE site_code=@site AND substr(meeting_date,1,7)=@ym
        AND dept_head_signed_at IS NOT NULL AND site_it_signed_at IS NOT NULL`
  ).get({ site: siteCode, ym }) || {};

  // Overdue actions for the site (md_actions reaches site_code via its meeting).
  // Also its OWN query, for the same fan-out reason. Terminal statuses match the
  // md_statuses seed codes — NOT status='open' (that would drop in_progress/
  // blocked/on_hold, which are overdue too).
  // The set MUST stay identical to listActions({overdue:1}) — this count and
  // that list appear side by side in the SAME report/email, so any drift shows
  // as "3 overdue actions" above a list of 4. 'closed' is not in the md_statuses
  // seed today, but the module's other terminal sets carry it; keep all three.
  const actOverdue = db.prepare(
    `SELECT COUNT(*) n
       FROM md_actions a JOIN md_meetings m ON m.id=a.meeting_id
      WHERE m.site_code=@site
        AND a.target_date IS NOT NULL AND date(a.target_date) < date('now')
        AND a.status NOT IN ('resolved','cancelled','closed')`
  ).get({ site: siteCode }) || {};

  // Per-department: meeting cadence + issue counts, merged by department.
  const deptMeet = db.prepare(
    `SELECT department dept, MAX(meeting_date) last_pv,
            MAX(CASE WHEN substr(meeting_date,1,7)=@ym THEN 1 ELSE 0 END) pv_this_month
       FROM md_meetings WHERE site_code=@site GROUP BY department`
  ).all({ site: siteCode, ym });
  const deptIss = db.prepare(
    `SELECT m.department dept,
            SUM(CASE WHEN ${_OPEN_SQL} THEN 1 ELSE 0 END)                       open,
            SUM(CASE WHEN ${_OPEN_SQL} AND i.severity='HIGH' THEN 1 ELSE 0 END) high,
            SUM(CASE WHEN ${_OPEN_SQL} AND i.status='blocked' THEN 1 ELSE 0 END) blocked,
            SUM(CASE WHEN substr(i.closed_at,1,7)=@ym THEN 1 ELSE 0 END)        resolved_m,
            SUM(CASE WHEN substr(i.created_at,1,7)=@ym THEN 1 ELSE 0 END)       new_m
       FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id
      WHERE m.site_code=@site GROUP BY m.department`
  ).all({ site: siteCode, ym });

  const byDept = {};
  for (const d of deptMeet) byDept[d.dept] = { department: d.dept, last_pv: d.last_pv || null,
    pv_this_month: !!d.pv_this_month, open: 0, high: 0, blocked: 0, resolved_m: 0, new_m: 0 };
  for (const d of deptIss) {
    const t = byDept[d.dept] || (byDept[d.dept] = { department: d.dept, last_pv: null, pv_this_month: false, open: 0, high: 0, blocked: 0, resolved_m: 0, new_m: 0 });
    t.open = d.open || 0; t.high = d.high || 0; t.blocked = d.blocked || 0;
    t.resolved_m = d.resolved_m || 0; t.new_m = d.new_m || 0;
  }
  const departments = Object.values(byDept).map(t => {
    let status = 'on_track';
    if (!t.pv_this_month)              status = 'no_pv';
    else if (t.blocked > 0 || t.high > 0) status = 'blocked';
    return { ...t, status };
  }).sort((a, b) => {
    const rank = s => (s === 'blocked' ? 0 : s === 'no_pv' ? 1 : 2);
    return rank(a.status) - rank(b.status) || (b.open - a.open);
  });

  // 3-month opened/closed trend ending at the target month.
  const months = [], opened = [], closed = [];
  for (let k = 2; k >= 0; k--) {
    const d = new Date(year, month - 1 - k, 1);
    const tym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(MON[d.getMonth()]);
    const row = db.prepare(
      `SELECT
         SUM(CASE WHEN substr(i.created_at,1,7)=@tym THEN 1 ELSE 0 END) o,
         SUM(CASE WHEN substr(i.closed_at,1,7)=@tym  THEN 1 ELSE 0 END) c
        FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id WHERE m.site_code=@site`
    ).get({ site: siteCode, tym }) || {};
    opened.push(row.o || 0); closed.push(row.c || 0);
  }

  // Auto-commentary — the "why it's not advancing" justification line.
  const bits = [];
  for (const d of departments.filter(x => x.status === 'blocked').slice(0, 2))
    bits.push(`${d.department}: ${d.open} issue${d.open === 1 ? '' : 's'} open${d.high ? ` (${d.high} HIGH)` : ''}`);
  const noPv = departments.filter(x => x.status === 'no_pv').map(x => x.department);
  if (noPv.length) bits.push(`${noPv.slice(0, 3).join(', ')}: no PV in ${MON[month - 1]}`);
  if ((iss.esc_open || 0) > 0) bits.push(`${iss.esc_open} escalated to Council`);
  const commentary = bits.length ? bits.join(' · ') : 'All departments met this month with no standing blockers.';

  return {
    site_code: siteCode, year, month, month_label: monthLabel, available: true,
    kpis: {
      pvs_held:        cad.pvs   || 0,
      depts_with_pv:   cad.depts || 0,
      dept_target:     3,                    // Engagement #1
      open_issues:     iss.open      || 0,
      high_open:       iss.high_open || 0,
      resolved_month:  iss.resolved_m || 0,
      new_month:       iss.new_m     || 0,
      escalations_open:iss.esc_open  || 0,
      signoff_pct:     (cad.pvs || 0) > 0 ? Math.round(((sign.signed || 0) / cad.pvs) * 100) : 0,
      overdue_actions_count: actOverdue.n || 0,
    },
    departments,
    trend: { months, opened, closed },
    commentary,
  };
}

// ── Postgres fork of getSiteMonthlyMeetingSummary() ───────────────────────
// Dialect rewrites vs the sqlite original:
//   substr(meeting_date,1,7)   → kept (meeting_date TEXT)
//   substr(i.closed_at,1,7)    → kept (closed_at TEXT)
//   substr(i.created_at,1,7)   → to_char(i.created_at,'YYYY-MM') (created_at TIMESTAMPTZ)
async function _getSiteMonthlyMeetingSummaryPg(siteCode, year, month) {
  const H = pgHandle();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabel = `${MON[month - 1]} ${year}`;
  if (!siteCode) {
    return { site_code: null, year, month, month_label: monthLabel, available: false,
             kpis: {}, departments: [], trend: { months: [], opened: [], closed: [] }, commentary: '' };
  }

  const cad = await H.prepare(
    `SELECT COUNT(*) pvs, COUNT(DISTINCT department) depts
       FROM md_meetings WHERE site_code=@site AND substr(meeting_date,1,7)=@ym`
  ).get({ site: siteCode, ym });

  const iss = (await H.prepare(
    `SELECT
        SUM(CASE WHEN ${_OPEN_SQL} THEN 1 ELSE 0 END)                                  open,
        SUM(CASE WHEN ${_OPEN_SQL} AND i.severity='HIGH' THEN 1 ELSE 0 END)            high_open,
        SUM(CASE WHEN ${_OPEN_SQL} AND i.escalate=1 THEN 1 ELSE 0 END)                 esc_open,
        SUM(CASE WHEN substr(i.closed_at,1,7)=@ym THEN 1 ELSE 0 END)                   resolved_m,
        SUM(CASE WHEN to_char(i.created_at,'YYYY-MM')=@ym THEN 1 ELSE 0 END)           new_m
       FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id
      WHERE m.site_code=@site`
  ).get({ site: siteCode, ym })) || {};

  // SEPARATE scalar queries (see the sqlite body) — never joined into the
  // cadence/issue aggregates above, which a JOIN would fan out.
  const sign = (await H.prepare(
    `SELECT COUNT(*) signed
       FROM md_meetings
      WHERE site_code=@site AND substr(meeting_date,1,7)=@ym
        AND dept_head_signed_at IS NOT NULL AND site_it_signed_at IS NOT NULL`
  ).get({ site: siteCode, ym })) || {};

  const actOverdue = (await H.prepare(
    `SELECT COUNT(*) n
       FROM md_actions a JOIN md_meetings m ON m.id=a.meeting_id
      WHERE m.site_code=@site
        AND a.target_date IS NOT NULL AND a.target_date::date < current_date
        AND a.status NOT IN ('resolved','cancelled','closed')`
  ).get({ site: siteCode })) || {};

  const deptMeet = await H.prepare(
    `SELECT department dept, MAX(meeting_date) last_pv,
            MAX(CASE WHEN substr(meeting_date,1,7)=@ym THEN 1 ELSE 0 END) pv_this_month
       FROM md_meetings WHERE site_code=@site GROUP BY department`
  ).all({ site: siteCode, ym });
  const deptIss = await H.prepare(
    `SELECT m.department dept,
            SUM(CASE WHEN ${_OPEN_SQL} THEN 1 ELSE 0 END)                       open,
            SUM(CASE WHEN ${_OPEN_SQL} AND i.severity='HIGH' THEN 1 ELSE 0 END) high,
            SUM(CASE WHEN ${_OPEN_SQL} AND i.status='blocked' THEN 1 ELSE 0 END) blocked,
            SUM(CASE WHEN substr(i.closed_at,1,7)=@ym THEN 1 ELSE 0 END)        resolved_m,
            SUM(CASE WHEN to_char(i.created_at,'YYYY-MM')=@ym THEN 1 ELSE 0 END) new_m
       FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id
      WHERE m.site_code=@site GROUP BY m.department`
  ).all({ site: siteCode, ym });

  const byDept = {};
  for (const d of deptMeet) byDept[d.dept] = { department: d.dept, last_pv: d.last_pv || null,
    pv_this_month: !!d.pv_this_month, open: 0, high: 0, blocked: 0, resolved_m: 0, new_m: 0 };
  for (const d of deptIss) {
    const t = byDept[d.dept] || (byDept[d.dept] = { department: d.dept, last_pv: null, pv_this_month: false, open: 0, high: 0, blocked: 0, resolved_m: 0, new_m: 0 });
    t.open = d.open || 0; t.high = d.high || 0; t.blocked = d.blocked || 0;
    t.resolved_m = d.resolved_m || 0; t.new_m = d.new_m || 0;
  }
  const departments = Object.values(byDept).map(t => {
    let status = 'on_track';
    if (!t.pv_this_month)              status = 'no_pv';
    else if (t.blocked > 0 || t.high > 0) status = 'blocked';
    return { ...t, status };
  }).sort((a, b) => {
    const rank = s => (s === 'blocked' ? 0 : s === 'no_pv' ? 1 : 2);
    return rank(a.status) - rank(b.status) || (b.open - a.open);
  });

  const months = [], opened = [], closed = [];
  for (let k = 2; k >= 0; k--) {
    const d = new Date(year, month - 1 - k, 1);
    const tym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(MON[d.getMonth()]);
    const row = (await H.prepare(
      `SELECT
         SUM(CASE WHEN to_char(i.created_at,'YYYY-MM')=@tym THEN 1 ELSE 0 END) o,
         SUM(CASE WHEN substr(i.closed_at,1,7)=@tym  THEN 1 ELSE 0 END) c
        FROM md_issues i JOIN md_meetings m ON m.id=i.meeting_id WHERE m.site_code=@site`
    ).get({ site: siteCode, tym })) || {};
    opened.push(row.o || 0); closed.push(row.c || 0);
  }

  const bits = [];
  for (const d of departments.filter(x => x.status === 'blocked').slice(0, 2))
    bits.push(`${d.department}: ${d.open} issue${d.open === 1 ? '' : 's'} open${d.high ? ` (${d.high} HIGH)` : ''}`);
  const noPv = departments.filter(x => x.status === 'no_pv').map(x => x.department);
  if (noPv.length) bits.push(`${noPv.slice(0, 3).join(', ')}: no PV in ${MON[month - 1]}`);
  if ((iss.esc_open || 0) > 0) bits.push(`${iss.esc_open} escalated to Council`);
  const commentary = bits.length ? bits.join(' · ') : 'All departments met this month with no standing blockers.';

  return {
    site_code: siteCode, year, month, month_label: monthLabel, available: true,
    kpis: {
      pvs_held:        cad.pvs   || 0,
      depts_with_pv:   cad.depts || 0,
      dept_target:     3,
      open_issues:     iss.open      || 0,
      high_open:       iss.high_open || 0,
      resolved_month:  iss.resolved_m || 0,
      new_month:       iss.new_m     || 0,
      escalations_open:iss.esc_open  || 0,
      signoff_pct:     Number(cad.pvs || 0) > 0 ? Math.round((Number(sign.signed || 0) / Number(cad.pvs)) * 100) : 0,
      overdue_actions_count: Number(actOverdue.n || 0),
    },
    departments,
    trend: { months, opened, closed },
    commentary,
  };
}

module.exports = {
  getDB,
  loadLookups,
  siteNameToCode: _siteNameToCode,
  getSiteMonthlyMeetingSummary,
  getSiteContacts, _pickContacts,
  getSiteScoreInputs, _computeMeetingsScoreInputs, _effClose, _openAt, MD_OPEN,
  listMeetings, countMeetings, getMeeting, saveMeeting, deleteMeeting, getMeetingStatus,
  listIssues, listEscalations, addIssueUpdate,
  listActions, addActionUpdate, listActionUpdates, getActionParent, getIssueParent,
  exportRows,
  aggregate, compliance, insights,
  previousMeeting, compareDepartment,
  resetLookups,
  addLookupRow, listLookupTable, updateLookupRow,
  getMeetingIdByReference,
  MEETINGS_BACKEND, initPgMeetings, pgHandle,
};

// ── Public helper exposed for the bulk-import preview ───────────────────
// Returns the existing meeting id when a reference is already in DB, or
// null when the reference is new. Lets the import UI decorate each row
// with "🆕 will create" vs "🔄 will update" before the user commits.
function getMeetingIdByReference(reference) {
  if (MEETINGS_BACKEND === 'postgres') return _getMeetingIdByReferencePg(reference);
  if (!reference) return null;
  const row = getDB().prepare('SELECT id FROM md_meetings WHERE reference = ?').get(String(reference).trim());
  return row ? row.id : null;
}
