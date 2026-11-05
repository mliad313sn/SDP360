'use strict';
// C-22 (G49 · PO decision R7) — emergency (break-glass) access rules. PURE: no database, no clock (now is passed in).
//
//   • granted by a super_admin who is NOT the beneficiary (nor a deputy of the beneficiary);
//   • a reason (10+ characters) is mandatory;
//   • at most MAX_HOURS = 24 h — a hard cap: the editable emergency_access_max_hours can only LOWER it;
//   • super_admin itself is never granted this way (it stays a direct decision of a super_admin);
//   • a post-review is due within REVIEW_WORKING_DAYS = 2 working days (Mon–Fri) after the grant, by a super_admin
//     other than the granter and the beneficiary; outcome `justified` | `not_justified` with notes;
//   • an emergency never waives a qualification prerequisite (C-19): it adds roles, never evidence.

const MAX_HOURS = 24;
const REVIEW_WORKING_DAYS = 2;
const OUTCOMES = Object.freeze(['justified', 'not_justified']);
const NEVER_GRANTED = Object.freeze(['super_admin']);
const err = (status, code, error) => ({ status, code, error });

/** Effective cap in hours: the policy value clamped to [1, 24]; unreadable → 24. */
function maxHours(policyValue) {
  const n = Number(policyValue);
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_HOURS) : MAX_HOURS;
}

/** The date `n` working days (Mon–Fri) after the UTC date of `iso`. */
function addWorkingDays(iso, n = REVIEW_WORKING_DAYS) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Validate a grant. Returns { error } or { value: { subject_user_id, roles, site_ids, reason, starts_at, expires_at, review_due } }.
 * @param {object} b     { subject_user_id, roles[], site_ids[], hours, reason }
 * @param {object} ctx   { granter: {id}, isSuper: bool, deputyIds: Set<number> (deputies of the beneficiary),
 *                         knownRoles: string[], now: ISO, maxHours: number }
 */
function validateGrant(b, ctx = {}) {
  b = b || {};
  if (!ctx.isSuper) return { error: err(403, 'FORBIDDEN', 'only a super_admin may grant emergency access') };
  const subject = Number(b.subject_user_id);
  if (!Number.isInteger(subject) || subject <= 0) return { error: err(400, 'VALIDATION', 'subject_user_id is required') };
  const me = ctx.granter && ctx.granter.id != null ? Number(ctx.granter.id) : null;
  if (me === subject) return { error: err(403, 'FORBIDDEN', 'nobody grants emergency access to themselves — another super_admin must do it') };
  if (ctx.deputyIds && ctx.deputyIds.has(me)) return { error: err(403, 'FORBIDDEN', 'a deputy of the beneficiary may not grant them emergency access') };
  const roles = [...new Set((Array.isArray(b.roles) ? b.roles : []).map((r) => String(r).trim()).filter(Boolean))].sort();
  const sites = [...new Set((Array.isArray(b.site_ids) ? b.site_ids : []).map(Number))].sort((x, y) => x - y);
  if (!roles.length && !sites.length) return { error: err(400, 'VALIDATION', 'an emergency grant needs at least one role or one site') };
  if (roles.some((r) => NEVER_GRANTED.includes(r))) return { error: err(400, 'VALIDATION', 'super_admin is never granted as emergency access') };
  const unknown = roles.filter((r) => !(ctx.knownRoles || []).includes(r));
  if (unknown.length) return { error: err(400, 'VALIDATION', `unknown role: ${unknown.join(', ')}`) };
  if (sites.some((s) => !Number.isInteger(s) || s <= 0)) return { error: err(400, 'VALIDATION', 'site_ids must be site ids') };
  const cap = maxHours(ctx.maxHours);
  const hours = Number(b.hours == null || b.hours === '' ? cap : b.hours);
  if (!Number.isFinite(hours) || hours <= 0) return { error: err(400, 'VALIDATION', 'hours must be a positive number') };
  if (hours > cap) return { error: err(400, 'VALIDATION', `emergency access lasts at most ${cap} h`) };
  const reason = String(b.reason || '').trim();
  if (reason.length < 10) return { error: err(400, 'VALIDATION', 'a reason (10+ characters) is required') };
  const now = String(ctx.now);
  const expires = new Date(Date.parse(now) + Math.round(hours * 3600e3)).toISOString();
  return { value: { subject_user_id: subject, roles, site_ids: sites, reason: reason.slice(0, 2000), starts_at: now, expires_at: expires, review_due: addWorkingDays(now) } };
}

/** May `actor` record the post-review of emergency `e`? null = yes. */
function reviewCheck(e, actor, { isSuper = false, outcome, notes } = {}) {
  if (!e) return err(404, 'NOT_FOUND', 'emergency access not found');
  if (e.reviewed_at) return err(409, 'CONFLICT', 'this emergency access has already been reviewed');
  if (!isSuper) return err(403, 'FORBIDDEN', 'only a super_admin reviews an emergency access');
  const me = actor && actor.id != null ? Number(actor.id) : null;
  if (me === Number(e.granted_by)) return err(403, 'FORBIDDEN', 'the person who granted the emergency access may not review it');
  if (me === Number(e.subject_user_id)) return err(403, 'FORBIDDEN', 'the beneficiary may not review their own emergency access');
  if (!OUTCOMES.includes(outcome)) return err(400, 'VALIDATION', 'outcome must be justified or not_justified');
  if (String(notes || '').trim().length < 10) return err(400, 'VALIDATION', 'review notes (10+ characters) are required');
  return null;
}

/** Review overdue: not reviewed and today (UTC) is after the due date. */
function isOverdue(e, now) {
  return !!e && !e.reviewed_at && String(now).slice(0, 10) > String(e.review_due);
}

/** Still in force: not ended and not past its hour. */
function isLive(e, now) {
  return !!e && !e.ended_at && Date.parse(e.expires_at) > Date.parse(now);
}

module.exports = { MAX_HOURS, REVIEW_WORKING_DAYS, OUTCOMES, NEVER_GRANTED, maxHours, addWorkingDays, validateGrant, reviewCheck, isOverdue, isLive };
