'use strict';
// W3-GOVERNANCE (PPM parity G1 / T9) — configurable stage-gate checklist with required artifacts and multi-approver
// sign-off. PURE: no I/O, no clock (the caller passes the server time), no database.
// ADR: docs/ai-decisions/ADR-W3-GOVERNANCE-executive-governance.md.
//
// A checklist is defined per project and per TARGET stage (the gate is "entering <stage>"):
//   items      [{ key, label, kind: 'artifact' | 'check' }]   artifact = a linked document / evidence (http(s) link or
//              an internal path starting with '/'); check = a confirmation recorded by a named person.
//   approvers  [{ user_id } | { role }]   N named people or roles; each slot is filled by a DISTINCT person.
//   rule       'all' (every slot approves) | 'quorum' (at least `quorum` slots approve).
// Sign-off rules (each pinned by a negative test):
//   • the approver must match a slot (named user, or holds the role) and may not be the project owner;
//   • one person fills at most one slot; a reject needs a reason (10+ characters);
//   • the LATEST decision of each approver counts; any standing reject blocks the gate (both rules — PROPOSED);
//   • a sign-off belongs to one gate CYCLE (the latest stage move of the project) and one checklist VERSION: moving
//     the project or redefining the checklist asks for fresh sign-offs;
//   • nothing here moves a stage: a complete checklist only lifts the refusal; the committee still makes the move.
// A recorded approval is not a legal / identity-based signature (the session identity only).

const KINDS = ['artifact', 'check'];
const RULES = ['all', 'quorum'];
const STAGES = ['proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed'];
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const LEGAL_NOTE = 'recorded approval (session identity, server time) — not a legal or identity-based signature';

/** Validate / normalise a checklist definition body. Throws INVALID with a reason code. */
function normaliseDefinition(body) {
  const b = body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length > 40) throw bad('at most 40 checklist items', 'TOO_MANY_ITEMS');
  const seen = new Set();
  const outItems = items.map((it, i) => {
    const key = String((it && it.key) || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(key)) throw bad(`item ${i + 1}: key must be 1-40 letters, digits, - or _`, 'BAD_ITEM_KEY');
    if (seen.has(key)) throw bad(`item key ${key} is listed twice`, 'DUPLICATE_ITEM');
    seen.add(key);
    const label = String((it && it.label) || '').trim();
    if (label.length < 3) throw bad(`item ${key}: a label of 3+ characters is required`, 'BAD_ITEM_LABEL');
    const kind = String((it && it.kind) || 'artifact');
    if (!KINDS.includes(kind)) throw bad(`item ${key}: kind must be artifact | check`, 'BAD_ITEM_KIND');
    return { key, label: label.slice(0, 200), kind };
  });
  const appr = Array.isArray(b.approvers) ? b.approvers : [];
  if (!appr.length) throw bad('at least one approver (a named person or a role) is required — a gate is never auto-approved', 'NO_APPROVER');
  if (appr.length > 12) throw bad('at most 12 approver slots', 'TOO_MANY_APPROVERS');
  const outAppr = appr.map((a, i) => {
    if (a && a.user_id != null && a.user_id !== '') {
      const id = Number(a.user_id);
      if (!Number.isInteger(id) || id <= 0) throw bad(`approver ${i + 1}: user_id must be a user id`, 'BAD_APPROVER');
      return { user_id: id };
    }
    const role = String((a && a.role) || '').trim();
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(role)) throw bad(`approver ${i + 1}: give a user_id or a role`, 'BAD_APPROVER');
    return { role };
  });
  const named = outAppr.filter((a) => a.user_id != null).map((a) => a.user_id);
  if (new Set(named).size !== named.length) throw bad('the same person is named in two approver slots', 'DUPLICATE_APPROVER');
  const rule = String(b.rule || 'all');
  if (!RULES.includes(rule)) throw bad('rule must be all | quorum', 'BAD_RULE');
  let quorum = null;
  if (rule === 'quorum') {
    quorum = Number(b.quorum);
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > outAppr.length) throw bad(`quorum must be 1..${outAppr.length}`, 'BAD_QUORUM');
  }
  return { items: outItems, approvers: outAppr, rule, quorum };
}

/** A link that may stand as evidence: http(s) URL or an internal absolute path. */
function validLink(v) { const s = String(v || '').trim(); return s.length <= 2000 && (/^https?:\/\/[^\s]+$/i.test(s) || /^\/[^\s/][^\s]*$/.test(s)); }

/**
 * Which slots may this actor fill, and is the actor allowed to sign at all?
 * @param {object} def  normalised definition
 * @param {{id:number}} actor
 * @param {(role:string)=>boolean} holds  does the actor hold the role (the caller's role check)
 * @param {boolean} isOwner  is the actor the project owner (services/portfolioAccess.ownerMatches)
 * @returns {{error?:{code,error}, slots?:number[]}}
 */
function eligibleSlots(def, actor, holds, isOwner) {
  if (isOwner) return { error: { code: 'GATE_SOD', error: 'the project owner cannot sign off their own gate' } };
  const slots = [];
  (def.approvers || []).forEach((a, i) => { if ((a.user_id != null && Number(a.user_id) === Number(actor && actor.id)) || (a.role && holds(a.role))) slots.push(i); });
  if (!slots.length) return { error: { code: 'NOT_AN_APPROVER', error: 'you are not one of the approvers of this gate' } };
  return { slots };
}

/** The current (cycle, version) sign-offs, the latest per approver. */
function currentDecisions(signoffs, { cycleKey, version }) {
  const latest = new Map();
  for (const s of signoffs || []) {
    if (String(s.cycle_key) !== String(cycleKey) || Number(s.checklist_version) !== Number(version)) continue;
    const prev = latest.get(Number(s.approver_id));
    if (!prev || Number(s.id) > Number(prev.id)) latest.set(Number(s.approver_id), s);
  }
  return [...latest.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Pick the slot a new sign-off fills: the slot this approver already holds in the cycle, else the first eligible slot
 * nobody else holds. Null when every eligible slot is taken by someone else.
 */
function pickSlot(eligible, decisions, actorId) {
  const mine = decisions.find((d) => Number(d.approver_id) === Number(actorId));
  if (mine && eligible.includes(Number(mine.slot_index))) return Number(mine.slot_index);
  const taken = new Set(decisions.filter((d) => Number(d.approver_id) !== Number(actorId)).map((d) => Number(d.slot_index)));
  const free = eligible.find((i) => !taken.has(i));
  return free == null ? null : free;
}

/**
 * Evaluate a gate checklist. Returns the per-item and per-slot state and the refusal (null when complete).
 * @param {{definition:object|null, version:number, evidence:object[], signoffs:object[], cycleKey:string|number}} x
 */
function evaluate({ definition, version, evidence, signoffs, cycleKey }) {
  if (!definition) return { defined: false, complete: true, refusal: null };
  const latestEv = new Map();
  for (const e of evidence || []) {
    if (String(e.cycle_key) !== String(cycleKey)) continue;
    const p = latestEv.get(e.item_key);
    if (!p || Number(e.id) > Number(p.id)) latestEv.set(e.item_key, e);
  }
  const items = definition.items.map((it) => {
    const e = latestEv.get(it.key) || null;
    const satisfied = !!e && !e.withdrawn && (it.kind === 'check' ? true : validLink(e.link));
    return { ...it, satisfied, evidence: e ? { link: e.link || null, note: e.note || null, by: e.added_by_name || null, at: e.added_at } : null };
  });
  const decisions = currentDecisions(signoffs, { cycleKey, version });
  const slots = definition.approvers.map((a, i) => {
    const d = decisions.find((x) => Number(x.slot_index) === i) || null;
    return { ...a, slot: i, decision: d ? d.decision : null, by: d ? d.approver_name : null, by_id: d ? Number(d.approver_id) : null, at: d ? d.at : null, reason: d ? d.reason || null : null };
  });
  const approved = slots.filter((s) => s.decision === 'approve').length;
  const rejected = slots.filter((s) => s.decision === 'reject');
  const required = definition.rule === 'quorum' ? definition.quorum : definition.approvers.length;
  const missing = items.filter((i) => !i.satisfied);
  let refusal = null;
  if (missing.length) refusal = { code: 'GATE_CHECKLIST', error: `${missing.length} checklist item(s) not satisfied: ${missing.map((m) => m.label).join(', ')}` };
  else if (rejected.length) refusal = { code: 'GATE_REJECTED', error: `rejected by ${rejected.map((r) => r.by).join(', ')}` };
  else if (approved < required) refusal = { code: 'GATE_SIGNOFF', error: `${approved} of ${required} required sign-off(s)` };
  return { defined: true, version, rule: definition.rule, quorum: definition.quorum, items, slots, approved, required, complete: !refusal, refusal, note: LEGAL_NOTE };
}

/** Validate a sign-off decision body. */
function normaliseDecision(body) {
  const decision = String((body && body.decision) || '');
  if (!['approve', 'reject'].includes(decision)) throw bad('decision must be approve | reject', 'BAD_DECISION');
  const reason = String((body && body.reason) || '').trim();
  if (decision === 'reject' && reason.length < 10) throw bad('a reason of 10 characters or more is required to reject', 'REASON_REQUIRED');
  return { decision, reason: reason ? reason.slice(0, 2000) : null };
}

module.exports = { normaliseDefinition, normaliseDecision, eligibleSlots, pickSlot, currentDecisions, evaluate, validLink, KINDS, RULES, STAGES, LEGAL_NOTE };
