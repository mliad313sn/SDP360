'use strict';
// 2027 Goal 02 — canonical business commitment: PURE state machine.
//
// One commitment = one thing the business is owed (a need, a finding, a weakness, a risk, an
// issue, a corrective action, an improvement, a decision). Its lifecycle is explicit and the
// transition table below is the ONLY place a status may change. Rules enforced here:
//   • technical completion (→ awaiting_verification) is NOT closure; only an independent
//     reviewer reaches verified_closed.
//   • the verifier is never the accountable owner, never an execution owner and never the
//     creator — a super_admin included (no self-verification).
//   • a high / critical commitment cannot leave `captured` (nor become `committed`) without an
//     accountable owner, a due date (or an approved exception) and a treatment plan.
//   • a source system's "closed" status never produces verified_closed (sourceStatusSuggestion).
// No DB, no clock: the caller passes the commitment, the target, the actor and the reason.

const KINDS = ['business_need', 'inspection_finding', 'control_weakness', 'operational_risk', 'issue', 'corrective_action', 'improvement', 'decision'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['captured', 'triaged', 'committed', 'in_progress', 'awaiting_verification', 'verified_closed',
  'blocked', 'deferred', 'cancelled_with_reason', 'rejected_for_rework', 'reopened', 'accepted_risk_exception'];
const TERMINAL = ['verified_closed', 'cancelled_with_reason', 'accepted_risk_exception'];
const SOURCE_SYSTEMS = ['meetings', 'inspection', 'report', 'governance', 'sdp_ticket', 'sdp_change', 'portfolio'];

// who may fire a transition: 'editor' = editor of the commitment's site (or admin tier),
// 'review' = the designated reviewer (or admin tier) and never owner/executor/creator,
// 'admin' = admin tier only.
const T = (to, who, o = {}) => ({ to, who, reason: !!o.reason });
const TRANSITIONS = {
  captured: [T('triaged', 'editor'), T('committed', 'editor'), T('cancelled_with_reason', 'editor', { reason: true })],
  triaged: [T('committed', 'editor'), T('deferred', 'editor', { reason: true }), T('cancelled_with_reason', 'editor', { reason: true })],
  committed: [T('in_progress', 'editor'), T('blocked', 'editor', { reason: true }), T('deferred', 'editor', { reason: true }), T('cancelled_with_reason', 'editor', { reason: true })],
  in_progress: [T('awaiting_verification', 'editor'), T('blocked', 'editor', { reason: true }), T('deferred', 'editor', { reason: true }), T('cancelled_with_reason', 'editor', { reason: true })],
  blocked: [T('in_progress', 'editor'), T('committed', 'editor'), T('cancelled_with_reason', 'editor', { reason: true })],
  deferred: [T('triaged', 'editor'), T('committed', 'editor'), T('cancelled_with_reason', 'editor', { reason: true })],
  awaiting_verification: [T('verified_closed', 'review'), T('rejected_for_rework', 'review', { reason: true }), T('accepted_risk_exception', 'review', { reason: true })],
  rejected_for_rework: [T('in_progress', 'editor'), T('awaiting_verification', 'editor')],
  reopened: [T('triaged', 'editor'), T('committed', 'editor'), T('in_progress', 'editor')],
  verified_closed: [T('reopened', 'review', { reason: true })],
  accepted_risk_exception: [T('reopened', 'review', { reason: true })],
  cancelled_with_reason: [T('reopened', 'admin', { reason: true })],
};
const VERIFY_DECISION = { verified_closed: 'accepted', rejected_for_rework: 'rejected_for_rework', accepted_risk_exception: 'residual_risk_accepted' };

const _s = (v) => String(v == null ? '' : v).trim().toLowerCase();
function _execs(c) { const e = c && c.execution_owners; return (Array.isArray(e) ? e : []).map(_s).filter(Boolean); }
/** Identities an actor answers to (username, full name, e-mail, id) — matched case-insensitively. */
function _ids(actor) { return [actor && actor.username, actor && actor.full_name, actor && actor.email, actor && actor.id != null ? String(actor.id) : null].map(_s).filter(Boolean); }
const _is = (actor, who) => { const w = _s(who); return !!w && _ids(actor).includes(w); };

/** Is the actor one of the people doing / owning / having created the work? */
function isSelf(c, actor) {
  if (!c || !actor) return false;
  return _is(actor, c.accountable_owner) || _execs(c).some((e) => _is(actor, e)) || _is(actor, c.created_by);
}
// A grant (who may VERIFY) matches only a unique identity — username or e-mail — never a full name
// (namesakes are common) nor a bare numeric id typed into the field (committee security P1-3).
// Refusals (isSelf) keep the broad match: more matches there only means more caution.
function _grantIds(actor) { return [actor && actor.username, actor && actor.email].map(_s).filter(Boolean); }
const isReviewer = (c, actor) => { const w = _s(c && c.reviewer); return !!w && _grantIds(actor).includes(w); };

/** Severity rule (high / critical): owner + (due date OR approved exception) + treatment plan. Returns missing fields. */
function severityGaps(c) {
  if (!c || !['high', 'critical'].includes(_s(c.severity))) return [];
  const gaps = [];
  if (!_s(c.accountable_owner)) gaps.push('accountable_owner');
  if (!_s(c.due_date) && !_s(c.exception_approved_by)) gaps.push('due_date');
  if (!_s(c.treatment_plan)) gaps.push('treatment_plan');
  return gaps;
}

/**
 * @param {object} c       the commitment row (status, severity, owners, reviewer, created_by…)
 * @param {string} to      target status
 * @param {object} actor   { id, username, full_name, email, isAdmin, canEdit }  — canEdit = editor of the commitment's site
 * @param {object} [o]     { reason }
 * @returns {{ok:true, rule}|{ok:false, code, status, reason}}
 */
function checkTransition(c, to, actor, o = {}) {
  const no = (code, status, reason) => ({ ok: false, code, status, reason });
  if (!c || !STATUSES.includes(c.status)) return no('INVALID', 400, 'unknown current status');
  if (!STATUSES.includes(to)) return no('INVALID', 400, `unknown target status "${to}"`);
  const rule = (TRANSITIONS[c.status] || []).find((t) => t.to === to);
  if (!rule) return no('INVALID', 400, `transition ${c.status} → ${to} is not allowed`);
  if (!actor) return no('FORBIDDEN', 403, 'no actor');
  if (rule.who === 'admin' && !actor.isAdmin) return no('FORBIDDEN', 403, 'only the admin tier may do this');
  if (rule.who === 'editor' && !(actor.isAdmin || actor.canEdit)) return no('FORBIDDEN', 403, 'editor of this site required');
  if (rule.who === 'review') {
    if (isSelf(c, actor)) return no('FORBIDDEN', 403, 'the owner, an executor or the creator cannot verify their own commitment');
    if (!(isReviewer(c, actor) || actor.isAdmin)) return no('FORBIDDEN', 403, 'only the designated reviewer (or the admin tier) may verify');
  }
  if (rule.reason && !_s(o.reason)) return no('VALIDATION', 400, `a reason is required for ${to}`);
  if ((c.status === 'captured' && to !== 'cancelled_with_reason') || to === 'committed') {
    const gaps = severityGaps(c);
    if (gaps.length) return no('VALIDATION', 400, `a ${_s(c.severity)} commitment needs ${gaps.join(', ')} before ${to}`);
  }
  return { ok: true, rule };
}

/** Transitions the actor may fire now (for the UI buttons). */
function allowedTransitions(c, actor) {
  return (TRANSITIONS[c && c.status] || []).filter((t) => {
    const r = checkTransition(c, t.to, actor, { reason: 'x' });
    return r.ok;
  }).map((t) => ({ to: t.to, reason: t.reason }));
}

/** A source system's status may SUGGEST technical completion — never verification. */
function sourceStatusSuggestion(sourceStatus) {
  const s = _s(sourceStatus);
  if (['closed', 'resolved', 'done', 'completed', 'successful', 'success'].includes(s)) return 'awaiting_verification';
  return null;
}

const isVerified = (status) => status === 'verified_closed';

module.exports = { KINDS, SEVERITIES, PRIORITIES, STATUSES, TERMINAL, SOURCE_SYSTEMS, TRANSITIONS, VERIFY_DECISION,
  checkTransition, allowedTransitions, severityGaps, isSelf, isReviewer, sourceStatusSuggestion, isVerified };
