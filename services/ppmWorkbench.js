'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — PURE rules of the project workbench additions (no I/O, no config read).
//   R2-WB-04 normaliseMember — a project team member: a label (free text, kept), optional user id, role, allocation to
//            the project (null = unknown, never 0 % nor 100 %), optional window. The allocation rule itself lives in
//            public/lib/allocationContract.withMembers (the ONE allocation contract).
//   R2-WB-02 normaliseTimeEntry — one entry: person (label, optional user id; default = the person recording), a day
//            YYYY-MM-DD, hours 0..24 (a stated 0 stays 0), a note. The sum per task is projectSchedule.actualHours.
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

module.exports = { normaliseTimeEntry, normaliseMember, day, bad, text, numOrNull };
