'use strict';
// G-22 — PURE state machine of an interdepartmental business handoff (committee review 2026-10-28):
//   request → accepted | rejected → blocked | escalated → delivered → verified
// One department (the requester) hands a piece of work to a NAMED receiver of another department.
// Rules enforced here (no DB, no clock):
//   • nothing is accepted automatically: only the named receiver accepts (and the requester cannot be the receiver);
//   • a rejection, a blocker, an escalation, a cancellation and a rework request each need a reason;
//   • the work is verified by the requesting side, never by the person who delivered it (an admin included);
//   • reassigning the receiver sends the handoff back to `requested`: the new receiver accepts it themselves;
//   • an overdue handoff is escalated once (escalated_from remembers where it was); verified / cancelled are final.
// "Receiver" / "requester" are people, not departments: the user directory has no department attribute,
// so the department fields are labels validated against the department list, and the named people carry the duty.

const STATUSES = ['requested', 'accepted', 'rejected', 'blocked', 'escalated', 'delivered', 'verified', 'cancelled'];
const TERMINAL = ['verified', 'cancelled'];
const OPEN = ['requested', 'accepted', 'blocked', 'escalated'];   // what an overdue escalation can hit

// who: 'receiver' · 'requester' · 'admin' — the admin tier may also act for either side except where noted.
const T = (to, who, reason = false) => ({ to, who, reason });
const TRANSITIONS = {
  requested: [T('accepted', 'receiver'), T('rejected', 'receiver', true), T('cancelled', 'requester', true)],
  accepted: [T('blocked', 'receiver', true), T('delivered', 'receiver'), T('cancelled', 'requester', true)],
  blocked: [T('accepted', 'receiver'), T('escalated', 'requester', true), T('cancelled', 'requester', true)],
  escalated: [T('accepted', 'receiver'), T('rejected', 'admin', true), T('cancelled', 'requester', true)],
  rejected: [T('requested', 'requester'), T('cancelled', 'requester', true)],
  delivered: [T('verified', 'requester'), T('accepted', 'requester', true)],   // accepted here = rework
  verified: [],
  cancelled: [],
};

// Policies (services/governancePolicy.js): reason length, overdue escalation switch and grace.
const _pol = (pol) => ({ ...require('./governancePolicy').DEFAULTS, ...(pol || {}) });
const _rmin = (pol) => Number(_pol(pol)['handoffs.reason_min']) || 5;
const isRequester = (h, a) => a && a.id != null && Number(h.requested_by) === Number(a.id);
const isReceiver = (h, a) => a && a.id != null && Number(h.receiver_id) === Number(a.id);
// ADR-006 — a deputy named for the absent person (table deputies, resolved by the route for today)
// acts IN THEIR NAME: actor.deputyFor = the ids they stand in for. The event records acting_for.
const standsInFor = (a, id) => !!a && Array.isArray(a.deputyFor) && a.deputyFor.map(Number).includes(Number(id));
const actsAsRequester = (h, a) => isRequester(h, a) || standsInFor(a, h.requested_by);
const actsAsReceiver = (h, a) => isReceiver(h, a) || standsInFor(a, h.receiver_id);
/** 'deputy_for:<id>' when the actor acts only as a deputy for this side; null otherwise. */
function actingFor(h, a, side) {
  if (side === 'receiver' && !isReceiver(h, a) && standsInFor(a, h.receiver_id)) return `deputy_for:${Number(h.receiver_id)}`;
  if (side === 'requester' && !isRequester(h, a) && standsInFor(a, h.requested_by)) return `deputy_for:${Number(h.requested_by)}`;
  return null;
}
/**
 * Account-less receiver (committee #34): naming a contact who has no account is allowed only under the
 * site policy handoffs.proxy_accept; the receiver ACCOUNT then records each step on the contact's behalf
 * and must write a note every time (who said what, when).
 */
function contactCheck(contact, pol) {
  if (contact == null || String(contact).trim() === '') return null;
  if (_pol(pol)['handoffs.proxy_accept'] !== true) return { status: 403, code: 'FORBIDDEN', error: 'naming a receiver without an account is not allowed on this site (policy handoffs.proxy_accept)' };
  if (String(contact).trim().length < 3) return { status: 400, code: 'VALIDATION', error: 'name the person who receives the work (3+ characters)' };
  return null;
}

/**
 * @param {object} h      handoff row
 * @param {string} to     target status
 * @param {object} actor  { id, isAdmin, active, hasSite }  — hasSite = the handoff's site is one of the actor's sites (live check)
 * @param {object} [o]    { reason }
 * @returns {null | {status, code, error}}
 */
function check(h, to, actor, o = {}) {
  const no = (status, code, error) => ({ status, code, error });
  if (!h || !STATUSES.includes(h.status)) return no(400, 'INVALID', 'unknown current status');
  if (!actor || actor.id == null) return no(401, 'NO_USER', 'no user');
  if (actor.active === false) return no(403, 'FORBIDDEN', 'inactive account');
  const rule = (TRANSITIONS[h.status] || []).find((t) => t.to === to);
  if (!rule) return no(409, 'BAD_STAGE', `a ${h.status} handoff cannot become ${to}`);
  // permission downgrade: a person who lost the site (or was deactivated) can no longer act on it
  if (!actor.isAdmin && !actor.hasSite) return no(403, 'FORBIDDEN', 'this handoff belongs to a site you no longer have');
  if (rule.who === 'receiver' && !actsAsReceiver(h, actor)) return no(403, 'FORBIDDEN', 'only the named receiver (or their named deputy) can do this — nothing is accepted on their behalf');
  if (rule.who === 'requester' && !(actsAsRequester(h, actor) || actor.isAdmin)) return no(403, 'FORBIDDEN', 'only the requester (or the admin tier) can do this');
  if (rule.who === 'admin' && !actor.isAdmin) return no(403, 'FORBIDDEN', 'only the admin tier can do this');
  if (to === 'verified' && h.delivered_by != null && Number(h.delivered_by) === Number(actor.id)) return no(403, 'SOD', 'the person who delivered the work cannot verify it');
  // a deputy never satisfies four-eyes against the person they replace (ADR-006): no verifying the work of
  // someone you stand in for
  if (to === 'verified' && h.delivered_by != null && standsInFor(actor, h.delivered_by)) return no(403, 'SOD', 'you stand in for the person who delivered the work — you cannot verify it');
  // verification belongs to the requesting side: the admin tier does not verify for the requester (audit P2-10)
  if (to === 'verified' && !actsAsRequester(h, actor)) return no(403, 'FORBIDDEN', 'only the requester verifies the delivered work');
  const rmin = _rmin(o.policy);
  if (rule.reason && String(o.reason || '').trim().length < rmin) return no(400, 'VALIDATION', `a reason (${rmin}+ characters) is required for ${to}`);
  // on behalf of an account-less contact: every receiver step carries a note
  if (rule.who === 'receiver' && h.receiver_contact && String(o.reason || '').trim().length < rmin) return no(400, 'VALIDATION', `a note (${rmin}+ characters) is required: you record this on behalf of ${String(h.receiver_contact).slice(0, 80)}`);
  return null;
}

/** Reassignment: requester or admin, while not delivered / terminal; the new receiver differs from the requester. */
function checkReassign(h, actor, newReceiverId, o = {}) {
  const no = (status, code, error) => ({ status, code, error });
  if (!actor || actor.id == null) return no(401, 'NO_USER', 'no user');
  if (!(actsAsRequester(h, actor) || actor.isAdmin)) return no(403, 'FORBIDDEN', 'only the requester (or the admin tier) can reassign');
  if (!actor.isAdmin && !actor.hasSite) return no(403, 'FORBIDDEN', 'this handoff belongs to a site you no longer have');
  if (!OPEN.includes(h.status)) return no(409, 'BAD_STAGE', `a ${h.status} handoff cannot be reassigned`);
  if (newReceiverId == null) return no(400, 'VALIDATION', 'receiver is required');
  if (Number(newReceiverId) === Number(h.requested_by)) return no(400, 'VALIDATION', 'the requester cannot be the receiver');
  if (Number(newReceiverId) === Number(h.receiver_id)) return no(400, 'VALIDATION', 'already the receiver');
  const rmin = _rmin(o.policy);
  if (String(o.reason || '').trim().length < rmin) return no(400, 'VALIDATION', `a reason (${rmin}+ characters) is required to reassign`);
  return null;
}

/** Overdue handoffs to escalate now (due date strictly before `today`, open, not already escalated). */
function overdue(rows, today, pol) {
  const P = _pol(pol);
  if (P['handoffs.overdue_escalation'] === false) return [];
  const grace = Math.max(0, Number(P['handoffs.escalation_grace_days']) || 0);
  const t = Date.parse(String(today || '').slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return [];
  const d = new Date(t - grace * 864e5).toISOString().slice(0, 10);   // escalate when due_date < today − grace
  return (rows || []).filter((h) => OPEN.includes(h.status) && h.status !== 'escalated' && h.due_date && String(h.due_date).slice(0, 10) < d);
}

function allowed(h, actor) {
  return (TRANSITIONS[h && h.status] || []).filter((t) => !check(h, t.to, actor, { reason: 'x'.repeat(500) })).map((t) => ({ to: t.to, reason: t.reason }));
}

module.exports = { STATUSES, TERMINAL, OPEN, TRANSITIONS, check, checkReassign, overdue, allowed, isRequester, isReceiver, actsAsRequester, actsAsReceiver, actingFor, contactCheck };
