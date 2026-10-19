'use strict';
/**
 * Pure CSV parser for Action Items bulk import.
 *
 * Usage (browser):
 *   const { ok, errors, fatal, error } = parseActionsCsv(text, departmentList);
 *
 * Usage (Node — for tests):
 *   const { parseActionsCsv } = require('./parse-actions-csv');
 *
 * `departmentList` accepts either:
 *   - array of strings: ['Mining', 'Technical Service', ...]
 *   - array of objects: [{name:'Mining'}, ...]   (matches the API response shape)
 *
 * Output:
 *   - { fatal:true, error:'…' }                                    on whole-file rejection
 *   - { fatal:false, ok:[…rows], errors:[{row, reason}] }          on partial success
 *
 * `row` in errors is the 1-indexed CSV file row (header = row 1, first data row = row 2).
 *
 * See spec §7 (parser format) for the canonical rules this implements.
 */

const HEADER_SYNONYMS = {
  task:       ['task', 'action', 'tâche', 'tache', 'task / action'],
  department: ['department', 'dept', 'département', 'departement'],
  priority:   ['priority', 'priorité', 'priorite'],
  due_date:   ['due_date', 'due date', 'due', 'échéance', 'echeance', 'date'],
  owner:      ['owner', 'assignee', 'responsable'],
  status:     ['status', 'statut', 'state'],
  comment:    ['comment', 'comments', 'note', 'notes', 'commentaire']
};
const REQUIRED = ['task', 'department', 'priority', 'due_date', 'owner', 'status'];

const PRIORITY_MAP = {
  high: 'High', haute: 'High', h: 'High',
  medium: 'Medium', med: 'Medium', moyenne: 'Medium', m: 'Medium',
  low: 'Low', basse: 'Low', l: 'Low'
};

const STATUS_MAP = {
  'open': 'open', 'ouvert': 'open',
  'in_progress': 'in_progress', 'in progress': 'in_progress', 'inprogress': 'in_progress',
  'en cours': 'in_progress', 'en_cours': 'in_progress',
  'on_hold': 'on_hold', 'on hold': 'on_hold', 'onhold': 'on_hold',
  'en attente': 'on_hold', 'en_attente': 'on_hold',
  'closed': 'closed', 'fermé': 'closed', 'ferme': 'closed',
  'cancelled': 'cancelled', 'canceled': 'cancelled',
  'annulé': 'cancelled', 'annule': 'cancelled'
};

const MAX_ROWS = 5000;
const MAX_TASK_LEN = 500;
const MAX_OWNER_LEN = 100;
const MAX_COMMENT_LEN = 2000;

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

/**
 * Split CSV text into rows (arrays of fields).
 * Honours RFC 4180-style quoting:
 *   - fields enclosed in double quotes may contain commas, newlines, and escaped ""
 *   - unquoted fields cannot contain commas
 */
function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c === '\r') {
        // skip — handle \r\n via the \n branch
      } else {
        field += c;
      }
    }
  }
  // trailing field/row (no trailing newline)
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();
  return rows;
}

function normalizeHeader(h) {
  const k = String(h || '').trim().toLowerCase();
  for (const [canonical, syns] of Object.entries(HEADER_SYNONYMS)) {
    if (syns.includes(k)) return canonical;
  }
  return null;
}

/**
 * Returns { value: 'YYYY-MM-DD' } on success, { error: string } on failure,
 * or { value: null } for empty input.
 */
function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (!isNaN(d) && d.toISOString().slice(0, 10) === s) return { value: s };
    return { error: `invalid ISO date '${s}'` };
  }

  // DMY/MDY with /, -, or . separators
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = m[3];
    let day, month;
    if (a > 12 && b <= 12)       { day = a; month = b; }      // unambiguous DMY
    else if (b > 12 && a <= 12)  { day = b; month = a; }      // unambiguous MDY
    else if (a <= 12 && b <= 12) return { error: `ambiguous date '${s}' (use YYYY-MM-DD)` };
    else                          return { error: `invalid date '${s}'` };

    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d) || d.toISOString().slice(0, 10) !== iso) return { error: `invalid date '${s}'` };
    return { value: iso };
  }

  return { error: `unparseable date '${s}'` };
}

function parseActionsCsv(rawText, departmentList) {
  const text = stripBom(String(rawText || ''));
  const rows = parseCsvRows(text);

  if (!rows.length) return { fatal: true, error: 'empty file' };
  if (rows.length - 1 > MAX_ROWS) {
    return { fatal: true, error: `too many rows (max ${MAX_ROWS}); got ${rows.length - 1}` };
  }

  // Header
  const headerRow = rows[0].map(normalizeHeader);
  const present = new Set(headerRow.filter(Boolean));
  const missing = REQUIRED.filter(c => !present.has(c));
  if (missing.length) return { fatal: true, error: `missing required column "${missing[0]}"` };

  // Build column index map (canonical → index)
  const idx = {};
  headerRow.forEach((h, i) => { if (h) idx[h] = i; });

  // Build canonical-name lookup for departments (lowercase trimmed → original casing)
  const deptCanon = {};
  (departmentList || []).forEach(d => {
    const name = typeof d === 'string' ? d : (d && d.name);
    if (typeof name === 'string') {
      deptCanon[name.toLowerCase().trim()] = name;
    }
  });

  const ok = [];
  const errors = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const fileRow = r + 1;  // 1-indexed CSV file row (header is row 1)
    const get = key => idx[key] !== undefined ? String(row[idx[key]] || '').trim() : '';

    // task — required
    const task = get('task');
    if (!task) { errors.push({ row: fileRow, reason: 'empty task' }); continue; }
    if (task.length > MAX_TASK_LEN) { errors.push({ row: fileRow, reason: `task too long (max ${MAX_TASK_LEN})` }); continue; }

    // department — required, must match an active dept (case-insensitive)
    const deptRaw = get('department');
    const deptCanonical = deptCanon[deptRaw.toLowerCase()];
    if (!deptCanonical) {
      errors.push({ row: fileRow, reason: `unknown department '${deptRaw}'` });
      continue;
    }

    // priority — optional, default Medium; rejects unparseable non-empty values
    let priority = 'Medium';
    const priRaw = get('priority');
    if (priRaw) {
      const m = PRIORITY_MAP[priRaw.toLowerCase()];
      if (!m) { errors.push({ row: fileRow, reason: `unknown priority '${priRaw}'` }); continue; }
      priority = m;
    }

    // status — optional, default open
    let status = 'open';
    const stRaw = get('status');
    if (stRaw) {
      const m = STATUS_MAP[stRaw.toLowerCase()];
      if (!m) { errors.push({ row: fileRow, reason: `unknown status '${stRaw}'` }); continue; }
      status = m;
    }

    // due_date — optional; ISO or unambiguous DMY/MDY
    const dateRes = parseDate(get('due_date'));
    if (dateRes.error) { errors.push({ row: fileRow, reason: dateRes.error }); continue; }

    // owner — optional, free text, truncate at 100
    let owner = get('owner');
    if (owner.length > MAX_OWNER_LEN) owner = owner.slice(0, MAX_OWNER_LEN);

    // comment — optional, truncate at 2000
    let comment = get('comment');
    if (comment.length > MAX_COMMENT_LEN) comment = comment.slice(0, MAX_COMMENT_LEN);

    ok.push({
      task,
      department: deptCanonical,
      priority,
      due_date: dateRes.value,
      owner: owner || null,
      status,
      comment: comment || null
    });
  }

  return { fatal: false, ok, errors };
}

// CommonJS export (Node tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseActionsCsv };
}
// Browser global
if (typeof window !== 'undefined') {
  window.parseActionsCsv = parseActionsCsv;
}
