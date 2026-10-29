'use strict';
// ADR-006 — PURE resolver: roles, deputies and the escalation matrix are DATA (migration 035).
// No DB, no clock: every function takes the rows and the day. The lifecycles keep their invariants
// (only the receiver accepts, nobody verifies their own work); this module only answers
// "who holds this role here, today" and "who stands in for whom today".
//
// Resolution, like the policies: site rows first, then platform rows (site_id NULL).
// Empty tables = the behaviour until now: no named holder, no deputy, escalations recorded without a target.

const ROLES = Object.freeze({
  'handoffs.escalation_target': { process: 'handoffs', en: 'Receives overdue handoff escalations', fr: 'Reçoit les remontées des demandes inter-services en retard' },
  'handoffs.group_escalation': { process: 'handoffs', en: 'Second level for handoffs still overdue (group)', fr: 'Second niveau pour les demandes toujours en retard (groupe)' },
  'commitments.escalation_target': { process: 'commitments', en: 'Receives A01 / A02 commitment escalations', fr: 'Reçoit les alertes A01 / A02 des engagements' },
  'commitments.group_escalation': { process: 'commitments', en: 'Second level for serious commitments still overdue (group)', fr: 'Second niveau pour les engagements graves toujours en retard (groupe)' },
  'meetings.chair': { process: 'meetings', en: 'Chairs the site governance sessions', fr: 'Préside les séances de gouvernance du site' },
  'meetings.minutes_acceptor': { process: 'meetings', en: 'Accepts the minutes (second pair of eyes)', fr: 'Accepte le compte rendu (deuxième regard)' },
  'commitments.reviewer': { process: 'commitments', en: 'Verifies the closure of commitments', fr: 'Vérifie la clôture des engagements' },
  'reports.publisher': { process: 'reports', en: 'Publishes reports after review', fr: 'Publie les rapports après revue' },
  'group.reviewer': { process: 'group', en: 'Second pair of eyes from the group for one-person sites', fr: 'Deuxième regard du groupe pour les sites à une personne' },
});
const REGISTERS = Object.freeze({ handoffs: ['*'], commitments: ['*', 'low', 'medium', 'high', 'critical'] });
// roles every operating site should have a holder for (site row or platform row) — the coverage gaps list
const REQUIRED = Object.freeze(['handoffs.escalation_target', 'commitments.escalation_target']);
const DEPUTY_MAX_DAYS = 120;
// security review: listed days pause the overdue rules — the admin tier lists at most this many per site per year
const CALENDAR_MAX_DAYS_PER_YEAR = 20;

const day = (d) => String(d || '').slice(0, 10);
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && Number.isFinite(Date.parse(d + 'T00:00:00Z'));
const num = (x) => (x == null || x === '' ? null : Number(x));
const live = (r, d) => !r.ended_at && !r.revoked_at && !r.retired_at && day(r.effective_from || r.start_date) <= d && (!(r.effective_to || r.end_date) || day(r.effective_to || r.end_date) >= d);

/** Holders of a role at a site on a day: the site's own holders, else the platform holders. */
function holders(assignments, role, siteId, today) {
  const d = day(today); const rows = (assignments || []).filter((a) => a.role === role && live(a, d));
  const site = siteId == null ? [] : rows.filter((a) => num(a.site_id) === Number(siteId));
  const pick = site.length ? site : rows.filter((a) => a.site_id == null);
  return [...new Set(pick.map((a) => Number(a.user_id)))];
}

/** People `deputyId` stands in for today. */
function principalsOf(deputies, deputyId, today) {
  const d = day(today);
  return [...new Set((deputies || []).filter((x) => Number(x.deputy_id) === Number(deputyId) && live(x, d)).map((x) => Number(x.user_id)))];
}
/** Who stands in for `userId` today. */
function deputiesOf(deputies, userId, today) {
  const d = day(today);
  return [...new Set((deputies || []).filter((x) => Number(x.user_id) === Number(userId) && live(x, d)).map((x) => Number(x.deputy_id)))];
}

/**
 * Escalation target for an overdue item. Matching matrix rows: same register, severity '*' or equal,
 * site row or platform row, after_days ≤ overdue days. Preference: site over platform, then the highest
 * after_days (the latest level reached), then an exact severity over '*'.
 * @returns {{ matched, role, targets:number[], gap:boolean, why:string }}
 *   gap = a row matched but nobody holds the role — never an escalation into the void (ADR-006 risk).
 */
function escalationTarget({ matrix, assignments, deputies }, { register, severity, siteId, overdueDays, today }) {
  const sev = String(severity || '*').toLowerCase(); const od = Math.max(0, Number(overdueDays) || 0);
  const rows = (matrix || []).filter((m) => !m.retired_at && m.register === register && (m.severity === '*' || String(m.severity).toLowerCase() === sev)
    && Number(m.after_days || 0) <= od && (m.site_id == null || (siteId != null && num(m.site_id) === Number(siteId))));
  if (!rows.length) return { matched: null, role: null, targets: [], gap: false, why: 'no escalation rule' };
  rows.sort((a, b) => (Number(b.site_id != null) - Number(a.site_id != null)) || (Number(b.after_days || 0) - Number(a.after_days || 0)) || (Number(b.severity !== '*') - Number(a.severity !== '*')));
  const m = rows[0];
  const who = holders(assignments, m.role, siteId, today);
  // a holder who is away is replaced by their deputy — the escalation still reaches a person
  const targets = [...new Set(who.flatMap((u) => { const deps = deputiesOf(deputies, u, today); return deps.length ? [u, ...deps] : [u]; }))];
  return { matched: { id: Number(m.id), role: m.role, after_days: Number(m.after_days || 0), site_id: num(m.site_id) }, role: m.role, targets, gap: !targets.length, why: targets.length ? 'ok' : `nobody holds ${m.role}` };
}

/** (site × required role) pairs with no holder today, and matrix rows whose role nobody holds. */
function coverageGaps({ assignments, matrix }, sites, today) {
  const out = [];
  for (const s of sites || []) for (const role of REQUIRED) if (!holders(assignments, role, s.id, today).length) out.push({ kind: 'role', site_id: Number(s.id), site: s.name, role });
  for (const m of (matrix || []).filter((x) => !x.retired_at)) {
    const siteList = m.site_id == null ? (sites || []) : (sites || []).filter((s) => Number(s.id) === Number(m.site_id));
    for (const s of siteList) if (!holders(assignments, m.role, s.id, today).length) out.push({ kind: 'matrix', matrix_id: Number(m.id), site_id: Number(s.id), site: s.name, role: m.role, register: m.register });
  }
  return out;
}

const no = (status, code, error) => ({ status, code, error });
function validateAssignment(b) {
  if (!ROLES[b.role]) return no(400, 'VALIDATION', 'unknown role');
  if (b.user_id == null || !Number.isFinite(Number(b.user_id))) return no(400, 'VALIDATION', 'user_id is required');
  if (!isDay(b.effective_from)) return no(400, 'VALIDATION', 'effective_from must be YYYY-MM-DD');
  if (b.effective_to != null && b.effective_to !== '' && (!isDay(b.effective_to) || b.effective_to < b.effective_from)) return no(400, 'VALIDATION', 'effective_to must be a date on or after effective_from');
  if (String(b.reason || '').trim().length < 5) return no(400, 'VALIDATION', 'a reason (5+ characters) is required');
  return null;
}
function validateDeputy(b) {
  if (b.user_id == null || b.deputy_id == null) return no(400, 'VALIDATION', 'user_id and deputy_id are required');
  if (Number(b.user_id) === Number(b.deputy_id)) return no(400, 'VALIDATION', 'a person cannot be their own deputy');
  if (!isDay(b.start_date) || !isDay(b.end_date) || b.end_date < b.start_date) return no(400, 'VALIDATION', 'start_date and end_date must be dates, end on or after start');
  if ((Date.parse(b.end_date) - Date.parse(b.start_date)) / 864e5 > DEPUTY_MAX_DAYS) return no(400, 'VALIDATION', `a deputy covers at most ${DEPUTY_MAX_DAYS} days — renew it for a longer absence`);
  if (String(b.reason || '').trim().length < 5) return no(400, 'VALIDATION', 'a reason (5+ characters) is required');
  return null;
}
function validateMatrix(b) {
  if (!REGISTERS[b.register]) return no(400, 'VALIDATION', 'register must be handoffs or commitments');
  if (!REGISTERS[b.register].includes(String(b.severity || '*').toLowerCase())) return no(400, 'VALIDATION', 'unknown severity for this register');
  if (!ROLES[b.role]) return no(400, 'VALIDATION', 'unknown role');
  const d = Number(b.after_days == null ? 0 : b.after_days);
  if (!Number.isInteger(d) || d < 0 || d > 365) return no(400, 'VALIDATION', 'after_days must be a whole number between 0 and 365');
  if (String(b.reason || '').trim().length < 5) return no(400, 'VALIDATION', 'a reason (5+ characters) is required');
  return null;
}

module.exports = { ROLES, REGISTERS, REQUIRED, DEPUTY_MAX_DAYS, CALENDAR_MAX_DAYS_PER_YEAR, holders, principalsOf, deputiesOf, escalationTarget, coverageGaps, validateAssignment, validateDeputy, validateMatrix };
