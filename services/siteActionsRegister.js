'use strict';
// SP1a — Per-site Actions Register: PURE normalizer.
// Merges a site's still-open actions from three sources (meetings / inspection
// / weekly-report follow-ups) into one grouped, aged, overdue-flagged shape.
// No DB, no Date.now — `asOf` is passed in so it is unit-testable and
// deterministic. Terminal statuses are filtered per source vocabulary; the
// report source carries no created timestamp, so its rows have age_days=null
// (flagged, never faked). Spec:
// docs/superpowers/specs/2026-07-27-site-actions-register-design.md
//
// Deliberately independent of the DB readers: the route fetches raw rows and
// hands them here, so acquisition can change without touching this logic.

const TERMINAL = {
  meetings: new Set(['resolved', 'cancelled', 'closed']),
  inspection: new Set(['closed', 'cancelled']),
  report: new Set(['closed']),
};

function _isTerminal(source, status) {
  return TERMINAL[source].has(String(status || '').trim().toLowerCase());
}

// Parse a stored date to epoch ms, or null when unparseable. ISO (what the DBs
// store for created_at) parses cleanly; ambiguous free-form due dates that
// don't parse yield null → overdue false / age null, never a guessed value.
function _time(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

const _DAY = 86400000;

function _ageDays(createdAt, asOfMs) {
  const t = _time(createdAt);
  if (t == null || asOfMs == null) return null;
  const d = Math.floor((asOfMs - t) / _DAY);
  return d < 0 ? 0 : d;
}

function _overdue(dueDate, asOfMs, terminal) {
  if (terminal) return false;
  const t = _time(dueDate);
  return t != null && asOfMs != null && t < asOfMs;
}

function _emptyGroup() {
  return { items: [], count: 0, oldest_days: null };
}

function _finishGroup(items) {
  const ages = items.map((i) => i.age_days).filter((a) => a != null);
  return {
    items,
    count: items.length,
    oldest_days: ages.length ? Math.max(...ages) : null,
  };
}

function buildSiteActions(input) {
  input = input || {};
  const asOfMs = _time(input.asOf);
  const meetings = Array.isArray(input.meetings) ? input.meetings : [];
  const inspection = Array.isArray(input.inspection) ? input.inspection : [];
  const report = input.report && Array.isArray(input.report.actions) ? input.report : null;

  const mItems = meetings
    .filter((a) => !_isTerminal('meetings', a.status))
    .map((a) => ({
      source: 'meetings',
      title: a.description || '—',
      owner: a.owner_it || a.owner_email || null,
      due_date: a.target_date || null,
      status: a.status,
      age_days: _ageDays(a.created_at, asOfMs),
      overdue: _overdue(a.target_date, asOfMs, false),
      origin_label: a.meeting_reference || null,
      action_id: a.id,
      close: { kind: 'inline' },
    }));

  const iItems = inspection
    .filter((a) => !_isTerminal('inspection', a.status))
    .map((a) => ({
      source: 'inspection',
      title: a.description || '—',
      owner: a.owner || null,
      due_date: a.due_date || null,
      status: a.status,
      age_days: _ageDays(a.created_at, asOfMs),
      overdue: _overdue(a.due_date, asOfMs, false),
      origin_label: a.inspection_label || null,
      action_id: a.id,
      close: { kind: 'inline' },
    }));

  const rItems = report
    ? report.actions
        // SP1b: a merged follow-up (source set) is a duplicate of an origin
        // already listed under Meetings/Inspections — fold it away here.
        .filter((a) => !_isTerminal('report', a.status) && !a.source)
        .map((a) => ({
          source: 'report',
          title: a.task || '—',
          owner: a.owner || null,
          due_date: a.due_date || null,
          status: a.status,
          age_days: null, // action_items has no created timestamp
          overdue: _overdue(a.due_date, asOfMs, false),
          origin_label: report.week_label || null,
          action_id: null,
          uid: a.uid || null,   // SP1b: the report action's stable uid — merge target for the hub
          close: { kind: 'link', url: 'reports.html?report=' + report.report_id },
        }))
    : [];

  const groups = {
    meetings: _finishGroup(mItems),
    inspection: _finishGroup(iItems),
    report: _finishGroup(rItems),
  };
  return {
    groups,
    totals: { open: groups.meetings.count + groups.inspection.count + groups.report.count },
  };
}

module.exports = { buildSiteActions, TERMINAL };
