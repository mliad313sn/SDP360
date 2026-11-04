'use strict';
// A-24 — canonical figures of a weekly report (as returned by reports-db.getReport) and their
// SHA-256. Captured at every submission (weekly_report_submissions, migration 054) and recomputed
// by GET /api/reports/:id/integrity to detect figures that changed after submission.
// The hash is INTEGRITY evidence, never an approval or a signature. PURE: no I/O.
//
// What counts as a figure: the helpdesk snapshot (minus ids/timestamps/fetched_at), the
// infrastructure KPIs, the highlights/lowlights and the action items (minus ids, uids, links and
// display order). Arrays are sorted by their canonical JSON, so the display order (sort_order,
// which the section writers re-number on every save) never changes the hash; object keys are
// sorted recursively, so the column order of a row never does either.
const crypto = require('crypto');

const HELPDESK_SKIP = new Set(['id', 'report_id', 'updated_at', 'created_at', 'fetched_at']);
const INFRA_KEYS = ['service', 'kpi', 'target', 'status_value', 'status_color', 'trend'];
const LIGHT_KEYS = ['type', 'content'];
const ACTION_KEYS = ['task', 'priority', 'due_date', 'owner', 'status', 'department', 'comment'];

function _canon(v) {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? null : v;
  if (Array.isArray(v)) return v.map(_canon);
  const out = {};
  for (const k of Object.keys(v).sort()) { if (v[k] !== undefined) out[k] = _canon(v[k]); }
  return out;
}
function _pick(row, keys) {
  const o = {};
  for (const k of keys) o[k] = row && row[k] !== undefined ? _canon(row[k]) : null;
  return o;
}
function _sortedRows(rows, keys) {
  return (Array.isArray(rows) ? rows : []).map((r) => _pick(r, keys))
    .map((o) => [JSON.stringify(o), o]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((x) => x[1]);
}

function canonicalFigures(report) {
  const r = report || {};
  const hd = {};
  const src = r.helpdesk && typeof r.helpdesk === 'object' ? r.helpdesk : {};
  for (const k of Object.keys(src).sort()) if (!HELPDESK_SKIP.has(k)) hd[k] = _canon(src[k]);
  return {
    helpdesk: hd,
    infra_kpis: _sortedRows(r.infra_kpis, INFRA_KEYS),
    lights: _sortedRows(r.lights, LIGHT_KEYS),
    action_items: _sortedRows(r.action_items, ACTION_KEYS),
  };
}

function figuresHash(report) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalFigures(report)), 'utf8').digest('hex');
}

module.exports = { canonicalFigures, figuresHash };
