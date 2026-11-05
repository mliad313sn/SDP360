'use strict';
// C-18 (G40 / A09) — the access request state machine. PURE: no database, no clock (today is passed in).
//
//   REQUESTED ──review──▶ REVIEWING ──approve──▶ APPROVED ──activate──▶ ACTIVE ──expire──▶ EXPIRED
//        │                    │                      │                     └──revoke──▶ REVOKED
//        └────reject / approve┴──reject──▶ REJECTED  └──revoke──▶ REVOKED (also withdraw before a decision)
//
// Separation of duties (same spirit as ADR-006 / governancePolicy proposals):
//   • the approver follows the R7 policy (C-19, services/accessApproverPolicy.js — platform roles: a super_admin;
//     site-scoped roles: an admin-tier user holding the site);
//   • the approver is neither the subject nor the requester;
//   • the approver is not a deputy of the subject or of the requester (a stand-in acts in their name);
//   • the approval is bound to subject × roles × sites × dates (`scopeKey`) — never to a template as a whole:
//     a template change cannot widen what was approved, and a request cannot be edited after filing.

const STATES = Object.freeze(['REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'REVOKED']);
const TRANSITIONS = Object.freeze({
  review: { from: ['REQUESTED'], to: 'REVIEWING' },
  approve: { from: ['REQUESTED', 'REVIEWING'], to: 'APPROVED' },
  reject: { from: ['REQUESTED', 'REVIEWING'], to: 'REJECTED' },
  activate: { from: ['APPROVED'], to: 'ACTIVE' },
  expire: { from: ['APPROVED', 'ACTIVE'], to: 'EXPIRED' },
  revoke: { from: ['REQUESTED', 'REVIEWING', 'APPROVED', 'ACTIVE'], to: 'REVOKED' },
});
const OPEN = Object.freeze(['REQUESTED', 'REVIEWING', 'APPROVED', 'ACTIVE']);
const MAX_DAYS = 366;                 // longest validity a single request may carry (PROPOSED, not a policy)
const FORBIDDEN_ROLES = Object.freeze(['super_admin']);   // break-glass stays a direct human act, never a request

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const err = (status, code, error) => ({ status, code, error });
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const validDate = (s) => ISO.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/** Canonical text of what an approval covers. Same input → same key, whatever the order. */
function scopeKey(r) {
  return JSON.stringify({
    subject: Number(r.subject_user_id),
    roles: [...new Set((r.roles || []).map(String))].sort(),
    sites: [...new Set((r.site_ids || []).map(Number))].sort((a, b) => a - b),
    from: String(r.valid_from), to: String(r.valid_to),
  });
}

/**
 * Validate and normalise a new request. Returns { error } or { value }.
 * @param {object} b       body: subject_user_id, roles[], site_ids[], valid_from, valid_to, justification
 * @param {object} o       { knownRoles: string[], today: 'YYYY-MM-DD', template: {roles[], site_rule, max_days}|null }
 */
function validateRequest(b, { knownRoles = [], today, template = null } = {}) {
  b = b || {};
  const subject = Number(b.subject_user_id);
  if (!Number.isInteger(subject) || subject <= 0) return { error: err(400, 'VALIDATION', 'subject_user_id is required') };
  let roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map((r) => String(r).trim()).filter(Boolean))];
  if (template) {
    const tRoles = (template.roles || []).map(String);
    if (!roles.length) roles = tRoles.slice();
    const outside = roles.filter((r) => !tRoles.includes(r));
    if (outside.length) return { error: err(400, 'VALIDATION', `roles not in the template: ${outside.join(', ')}`) };
  }
  if (!roles.length) return { error: err(400, 'VALIDATION', 'at least one role is required') };
  const bad = roles.filter((r) => FORBIDDEN_ROLES.includes(r));
  if (bad.length) return { error: err(400, 'VALIDATION', 'super_admin cannot be requested — it stays a direct decision of a super_admin') };
  const unknown = roles.filter((r) => !knownRoles.includes(r));
  if (unknown.length) return { error: err(400, 'VALIDATION', `unknown role: ${unknown.join(', ')}`) };
  const sites = [...new Set((Array.isArray(b.site_ids) ? b.site_ids : []).map(Number))];
  if (sites.some((s) => !Number.isInteger(s) || s <= 0)) return { error: err(400, 'VALIDATION', 'site_ids must be site ids') };
  if (template && template.site_rule === 'listed' && !sites.length) return { error: err(400, 'VALIDATION', 'this template needs at least one site') };
  const from = String(b.valid_from || today || ''), to = String(b.valid_to || '');
  if (!validDate(from) || !validDate(to)) return { error: err(400, 'VALIDATION', 'valid_from and valid_to must be YYYY-MM-DD') };
  if (to < from) return { error: err(400, 'VALIDATION', 'valid_to is before valid_from') };
  if (today && to < today) return { error: err(400, 'VALIDATION', 'valid_to is in the past') };
  const max = template && Number(template.max_days) > 0 ? Math.min(Number(template.max_days), MAX_DAYS) : MAX_DAYS;
  if (days(from, to) + 1 > max) return { error: err(400, 'VALIDATION', `validity longer than ${max} days`) };
  const justification = String(b.justification || '').trim();
  if (justification.length < 10) return { error: err(400, 'VALIDATION', 'a justification (10+ characters) is required') };
  return { value: { kind: 'grant', subject_user_id: subject, roles: roles.sort(), site_ids: sites.sort((x, y) => x - y), valid_from: from, valid_to: to, justification: justification.slice(0, 2000) } };
}

/** Validate a template version payload. Returns { error } or { value }. */
function validateTemplatePayload(p, { knownRoles = [] } = {}) {
  p = p || {};
  const roles = [...new Set((Array.isArray(p.roles) ? p.roles : []).map((r) => String(r).trim()).filter(Boolean))].sort();
  if (!roles.length) return { error: err(400, 'VALIDATION', 'a template needs at least one role') };
  if (roles.some((r) => FORBIDDEN_ROLES.includes(r))) return { error: err(400, 'VALIDATION', 'super_admin cannot be part of a template') };
  const unknown = roles.filter((r) => !knownRoles.includes(r));
  if (unknown.length) return { error: err(400, 'VALIDATION', `unknown role: ${unknown.join(', ')}`) };
  const site_rule = p.site_rule === 'listed' ? 'listed' : 'primary';
  const md = Number(p.max_days);
  const max_days = Number.isInteger(md) && md > 0 ? Math.min(md, MAX_DAYS) : 180;
  return { value: { roles, site_rule, max_days } };
}

/**
 * May `actor` take `action` on request `r`? null = yes, else { status, code, error }.
 * @param {object} ctx { isApprover: bool (R7 approver rule, see accessApproverPolicy), approverError, canRevoke, deputyIds: Set<number> (active deputies of subject and
 *                      requester), today, scopeOk: bool (activation only) }
 */
function check(r, action, actor, ctx = {}) {
  const t = TRANSITIONS[action];
  if (!t) return err(400, 'VALIDATION', 'unknown action');
  if (!r) return err(404, 'NOT_FOUND', 'request not found');
  if (!t.from.includes(r.status)) return err(409, 'CONFLICT', `a ${r.status} request cannot be ${action === 'approve' ? 'approved' : action + 'ed'}`);
  const me = actor && actor.id != null ? Number(actor.id) : null;
  const deps = ctx.deputyIds || new Set();
  if (action === 'review' || action === 'approve' || action === 'reject') {
    // C-19: separation of duties from the one registry (services/sodPolicy.js, R8), then the approver rule (R7,
    // services/accessApproverPolicy.js — computed by the caller into ctx.isApprover / ctx.approverError).
    const sod = require('./sodPolicy').evaluate('access.decide', { actorId: me, subjectId: r.subject_user_id, requesterId: r.requested_by, deputyIds: deps });
    if (sod.refuse) return err(403, 'FORBIDDEN', sod.refuse.error);
    if (!ctx.isApprover) return ctx.approverError || err(403, 'FORBIDDEN', 'you may not decide this access request (approver rule)');
  }
  if (action === 'revoke') {
    const undecided = r.status === 'REQUESTED' || r.status === 'REVIEWING';
    const withdraw = undecided && me != null && (me === Number(r.requested_by) || me === Number(r.subject_user_id));
    const canRevoke = ctx.canRevoke !== undefined ? ctx.canRevoke : ctx.isApprover;
    if (!withdraw && !canRevoke) return err(403, 'FORBIDDEN', 'only a super_admin may revoke an access');
  }
  if (action === 'activate') {
    if (ctx.today && r.valid_from > ctx.today) return err(409, 'CONFLICT', 'not yet valid');
    if (ctx.scopeOk === false || (r.approved_scope && r.approved_scope !== scopeKey(r))) return err(409, 'CONFLICT', 'the request no longer matches what was approved');
  }
  return null;
}

/** Is a grant live on `today`? */
function grantLive(g, today) {
  return !g.ended_at && String(g.valid_from) <= today && String(g.valid_to) >= today;
}

/**
 * What to take away from a user when some grants end. A role (site) is removed only when no other grant still
 * holds it and no grant recorded it as already held before (a direct, "legacy" source).
 * @param {object[]} ending  grant rows being ended now
 * @param {object[]} others  every OTHER grant row of the same user (any state)
 * @returns {{ roles: string[], sites: number[] }}
 */
function planRemoval(ending, others, today) {
  const keepRole = (role) => others.some((g) => g.role === role && (g.held_before || grantLive(g, today)))
    || ending.some((g) => g.role === role && g.held_before);
  const keepSite = (s) => others.some((g) => Number(g.site_id) === s && (g.held_before || grantLive(g, today)))
    || ending.some((g) => Number(g.site_id) === s && g.held_before);
  const roles = [...new Set(ending.filter((g) => g.role).map((g) => g.role))].filter((r) => !keepRole(r)).sort();
  const sites = [...new Set(ending.filter((g) => g.site_id != null).map((g) => Number(g.site_id)))].filter((s) => !keepSite(s)).sort((a, b) => a - b);
  return { roles, sites };
}

/**
 * Roles (among `roles`) that open a capability marked `requires_request` in the C-17 catalogue — through the
 * hierarchy too (executive ⇒ admin ⇒ finance.read). `hasRole(user, role)` is reports-db.userHasRole.
 */
function rolesRequiringRequest(roles, hasRole) {
  const caps = require('./capabilityRegistry').list().filter((c) => c.requires_request);
  return [...new Set(roles || [])].filter((r) => caps.some((c) => c.legacy.some((l) => hasRole({ roles: [r] }, l)))).sort();
}

module.exports = { rolesRequiringRequest, STATES, TRANSITIONS, OPEN, MAX_DAYS, FORBIDDEN_ROLES, scopeKey, validateRequest, validateTemplatePayload, check, grantLive, planRemoval };
