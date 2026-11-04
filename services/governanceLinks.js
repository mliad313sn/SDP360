'use strict';
// C-15 (G23) — PURE helpers for the governance cockpit.
//   decisionSourceLinks(d, { sessions })  where a decision came from: its session (cockpit deep link) and/or the
//     PV / reference it names (source_kind + source_ref). Empty array = source unknown — never invented.
//   daysOverdue(due, asOf)                whole days late; 0 when not yet due (a measured zero); null when the due
//     date is missing or unreadable (unknown — never 0).
//   engagementDelays(items, asOf)         per-item days_overdue + bucket, and the ageing summary for the cockpit.

const PV_KINDS = new Set(['pv', 'meeting', 'meetings', 'md_meeting']);
const d10 = (v) => (v ? String(v).slice(0, 10) : '');

function decisionSourceLinks(d, { sessions = null } = {}) {
  if (!d) return [];
  const out = [];
  if (d.session_id != null && d.session_id !== '') {
    const id = Number(d.session_id);
    const s = sessions && typeof sessions.get === 'function' ? sessions.get(id) : null;
    const date = s && d10(s.scheduled_at);
    const label = s && (date || s.cadence_name) ? ['Session ' + (date || '#' + id), s.cadence_name].filter(Boolean).join(' · ') : 'Session #' + id;
    out.push({ kind: 'session', label, href: 'cockpit.html?session=' + id });
  }
  const ref = d.source_ref == null ? '' : String(d.source_ref).trim();
  if (ref) {
    const kind = String(d.source_kind || '').trim().toLowerCase();
    if (PV_KINDS.has(kind)) out.push({ kind: 'pv', label: 'PV ' + ref, href: /^\d+$/.test(ref) ? 'meeting.html?id=' + ref : null });
    else out.push({ kind: kind || 'reference', label: ref, href: null });
  }
  return out;
}

function _day(v) {
  const s = d10(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;   // 2026-02-31 → unknown
  return t;
}

function daysOverdue(due, asOf) {
  const a = _day(due), b = _day(asOf || new Date().toISOString());
  if (a == null || b == null) return null;
  return Math.max(0, Math.round((b - a) / 864e5));
}

function bucketOf(days) {
  if (days == null) return 'unknown';
  if (days === 0) return 'on_time';
  if (days <= 7) return 'd1_7';
  if (days <= 30) return 'd8_30';
  if (days <= 90) return 'd31_90';
  return 'd90_plus';
}

function engagementDelays(items, asOf) {
  const rows = (items || []).map((it) => { const days = daysOverdue(it && it.due_date, asOf); return { ...it, days_overdue: days, bucket: bucketOf(days) }; });
  rows.sort((x, y) => (x.days_overdue == null) - (y.days_overdue == null) || (y.days_overdue || 0) - (x.days_overdue || 0));
  const buckets = { on_time: 0, d1_7: 0, d8_30: 0, d31_90: 0, d90_plus: 0, unknown: 0 };
  for (const r of rows) buckets[r.bucket]++;
  const known = rows.filter((r) => r.days_overdue != null);
  return {
    items: rows,
    summary: { total: rows.length, overdue: known.filter((r) => r.days_overdue > 0).length, unknown: buckets.unknown, buckets,
      max_days_overdue: known.length ? Math.max(...known.map((r) => r.days_overdue)) : null },
  };
}

module.exports = { decisionSourceLinks, daysOverdue, engagementDelays, bucketOf };
