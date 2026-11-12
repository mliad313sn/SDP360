'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — PURE rules of the project workbench additions (no I/O, no config read).
//   R2-WB-04 normaliseMember — a project team member: a label (free text, kept), optional user id, role, allocation to
//            the project (null = unknown, never 0 % nor 100 %), optional window. The allocation rule itself lives in
//            public/lib/allocationContract.withMembers (the ONE allocation contract).
//   R2-WB-02 normaliseTimeEntry — one entry: person (label, optional user id; default = the person recording), a day
//            YYYY-MM-DD, hours 0..24 (a stated 0 stays 0), a note. The sum per task is projectSchedule.actualHours.
//   R2-WB-01 normaliseChangeRequest / crTransition — native change requests: proposed → assessed → approved |
//            rejected → applied, withdrawn while open; approver ≠ author; apply only an approved request.
// Every error carries a stable code (the page turns it into plain words).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (code, error) => Object.assign(new Error(error), { code: 'INVALID', reason: code, status: 400 });
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const numOrNull = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
function day(v, field) {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw bad('BAD_DAY', `${field} must be a date YYYY-MM-DD`);
  return s;
}

/** @returns {{user_id:number|null,label:string,role:string|null,allocation_pct:number|null,from_day:string|null,to_day:string|null}} */
function normaliseMember(body) {
  const b = body || {};
  const label = text(b.label, 200);
  const userId = b.user_id == null || b.user_id === '' ? null : Number(b.user_id);
  if (userId != null && !(Number.isInteger(userId) && userId > 0)) throw bad('BAD_USER', 'user_id must be a user id');
  if (!label) throw bad('LABEL_REQUIRED', 'a member needs a name (label)');
  const alloc = numOrNull(b.allocation_pct);
  if (alloc != null && !(alloc >= 0 && alloc <= 100)) throw bad('BAD_ALLOCATION', 'allocation_pct must be 0..100 (leave empty when unknown)');
  const from = day(b.from_day, 'from_day'), to = day(b.to_day, 'to_day');
  if (from && to && to < from) throw bad('BAD_WINDOW', 'to_day is before from_day');
  return { user_id: userId, label, role: text(b.role, 120), allocation_pct: alloc, from_day: from, to_day: to };
}

/** @returns {{person_user_id:number|null, person_label:string, day:string, hours:number, note:string|null}} */
function normaliseTimeEntry(body, user) {
  const b = body || {};
  const d = day(b.day, 'day');
  if (!d) throw bad('DAY_REQUIRED', 'a day (YYYY-MM-DD) is required');
  const h = numOrNull(b.hours);
  if (h == null || Number.isNaN(h) || h < 0 || h > 24) throw bad('BAD_HOURS', 'hours must be a number from 0 to 24');
  let userId = b.person_user_id == null || b.person_user_id === '' ? null : Number(b.person_user_id);
  if (userId != null && !(Number.isInteger(userId) && userId > 0)) throw bad('BAD_USER', 'person_user_id must be a user id');
  let label = text(b.person_label, 200);
  if (!label && userId == null && user) { label = text(user.full_name || user.username, 200); userId = user.id != null ? Number(user.id) : null; }
  if (!label) throw bad('PERSON_REQUIRED', 'who worked these hours (person_label) is required');
  return { person_user_id: userId, person_label: label, day: d, hours: h, note: text(b.note, 1000) };
}

const CR_STATUSES = Object.freeze(['proposed', 'assessed', 'approved', 'rejected', 'applied', 'withdrawn']);
// action → { from: allowed statuses, to, committee: only the committee, sod: the actor may not be the author, note: min chars }
const CR_ACTIONS = Object.freeze({
  assess: { from: ['proposed'], to: 'assessed', committee: true, sod: false, note: 0 },
  approve: { from: ['assessed'], to: 'approved', committee: true, sod: true, note: 0 },
  reject: { from: ['proposed', 'assessed'], to: 'rejected', committee: true, sod: true, note: 10 },
  withdraw: { from: ['proposed', 'assessed', 'approved'], to: 'withdrawn', committee: false, sod: false, note: 10 },
  apply: { from: ['approved'], to: 'applied', committee: true, sod: false, note: 0 },
});
const MIN_CR_REASON = 10;

/** @returns {{title, reason, impact_dates_days:number|null, impact_budget:number|null, currency:string|null}} */
function normaliseChangeRequest(body) {
  const b = body || {};
  const title = text(b.title, 300);
  if (!title) throw bad('TITLE_REQUIRED', 'a change request needs a title');
  const reason = text(b.reason, 4000);
  if (!reason || reason.length < MIN_CR_REASON) throw bad('REASON_REQUIRED', `a reason (${MIN_CR_REASON}+ characters) is required`);
  const days = numOrNull(b.impact_dates_days);
  if (days != null && !Number.isInteger(days)) throw bad('BAD_DAYS', 'impact_dates_days must be a whole number of days (empty = no dates impact known)');
  const money = numOrNull(b.impact_budget);
  if (money != null && Number.isNaN(money)) throw bad('BAD_AMOUNT', 'impact_budget must be a number (empty = not known)');
  const currency = text(b.currency, 3) ? String(b.currency).trim().toUpperCase() : null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw bad('BAD_CURRENCY', 'currency must be an ISO code such as USD or XOF');
  if (money != null && !currency) throw bad('CURRENCY_REQUIRED', 'an amount needs its currency (ISO code such as USD or XOF)');
  return { title, reason, impact_dates_days: days, impact_budget: money, currency: money == null ? null : currency };
}

/**
 * Can `actor` do `action` on `cr`? → null when allowed, else { code, error, status }.
 * @param {{status, author_id}} cr @param {string} action @param {{id, isCommittee:boolean}} actor @param {string} [note]
 */
function crTransition(cr, action, actor, note) {
  const a = CR_ACTIONS[action];
  if (!a) return { code: 'UNKNOWN_ACTION', error: `unknown action ${action}`, status: 400 };
  const isAuthor = actor && cr.author_id != null && Number(actor.id) === Number(cr.author_id);
  if (a.committee && !(actor && actor.isCommittee)) return { code: 'COMMITTEE_ONLY', error: 'committee-member or admin role required', status: 403 };
  if (action === 'withdraw' && !isAuthor && !(actor && actor.isCommittee)) return { code: 'AUTHOR_OR_COMMITTEE', error: 'only the author or the committee withdraws a change request', status: 403 };
  if (a.sod && (isAuthor || !actor || actor.id == null)) return { code: 'SELF_REVIEW', error: 'the author of a change request cannot decide it', status: 403 };
  if (!a.from.includes(cr.status)) return { code: 'CR_ORDER', error: `cannot ${action} a change request that is ${cr.status}`, status: 409 };
  if (a.note && !(note && String(note).trim().length >= a.note)) return { code: 'NOTE_REQUIRED', error: `a note (${a.note}+ characters) is required to ${action}`, status: 400 };
  return null;
}

// UAT-OI-08 (G3-UX) — people offered by the team picker and the member rows sent to a browser. A login name can be an
// e-mail address (SSO accounts): neither the picker nor a team row ever carries one. The display name is the full
// name, else the login name when it is not an address, else "User #id".
const looksLikeEmail = (v) => /@/.test(String(v || ''));
function personName(u) {
  if (!u) return null;
  const full = String(u.full_name || '').trim(), login = String(u.username || '').trim();
  if (full && !looksLikeEmail(full)) return full;
  if (login && !looksLikeEmail(login)) return login;
  return u.id != null ? 'User #' + Number(u.id) : null;
}
/** Active users → [{ id, name }] sorted by name (no e-mail, no login name that is an address, no role). */
function pickerPeople(users) {
  return (users || []).filter((x) => x && x.active !== 0 && x.active !== false && x.id != null)
    .map((x) => ({ id: Number(x.id), name: personName(x) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
}
/** A member row for a browser: the linked account's display name, never its login name. */
function publicMember(m) {
  if (!m) return m;
  const { username, user_full_name, ...rest } = m;
  return { ...rest, user_name: m.user_id == null ? null : personName({ id: m.user_id, full_name: user_full_name, username }) };
}

module.exports = { CR_STATUSES, CR_ACTIONS, normaliseChangeRequest, crTransition, normaliseTimeEntry, normaliseMember, day, bad, text, numOrNull, personName, pickerPeople, publicMember };
