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

// A10 / C-03 — account state. `opts` is OPTIONAL: { active:Set<userId>, sitesOf:(userId)=>number[]|null }.
// Absent (governance.skip_inactive_holders = false) = the behaviour until now: role / deputy rows only.
// sitesOf → the user's sites today; null = unscoped (admin tier, works on every site).
const _sitesOf = (opts, u) => (opts && typeof opts.sitesOf === 'function' ? opts.sitesOf(Number(u)) : null);
const _isActive = (opts, u) => !(opts && opts.active) || opts.active.has(Number(u));
/** Why a holder is not eligible for a role row (null = eligible): inactive account, or a site row whose site the person no longer holds. */
function holderIneligible(opts, userId, rowSiteId) {
  if (!opts) return null;
  if (!_isActive(opts, userId)) return 'inactive';
  if (rowSiteId != null) { const s = _sitesOf(opts, userId); if (s != null && !s.map(Number).includes(Number(rowSiteId))) return 'site_removed'; }
  return null;
}
/** Why a deputy cannot stand in for `principalId` (null = eligible) — the naming rule re-checked today:
 *  active, and a shared site with the principal (or unscoped). An unscoped principal: the deputy must hold `siteId`. */
function deputyIneligible(opts, deputyId, principalId, siteId) {
  if (!opts) return null;
  if (!_isActive(opts, deputyId)) return 'inactive';
  const ds = _sitesOf(opts, deputyId); if (ds == null) return null;
  const ps = _sitesOf(opts, principalId);
  const need = ps != null ? ps.map(Number) : (siteId != null ? [Number(siteId)] : null);
  if (need && !ds.map(Number).some((x) => need.includes(x))) return 'site_removed';
  return null;
}

/** Holders of a role at a site on a day: the site's own holders, else the platform holders.
 *  With `opts`: ineligible holders are skipped; no eligible site holder → the eligible platform holders. */
function holders(assignments, role, siteId, today, opts) {
  const d = day(today); const rows = (assignments || []).filter((a) => a.role === role && live(a, d));
  const site = siteId == null ? [] : rows.filter((a) => num(a.site_id) === Number(siteId));
  if (!opts) {
    const pick = site.length ? site : rows.filter((a) => a.site_id == null);
    return [...new Set(pick.map((a) => Number(a.user_id)))];
  }
  const ok = (list) => list.filter((a) => !holderIneligible(opts, a.user_id, a.site_id)).map((a) => Number(a.user_id));
  const fromSite = ok(site);
  return [...new Set(fromSite.length ? fromSite : ok(rows.filter((a) => a.site_id == null)))];
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
 * With `opts` (governance.skip_inactive_holders): inactive / site-less holders and deputies are skipped; a
 * holder skipped is still replaced by their eligible deputy; a rule that reaches nobody eligible falls to the
 * next matching rule (`fallback_from` names the rule skipped). `skipped` lists the accounts passed over.
 * @returns {{ matched, role, targets:number[], gap:boolean, why:string }}
 *   gap = a row matched but nobody holds the role — never an escalation into the void (ADR-006 risk).
 */
function escalationTarget({ matrix, assignments, deputies }, { register, severity, siteId, overdueDays, today }, opts) {
  const sev = String(severity || '*').toLowerCase(); const od = Math.max(0, Number(overdueDays) || 0);
  const rows = (matrix || []).filter((m) => !m.retired_at && m.register === register && (m.severity === '*' || String(m.severity).toLowerCase() === sev)
    && Number(m.after_days || 0) <= od && (m.site_id == null || (siteId != null && num(m.site_id) === Number(siteId))));
  if (!rows.length) return { matched: null, role: null, targets: [], gap: false, why: 'no escalation rule' };
  rows.sort((a, b) => (Number(b.site_id != null) - Number(a.site_id != null)) || (Number(b.after_days || 0) - Number(a.after_days || 0)) || (Number(b.severity !== '*') - Number(a.severity !== '*')));
  const shape = (m) => ({ id: Number(m.id), role: m.role, after_days: Number(m.after_days || 0), site_id: num(m.site_id) });
  if (!opts) {
    const m = rows[0];
    const who = holders(assignments, m.role, siteId, today);
    // a holder who is away is replaced by their deputy — the escalation still reaches a person
    const targets = [...new Set(who.flatMap((u) => { const deps = deputiesOf(deputies, u, today); return deps.length ? [u, ...deps] : [u]; }))];
    return { matched: shape(m), role: m.role, targets, gap: !targets.length, why: targets.length ? 'ok' : `nobody holds ${m.role}` };
  }
  const d = day(today); const skipped = new Set();
  for (const m of rows) {
    // every live holder (site rows, then platform rows) — an ineligible one is still covered by an eligible deputy
    const live_ = (assignments || []).filter((a) => a.role === m.role && live(a, d));
    const siteRows = siteId == null ? [] : live_.filter((a) => num(a.site_id) === Number(siteId));
    const tiers = [siteRows, live_.filter((a) => a.site_id == null)];
    let targets = [];
    for (const tier of tiers) {
      for (const a of tier) {
        const u = Number(a.user_id);
        const deps = deputiesOf(deputies, u, today).filter((x) => { const why = deputyIneligible(opts, x, u, siteId); if (why) skipped.add(x); return !why; });
        if (!holderIneligible(opts, u, a.site_id)) targets.push(u); else skipped.add(u);
        targets.push(...deps);
      }
      targets = [...new Set(targets)];
      if (targets.length) break;
    }
    if (targets.length) {
      const out = { matched: shape(m), role: m.role, targets, gap: false, why: 'ok', skipped: [...skipped] };
      if (m !== rows[0]) out.fallback_from = shape(rows[0]);
      return out;
    }
  }
  const m = rows[0];
  return { matched: shape(m), role: m.role, targets: [], gap: true, why: `nobody eligible holds ${m.role}`, skipped: [...skipped] };
}

/** (site × required role) pairs with no holder today, and matrix rows whose role nobody holds.
 *  With `opts`: holders are counted only when eligible, and every live holder / deputy whose account is inactive
 *  or no longer holds the site is listed (kind `inactive_holder` / `inactive_deputy`). */
function coverageGaps({ assignments, matrix, deputies }, sites, today, opts) {
  const out = [];
  for (const s of sites || []) for (const role of REQUIRED) if (!holders(assignments, role, s.id, today, opts).length) out.push({ kind: 'role', site_id: Number(s.id), site: s.name, role });
  for (const m of (matrix || []).filter((x) => !x.retired_at)) {
    const siteList = m.site_id == null ? (sites || []) : (sites || []).filter((s) => Number(s.id) === Number(m.site_id));
    for (const s of siteList) if (!holders(assignments, m.role, s.id, today, opts).length) out.push({ kind: 'matrix', matrix_id: Number(m.id), site_id: Number(s.id), site: s.name, role: m.role, register: m.register });
  }
  if (opts) {
    const d = day(today); const name = (id) => { const s = (sites || []).find((x) => Number(x.id) === Number(id)); return s ? s.name : null; };
    const liveA = (assignments || []).filter((a) => live(a, d));
    for (const a of liveA) {
      const why = holderIneligible(opts, a.user_id, a.site_id);
      if (why) out.push({ kind: 'inactive_holder', assignment_id: Number(a.id), site_id: num(a.site_id), site: name(a.site_id), role: a.role, user_id: Number(a.user_id), reason: why });
    }
    for (const x of (deputies || []).filter((y) => live(y, d))) {
      if (!liveA.some((a) => Number(a.user_id) === Number(x.user_id))) continue;   // only deputies of role holders carry coverage
      const why = deputyIneligible(opts, x.deputy_id, x.user_id, null);
      if (why) out.push({ kind: 'inactive_deputy', deputy_row_id: Number(x.id), site_id: null, site: null, role: null, user_id: Number(x.user_id), deputy_id: Number(x.deputy_id), reason: why });
    }
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

module.exports = { ROLES, REGISTERS, REQUIRED, DEPUTY_MAX_DAYS, CALENDAR_MAX_DAYS_PER_YEAR, holders, holderIneligible, deputyIneligible, principalsOf, deputiesOf, escalationTarget, coverageGaps, validateAssignment, validateDeputy, validateMatrix };
