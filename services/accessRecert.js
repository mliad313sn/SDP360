'use strict';
// E-S03 (audit S-05) — access recertification, PURE core (no I/O). The store (services/accessStore.js) and the
// routes (routes/access.js) feed it rows; nothing here reads a database or a clock of its own.
//
//   buildLines(users, { scopeSiteId })              account × role ('role') and account × site ('site') lines
//   resolveApprover(line, users, ctx)               R7 approver (services/accessApproverPolicy.js), never the subject
//   validateAnswer({answer, reason})                keep | revoke | unknown, reason ≥ 5 characters
//   canAnswer(line, actor, ctx)                     not the subject, and the R7 rule admits the actor
//   applyPlan(user, line)                           what a revoke answer changes (role removed / site removed)
//   orphans(users, ctx)                             accounts worth a look; a NULL last login is UNKNOWN, never "old"
//   progress(lines)                                 counts for the campaign card
const AP = require('./accessApproverPolicy');

const ANSWERS = Object.freeze(['keep', 'revoke', 'unknown']);
const isActive = (u) => !(u && (u.active === 0 || u.active === false || u.active === '0'));
const siteIdsOf = (u) => [u && u.site_id, ...((u && u.extra_site_ids) || [])].filter((x) => x != null).map(Number)
  .filter((x, i, a) => a.indexOf(x) === i);

/** Lines of a campaign: every ACTIVE account in scope × each role, and × each in-scope site. */
function buildLines(users, { scopeSiteId = null } = {}) {
  const scope = scopeSiteId == null || scopeSiteId === '' ? null : Number(scopeSiteId);
  const out = [];
  for (const u of users || []) {
    if (!isActive(u)) continue;
    const sites = siteIdsOf(u);
    if (scope != null && !sites.includes(scope)) continue;
    for (const role of [...new Set(u.roles || [])].sort()) out.push({ kind: 'role', user_id: Number(u.id), role, site_id: scope });
    for (const s of sites) if (scope == null || s === scope) out.push({ kind: 'site', user_id: Number(u.id), role: null, site_id: s });
  }
  return out;
}

/** The pseudo access request the R7 rule is evaluated on for one line. */
function _asRequest(line) {
  return { roles: line.kind === 'role' ? [line.role] : [], site_ids: line.site_id == null ? [] : [Number(line.site_id)] };
}

/** May `actor` answer `line`? null = yes, else an error string. */
function canAnswer(line, actor, { users = [], policy = AP.DEFAULT_POLICY, hasRole } = {}) {
  if (!actor || actor.id == null) return 'no session';
  if (Number(actor.id) === Number(line.user_id)) return 'the account under review cannot answer its own line';
  const subj = (users || []).find((u) => Number(u.id) === Number(line.user_id));
  const e = AP.approverCheck(_asRequest(line), actor, { policy, hasRole, actorSiteIds: siteIdsOf(actor), subjectSiteIds: subj ? siteIdsOf(subj) : [] });
  return e ? e.error : null;
}

/**
 * The approver a line is assigned to: an active account other than the subject that the R7 rule admits.
 * A site-tier approver (not super_admin) is preferred for site-scoped lines; ties → lowest id. None → null
 * (UNKNOWN: shown as "no eligible approver"; a super_admin can still answer).
 */
function resolveApprover(line, users, { policy = AP.DEFAULT_POLICY, hasRole } = {}) {
  const p = AP.parsePolicy(policy);
  const cands = (users || []).filter((u) => isActive(u) && Number(u.id) !== Number(line.user_id))
    .filter((u) => !canAnswer(line, u, { users, policy: p, hasRole }))
    .sort((a, b) => {
      const sa = hasRole(a, p.platform_approver_role) ? 1 : 0, sb = hasRole(b, p.platform_approver_role) ? 1 : 0;
      return sa - sb || Number(a.id) - Number(b.id);
    });
  return cands.length ? Number(cands[0].id) : null;
}

function validateAnswer(b) {
  const answer = String((b && b.answer) || '').trim().toLowerCase();
  if (!ANSWERS.includes(answer)) return { error: 'answer must be keep, revoke or unknown' };
  const reason = String((b && b.reason) || '').trim();
  if (reason.length < 5) return { error: 'a reason (5+ characters) is required' };
  return { value: { answer, reason: reason.slice(0, 2000) } };
}

/**
 * What applying a revoke answer would write through rdb.updateUser. null = nothing to change
 * (the role / site is already gone). Never leaves an account with no role at all (→ viewer).
 */
function applyPlan(user, line) {
  if (!user) return null;
  let roles = [...(user.roles || [])];
  let extras = (user.extra_site_ids || []).map(Number);
  let primary = user.site_id == null ? null : Number(user.site_id);
  if (line.kind === 'role') {
    if (!roles.includes(line.role)) return null;
    roles = roles.filter((r) => r !== line.role);
    if (!roles.length) roles = ['viewer'];
  } else {
    const s = Number(line.site_id);
    if (primary !== s && !extras.includes(s)) return null;
    extras = extras.filter((x) => x !== s);
    if (primary === s) primary = extras.length ? extras.shift() : null;
  }
  return { full_name: user.full_name, site_id: primary, active: user.active, roles, extra_site_ids: extras.filter((x) => x !== primary) };
}

const DAY = 864e5;
/**
 * Orphan list. ctx: { lastLoginById: Map<id, ISO|null>, sites: [{id, name, active}], templateRoles: Set|null,
 * today: 'YYYY-MM-DD', days: N, hasRole }. templateRoles null = no published template → that check is UNKNOWN.
 */
function orphans(users, { lastLoginById = new Map(), sites = [], templateRoles = null, today, days, hasRole } = {}) {
  const n = Number.parseInt(days, 10);
  const nDays = Number.isFinite(n) && n > 0 ? n : null;
  const t = Date.parse(String(today || '').slice(0, 10) + 'T00:00:00Z');
  const siteById = new Map((sites || []).map((s) => [Number(s.id), s]));
  const rows = [], unknown = [];
  for (const u of users || []) {
    if (!isActive(u)) continue;
    const reasons = [];
    const ll = lastLoginById.get(Number(u.id));
    const last = ll == null ? null : String(ll instanceof Date ? ll.toISOString() : ll);
    let idle = null;
    if (last == null) unknown.push({ user_id: Number(u.id), username: u.username });
    else if (Number.isFinite(t) && Number.isFinite(Date.parse(last))) idle = Math.floor((t - Date.parse(last)) / DAY);
    if (nDays != null && idle != null && idle > nDays) reasons.push({ code: 'no_login', detail: `${idle} days since the last sign-in (threshold ${nDays})` });
    const sitesHeld = siteIdsOf(u);
    if ((u.roles || []).includes('editor') && !hasRole(u, 'admin') && !sitesHeld.length) reasons.push({ code: 'editor_without_site', detail: 'editor with no site — can write nothing' });
    for (const s of sitesHeld) {
      const row = siteById.get(s);
      if (row && (row.active === 0 || row.active === false || row.active === '0')) reasons.push({ code: 'inactive_site', detail: `holds inactive site ${row.name || s}` });
    }
    if (templateRoles) {
      const loose = (u.roles || []).filter((r) => !templateRoles.has(r));
      if (loose.length) reasons.push({ code: 'role_without_template', detail: `role(s) no published template grants: ${loose.join(', ')}` });
    }
    if (reasons.length) rows.push({ user_id: Number(u.id), username: u.username, last_login: last, idle_days: idle, last_login_known: last != null, reasons });
  }
  // last_login_unknown: no sign-in evidence at all — listed as UNKNOWN, never counted as an idle account.
  return { rows, last_login_unknown: unknown, templates_known: !!templateRoles, threshold_days: nDays };
}

function progress(lines) {
  const p = { total: 0, answered: 0, pending: 0, keep: 0, revoke: 0, unknown: 0, applied: 0, no_approver: 0 };
  for (const l of lines || []) {
    p.total++;
    if (l.answer) { p.answered++; p[l.answer]++; } else p.pending++;
    if (l.applied_at) p.applied++;
    if (l.approver_user_id == null) p.no_approver++;
  }
  return p;
}

module.exports = { ANSWERS, siteIdsOf, buildLines, resolveApprover, canAnswer, validateAnswer, applyPlan, orphans, progress };
