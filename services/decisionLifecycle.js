'use strict';
// F-PRODUCT-06 (committee 12 Nov 2026, finding N6 / E08) — decision register (DEC-YYYY-NNN): PURE transition table.
//
// Until now a decision's status moved any → any, with no reason and no history, and a site could mark a committee
// decision `done`. This module is the only place the PROPOSED rule lives (switch `decision_lifecycle_enforced`,
// default '0' = today's free status). No DB, no clock: the caller passes the current status, the target, the actor
// class and the reason.
//
//   actor 'committee' = admin tier or committee-member; actor 'site' = the chair / secretary of the session's
//   cadence or an editor of the decision's site (the people the route already lets move the status).
//
//   • the four historical statuses are kept (open, in_progress, done, cancelled); `awaiting_confirmation` is the only
//     addition and is reachable only while the rule is enforced.
//   • a site moves open ↔ in_progress and PROPOSES completion: its `done` is stored as `awaiting_confirmation`,
//     the committee confirms (→ done) or sends it back (→ in_progress, reason).
//   • cancelling needs a reason; reopening a done or cancelled decision is a committee act with a reason.
// The rule is PROPOSED: who closes a decision is the governance committee chair's call (PANEL-PRODUCT §f).

const BASE_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
const STATUSES = ['open', 'in_progress', 'awaiting_confirmation', 'done', 'cancelled'];
const OPEN_STATUSES = ['open', 'in_progress', 'awaiting_confirmation'];   // not closed: still on agendas and delay lists
const CLOSED_STATUSES = ['done', 'cancelled'];
const ACTORS = ['committee', 'site'];

const T = (to, who, o = {}) => ({ to, who, reason: !!o.reason });
const BOTH = ['committee', 'site'], COMMITTEE = ['committee'];
const TRANSITIONS = {
  open: [T('in_progress', BOTH), T('awaiting_confirmation', ['site']), T('done', COMMITTEE), T('cancelled', COMMITTEE, { reason: true })],
  in_progress: [T('open', BOTH), T('awaiting_confirmation', ['site']), T('done', COMMITTEE), T('cancelled', COMMITTEE, { reason: true })],
  awaiting_confirmation: [T('done', COMMITTEE), T('in_progress', COMMITTEE, { reason: true }), T('in_progress', ['site']), T('cancelled', COMMITTEE, { reason: true })],
  done: [T('open', COMMITTEE, { reason: true })],
  cancelled: [T('open', COMMITTEE, { reason: true })],
};

const err = (status, code, error) => ({ ok: false, status, code, error });
const _reason = (r) => String(r == null ? '' : r).trim();

/**
 * Resolve a requested status change.
 * @returns {{ok:true,to:string,changed:boolean,proposed:boolean}|{ok:false,status:number,code:string,error:string}}
 *   `proposed` = a site asked for `done` and the stored status is `awaiting_confirmation`.
 */
function resolve(from, requested, { actor = 'site', reason = null, enforced = false } = {}) {
  const cur = STATUSES.includes(from) ? from : 'open';
  if (!enforced) {   // today's behaviour: any of the four historical statuses, from anywhere, by whoever the route lets in
    if (!BASE_STATUSES.includes(requested)) return err(400, 'INVALID', 'bad decision status');
    return { ok: true, to: requested, changed: requested !== from, proposed: false };
  }
  if (!STATUSES.includes(requested)) return err(400, 'INVALID', 'bad decision status');
  if (!ACTORS.includes(actor)) return err(403, 'FORBIDDEN', 'not allowed to update this decision');
  // a site that reports completion proposes it; the committee confirms
  const proposed = actor === 'site' && requested === 'done' && cur !== 'awaiting_confirmation';
  const to = proposed ? 'awaiting_confirmation' : requested;
  if (to === cur) return { ok: true, to, changed: false, proposed: false };
  const options = (TRANSITIONS[cur] || []).filter((t) => t.to === to);
  if (!options.length) return err(409, 'ILLEGAL_TRANSITION', `a decision cannot go from ${cur} to ${to}`);
  const mine = options.find((t) => t.who.includes(actor));
  if (!mine) return err(403, 'COMMITTEE_ONLY', `only the committee moves a decision from ${cur} to ${to}`);
  if (mine.reason && _reason(reason).length < 3) return err(400, 'REASON_REQUIRED', `a reason is required to move a decision from ${cur} to ${to}`);
  return { ok: true, to, changed: true, proposed };
}

/** Targets an actor may request from a status (for the UI). */
function allowed(from, actor, { enforced = false } = {}) {
  if (!enforced) return BASE_STATUSES.filter((s) => s !== from);
  const cur = STATUSES.includes(from) ? from : 'open';
  const out = (TRANSITIONS[cur] || []).filter((t) => t.who.includes(actor)).map((t) => ({ to: t.to, reason: t.reason }));
  // a site sees "done" as the way to propose completion
  if (actor === 'site' && out.some((t) => t.to === 'awaiting_confirmation')) out.push({ to: 'done', reason: false, proposes: 'awaiting_confirmation' });
  return out;
}

const isClosed = (status) => CLOSED_STATUSES.includes(status);

module.exports = { BASE_STATUSES, STATUSES, OPEN_STATUSES, CLOSED_STATUSES, ACTORS, TRANSITIONS, resolve, allowed, isClosed };
