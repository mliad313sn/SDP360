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

// DEC-07 (transplanted 2026-10-28 from the 1.11 line): a site filter may be ONE code or a LIST
// of codes (a site-scoped reader's sites). An empty list matches nothing.
// `form`: 'eq' (col = x), 'nocase' (sqlite COLLATE NOCASE), 'lower' (lower(col) = lower(x)).
function _siteClause(col, site, params, form) {
  const list = Array.isArray(site) ? site : [site];
  if (!list.length) return '1=0';
  const names = list.map((v, i) => { const n = 'site' + (list.length > 1 || Array.isArray(site) ? i : ''); params[n] = v; return '@' + n; });
  if (form === 'lower') return names.length === 1 ? `lower(${col}) = lower(${names[0]})` : `lower(${col}) IN (${names.map(n => `lower(${n})`).join(', ')})`;
  const c = form === 'nocase' ? `${col} COLLATE NOCASE` : col;
  return names.length === 1 ? `${c} = ${names[0]}` : `${c} IN (${names.join(', ')})`;
}
const { inScope: _inScope } = require('./services/userSites');   // multi-site editors: a scope may be a list of codes


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




// PostgreSQL is the only database (PO-08): getDB() is the pg handle.
// PostgreSQL is the only database (PO-08): getDB() is the pg handle.
function getDB() { return pgHandle(); }

// ── PostgreSQL backend selector (Chunk 2) ────────────────────────────────────
// `sqlite` (default) keeps the better-sqlite3 path above, byte-for-byte.
// `postgres` routes every DB function through the async services/pgDb adapter.
const MEETINGS_BACKEND = 'postgres';
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
  // 2026-09 Business Incubation (parity with the sqlite path): additive column on an
  // existing table + the intake_source code (the seed only fires on an empty DB).
  await _pg.exec(`ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS incubation_json TEXT`);
  await _pg.prepare(`INSERT INTO md_intake_sources (code, name_en, name_fr, color, display_order, active)
                     VALUES ('business_incubation', 'Business Incubation', 'Incubation métier', '#0D9488', 4, 1)
                     ON CONFLICT (code) DO NOTHING`).run();
  // 2026-10-16: transfer statuses (parity with the sqlite path).
  for (const t of ['md_issues', 'md_actions']) {
    await _pg.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS status_note TEXT`);
    await _pg.exec(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS helpdesk_ticket TEXT`);
  }
  for (const st of INIT.statuses.filter(x => x.code === 'demand' || x.code === 'helpdesk_ticket')) {
    await _pg.prepare(`INSERT INTO md_statuses (code, name_en, name_fr, color, is_terminal, display_order)
                       VALUES (@code, @name_en, @name_fr, @color, @is_terminal, @display_order)
                       ON CONFLICT (code) DO NOTHING`).run(st);
  }
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







// ── Helpers ─────────────────────────────────────────────────────────────────
function _siteNameToCode(name) {
  try { return require('./inspection-db.js').siteNameToCode(name); }
  catch (e) { return null; }
}

// Reference format mirrors the canonical SharePoint naming:
//   [SITE]_[Department]_PV_[YYYY-MM]   →  HGO_Maintenance_PV_2026-05
// If the user re-saves a meeting whose meeting_date moves to a new month,
// the reference auto-updates (caller may pass a fixed reference to override).
// A Business Incubation session gets _INC_ instead of _PV_ (2026-10-03, same tag as the
// incubation import): with _PV_ a hand-entered incubation matched the month's PV by
// reference and OVERWROTE it.
function _buildReference(site_code, department, meeting_date, intake_source) {
  if (!site_code || !department || !meeting_date) return null;
  const m = String(meeting_date).match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  // Title-case the department code (mining → Mining, mobile_maint → Mobile_Maint)
  const dept = department
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
  const tag = String(intake_source || '') === 'business_incubation' ? 'INC' : 'PV';
  return `${site_code}_${dept}_${tag}_${m[1]}-${m[2]}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** All lookups in one call — drives every dropdown in the form. */
function loadLookups() {
  return _loadLookupsPg();
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
  if (opts.site)       { where.push(_siteClause('m.site_code', opts.site, params, 'eq')); }
  if (opts.department) { where.push('m.department = @department'); params.department = opts.department; }
  if (opts.status)     { where.push('m.status = @status');         params.status = opts.status; }
  if (opts.intake)     { where.push('m.intake_source = @intake');  params.intake = opts.intake; }
  if (opts.from)       { where.push('m.meeting_date >= @from');    params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');      params.to = opts.to; }
  if (opts.unsigned)   { where.push('(m.dept_head_signed_at IS NULL OR m.site_it_signed_at IS NULL)'); }
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
      (SELECT COUNT(*) FROM md_actions a WHERE a.meeting_id = m.id AND a.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')) AS open_action_count,
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
  if (header.incubation_json) { try { header.incubation = JSON.parse(header.incubation_json); } catch (e) { header.incubation = null; } }
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
  return _listMeetingsPg(opts);
}

/**
 * countMeetings — returns the row count that listMeetings WOULD return
 * with the same filters but NO pagination. Used by the list route so the
 * front-end can render "Showing 1–20 of 187" and gray out Next on the
 * last page. Mirrors the WHERE clauses in listMeetings exactly — keep
 * the two in sync.
 */
function countMeetings(opts = {}) {
  return _countMeetingsPg(opts);
}

/** Full meeting record incl. children. */
function getMeeting(id) {
  return _getMeetingPg(id);
}

// Set (or clear) the Business Incubation extras blob on a meeting. Kept OUT of the
// big saveMeeting upsert so that hot path is untouched: the incubation import calls
// saveMeeting (meeting + issues) then stamps the blob here by id. `incubation` = an
// object ({roles, business_description, flow[], services[]}) or null to clear.
// Async on postgres (pg driver returns a Promise); callers must await.
function setMeetingIncubation(id, incubation) {
  const json = incubation == null ? null : JSON.stringify(incubation);
  return pgHandle().prepare('UPDATE md_meetings SET incubation_json = ?, updated_at = now() WHERE id = ?').run(json, id);
}

/**
 * Upsert a meeting + its nested children in one transaction.
 *
 * @param {object} state  { id?, header: {...}, projects: [...], issues: [...], actions: [...] }
 * @param {string|null} userSiteCode  if set, write blocked unless the meeting's site matches
 * @param {number|null} userId   for audit
 * @returns {{id, reference, created}}
 */
const _isIncubation = (h) => String((h && h.intake_source) || '') === 'business_incubation';
// Actions upsert helper (F2, 2026-09-06): the closure stamp for one incoming action row.
//   terminal status  → keep the existing closed_at if the row already had one, else stamp now
//   non-terminal     → null (a reopened action is open again — no stale closure survives)
// Transfer statuses (2026-10-16): demand / helpdesk_ticket leave the register like cancelled
// (public/lib/statusTransfer.js — DONE = every status that closes an issue or an action).
const _statusTransfer = require('./public/lib/statusTransfer');
const _isDone = (s) => _statusTransfer.isDone(s);
const _ACTION_TERMINAL = new Set(_statusTransfer.DONE);
// status_note / helpdesk_ticket columns: kept only while the row sits in a transfer status.
function _transferCols(status, note, ticket) {
  const tr = _statusTransfer.isTransfer(status);
  return {
    note:   tr && note ? String(note).trim().slice(0, _statusTransfer.NOTE_MAX) : null,
    ticket: _statusTransfer.needsTicket(status) ? _statusTransfer.normalizeTicket(ticket) : null,
  };
}
function _actionClosedAt(a, existingClosedAt, nowStr) {
  if (!_ACTION_TERMINAL.has(String(a.status || 'open'))) return null;
  return existingClosedAt || nowStr;
}

function saveMeeting(state, userSiteCode, userId) {
  return _saveMeetingPg(state, userSiteCode, userId);
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
    const incomingRef = (h.reference || '').trim() || _buildReference(h.site_code, h.department, h.meeting_date, h.intake_source);
    if (incomingRef) {
      exist = await H.prepare('SELECT * FROM md_meetings WHERE lower(reference) = lower(?)').get(incomingRef);
      if (exist) id = exist.id;
    }
    // F1 (2026-09-06): PV-only month fallback — see the sqlite fork.
    if (!exist && h.site_code && h.department && h.meeting_date && !_isIncubation(h)) {
      const month = String(h.meeting_date).slice(0, 7);
      exist = await H.prepare(`SELECT * FROM md_meetings
         WHERE lower(site_code) = lower(?) AND lower(department) = lower(?) AND substr(meeting_date, 1, 7) = ?
           AND COALESCE(intake_source, '') <> 'business_incubation'
         ORDER BY id LIMIT 1`).get(h.site_code, h.department, month);
      if (exist) id = exist.id;
    }
  }
  if (userSiteCode) {
    const existingSite = exist && exist.site_code;
    const incomingSite = h.site_code || null;
    if (existingSite && !_inScope(existingSite, userSiteCode)) throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, meeting is for ${existingSite}`);
    if (!_inScope(incomingSite, userSiteCode)) throw new Error(`Cross-site save blocked: editor scoped to ${userSiteCode}, cannot write site ${incomingSite}`);
    // RBAC lot 4c: a closed PV is editable by an editor of its site (site checks above).
  }
  const reference = (exist && exist.reference) || (h.reference != null ? String(h.reference).trim() : '') || _buildReference(h.site_code, h.department, h.meeting_date, h.intake_source);

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
      const updI = H.prepare(`UPDATE md_issues SET ord=?, title=?, description=?, category=?, severity=?, affects=?, champion=?, champion_email=?, target_date=?, status=?, escalate=?, escalation_reason=?, council_theme=?, notes=?, closed_at=?, status_note = CASE WHEN ? = 1 THEN COALESCE(?, status_note) ELSE NULL END, helpdesk_ticket = CASE WHEN ? = 1 THEN COALESCE(?, helpdesk_ticket) ELSE NULL END, updated_at=now() WHERE id=? AND meeting_id=?`);
      const insI = H.prepare(`INSERT INTO md_issues (meeting_id, ord, title, description, category, severity, affects, champion, champion_email, target_date, status, escalate, escalation_reason, council_theme, notes, closed_at, status_note, helpdesk_ticket) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insA = H.prepare(`INSERT INTO md_issue_updates (issue_id, author_id, author_name, body, status_change, escalate_change) VALUES (?,?,?,?,?,?)`);
      let ix = 0;
      for (const iss of (state.issues || [])) {
        if (!iss.title || !iss.category) { ix++; continue; }
        const terminal = _isDone(iss.status);
        const closed_at = terminal ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
        const esc = iss.escalate ? 1 : 0;
        const tc = _transferCols(iss.status, iss.status_note, iss.helpdesk_ticket);
        const trI = _statusTransfer.isTransfer(iss.status) ? 1 : 0, tkI = _statusTransfer.needsTicket(iss.status) ? 1 : 0;
        if (iss.id && oldById[iss.id]) {
          incoming.add(iss.id);
          await updI.run(iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM', iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null, iss.status || 'open', esc, iss.escalation_reason || null, iss.council_theme || null, iss.notes || '', closed_at, trI, tc.note, tkI, tc.ticket, iss.id, meetingId);
          const old = oldById[iss.id];
          const sc = old.status !== (iss.status || 'open') ? (iss.status || 'open') : null;
          const ec = old.escalate !== esc ? esc : null;
          if (sc || ec) await insA.run(iss.id, userId || null, state.author_name || null, iss.update_comment || (sc && tc.note) || null, sc, ec);
        } else {
          const r = await insI.run(meetingId, iss.ord || ix, iss.title, iss.description || '', iss.category, iss.severity || 'MEDIUM', iss.affects || '', iss.champion || '', iss.champion_email || '', iss.target_date || null, iss.status || 'open', esc, iss.escalation_reason || null, iss.council_theme || null, iss.notes || '', closed_at, tc.note, tc.ticket);
          await insA.run(r.lastID, userId || null, state.author_name || null, iss.update_comment || tc.note || 'Issue created.', iss.status || 'open', esc);
        }
        ix++;
      }
      for (const o of oldIssues) { if (!incoming.has(o.id)) await H.prepare('DELETE FROM md_issues WHERE id = ?').run(o.id); }
    }
    if (state.actions !== undefined) {
      // F2 (2026-09-06): upsert by id — mirrors the sqlite fork (ids are load-bearing).
      const oldActions = await H.prepare('SELECT id, closed_at, status FROM md_actions WHERE meeting_id = ?').all(meetingId);
      const oldById = new Map(oldActions.map(o => [Number(o.id), o]));
      const insAc = H.prepare(`INSERT INTO md_actions (meeting_id, ord, description, owner_it, owner_email, target_date, status, linked_issue_id, closed_at, status_note, helpdesk_ticket) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`);
      const updAc = H.prepare(`UPDATE md_actions SET ord = ?, description = ?, owner_it = ?, owner_email = ?, target_date = ?, status = ?, linked_issue_id = ?, closed_at = ?, status_note = CASE WHEN ? = 1 THEN COALESCE(?, status_note) ELSE NULL END, helpdesk_ticket = CASE WHEN ? = 1 THEN COALESCE(?, helpdesk_ticket) ELSE NULL END, updated_at = now() WHERE id = ? AND meeting_id = ?`);
      const insActAudit = H.prepare(`INSERT INTO md_action_updates (action_id, author_id, author_name, body, status_change) VALUES (?, ?, ?, ?, ?)`);
      const issuesAfter = await H.prepare('SELECT id, ord FROM md_issues WHERE meeting_id = ? ORDER BY ord, id').all(meetingId);
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const keep = new Set();
      let ix = 0;
      for (const a of (state.actions || [])) {
        if (!a.description) { ix++; continue; }
        let linked = null;
        if (a.linked_issue_id) linked = a.linked_issue_id;
        else if (a.linked_issue_ord) { const ord = parseInt(a.linked_issue_ord, 10); const m = issuesAfter[ord - 1]; if (m) linked = m.id; }
        const aid = a.id != null ? parseInt(a.id, 10) : null;
        const existing = (aid != null && oldById.has(aid)) ? oldById.get(aid) : null;
        const closed_at = _actionClosedAt(a, existing ? existing.closed_at : null, nowStr);
        const tc = _transferCols(a.status, a.status_note, a.helpdesk_ticket);
        const trA = _statusTransfer.isTransfer(a.status) ? 1 : 0, tkA = _statusTransfer.needsTicket(a.status) ? 1 : 0;
        if (existing) {
          await updAc.run(a.ord || ix, a.description, a.owner_it || '', a.owner_email || '', a.target_date || null, a.status || 'open', linked, closed_at, trA, tc.note, tkA, tc.ticket, aid, meetingId);
          keep.add(aid);
          if (trA && existing.status !== a.status) await insActAudit.run(aid, userId || null, state.author_name || null, tc.note, a.status);
        } else {
          const r = await insAc.get(meetingId, a.ord || ix, a.description, a.owner_it || '', a.owner_email || '', a.target_date || null, a.status || 'open', linked, closed_at, tc.note, tc.ticket);
          if (r && r.id != null) keep.add(Number(r.id));
          if (trA && r && r.id != null) await insActAudit.run(Number(r.id), userId || null, state.author_name || null, tc.note, a.status);
        }
        ix++;
      }
      for (const o of oldActions) { if (!keep.has(Number(o.id))) await H.prepare('DELETE FROM md_actions WHERE id = ?').run(o.id); }
    }
  });
  const saved = await H.prepare('SELECT id FROM md_meetings WHERE reference = ?').get(reference);
  return { id: saved && saved.id, reference, created: !exist };
}

/** Append an audit-trail update to one issue. */
function addIssueUpdate(issueId, opts = {}) {
  return _addIssueUpdatePg(issueId, opts);
}

/**
 * « + Action » from the Site Actions hub (2026-10-05): create ONE action that treats an
 * issue, in the issue's own session, without re-saving the whole PV. Linked to the issue,
 * appended after the session's existing actions, status 'open'; leaves a trace on the issue
 * (md_issue_updates, status unchanged). Site scoping is the route's job (getIssueParent).
 */
function _actionFromIssueInput(fields) {
  const f = fields || {};
  const description = String(f.description || '').trim().slice(0, 2000);
  if (!description) throw new Error('description is required');
  const iso = (v) => { const t = String(v || '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
  return { description, owner_it: String(f.owner_it || '').trim().slice(0, 200) || null,
    owner_email: String(f.owner_email || '').trim().slice(0, 200) || null, target_date: iso(f.target_date) };
}
function addActionForIssue(issueId, fields, author = {}) {
  return _addActionForIssuePg(issueId, fields, author);
}
async function _addActionForIssuePg(issueId, fields, author = {}) {
  const v = _actionFromIssueInput(fields);
  const H = pgHandle();
  const issue = await H.prepare('SELECT id, meeting_id FROM md_issues WHERE id = ?').get(issueId);
  if (!issue) throw new Error('Issue not found');
  let id;
  await H.runTransaction(async () => {
    const m = await H.prepare('SELECT COALESCE(MAX(ord), 0) AS m FROM md_actions WHERE meeting_id = ?').get(issue.meeting_id);
    const ord = (Number(m && m.m) || 0) + 1;
    const row = await H.prepare(`INSERT INTO md_actions (meeting_id, ord, description, owner_it, owner_email, target_date, status, linked_issue_id)
                                 VALUES (?, ?, ?, ?, ?, ?, 'open', ?) RETURNING id`)
      .get(issue.meeting_id, ord, v.description, v.owner_it, v.owner_email, v.target_date, issueId);
    id = row.id;
    await H.prepare(`INSERT INTO md_issue_updates (issue_id, author_id, author_name, body) VALUES (?, ?, ?, ?)`)
      .run(issueId, author.author_id || null, author.author_name || null, 'Action ajoutée : ' + v.description);
  });
  return { id: Number(id), meeting_id: issue.meeting_id };
}

/** Flat list of all issues across all meetings — drives the Issues Log view. */
function listIssues(opts = {}) {
  return _listIssuesPg(opts);
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
  return _addActionUpdatePg(actionId, opts);
}

/** Audit thread for one action (newest first). */
function listActionUpdates(actionId) {
  return _listActionUpdatesPg(actionId);
}

/** Parent meeting's site + status for one issue (route-layer site scoping). */
function getIssueParent(issueId) {
  return _getIssueParentPg(issueId);
}

/** Parent meeting's site + status for one action (route-layer site scoping). */
function getActionParent(actionId) {
  return _getActionParentPg(actionId);
}

// Map the caller's `which` token to the DB column. The ONLY two accepted
// values — anything else throws (never lets an arbitrary column name reach
// the SQL).
const _SIGN_COLS = { dept_head: 'dept_head_signed_at', site_it: 'site_it_signed_at' };

/**
 * Stamp ONE signature on a meeting. SERVER-AUTHORITATIVE + IMMUTABLE — the
 * timestamp is the server's clock (the browser's is untrusted; `signoff` is a
 * SCORED dimension) and COALESCE(<col>, @now) makes the FIRST stamp win, so a
 * re-sign never rewrites an existing signature. Mirrors saveMeeting's contract.
 *
 * @param {number} id      meeting id
 * @param {string} which   'dept_head' | 'site_it'
 * @param {object} [opts]  { user } — reserved for future audit; NOT stored (no
 *                         provenance / audit table by design).
 * @returns {{dept_head_signed_at, site_it_signed_at}} the post-update state.
 */
function signMeeting(id, which, opts = {}) {
  const col = _SIGN_COLS[which];
  if (!col) throw new Error(`Invalid which "${which}" — expected dept_head|site_it`);
  return _signMeetingPg(id, col);
}
async function _signMeetingPg(id, col) {
  const H   = pgHandle();
  const mid = parseInt(id, 10);
  const exist = await H.prepare('SELECT id FROM md_meetings WHERE id = ?').get(mid);
  if (!exist) throw new Error('Meeting not found');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await H.prepare(`
    UPDATE md_meetings
       SET ${col} = COALESCE(${col}, @now),
           updated_at = now()
     WHERE id = @id
  `).run({ now, id: mid });
  return H.prepare('SELECT dept_head_signed_at, site_it_signed_at FROM md_meetings WHERE id = ?').get(mid);
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
      const terminal = _isDone(opts.status_change);
      const tc = _transferCols(opts.status_change, opts.body, opts.helpdesk_ticket);
      await H.prepare(`UPDATE md_issues SET status = ?, closed_at = CASE WHEN ? = 1 THEN COALESCE(closed_at, to_char(now(),'YYYY-MM-DD HH24:MI:SS')) ELSE NULL END, status_note = ?, helpdesk_ticket = ?, updated_at = now() WHERE id = ?`)
        .run(opts.status_change, terminal ? 1 : 0, tc.note, tc.ticket, issueId);
    }
    if (opts.escalate_change !== null && opts.escalate_change !== undefined && opts.escalate_change !== issue.escalate) {
      await H.prepare(`UPDATE md_issues SET escalate = ?, updated_at = now() WHERE id = ?`).run(opts.escalate_change ? 1 : 0, issueId);
    }
  });
}
async function _listIssuesPg(opts = {}) {
  const where = [], params = {};
  if (opts.site)        { where.push(_siteClause('m.site_code', opts.site, params, 'eq')); }
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
    ORDER BY CASE WHEN i.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END,
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
      const terminal = _isDone(opts.status_change);
      const tc = _transferCols(opts.status_change, opts.body, opts.helpdesk_ticket);
      await H.prepare(`UPDATE md_actions SET status = ?, closed_at = CASE WHEN ? = 1 THEN COALESCE(closed_at, to_char(now(),'YYYY-MM-DD HH24:MI:SS')) ELSE NULL END, status_note = ?, helpdesk_ticket = ?, updated_at = now() WHERE id = ?`)
        .run(opts.status_change, terminal ? 1 : 0, tc.note, tc.ticket, actionId);
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
  return _listActionsPg(opts);
}

/**
 * Full-table export for the "Download Excel" feature — every PV, issue,
 * action and project across ALL meetings (no filter, no LIMIT). Backend-
 * agnostic: `await handle.prepare(sql).all()` resolves for both the sync
 * sqlite handle and the async pg handle. Attachments (base64 blobs) and
 * lookup tables are intentionally excluded.
 */
// opts.site: limit every sheet to one site code (a scoped user's export, RBAC lot 4c).
async function exportRows(opts = {}) {
  const H = (pgHandle());
  // opts.site: one code, or a LIST (multi-site editors, 2026-10-05 — the route hands over
  // every code of the account; binding the array as one value broke the export).
  const codes = (Array.isArray(opts.site) ? opts.site : (opts.site ? [opts.site] : [])).filter(Boolean);
  const inList = codes.length ? ` IN (${codes.map(() => '?').join(',')})` : '';
  const wm = codes.length ? ' WHERE m.site_code' + inList : '';
  const p  = codes;
  const meetings = await H.prepare(`SELECT * FROM md_meetings${codes.length ? ' WHERE site_code' + inList : ''} ORDER BY meeting_date DESC, id`).all(...p);
  const issues = await H.prepare(`
    SELECT iss.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_issues iss JOIN md_meetings m ON m.id = iss.meeting_id${wm}
     ORDER BY m.meeting_date DESC, iss.meeting_id, iss.ord`).all(...p);
  const actions = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id${wm}
     ORDER BY m.meeting_date DESC, a.meeting_id, a.ord`).all(...p);
  const projects = await H.prepare(`
    SELECT p.*, m.reference AS meeting_reference, m.site_code AS site_code,
           m.department AS department, m.meeting_date AS meeting_date
      FROM md_meeting_projects p JOIN md_meetings m ON m.id = p.meeting_id${wm}
     ORDER BY m.meeting_date DESC, p.meeting_id, p.ord`).all(...p);
  return { meetings, issues, actions, projects };
}

async function _listActionsPg(opts = {}) {
  const where = [], params = {};
  if (opts.site)       { where.push(_siteClause('m.site_code', opts.site, params, 'lower')); }
  if (opts.department) { where.push('lower(m.department) = lower(@department)'); params.department = opts.department; }
  if (opts.status)     { where.push('a.status = @status');                       params.status = opts.status; }
  if (opts.owner)      { where.push('(a.owner_it ILIKE @owner OR a.owner_email ILIKE @owner)'); params.owner = '%' + opts.owner + '%'; }
  if (opts.overdue)    { where.push("a.target_date IS NOT NULL AND a.target_date < to_char(current_date,'YYYY-MM-DD') AND a.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')"); }
  if (opts.from)       { where.push('m.meeting_date >= @from'); params.from = opts.from; }
  if (opts.to)         { where.push('m.meeting_date <= @to');   params.to = opts.to; }
  if (opts.q)          { where.push('(a.description ILIKE @q OR a.owner_it ILIKE @q OR a.owner_email ILIKE @q)'); params.q = '%' + opts.q + '%'; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.limit = opts.limit || 1000; params.offset = opts.offset || 0;
  return pgHandle().prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.site_code AS site_code, m.department AS department,
           m.meeting_date AS meeting_date, m.status AS meeting_status, m.intake_source AS intake_source, m.id AS meeting_id_ref, li.title AS linked_issue_title
    FROM md_actions a
    JOIN md_meetings m ON m.id = a.meeting_id
    LEFT JOIN md_issues li ON li.id = a.linked_issue_id ${w}
    ORDER BY CASE WHEN a.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END,
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
  return _insightsPg(opts);
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
  if (opts.site)       { extra.push(_siteClause('m.site_code', opts.site, params, 'eq')); }
  if (opts.department) { extra.push('m.department = @department'); params.department = opts.department; }
  const extraW = extra.length ? ' AND ' + extra.join(' AND ') : '';

  // 1. Monthly time-series
  const monthlyRaw = await H.prepare(`
    SELECT
      substr(m.meeting_date,1,7)        AS month,
      COUNT(DISTINCT m.id)              AS meetings,
      COUNT(i.id)                       AS issues_opened,
      SUM(CASE WHEN i.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END) AS issues_closed,
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
                AND i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END) AS overdue
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
  return _aggregatePg(opts);
}

/**
 * Compliance monitor for the 5 Engagements. Returns per-site counts so
 * the UI can render a leaderboard. `month` parameter expected as 'YYYY-MM'.
 */
function compliance(opts = {}) {
  return _compliancePg(opts);
}

// ── Async postgres forks: aggregate + compliance (Chunk 2) ──────────────────
async function _aggregatePg(opts = {}) {
  const H = pgHandle();
  const where = [], params = {};
  if (opts.site)       { where.push(_siteClause('m.site_code', opts.site, params, 'eq')); }
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
      SUM(CASE WHEN i.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 0 ELSE 1 END) AS open_issues,
      SUM(CASE WHEN i.escalate=1 AND i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END) AS escalated_open,
      SUM(CASE WHEN i.escalate=1 THEN 1 ELSE 0 END) AS total_escalated,
      SUM(CASE WHEN i.target_date IS NOT NULL AND i.target_date < to_char(current_date,'YYYY-MM-DD') AND i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket') THEN 1 ELSE 0 END) AS overdue_issues
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
  return _deleteMeetingPg(id);
}



function getMeetingStatus(id) {
  return _getMeetingStatusPg(id);
}

function resetLookups() {
  return _resetLookupsPg();
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



/**
 * Insert ONE row into a lookup. Refuses to write if `code` already exists —
 * use updateLookupRow() to patch an existing row. (The underlying
 * _seedTable uses INSERT OR REPLACE which would silently clobber columns
 * absent from the patch back to their defaults, e.g. wiping display_order
 * to 0 or active to 1. Strict refuse here protects admins from that
 * surprise.)
 */
function addLookupRow(table, row) {
  return _addLookupRowPg(table, row);
}

/**
 * List one lookup table. With { includeInactive: true } the admin sees
 * soft-deleted rows too (the dropdowns elsewhere in the app filter by
 * active=1 via loadLookups()). Sorted by display_order then code so the
 * admin UI is deterministic.
 */
function listLookupTable(table, opts = {}) {
  return _listLookupTablePg(table, opts);
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
  return _updateLookupRowPg(table, code, patch);
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
  return _previousMeetingPg(site_code, department, beforeDate);
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
  return _compareDepartmentPg(opts);
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
       AND i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')
     ORDER BY
       CASE i.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
       CASE WHEN i.target_date IS NULL THEN 1 ELSE 0 END,
       i.target_date ASC, i.id ASC
  `).all(site_code, department);

  const resolved = await H.prepare(`
    SELECT i.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_issues i JOIN md_meetings m ON m.id = i.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND i.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket')
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
       AND a.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')
     ORDER BY
       CASE WHEN a.target_date IS NULL THEN 1 ELSE 0 END,
       a.target_date ASC, a.id ASC
  `).all(site_code, department);
  const actions_resolved = await H.prepare(`
    SELECT a.*, m.reference AS meeting_reference, m.meeting_date AS meeting_date, m.id AS meeting_id_ref
      FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
     WHERE m.site_code = ? AND m.department = ?
       AND a.status IN ('resolved','cancelled','closed','demand','helpdesk_ticket')
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
       AND i.escalate = 1 AND i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')
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
  return _getSiteContactsPg(siteCode);
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
  if (_isDone(i.status)) return i.updated_at ? _d10(i.updated_at) : null;
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
  return _getSiteScoreInputsPg(siteCode, from, to);
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
const _OPEN_SQL = "i.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')";
function getSiteMonthlyMeetingSummary(siteCode, year, month) {
  return _getSiteMonthlyMeetingSummaryPg(siteCode, year, month);
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
        AND a.status NOT IN ('resolved','cancelled','closed','demand','helpdesk_ticket')`
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
  listMeetings, countMeetings, getMeeting, saveMeeting, setMeetingIncubation, addActionForIssue, deleteMeeting, getMeetingStatus, signMeeting,
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
  return _getMeetingIdByReferencePg(reference);
}
