'use strict';
// C-21 (G47) — shift handover with explicit acceptance. PURE: no DB, no clock.
//   • the outgoing person records the open items (snapshot frozen at creation) and names the incoming person;
//   • ONLY the incoming person — or their deputy in scope (site × duty family, migration 060) — accepts or
//     refuses; a refusal carries a reason. The admin tier does NOT accept on anybody's behalf;
//   • separation of duties (services/sodPolicy 'shift_handover.accept'): the outgoing person, the person who
//     recorded it and any deputy of either never accept it;
//   • nothing accepts by itself: a handover pending longer than `flagHours` is flagged (`stale`), nothing more.
const sod = require('./sodPolicy');

const STATUSES = Object.freeze(['pending', 'accepted', 'refused']);
const MAX_ITEMS = 100;
const no = (status, code, error) => ({ status, code, error });
const n = (v) => (v == null || v === '' ? null : Number(v));

/** Normalises the open items the outgoing person lists: strings or { ref, title, status }. */
function cleanItems(items) {
  if (items == null) return [];
  if (!Array.isArray(items)) return null;
  return items.slice(0, MAX_ITEMS).map((x) => (typeof x === 'string' ? { title: x.slice(0, 300) } : {
    ref: x && x.ref != null ? String(x.ref).slice(0, 60) : undefined, title: String((x && x.title) || '').slice(0, 300), status: x && x.status ? String(x.status).slice(0, 30) : undefined,
  })).filter((x) => x.title.trim() !== '');
}

/** { site_id, family, to_user, shift_label?, notes?, items? } — `families` = known duty family keys. */
function validateCreate(b, { families = [], actorId } = {}) {
  b = b || {};
  if (!Number.isInteger(Number(b.site_id)) || Number(b.site_id) <= 0) return no(400, 'VALIDATION', 'site_id is required');
  if (!families.includes(String(b.family || ''))) return no(400, 'VALIDATION', `family must be one of: ${families.join(', ')}`);
  if (n(b.to_user) == null || !Number.isInteger(n(b.to_user))) return no(400, 'VALIDATION', 'to_user (the incoming person) is required');
  if (n(b.to_user) === n(actorId)) return no(400, 'VALIDATION', 'you cannot hand a shift over to yourself');
  if (cleanItems(b.items) == null) return no(400, 'VALIDATION', 'items must be a list');
  if (b.notes != null && String(b.notes).length > 4000) return no(400, 'VALIDATION', 'notes: at most 4000 characters');
  return null;
}

/**
 * @param {object} h      shift handover row
 * @param {object} actor  { id, active, isAdmin, hasSite, deputyFor:number[] (in scope of this handover), sodDeputyFor:number[] (any scope) }
 * @param {'accepted'|'refused'} to
 */
function checkDecision(h, actor, to, { reason } = {}) {
  if (!h) return no(404, 'NOT_FOUND', 'handover not found');
  if (!actor || actor.id == null) return no(401, 'NO_USER', 'no user');
  if (!['accepted', 'refused'].includes(to)) return no(400, 'VALIDATION', 'unknown decision');
  if (h.status !== 'pending') return no(409, 'CONFLICT', `this handover is already ${h.status}`);
  if (actor.active === false) return no(403, 'FORBIDDEN', 'inactive account');
  const me = Number(actor.id); const any = (actor.sodDeputyFor || actor.deputyFor || []).map(Number);
  const s = sod.evaluate('shift_handover.accept', { actorId: me, subjectId: h.from_user, recorderId: h.created_by,
    deputyIds: any.includes(Number(h.from_user)) || any.includes(Number(h.created_by)) ? new Set([me]) : new Set() });
  if (s.refuse) return no(403, 'SOD', s.refuse.rule === 'no_deputy_verification' ? 'you stand in for the outgoing person — you cannot accept their handover' : 'the outgoing person (or whoever recorded the handover) cannot accept it');
  const incoming = me === Number(h.to_user) || (actor.deputyFor || []).map(Number).includes(Number(h.to_user));
  if (!incoming) return no(403, 'FORBIDDEN', 'only the incoming person (or their deputy for this site and duty) can decide — nothing is accepted on their behalf');
  if (!actor.isAdmin && !actor.hasSite) return no(403, 'FORBIDDEN', 'this handover belongs to a site you no longer have');
  if (to === 'refused' && String(reason || '').trim().length < 5) return no(400, 'VALIDATION', 'a reason (5+ characters) is required to refuse a handover');
  return null;
}

/** The id the actor decides in the name of (deputy), or null. */
const actingFor = (h, actor) => (actor && h && Number(actor.id) !== Number(h.to_user) ? Number(h.to_user) : null);

/** Rows with `age_hours` and `stale` (pending longer than flagHours). Never changes a status. */
function flag(rows, nowIso, flagHours) {
  const t = Date.parse(nowIso); const lim = Math.max(1, Number(flagHours) || 8);
  return (rows || []).map((h) => {
    const age = Number.isFinite(t) ? Math.max(0, (t - Date.parse(h.created_at)) / 36e5) : null;
    return { ...h, age_hours: age == null ? null : Math.round(age * 10) / 10, stale: h.status === 'pending' && age != null && age > lim };
  });
}

module.exports = { STATUSES, MAX_ITEMS, cleanItems, validateCreate, checkDecision, actingFor, flag };
