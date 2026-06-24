/**
 * meetings-import.js — Bulk historical PV import for the Meetings module.
 *
 * Lets the operations team upload a 3-tab Excel workbook of past
 * department meetings + their nested issues + actions, in one shot.
 *
 *   Tab 1: Meetings   — one row per PV (reference, site, dept, date, …)
 *   Tab 2: Issues     — many rows per meeting, linked by reference
 *   Tab 3: Actions    — many rows per meeting, linked by reference
 *                       optional `linked_issue_ord` joins to an issue
 *                       on the SAME meeting by 1-based ord
 *
 * Two public entry points:
 *
 *   buildTemplate(lookups)     → Buffer (xlsx) of a pre-populated blank
 *                                template with the 3 tabs + a 4th "Codes"
 *                                tab listing every lookup code
 *                                (site / department / category / severity /
 *                                 status / meeting status / escalation
 *                                 reason / council theme).
 *
 *   parseBuffer(buf, lookups)  → { meetings, errors, warnings, summary }
 *                                runs all validation but DOES NOT touch
 *                                the DB. Caller decides whether to commit.
 *
 *   commit(parsed, meetingsDb) → { created, updated, errors }
 *                                runs saveMeeting() for every row in
 *                                admin-scope (no user-site restriction).
 *
 * The dry-run / commit split lets the UI show the user exactly what
 * will land before they pull the trigger.
 */

'use strict';

const XLSX = require('xlsx');

// ── Sheet name conventions ──────────────────────────────────────────
// Accepts these names (case-insensitive). First match wins.
const SHEET_NAMES = {
  meetings: ['meetings', 'meeting', 'pv', 'pvs', 'réunions', 'reunions'],
  issues:   ['issues',   'issue',   'problems', 'problèmes', 'problemes'],
  actions:  ['actions',  'action',  'commitments', 'engagements'],
};

function _pickSheet(workbook, candidateNames) {
  const keys = Object.keys(workbook.Sheets || {});
  for (const name of candidateNames) {
    const hit = keys.find(k => k.toLowerCase().trim() === name);
    if (hit) return workbook.Sheets[hit];
  }
  return null;
}

// ── Date coercion (Excel serial OR ISO string) ──────────────────────
function _toIsoDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel epoch 1900-01-01 (with the leap-year bug — JSDate handles it)
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const pad = n => String(n).padStart(2, '0');
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  const s = String(v).trim();
  // Try ISO first
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // Try DD/MM/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function _normaliseHeader(s) {
  return String(s || '').toLowerCase().trim().replace(/[\s\-]+/g, '_');
}

function _rowsFromSheet(sheet) {
  if (!sheet) return [];
  // header:1 returns arrays-of-arrays; defval keeps blank cells as ''
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
  if (!aoa.length) return [];
  const headers = aoa[0].map(_normaliseHeader);
  return aoa.slice(1).map((row, ix) => {
    const obj = { __row: ix + 2 };  // 1-based + header row
    headers.forEach((h, j) => { if (h) obj[h] = row[j]; });
    return obj;
  }).filter(r => Object.keys(r).some(k => k !== '__row' && r[k] !== '' && r[k] != null));
}

// ── Validation helpers ──────────────────────────────────────────────
function _coerceCode(value, validSet, fieldName, rowNo, errors, opts = {}) {
  if (value == null || value === '') {
    if (opts.required) errors.push({ row: rowNo, field: fieldName, msg: `${fieldName} is required` });
    return null;
  }
  const v = String(value).trim();
  if (!validSet.has(v)) {
    // Try case-insensitive match
    const lowered = v.toLowerCase();
    const match = [...validSet].find(c => c.toLowerCase() === lowered);
    if (match) return match;
    errors.push({ row: rowNo, field: fieldName, msg: `Unknown ${fieldName} "${v}". Allowed: ${[...validSet].join(', ')}` });
    return null;
  }
  return v;
}

// Build a reference if one isn't supplied (matches meetings-db._buildReference)
function _buildReference(site_code, department, meeting_date) {
  if (!site_code || !department || !meeting_date) return null;
  const m = String(meeting_date).match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const dept = String(department).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
  return `${site_code}_${dept}_PV_${m[1]}-${m[2]}`;
}

// Truthy parse of 0/1, yes/no, true/false, oui/non
function _toBool(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v ? 1 : 0;
  const s = String(v).trim().toLowerCase();
  return ['1', 'y', 'yes', 'true', 't', 'oui', 'o'].includes(s) ? 1 : 0;
}

// ── parseBuffer ─────────────────────────────────────────────────────
/**
 * @param {Buffer} buf  raw xlsx/xlsm/xls/csv bytes
 * @param {object} lookups  output of meetingsDb.loadLookups()
 */
function parseBuffer(buf, lookups) {
  const errors   = [];
  const warnings = [];
  let workbook;
  try {
    workbook = XLSX.read(buf, { type: 'buffer', cellDates: false });
  } catch (e) {
    errors.push({ row: 0, field: '_workbook', msg: 'Could not parse the workbook: ' + e.message });
    return { meetings: [], errors, warnings, summary: { meetings: 0, issues: 0, actions: 0 } };
  }

  const mSheet = _pickSheet(workbook, SHEET_NAMES.meetings);
  const iSheet = _pickSheet(workbook, SHEET_NAMES.issues);
  const aSheet = _pickSheet(workbook, SHEET_NAMES.actions);

  if (!mSheet) {
    errors.push({ row: 0, field: '_workbook', msg: 'No "Meetings" tab found. Sheet names accepted: ' + SHEET_NAMES.meetings.join(', ') });
    return { meetings: [], errors, warnings, summary: { meetings: 0, issues: 0, actions: 0 } };
  }

  // Lookup sets (codes only)
  const setSite  = new Set((lookups.sites             || []).map(x => x.code));
  const setDept  = new Set((lookups.departments       || []).map(x => x.code));
  const setIntake= new Set((lookups.intake_sources    || []).map(x => x.code));
  const setMstat = new Set((lookups.meeting_statuses  || []).map(x => x.code));
  const setCat   = new Set((lookups.categories        || []).map(x => x.code));
  const setSev   = new Set((lookups.severities        || []).map(x => x.code));
  const setStat  = new Set((lookups.statuses          || []).map(x => x.code));
  const setReason= new Set((lookups.escalation_reasons|| []).map(x => x.code));
  const setTheme = new Set((lookups.council_themes    || []).map(x => x.code));

  // ─ Parse Meetings tab ─────────────────────────────────────────────
  const mRows = _rowsFromSheet(mSheet);
  const meetingsByRef = {};
  mRows.forEach((row, ix) => {
    const rn = row.__row;
    const site_code  = _coerceCode(row.site_code  || row.site,        setSite,   'site_code',  rn, errors, { required: true });
    const department = _coerceCode(row.department || row.dept,        setDept,   'department', rn, errors, { required: true });
    const meetingDate= _toIsoDate(row.meeting_date || row.date);
    if (!meetingDate) errors.push({ row: rn, field: 'meeting_date', msg: 'meeting_date missing or unrecognised format (try YYYY-MM-DD)' });

    let ref = row.reference ? String(row.reference).trim() : '';
    if (!ref) ref = _buildReference(site_code, department, meetingDate);
    if (!ref) {
      // already errored via fields above
      return;
    }
    if (meetingsByRef[ref]) {
      errors.push({ row: rn, field: 'reference', msg: `Duplicate reference "${ref}" in the workbook (also on row ${meetingsByRef[ref].__row}).` });
      return;
    }

    const intake = row.intake_source ? _coerceCode(row.intake_source, setIntake, 'intake_source', rn, errors) : 'dept_meeting';
    const status = row.status        ? _coerceCode(row.status,         setMstat,  'status',        rn, errors) : 'draft';

    meetingsByRef[ref] = {
      __row: rn,
      header: {
        site_code,
        department,
        meeting_date: meetingDate,
        duration_min: row.duration_min ? parseInt(row.duration_min, 10) : null,
        department_head: row.department_head || row.dept_head || '',
        department_head_title: row.department_head_title || row.dept_head_title || '',
        site_it_lead: row.site_it_lead || row.it_lead || '',
        other_attendees: row.other_attendees || row.attendees || '',
        intake_source: intake || 'dept_meeting',
        priority_1: row.priority_1 || row.p1 || '',
        priority_2: row.priority_2 || row.p2 || '',
        priority_3: row.priority_3 || row.p3 || '',
        next_meeting_date:     _toIsoDate(row.next_meeting_date),
        next_meeting_location: row.next_meeting_location || '',
        status: status || 'draft',
        submitted_at:        row.submitted_at        || null,
        dept_head_signed_at: row.dept_head_signed_at || null,
        site_it_signed_at:   row.site_it_signed_at   || null,
        reference: ref,
      },
      projects: [],
      issues: [],
      actions: [],
    };
  });

  // ─ Parse Issues tab ───────────────────────────────────────────────
  if (iSheet) {
    const iRows = _rowsFromSheet(iSheet);
    iRows.forEach(row => {
      const rn = row.__row;
      const ref = String(row.meeting_reference || row.reference || '').trim();
      if (!ref) { errors.push({ row: rn, field: 'meeting_reference', msg: '[Issues] meeting_reference is required' }); return; }
      if (!meetingsByRef[ref]) {
        errors.push({ row: rn, field: 'meeting_reference', msg: `[Issues] meeting_reference "${ref}" does not exist in the Meetings tab` });
        return;
      }
      if (!row.title || !String(row.title).trim()) {
        errors.push({ row: rn, field: 'title', msg: '[Issues] title is required' }); return;
      }
      const category = _coerceCode(row.category, setCat,  'category', rn, errors, { required: true });
      const severity = row.severity ? _coerceCode(row.severity, setSev,  'severity', rn, errors) : 'MEDIUM';
      const status   = row.status   ? _coerceCode(row.status,   setStat, 'status',   rn, errors) : 'open';
      const escalate = _toBool(row.escalate);
      const reason   = row.escalation_reason ? _coerceCode(row.escalation_reason, setReason, 'escalation_reason', rn, errors) : null;
      const theme    = row.council_theme     ? _coerceCode(row.council_theme,     setTheme,  'council_theme',     rn, errors) : null;
      if (escalate && (!reason || !theme)) {
        warnings.push({ row: rn, field: 'escalate', msg: '[Issues] escalate=Y but escalation_reason or council_theme is blank — Engagement #5 will flag this' });
      }
      meetingsByRef[ref].issues.push({
        __row: rn,
        ord: row.ord ? parseInt(row.ord, 10) - 1 : meetingsByRef[ref].issues.length,
        title: String(row.title).trim(),
        description: row.description || '',
        category, severity: severity || 'MEDIUM',
        affects: row.affects || '',
        champion: row.champion || '',
        champion_email: row.champion_email || '',
        target_date: _toIsoDate(row.target_date),
        status: status || 'open',
        escalate,
        escalation_reason: reason || null,
        council_theme: theme || null,
        notes: row.notes || '',
      });
    });
  }

  // ─ Parse Actions tab ──────────────────────────────────────────────
  if (aSheet) {
    const aRows = _rowsFromSheet(aSheet);
    aRows.forEach(row => {
      const rn = row.__row;
      const ref = String(row.meeting_reference || row.reference || '').trim();
      if (!ref) { errors.push({ row: rn, field: 'meeting_reference', msg: '[Actions] meeting_reference is required' }); return; }
      if (!meetingsByRef[ref]) {
        errors.push({ row: rn, field: 'meeting_reference', msg: `[Actions] meeting_reference "${ref}" does not exist in the Meetings tab` });
        return;
      }
      if (!row.description || !String(row.description).trim()) {
        errors.push({ row: rn, field: 'description', msg: '[Actions] description is required' }); return;
      }
      const status = row.status ? _coerceCode(row.status, setStat, 'status', rn, errors) : 'open';
      const linkedOrd = row.linked_issue_ord ? parseInt(row.linked_issue_ord, 10) : null;
      if (linkedOrd && (linkedOrd < 1 || linkedOrd > meetingsByRef[ref].issues.length)) {
        warnings.push({ row: rn, field: 'linked_issue_ord', msg: `[Actions] linked_issue_ord=${linkedOrd} is out of range for "${ref}" (only ${meetingsByRef[ref].issues.length} issues)` });
      }
      if (!row.owner_it && !row.champion) {
        warnings.push({ row: rn, field: 'owner_it', msg: '[Actions] Engagement #3 — no Champion (owner_it) named on this action' });
      }
      meetingsByRef[ref].actions.push({
        __row: rn,
        ord: row.ord ? parseInt(row.ord, 10) - 1 : meetingsByRef[ref].actions.length,
        description: String(row.description).trim(),
        owner_it: row.owner_it || row.champion || '',
        owner_email: row.owner_email || '',
        target_date: _toIsoDate(row.target_date),
        status: status || 'open',
        linked_issue_ord: linkedOrd,
      });
    });
  }

  const meetings = Object.values(meetingsByRef);
  const summary = {
    meetings: meetings.length,
    issues:   meetings.reduce((s, m) => s + m.issues.length,  0),
    actions:  meetings.reduce((s, m) => s + m.actions.length, 0),
    by_site:  {},
  };
  meetings.forEach(m => {
    summary.by_site[m.header.site_code] = (summary.by_site[m.header.site_code] || 0) + 1;
  });

  return { meetings, errors, warnings, summary };
}

// ── commit ──────────────────────────────────────────────────────────
/**
 * Persist a parsed payload to the DB. Should ONLY be called by an
 * admin+ user — site scoping is NOT enforced here.
 *
 * @param {ReturnType<typeof parseBuffer>} parsed
 * @param {object} meetingsDb  the meetings-db module
 * @param {object} opts        { userId, force }
 *                             force=true means commit even with row-level
 *                             errors (the offending rows are skipped).
 *                             Default false → refuses if errors.length > 0.
 */
// NOTE: async since meetingsDb.saveMeeting is a Promise under the postgres
// backend (MEETINGS_BACKEND=postgres). The sqlite path resolves synchronously,
// so `await` is a no-op there. Callers MUST `await commit(...)`.
async function commit(parsed, meetingsDb, opts = {}) {
  const out = { created: 0, updated: 0, skipped: 0, issues: 0, actions: 0, errors: [] };
  if (!parsed || !Array.isArray(parsed.meetings)) {
    out.errors.push({ row: 0, msg: 'Nothing to commit (empty payload)' });
    return out;
  }
  if (!opts.force && parsed.errors && parsed.errors.length) {
    out.errors.push({ row: 0, msg: `Refusing to commit while ${parsed.errors.length} validation errors are present. Pass force=true to skip bad rows.` });
    return out;
  }

  for (const m of parsed.meetings) {
    try {
      // existing meeting? look up by reference (auto-built or supplied)
      const before = meetingsDb.getMeeting
        ? null  // we don't have getMeetingByReference, just go through save
        : null;
      const state = {
        header:   m.header,
        projects: [],          // import format doesn't carry projects (rare for historical PVs)
        issues:   m.issues.map(i => ({
          ord: i.ord, title: i.title, description: i.description,
          category: i.category, severity: i.severity, affects: i.affects,
          champion: i.champion, champion_email: i.champion_email,
          target_date: i.target_date, status: i.status,
          escalate: i.escalate, escalation_reason: i.escalation_reason,
          council_theme: i.council_theme, notes: i.notes,
        })),
        actions:  m.actions.map(a => ({
          ord: a.ord, description: a.description,
          owner_it: a.owner_it, owner_email: a.owner_email,
          target_date: a.target_date, status: a.status,
          linked_issue_ord: a.linked_issue_ord,
        })),
        author_name: opts.author_name || 'import',
      };
      const result = await meetingsDb.saveMeeting(state, null, opts.userId || null);
      if (result.created) out.created++; else out.updated++;
      out.issues += state.issues.length;
      out.actions += state.actions.length;
    } catch (e) {
      out.skipped++;
      out.errors.push({ row: m.__row || 0, msg: `Save failed for ${m.header.reference}: ${e.message}` });
    }
  }
  return out;
}

// ── buildTemplate ───────────────────────────────────────────────────
/**
 * Return a Buffer (xlsx) containing a pre-populated blank import
 * template, prefilled with the column headers + a 4th "Codes" tab
 * listing every lookup code so the user knows what's valid.
 *
 * @param {object} lookups  meetingsDb.loadLookups() output
 */
function buildTemplate(lookups) {
  const wb = XLSX.utils.book_new();

  // ── Tab 1: Meetings ──────────────────────────────────────────────
  const mHeader = [
    'reference', 'site_code', 'department', 'meeting_date',
    'duration_min', 'intake_source', 'status',
    'department_head', 'department_head_title', 'site_it_lead', 'other_attendees',
    'priority_1', 'priority_2', 'priority_3',
    'next_meeting_date', 'next_meeting_location',
  ];
  // Example row (deleteable by user). We pre-compute the reference so the
  // Issues + Actions example rows below can join cleanly — gives the user
  // a working end-to-end sample on first open.
  const today = new Date().toISOString().slice(0, 10);
  const exampleSite = (lookups.sites && lookups.sites[0] && lookups.sites[0].code) || 'HGO';
  const exampleDept = (lookups.departments && lookups.departments[0] && lookups.departments[0].code) || 'mining';
  const exampleRef  = _buildReference(exampleSite, exampleDept, today);
  const mData = [mHeader, [
    exampleRef, exampleSite, exampleDept, today,
    60, 'dept_meeting', 'signed',
    'Jane Doe', 'Mining Manager', 'John Smith', '',
    'Top priority 1', 'Top priority 2', '',
    '', '',
  ]];
  const mSheet = XLSX.utils.aoa_to_sheet(mData);
  mSheet['!cols'] = mHeader.map(h => ({ wch: Math.max(h.length + 2, 16) }));
  XLSX.utils.book_append_sheet(wb, mSheet, 'Meetings');

  // ── Tab 2: Issues ────────────────────────────────────────────────
  const iHeader = [
    'meeting_reference', 'ord', 'title', 'description',
    'category', 'severity', 'status',
    'champion', 'champion_email', 'affects', 'target_date',
    'escalate', 'escalation_reason', 'council_theme', 'notes',
  ];
  const iData = [iHeader, [
    exampleRef, 1, 'Crusher PLC freezes weekly',
    'PLC needs manual reboot every Monday', 'OT', 'HIGH', 'open',
    'IT Champion Name', 'champion@example.com', 'Production · 30 min downtime', '',
    'Y', 'group_decision', 'ot_it', '',
  ]];
  const iSheet = XLSX.utils.aoa_to_sheet(iData);
  iSheet['!cols'] = iHeader.map(h => ({ wch: Math.max(h.length + 2, 14) }));
  XLSX.utils.book_append_sheet(wb, iSheet, 'Issues');

  // ── Tab 3: Actions ───────────────────────────────────────────────
  const aHeader = [
    'meeting_reference', 'ord', 'description',
    'owner_it', 'owner_email', 'target_date', 'status', 'linked_issue_ord',
  ];
  const aData = [aHeader, [
    exampleRef, 1, 'Engage vendor to schedule PLC firmware upgrade',
    'IT Champion Name', 'champion@example.com', '', 'open', 1,
  ]];
  const aSheet = XLSX.utils.aoa_to_sheet(aData);
  aSheet['!cols'] = aHeader.map(h => ({ wch: Math.max(h.length + 2, 16) }));
  XLSX.utils.book_append_sheet(wb, aSheet, 'Actions');

  // ── Tab 4: Codes (lookup reference cheat-sheet) ──────────────────
  const codes = [];
  codes.push(['LOOKUP', 'CODE', 'NAME EN', 'NAME FR']);
  const groups = [
    ['site',              lookups.sites             || []],
    ['department',        lookups.departments       || []],
    ['intake_source',     lookups.intake_sources    || []],
    ['meeting_status',    lookups.meeting_statuses  || []],
    ['category',          lookups.categories        || []],
    ['severity',          lookups.severities        || []],
    ['issue_status',      lookups.statuses          || []],
    ['escalation_reason', lookups.escalation_reasons|| []],
    ['council_theme',     lookups.council_themes    || []],
  ];
  groups.forEach(([name, list]) => {
    list.forEach(row => {
      codes.push([
        name,
        row.code,
        row.name_en || row.name || '',
        row.name_fr || '',
      ]);
    });
    codes.push(['', '', '', '']);  // spacer
  });
  const cSheet = XLSX.utils.aoa_to_sheet(codes);
  cSheet['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 38 }, { wch: 38 }];
  XLSX.utils.book_append_sheet(wb, cSheet, 'Codes');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseBuffer, commit, buildTemplate };
