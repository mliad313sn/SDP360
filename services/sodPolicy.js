'use strict';
// C-19 (G43 · PO decision R8) — separation-of-duties registry. PURE: no database, no clock.
//
// R8: there is NO hard role-pair conflict at platform level. Separation is enforced PER OBJECT, as today:
//   • no_self_approval        — nobody decides / approves something about themselves or that they filed;
//   • no_self_verification    — the subject of a record and the person who recorded it never verify it;
//   • no_deputy_verification  — an active deputy acts in the name of their principal, so they never decide or
//                               verify work of (or about) that principal.
// One watched pair is FLAGGED, never refused: `report-author` + approver of the same report (warning only).
//
// The handoff / commitment / governance four-eyes rules (services/handoffLifecycle.js, commitmentLifecycle.js,
// governancePolicy.js — check-IAM A05) apply the same three rules in their own modules; they are listed here so
// the registry is the one place that names them. Access approvals (accessRequestLifecycle.check) and qualification
// verification (qualificationPolicy.verifyCheck) call `evaluate` directly. `POLICY_VERSION` = hash of the registry.
const crypto = require('crypto');

const RULES = Object.freeze([
  Object.freeze({ id: 'no_self_approval', level: 'refuse', en: 'Nobody approves what concerns them or what they filed', fr: 'Personne n’approuve ce qui le concerne ou ce qu’il a déposé' }),
  Object.freeze({ id: 'no_self_verification', level: 'refuse', en: 'The subject and the recorder never verify a record', fr: 'Le titulaire et la personne qui a saisi ne vérifient jamais l’enregistrement' }),
  Object.freeze({ id: 'no_deputy_verification', level: 'refuse', en: 'A deputy never decides or verifies the work of their principal', fr: 'Un suppléant ne décide ni ne vérifie le travail de la personne qu’il remplace' }),
]);
const WATCHED_PAIRS = Object.freeze([
  Object.freeze({ id: 'report_author_approver', level: 'warn', roles: Object.freeze(['report-author']), object: 'report.approve',
    en: 'The author of a report is also its approver — flagged, not refused (R8)', fr: 'L’auteur d’un rapport en est aussi l’approbateur — signalé, pas refusé (R8)' }),
]);
// Where each rule applies (the registry, by object). `also_in` points at the modules that apply it themselves.
const OBJECTS = Object.freeze({
  'access.decide': Object.freeze(['no_self_approval', 'no_deputy_verification']),
  'qualification.verify': Object.freeze(['no_self_verification', 'no_deputy_verification']),
  'report.approve': Object.freeze([]),
  'handoff.verify': Object.freeze(['no_self_verification', 'no_deputy_verification']),     // also_in handoffLifecycle.js
  'commitment.verify': Object.freeze(['no_self_verification', 'no_deputy_verification']),  // also_in commitmentLifecycle.js
  'governance.relax': Object.freeze(['no_self_approval']),                                // also_in governancePolicy.js
  // C-21 (G47) — the outgoing person (and whoever recorded the handover) never accepts it; a deputy of the
  // outgoing person never accepts it in the name of the incoming one (services/shiftHandover.js)
  'shift_handover.accept': Object.freeze(['no_self_approval', 'no_deputy_verification']),
  // C-31 — a KPI policy is adopted by a kpi-committee member who neither authored nor proposed it, nor stands in
  // for its author (services/kpiPolicyStore.js)
  'kpi_policy.adopt': Object.freeze(['no_self_approval', 'no_deputy_verification']),
});
const POLICY_VERSION = crypto.createHash('sha256').update(JSON.stringify({ RULES, WATCHED_PAIRS, OBJECTS })).digest('hex').slice(0, 12);

const n = (v) => (v == null || v === '' ? null : Number(v));
const refuse = (rule, error) => ({ rule, status: 403, code: 'FORBIDDEN', error });

/**
 * Evaluate the separation rules for one object.
 * @param {string} object  key of OBJECTS
 * @param {object} f       { actorId, subjectId, requesterId, recorderId, authorId, deputyIds:Set<number> }
 * @returns {{ refuse: null|{rule,status,code,error}, warnings: {rule,en,fr}[] }}
 */
function evaluate(object, f = {}) {
  const rules = OBJECTS[object];
  if (!rules) return { refuse: refuse('unknown_object', 'unknown separation-of-duties object'), warnings: [] };
  const me = n(f.actorId);
  const deps = f.deputyIds instanceof Set ? f.deputyIds : new Set(f.deputyIds || []);
  const warnings = [];
  if (me == null) return { refuse: refuse('no_actor', 'no actor'), warnings };
  if (object === 'access.decide') {
    if (me === n(f.subjectId)) return { refuse: refuse('no_self_approval', 'you cannot decide a request for your own access'), warnings };
    if (me === n(f.requesterId)) return { refuse: refuse('no_self_approval', 'you cannot decide a request you filed'), warnings };
    if (deps.has(me)) return { refuse: refuse('no_deputy_verification', 'a deputy of the requester or of the subject cannot decide this request'), warnings };
  } else if (object === 'qualification.verify') {
    if (me === n(f.subjectId)) return { refuse: refuse('no_self_verification', 'you cannot verify your own qualification'), warnings };
    if (me === n(f.recorderId)) return { refuse: refuse('no_self_verification', 'the person who recorded this evidence cannot also verify it'), warnings };
    if (deps.has(me)) return { refuse: refuse('no_deputy_verification', 'a deputy of the holder or of the recorder cannot verify this evidence'), warnings };
  } else if (object === 'report.approve') {
    if (me === n(f.authorId)) { const p = WATCHED_PAIRS[0]; warnings.push({ rule: p.id, en: p.en, fr: p.fr }); }
  } else {
    if (me === n(f.subjectId) || me === n(f.requesterId) || me === n(f.recorderId)) return { refuse: refuse(rules[0], 'separation of duties: not by the same person'), warnings };
    if (rules.includes('no_deputy_verification') && deps.has(me)) return { refuse: refuse('no_deputy_verification', 'a deputy cannot verify the work of their principal'), warnings };
  }
  return { refuse: null, warnings };
}

module.exports = { RULES, WATCHED_PAIRS, OBJECTS, POLICY_VERSION, evaluate };
