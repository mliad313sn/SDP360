'use strict';
// B5 (goal programme P7, REQ B4) — timesheet WEEK approval. PURE: no I/O, no clock (the caller passes every row).
// ADR: docs/ai-decisions/ADR-P7B-timesheets-cr-simulation.md. Switch ppm_timesheet_approval_enabled ('0' = today: time
// entries are recorded and removed freely, no week has a state).
//
//   A week = one person × one project × one ISO week (Monday start, UTC). Its state lives in ppm_timesheet_weeks
//   (migration 102); a week without a row is 'draft'. draft | rejected → submitted (the submitter) → approved |
//   rejected (another person) ; submitted → draft by recall (the submitter only, before any decision).
//   SoD: the approver / rejecter is never one of the ENTRANTS of the week — the submitter, the person whose hours they
//   are (when linked to an account) and whoever recorded any entry of the week. Refused with SELF_REVIEW (403).
//   A submitted or approved week is FROZEN: no entry of that person × project × week may be added or removed (409
//   WEEK_FROZEN). A rejected week is open again (entries may be fixed and the week re-submitted).
// Every error carries a stable code (the page turns it into plain words).

const DAY = 86400000;
const STATUSES = Object.freeze(['draft', 'submitted', 'approved', 'rejected']);
const FROZEN = Object.freeze(['submitted', 'approved']);
// action → { from, to, who: 'submitter' (any plan-writer; becomes the submitter) | 'approver' (a decider, SoD) | 'self' (the submitter), note: min chars }
const TS_ACTIONS = Object.freeze({
  submit: { from: ['draft', 'rejected'], to: 'submitted', who: 'submitter', note: 0 },
  recall: { from: ['submitted'], to: 'draft', who: 'self', note: 0 },
  approve: { from: ['submitted'], to: 'approved', who: 'approver', note: 0 },
  reject: { from: ['submitted'], to: 'rejected', who: 'approver', note: 10 },
});

const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
/** The Monday (UTC) of the ISO week holding `day`, or null when `day` is not a real YYYY-MM-DD. */
function weekStart(day) {
  const s = day == null ? '' : String(day).slice(0, 10);
  if (!isDay(s)) return null;
  const t = Date.parse(s + 'T00:00:00Z');
  const dow = new Date(t).getUTCDay();            // 0 = Sunday
  return new Date(t - ((dow + 6) % 7) * DAY).toISOString().slice(0, 10);
}
/** The Sunday ending the week that starts on `monday`. */
const weekEnd = (monday) => new Date(Date.parse(monday + 'T00:00:00Z') + 6 * DAY).toISOString().slice(0, 10);

/** The key of a person on a timesheet: the linked account ('u:<id>') else the label folded ('l:<label>'). Null = no person. */
function personKey(e) {
  if (!e) return null;
  if (e.person_user_id != null && e.person_user_id !== '' && Number.isInteger(Number(e.person_user_id))) return 'u:' + Number(e.person_user_id);
  const l = String(e.person_label || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return l ? 'l:' + l : null;
}

/**
 * Group time entries into weeks (person × week). `entries` rows carry task_id, person_user_id, person_label, day, hours,
 * created_by. `weeks` = stored ppm_timesheet_weeks rows of the project. Returns one item per (person, week) seen in
 * the entries OR stored, sorted by week then person: { person_key, person_label, person_user_id, week_start, week_end,
 * status, hours, entries, entrants: [user ids], week_id, submitted_by, decided_by, decision_note }.
 */
function groupWeeks(entries, weeks) {
  const by = new Map();
  const slot = (pk, ws, seed) => {
    const k = pk + '|' + ws;
    if (!by.has(k)) by.set(k, { person_key: pk, person_label: seed.person_label || null, person_user_id: seed.person_user_id == null ? null : Number(seed.person_user_id), week_start: ws, week_end: weekEnd(ws), status: 'draft', hours: null, entries: 0, entrants: [], week_id: null, submitted_by: null, submitted_at: null, decided_by: null, decided_by_name: null, decided_at: null, decision_note: null, total_hours: null });
    return by.get(k);
  };
  for (const e of entries || []) {
    const pk = personKey(e), ws = weekStart(e && e.day);
    if (!pk || !ws) continue;
    const s = slot(pk, ws, e);
    const h = Number(e.hours);
    if (Number.isFinite(h)) s.hours = Math.round(((s.hours || 0) + h) * 100) / 100;
    s.entries += 1;
    if (e.created_by != null && !s.entrants.includes(Number(e.created_by))) s.entrants.push(Number(e.created_by));
  }
  for (const w of weeks || []) {
    if (!w || !w.person_key || !isDay(String(w.week_start))) continue;
    const s = slot(w.person_key, w.week_start, w);
    Object.assign(s, { status: STATUSES.includes(w.status) ? w.status : 'draft', week_id: Number(w.id), submitted_by: w.submitted_by == null ? null : Number(w.submitted_by), submitted_at: w.submitted_at || null, decided_by: w.decided_by == null ? null : Number(w.decided_by), decided_by_name: w.decided_by_name || null, decided_at: w.decided_at || null, decision_note: w.decision_note || null, total_hours: w.total_hours == null ? null : Number(w.total_hours) });
    if (!s.person_label && w.person_label) s.person_label = w.person_label;
  }
  for (const s of by.values()) if (s.person_user_id != null && !s.entrants.includes(s.person_user_id)) s.entrants.push(s.person_user_id);
  return [...by.values()].sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : String(a.person_key).localeCompare(String(b.person_key))));
}

/**
 * May `actor` take `action` on the week `wk` (an item of groupWeeks, or a stored row with an `entrants` list)?
 * → null when allowed, else { code, error, status }. actor = { id, canPlanWrite:boolean, canDecide:boolean }.
 */
function tsTransition(wk, action, actor, note) {
  const a = TS_ACTIONS[action];
  if (!a) return { code: 'UNKNOWN_ACTION', error: `unknown action ${action}`, status: 400 };
  const uid = actor && actor.id != null ? Number(actor.id) : null;
  const status = (wk && wk.status) || 'draft';
  if (a.who === 'submitter' && !(actor && actor.canPlanWrite)) return { code: 'PLAN_WRITE', error: 'only someone who may write this project\'s plan submits a timesheet week', status: 403 };
  if (a.who === 'self' && !(uid != null && wk && Number(wk.submitted_by) === uid)) return { code: 'SUBMITTER_ONLY', error: 'only the person who submitted the week recalls it', status: 403 };
  if (a.who === 'approver') {
    if (!(actor && actor.canDecide)) return { code: 'DECIDER_ONLY', error: 'only someone who may write this project\'s plan (or the committee) approves or rejects a week', status: 403 };
    const entrants = new Set([...(wk && wk.entrants) || [], wk && wk.submitted_by].filter((x) => x != null).map(Number));
    if (uid == null || entrants.has(uid)) return { code: 'SELF_REVIEW', error: 'a person who entered or submitted these hours cannot approve or reject them — another person decides', status: 403 };
  }
  if (!a.from.includes(status)) return { code: 'TS_ORDER', error: `cannot ${action} a week that is ${status}`, status: 409 };
  if (a.who === 'submitter' && !(wk && wk.entries > 0)) return { code: 'EMPTY_WEEK', error: 'there is no hour recorded for this person in this week', status: 400 };
  if (a.note && !(note && String(note).trim().length >= a.note)) return { code: 'NOTE_REQUIRED', error: `a note (${a.note}+ characters) is required to ${action}`, status: 400 };
  return null;
}

const isFrozen = (status) => FROZEN.includes(status);

module.exports = { STATUSES, FROZEN, TS_ACTIONS, weekStart, weekEnd, personKey, groupWeeks, tsTransition, isFrozen, isDay };
