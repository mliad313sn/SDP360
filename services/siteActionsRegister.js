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

// md_issues / md_actions: + demand / helpdesk_ticket (2026-10-16, public/lib/statusTransfer.js)
const _MD_DONE = require('../public/lib/statusTransfer').DONE;
const TERMINAL = {
  meetings: new Set(_MD_DONE),
  incubation: new Set(_MD_DONE),   // same md_actions vocabulary
  issue: new Set(_MD_DONE),        // md_issues vocabulary (meetings-init statuses)
  inspection: new Set(['closed', 'cancelled']),
  report: new Set(['closed', 'cancelled']),
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



function _finishGroup(items) {
  const ages = items.map((i) => i.age_days).filter((a) => a != null);
  return {
    items,
    count: items.length,
    oldest_days: ages.length ? Math.max(...ages) : null,
  };
}

// Business Incubation sessions live in the meetings tables (md_actions) but get their OWN
// group in the hub (2026-10-05). Recognised by the session's intake_source, or — for rows
// read without that column — by the _INC_ reference the incubation sessions carry.
function _isIncubation(a) {
  return String((a && a.intake_source) || '') === 'business_incubation'
    || /_INC_/i.test(String((a && a.meeting_reference) || ''));
}

function buildSiteActions(input) {
  input = input || {};
  const asOfMs = _time(input.asOf);
  const meetings = Array.isArray(input.meetings) ? input.meetings : [];
  const inspection = Array.isArray(input.inspection) ? input.inspection : [];
  const report = input.report && Array.isArray(input.report.actions) ? input.report : null;

  const _mdItem = (source) => (a) => ({
      source,
      title: a.description || '—',
      owner: a.owner_it || a.owner_email || null,
      due_date: a.target_date || null,
      status: a.status,
      age_days: _ageDays(a.created_at, asOfMs),
      overdue: _overdue(a.target_date, asOfMs, false),
      origin_label: a.meeting_reference || null,
      action_id: a.id,
      linked_issue_id: a.linked_issue_id || null,   // lets the page offer to close the issue it treats
      close: { kind: 'inline' },
    });
  const mItems = meetings
    .filter((a) => !_isIncubation(a) && !_isTerminal('meetings', a.status))
    .map(_mdItem('meetings'));
  const incItems = meetings
    .filter((a) => _isIncubation(a) && !_isTerminal('incubation', a.status))
    .map(_mdItem('incubation'));

  // Open issues (meetings + incubation sessions, 2026-10-05): what each one still needs. An
  // issue is "treated" by its OPEN linked actions — open_actions = 0 means nobody is on it yet.
  const issues = Array.isArray(input.issues) ? input.issues : [];
  const openByIssue = new Map();
  for (const a of meetings) {
    if (a && a.linked_issue_id && !_isTerminal('meetings', a.status)) {
      openByIssue.set(a.linked_issue_id, (openByIssue.get(a.linked_issue_id) || 0) + 1);
    }
  }
  const SEV = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const isItems = issues
    .filter((i) => !_isTerminal('issue', i.status))
    .map((i) => ({
      source: 'issue',
      title: i.title || '—',
      owner: i.champion || null,
      severity: i.severity || null,
      due_date: i.target_date || null,
      status: i.status,
      age_days: _ageDays(i.created_at, asOfMs),
      overdue: _overdue(i.target_date, asOfMs, false),
      origin_label: i.meeting_reference || null,
      issue_id: i.id,
      meeting_id: i.meeting_id || i.meeting_id_ref || null,
      escalated: !!Number(i.escalate || 0),
      incubation: _isIncubation(i),
      open_actions: openByIssue.get(i.id) || 0,
      close: { kind: 'inline' },
    }))
    .sort((a, b) => (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3)
      || (b.overdue - a.overdue)
      || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));

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
          // action_items has no created_at; age is measured from first_logged —
          // the start of the EARLIEST report week the follow-up appeared in (its
          // lineage root), supplied by getSiteOpenReportActions. null when absent
          // (legacy fixtures) → never faked.
          age_days: _ageDays(a.first_logged, asOfMs),
          overdue: _overdue(a.due_date, asOfMs, false),
          // SP1b-lignée: each report action carries its OWN report_id/week_label
          // (the hub aggregates across weeks). Fall back to the wrapper for the
          // legacy single-report shape (kept for the unit fixtures).
          origin_label: a.week_label || report.week_label || null,
          action_id: null,
          uid: a.uid || null,   // SP1b: the report action's stable uid — merge target for the hub
          close: { kind: 'link', url: 'reports.html?report=' + (a.report_id || report.report_id) },
        }))
    : [];

  const groups = {
    issues: _finishGroup(isItems),
    meetings: _finishGroup(mItems),
    incubation: _finishGroup(incItems),
    inspection: _finishGroup(iItems),
    report: _finishGroup(rItems),
  };
  return {
    groups,
    // totals.open = ACTIONS only (unchanged meaning for every consumer); issues counted apart.
    totals: { open: groups.meetings.count + groups.incubation.count + groups.inspection.count + groups.report.count,
      issues: groups.issues.count },
  };
}

// Hub "Show closed / cancelled" (2026-10-16): what was closed or cancelled since `since`
// (YYYY-MM-DD), across the five sources, newest first — so a wrong click can be reopened
// without hunting for the right week. Same item shape as the open groups (+ closed_at);
// `source` names the group whose status vocabulary applies.
function buildRecentlyClosed(input) {
  input = input || {};
  const since = String(input.since || '');
  const d10 = (s) => (s ? String(s).slice(0, 10) : '');
  const recent = (s) => !!d10(s) && d10(s) >= since;
  const out = [];
  for (const a of (Array.isArray(input.meetings) ? input.meetings : [])) {
    const src = _isIncubation(a) ? 'incubation' : 'meetings';
    if (!_isTerminal(src, a.status) || !recent(a.closed_at)) continue;
    out.push({ source: src, title: a.description || '—', owner: a.owner_it || a.owner_email || null, status: a.status,
      closed_at: a.closed_at, origin_label: a.meeting_reference || null, action_id: a.id,
      status_note: a.status_note || null, helpdesk_ticket: a.helpdesk_ticket || null });
  }
  for (const i of (Array.isArray(input.issues) ? input.issues : [])) {
    if (!_isTerminal('issue', i.status) || !recent(i.closed_at)) continue;
    out.push({ source: 'issue', title: i.title || '—', owner: i.champion || null, status: i.status,
      closed_at: i.closed_at, origin_label: i.meeting_reference || null, issue_id: i.id,
      status_note: i.status_note || null, helpdesk_ticket: i.helpdesk_ticket || null });
  }
  for (const a of (Array.isArray(input.inspection) ? input.inspection : [])) {
    if (!_isTerminal('inspection', a.status) || !recent(a.closed_at || a.updated_at)) continue;
    out.push({ source: 'inspection', title: a.description || '—', owner: a.owner || null, status: a.status,
      closed_at: a.closed_at || a.updated_at, origin_label: a.inspection_label || null, action_id: a.id });
  }
  const rep = input.report && Array.isArray(input.report.actions) ? input.report.actions : [];
  for (const a of rep) {
    if (a.source || !_isTerminal('report', a.status) || !recent(a.closed_at)) continue;
    out.push({ source: 'report', title: a.task || '—', owner: a.owner || null, status: a.status,
      closed_at: a.closed_at, origin_label: a.week_label || null, uid: a.uid || null, comment: a.comment || null,
      close: { kind: 'link', url: 'reports.html?report=' + a.report_id } });
  }
  return out.sort((x, y) => String(y.closed_at).localeCompare(String(x.closed_at)));
}

module.exports = { buildSiteActions, buildRecentlyClosed, TERMINAL, _isIncubation };
