'use strict';
// R2-WORKBENCH (REBUILD-SPEC R5) — PURE rules of the project workbench additions (no I/O, no config read).
//   R2-WB-04 normaliseMember — a project team member: a label (free text, kept), optional user id, role, allocation to
//            the project (null = unknown, never 0 % nor 100 %), optional window. The allocation rule itself lives in
//            public/lib/allocationContract.withMembers (the ONE allocation contract).
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

module.exports = { normaliseMember, day, bad, text, numOrNull };
