'use strict';

// A-17b — one switchable definition of "resolution SLA missed" for the server readers.
//
//   flag            (default, today)  the stored request_records.overdue_status = 1
//                                     (Zoho's Overdue Status at the last sync).
//   due_vs_resolved (alternative)     the browser rule — isResOverdue in
//                                     public/lib/dashboard-shared.js: a resolved/closed
//                                     ticket with both a due time and a resolved (or
//                                     completed) time missed the SLA iff it was resolved
//                                     after its due time; a cancelled ticket never counts;
//                                     everything else falls back to the stored flag.
//
// The two disagree on a stale flag (pinned by tests/sla-definition-parity.test.js).
// Which one the server figures follow is a KPI-committee choice
// (report_config helpdesk_sla_definition) — this module only implements both.
// Pure: no I/O. The SQL fragments are constants (the mode is never interpolated).

const MODES = ['flag', 'due_vs_resolved'];
const DEFAULT_MODE = 'flag';

const RESOLVED_STATUSES = new Set(['closed', 'resolved', 'confirmed resolution', 'confirm resolution']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

function _flag(v) {
  if (v == null) return false;
  const s = String(v).toLowerCase().trim();
  return s === '1' || s === 'yes' || s === 'true';
}
const _nz = v => (v == null || String(v).trim() === '' ? null : String(v));

/**
 * resOverdueRow(row, mode) — row is a request_records row (snake_case, ISO date strings
 * as stored by zoho-sync). Returns true when the ticket missed its resolution SLA.
 */
function resOverdueRow(row, mode) {
  const r = row || {};
  if (normalizeMode(mode) === 'flag') return _flag(r.overdue_status);
  const st = String(r.request_status || '').toLowerCase().trim();
  if (CANCELLED_STATUSES.has(st)) return false;
  const due = _nz(r.due_by_time);
  const res = _nz(r.resolved_time) || _nz(r.completed_time);
  if (RESOLVED_STATUSES.has(st) && due && res) return res > due;   // ISO strings: lexical = chronological
  return _flag(r.overdue_status);
}

const _ST = "LOWER(TRIM(COALESCE(request_status, '')))";
const _RES = "COALESCE(NULLIF(resolved_time, ''), NULLIF(completed_time, ''))";
const SQL = {
  flag: 'overdue_status = 1',
  due_vs_resolved:
    `(CASE WHEN ${_ST} IN ('cancelled','canceled') THEN FALSE`
    + ` WHEN ${_ST} IN ('closed','resolved','confirmed resolution','confirm resolution')`
    + ` AND NULLIF(due_by_time, '') IS NOT NULL AND ${_RES} IS NOT NULL THEN ${_RES} > due_by_time`
    + ' ELSE COALESCE(overdue_status, 0) = 1 END)',
};

/** resOverdueSql(mode) — SQL predicate fragment over request_records (TEXT compare, no casts). */
function resOverdueSql(mode) {
  return SQL[normalizeMode(mode)];
}

module.exports = { MODES, DEFAULT_MODE, normalizeMode, resOverdueRow, resOverdueSql };
