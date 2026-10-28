'use strict';
// G-21 — PURE lifecycle of a governance meeting session (committee review 2026-10-28, goal G10):
//   planned → held (live, then closed) → logged (minutes recorded at close) → accepted (minutes accepted)
// plus two ways a planned session ends without being held:
//   missed     — the scheduled time passed (+ grace) and nobody started it. DERIVED, never stored, and it
//                never counts as held (a planned / no-show event must not count as held).
//   cancelled  — by someone allowed to run it, with a reason. The cancellation is an EXCEPTION that the
//                committee approves (approved = excused; pending / rejected = still a miss for compliance).
// Rules: start only from planned; close only from live (no "held" without having started); minutes are
// accepted by someone other than the person who recorded them (four-eyes) — and once accepted the session
// is frozen (no edits, no new decisions or actions) until an admin reopens it with a reason.
// No DB, no clock: the caller passes the session row, the actor flags and `now`.

const GRACE_HOURS = 48;
const STAGES = ['planned', 'missed', 'held', 'logged', 'accepted', 'cancelled'];

const _ms = (v) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : null; };

/** Lifecycle stage of a session at `now`. */
function stage(s, now = new Date(), graceHours = GRACE_HOURS) {
  if (!s) return null;
  if (s.status === 'cancelled') return 'cancelled';
  if (s.status === 'live') return 'held';
  if (s.status === 'closed') return s.minutes_accepted_at ? 'accepted' : 'logged';
  const at = _ms(s.scheduled_at);
  if (at != null && at + graceHours * 3600e3 < (now instanceof Date ? now.getTime() : Number(now))) return 'missed';
  return 'planned';
}

/**
 * May `actor` do `action` on session `s` now?
 * actor = { id, canRun, canDecide, isCommittee, isAdmin }
 * actions: start · close · edit (notes, items, attendees, decisions, actions) · cancel · approve_exception ·
 *          accept · reopen · reschedule
 * @returns {null | {status:number, code:string, error:string}}
 */
function check(s, action, actor, o = {}) {
  const no = (status, code, error) => ({ status, code, error });
  if (!s) return no(404, 'NOT_FOUND', 'session not found');
  if (!actor || actor.id == null) return no(401, 'NO_USER', 'no user');
  const st = stage(s, o.now || new Date());
  const reason = String(o.reason || '').trim();
  switch (action) {
    case 'start':
      if (!actor.canRun) return no(403, 'FORBIDDEN', 'only the chair, the secretary, the site editors or the committee may run this session');
      if (s.status !== 'planned') return no(409, 'BAD_STAGE', `a ${st} session cannot be started`);
      return null;
    case 'close':
      if (!actor.canRun) return no(403, 'FORBIDDEN', 'only the chair, the secretary, the site editors or the committee may run this session');
      if (s.status !== 'live') return no(409, 'BAD_STAGE', s.status === 'planned' ? 'start the session first — a session that never started is not held' : `a ${st} session cannot be closed again`);
      return null;
    case 'edit':
      if (st === 'accepted') return no(409, 'FROZEN', 'the minutes are accepted — the session is read-only (an admin may reopen it with a reason)');
      if (st === 'cancelled') return no(409, 'BAD_STAGE', 'the session is cancelled');
      return null;
    case 'reschedule':
      if (s.status !== 'planned') return no(409, 'BAD_STAGE', 'only a planned session can be rescheduled');
      return null;
    case 'cancel':
      if (!actor.canRun) return no(403, 'FORBIDDEN', 'only the chair, the secretary, the site editors or the committee may cancel this session');
      if (s.status !== 'planned') return no(409, 'BAD_STAGE', `a ${st} session cannot be cancelled`);
      if (reason.length < 5) return no(400, 'VALIDATION', 'a reason (5+ characters) is required to cancel a session');
      return null;
    case 'approve_exception':
      if (!actor.isCommittee) return no(403, 'FORBIDDEN', 'only the committee approves a cancellation as an exception');
      if (s.status !== 'cancelled') return no(409, 'BAD_STAGE', 'only a cancelled session carries an exception');
      if (s.exception_status === 'approved') return no(409, 'BAD_STAGE', 'already approved');
      if (Number(s.cancelled_by) === Number(actor.id)) return no(403, 'SOD', 'the person who cancelled cannot approve their own exception');
      return null;
    case 'accept':
      if (!(actor.canDecide || actor.isCommittee)) return no(403, 'FORBIDDEN', 'only the chair, the secretary, the committee or an admin may accept minutes');
      if (st !== 'logged') return no(409, 'BAD_STAGE', st === 'accepted' ? 'the minutes are already accepted' : 'close the session first — there are no minutes to accept');
      if (s.closed_by != null && Number(s.closed_by) === Number(actor.id)) return no(403, 'SOD', 'the person who recorded the minutes cannot accept them');
      return null;
    case 'reopen':
      if (!actor.isAdmin) return no(403, 'FORBIDDEN', 'only an admin may reopen accepted minutes');
      if (st !== 'accepted') return no(409, 'BAD_STAGE', 'only accepted minutes can be reopened');
      if (reason.length < 10) return no(400, 'VALIDATION', 'a reason (10+ characters) is required to reopen accepted minutes');
      return null;
    default:
      return no(400, 'VALIDATION', 'unknown action');
  }
}

/** Is a scheduled date inside the cadence's effective window (both bounds optional, inclusive, YYYY-MM-DD)? */
function inEffectiveWindow(cad, scheduledAt) {
  const d = String(scheduledAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  if (cad && cad.effective_from && d < String(cad.effective_from).slice(0, 10)) return false;
  if (cad && cad.effective_to && d > String(cad.effective_to).slice(0, 10)) return false;
  return true;
}

/**
 * Compliance counts for a set of sessions at `now`: held = logged + accepted (never planned, never missed);
 * excused = cancelled with an approved exception; unexcused = missed + cancelled without approval.
 */
function compliance(sessions, now = new Date()) {
  const c = { planned: 0, held: 0, logged: 0, accepted: 0, missed: 0, cancelled: 0, excused: 0, unexcused: 0, in_progress: 0 };
  for (const s of sessions || []) {
    const st = stage(s, now);
    if (st === 'planned') c.planned++;
    else if (st === 'held') c.in_progress++;
    else if (st === 'logged') { c.held++; c.logged++; }
    else if (st === 'accepted') { c.held++; c.accepted++; }
    else if (st === 'missed') { c.missed++; c.unexcused++; }
    else if (st === 'cancelled') { c.cancelled++; if (s.exception_status === 'approved') c.excused++; else c.unexcused++; }
  }
  const due = c.held + c.unexcused;
  c.held_pct = due ? Math.round(1000 * c.held / due) / 10 : null;   // null = nothing was due (not 0 %)
  return c;
}

module.exports = { GRACE_HOURS, STAGES, stage, check, inEffectiveWindow, compliance };
