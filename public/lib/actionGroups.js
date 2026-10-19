/* Weekly report actions — GROUPS (2026-10-15). UMD: required by the server
   (services/reportActionGroups.js re-exports it) AND loaded by reports.html, so the group
   code/colour shown in the browser is the very one the server computes. PURE, no I/O. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActionGroups = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

// Weekly report actions — GROUPS (2026-10-15). PURE, no I/O.
//
// An action followed over several weeks is a chain of action_items rows (one per weekly
// report) sharing a group key = lineage || uid (the first row has no lineage; its copies
// carry its uid). The site's view of an action is the NEWEST row of its group: a group whose
// newest row is closed/cancelled is finished, whatever an older week still says.
//
// These helpers serve three screens: the "import from a previous week" window (what may be
// imported, and why not), the per-week counts of that window, and the short visible identity
// (#CODE + colour) shown wherever two rows with the same title must be told apart.
// Plan: docs/superpowers/plans/2026-10-06-report-actions-import-merge-identity.md

const TERMINAL = new Set(['closed', 'cancelled']);

function groupKey(r) { return (r && (r.lineage || r.uid)) || ''; }

function _hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
/** Short stable code shown on a group, e.g. "#4K2Z". */
function shortCode(key) {
  return '#' + _hash(key).toString(36).toUpperCase().padStart(4, '0').slice(-4);
}
/** Stable hue (0-359) so a group keeps the same colour on every screen. */
function hue(key) { return _hash('h:' + key) % 360; }

function _yw(r) { return [Number(r.year ?? r._y) || 0, Number(r.week_number ?? r._w) || 0]; }
function _later(a, b) { const [ay, aw] = _yw(a), [by, bw] = _yw(b); return ay > by || (ay === by && aw > bw); }

/** key → { key, code, hue, weeks, first_week, newest:{status, week_label, report_id} } */
function summarizeGroups(siteRows) {
  const out = new Map();
  for (const r of siteRows || []) {
    const key = groupKey(r); if (!key) continue;
    let g = out.get(key);
    if (!g) { g = { key, code: shortCode(key), hue: hue(key), _reports: new Set(), _first: r, _newest: r }; out.set(key, g); }
    g._reports.add(r.report_id);
    if (_later(g._first, r)) g._first = r;
    if (_later(r, g._newest)) g._newest = r;
  }
  for (const g of out.values()) {
    g.weeks = g._reports.size;
    g.first_week = g._first.week_label || null;
    g.newest = { status: g._newest.status, week_label: g._newest.week_label || null, report_id: g._newest.report_id };
    delete g._reports; delete g._first; delete g._newest;
  }
  return out;
}

function _groupMeta(g) { return g ? { key: g.key, code: g.code, hue: g.hue, weeks: g.weeks, first_week: g.first_week } : null; }

/**
 * Decorate the rows of one past week with { group, importable, reason[, closed_week] }.
 * reason: 'closed' | 'cancelled' (the row itself) · 'in_current' (the group is already in the
 * report being edited — saved, or typed in the editor: extraCurrentKeys) · 'closed_since'
 * (a later week closed the group).
 */
function classifySourceRows({ sourceRows, siteRows, currentReportId, extraCurrentKeys }) {
  const groups = summarizeGroups(siteRows);
  const current = new Set(extraCurrentKeys || []);
  for (const r of siteRows || []) if (r.report_id === currentReportId) current.add(groupKey(r));
  return (sourceRows || []).map((r) => {
    const key = groupKey(r);
    const g = groups.get(key) || summarizeGroups([r]).get(key);
    const out = { ...r, group: _groupMeta(g), importable: true, reason: null };
    const st = String(r.status || '').toLowerCase();
    if (TERMINAL.has(st)) { out.importable = false; out.reason = st; }
    else if (current.has(key)) { out.importable = false; out.reason = 'in_current'; }
    else if (g && g.newest && TERMINAL.has(String(g.newest.status || '').toLowerCase())) {
      out.importable = false; out.reason = 'closed_since'; out.closed_week = g.newest.week_label;
    }
    return out;
  });
}

/** report_id → number of its actions still worth importing into currentReportId. */
function weekCounts(siteRows, currentReportId) {
  const counts = new Map();
  const byReport = new Map();
  for (const r of siteRows || []) {
    if (r.report_id === currentReportId) continue;
    if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
    byReport.get(r.report_id).push(r);
  }
  for (const [rid, rows] of byReport) {
    const n = classifySourceRows({ sourceRows: rows, siteRows, currentReportId }).filter(x => x.importable).length;
    counts.set(rid, n);
  }
  return counts;
}

  return { TERMINAL, groupKey, shortCode, hue, summarizeGroups, classifySourceRows, weekCounts };
}));
