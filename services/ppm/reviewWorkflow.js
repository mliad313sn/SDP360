'use strict';
// PORTFOLIO LOT 5 (IT portfolio reconstruction spec §26, §27, §28) — review workflow, role catalogue, business-case
// freeze. PURE: no I/O, no clock (the caller passes the server time), no database. ADR: ADR-PORTFOLIO-LOT5.
//
// Everything here is PROPOSED policy (review steps, role mapping, frozen fields) — nothing is an approved decision.
// Approvals are human acts: nothing here approves, signs or moves a stage. It only REFUSES.
//
// SELF-APPROVAL (fail closed). A decision on a project under review (a gate sign-off, or the approve / reject / defer
// move out of `approval`) is refused when the decider is the REQUESTER of the review cycle — the person who moved the
// project into its current stage (ledger), or its creator when no move was ever recorded — matched three ways:
//   1. the same user id;
//   2. the same identity skeleton (services/commitmentLifecycle.skeletonKey: case, accents, confusable letters folded)
//      on username / full name / e-mail against the requester's recorded name, the owner and the sponsor;
//   3. the approver account is not independent of the requester (services/approverProvenance — created / promoted by
//      the requester, a chain of such, or a fresh super_admin of unknown provenance) — checked by the caller (I/O).
// An unknown requester is a refusal (REVIEW_REQUESTER_UNKNOWN), never a pass.

const { skeletonKey } = require('../commitmentLifecycle');

const _ids = (actor) => [actor && actor.username, actor && actor.full_name, actor && actor.email].map(skeletonKey).filter(Boolean);

/**
 * @param {{id:number, username?:string, full_name?:string, email?:string}} actor
 * @param {{owner?:string, sponsor?:string}} project
 * @param {{id:number|null, name:string|null}|null} requester  who opened the review cycle (null = unknown)
 * @returns {null|{code:string, error:string}}
 */
function selfApprovalRefusal(actor, project, requester) {
  if (!actor || actor.id == null) return { code: 'REVIEW_ACTOR_UNKNOWN', error: 'the decider is not identified — refused' };
  if (!requester || (requester.id == null && !skeletonKey(requester.name))) return { code: 'REVIEW_REQUESTER_UNKNOWN', error: 'who submitted this project for review is not recorded — return it for correction and submit it again, then decide (refused, fail closed)' };
  if (requester.id != null && Number(requester.id) === Number(actor.id)) return { code: 'SELF_APPROVAL', error: 'you submitted this project for review — another person must decide' };
  const mine = _ids(actor);
  const clash = (who) => { const k = skeletonKey(who); return !!k && mine.includes(k); };
  if (clash(requester.name)) return { code: 'SELF_APPROVAL', error: 'you submitted this project for review — another person must decide' };
  if (clash(project && project.owner)) return { code: 'GATE_SOD', error: 'the project owner cannot decide on their own project' };
  if (clash(project && project.sponsor)) return { code: 'GATE_SOD_SPONSOR', error: 'the project sponsor cannot decide on the project they sponsor' };
  return null;
}

// Review steps of spec §26 (Site Review … Management Decision) as ONE gate-checklist template for the gate "entering
// in_progress" (the decision out of `approval`), reusing the W3 machinery (services/ppm/gateChecklist). Each step is a
// confirmation recorded by a named person; the approver slots are existing roles. PROPOSED — the PMO edits the
// checklist per project after applying it.
const REVIEW_STEPS = Object.freeze([
  { key: 'site_review', label: 'Site review (site IT manager)', label_fr: 'Revue du site (responsable IT du site)' },
  { key: 'dq_check', label: 'Data quality check', label_fr: 'Contrôle de la qualité des données' },
  { key: 'group_it_review', label: 'Group IT review', label_fr: 'Revue IT groupe' },
  { key: 'arch_security_review', label: 'Architecture / security review', label_fr: 'Revue architecture / sécurité' },
  { key: 'budget_review', label: 'Budget review', label_fr: 'Revue budgétaire' },
  { key: 'management_decision', label: 'Management decision recorded', label_fr: 'Décision de la direction enregistrée' },
]);
const REVIEW_GATE = 'in_progress';
function reviewTemplate() {
  return { items: REVIEW_STEPS.map((s) => ({ key: s.key, label: s.label, kind: 'check' })), approvers: [{ role: 'committee-member' }, { role: 'executive' }], rule: 'all', quorum: null };
}

// Spec §27 role catalogue mapped onto EXISTING roles (services/userRoles) and project roles (W4 ppm_project_roles) —
// no new authorisation system. `granted_by` names what already grants the capability today. PROPOSED.
const ROLE_CATALOGUE = Object.freeze([
  { spec_role: 'site_contributor', label: 'Site contributor', label_fr: 'Contributeur du site', maps_to: ['editor (own site)'], project_role: 'team member', can: ['create projects — NOT granted: today only the committee creates (portfolio_contributor_create, owner decision)', 'edit drafts — through the plan-write rule (portfolio_editor_plan_writes)', 'answer information requests on projects they own'], status: 'partial' },
  { spec_role: 'site_it_manager', label: 'Site IT manager', label_fr: 'Responsable IT du site', maps_to: ['editor (own site)', 'admin'], project_role: 'pm', can: ['review site portfolio (site-scoped reads)', 'record the site-review check of the review checklist when named or holding the slot role'], status: 'mapped' },
  { spec_role: 'group_it_reviewer', label: 'Group IT reviewer', label_fr: 'Réviseur IT groupe', maps_to: ['committee-member'], project_role: null, can: ['review all sites', 'assign reviewers', 'request information', 'return for correction', 'sign off review checklists'], status: 'mapped' },
  { spec_role: 'business_sponsor', label: 'Business sponsor', label_fr: 'Sponsor métier', maps_to: ['project sponsor field'], project_role: 'sponsor', can: ['confirm need and value (comments, checklist evidence)', 'never decides on the project they sponsor (GATE_SOD_SPONSOR)'], status: 'mapped' },
  { spec_role: 'portfolio_manager', label: 'Portfolio manager', label_fr: 'Gestionnaire de portefeuille', maps_to: ['committee-member'], project_role: null, can: ['manage portfolio', 'coordinate reviews', 'produce reporting'], status: 'mapped' },
  { spec_role: 'executive', label: 'Executive', label_fr: 'Direction', maps_to: ['executive'], project_role: null, can: ['approve / reject / defer from approval (stage move, committee)', 'request information', 'record management decisions'], status: 'mapped' },
  { spec_role: 'administrator', label: 'Administrator', label_fr: 'Administrateur', maps_to: ['admin', 'super_admin'], project_role: null, can: ['manage users', 'reference data', 'configure workflow (report_config switches)'], status: 'mapped' },
]);

// Business-case fields frozen once the project passed its approval gate (switch ppm_business_case_freeze_enabled).
// A change needs an APPROVED (or applied) change request of the same project, named in the write. PROPOSED list.
// P11 R5-2 — `currency` is frozen too, and a change request:
//   - is used ONCE (its first business-case edit leaves a `business_case_change` ledger row; a second use is refused);
//   - unlocks the budget only to the value it approved: new budget = old budget + impact_budget, in the request's
//     currency (a request without impact_budget does not unlock the budget);
//   - never unlocks a currency change: a request carries no exchange basis, so re-denominating an approved business
//     case is a committee re-baseline, not an edit (PROPOSED — for the committee to confirm).
const FROZEN_FIELDS = Object.freeze(['charter', 'business_need', 'expected_value', 'budget', 'currency', 'budget_reference', 'budget_approval_date']);
const CR_OK = ['approved', 'applied'];
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/**
 * @param {string[]} changed  field names whose value changes in this write
 * @param {{status:string, project_id:number, impact_budget?:any, currency?:string, used?:boolean}|null} cr  the change request named in the write, if any
 * @param {{before?:object, vals?:object}} [ctx]  the stored project row and the values being written (value binding)
 * @returns {null|{code:string, error:string, fields:string[]}}
 */
function freezeRefusal(changed, projectId, cr, ctx = {}) {
  const fields = (changed || []).filter((f) => FROZEN_FIELDS.includes(f));
  if (!fields.length) return null;
  const refuse = (code, error) => ({ code, error, fields });
  if (fields.includes('currency')) return refuse('BUSINESS_CASE_FROZEN', 'the currency of an approved business case is frozen: a change request carries no exchange basis — re-baseline the business case through the committee');
  if (!(cr && Number(cr.project_id) === Number(projectId) && CR_OK.includes(cr.status))) return refuse('BUSINESS_CASE_FROZEN', `the approved business case is frozen (${fields.join(', ')}): raise a change request, have it approved, then send its change_request_id with the edit`);
  if (cr.used) return refuse('CHANGE_REQUEST_USED', `change request #${cr.id} was already applied to the business case — raise a new change request for a further change`);
  if (fields.includes('budget')) {
    const before = ctx.before || {}, vals = ctx.vals || {};
    const impact = numOrNull(cr.impact_budget), oldB = numOrNull(before.budget), newB = numOrNull(vals.budget);
    const cur = vals.currency || before.currency || null;
    if (impact == null) return refuse('CHANGE_REQUEST_SCOPE', `change request #${cr.id} approved no budget impact — it does not unlock the budget`);
    if (cr.currency && cur && String(cr.currency) !== String(cur)) return refuse('CHANGE_REQUEST_SCOPE', `change request #${cr.id} is in ${cr.currency}, the project budget in ${cur}`);
    if (oldB == null || newB == null || Math.abs(oldB + impact - newB) > 1e-6) return refuse('CHANGE_REQUEST_SCOPE', `change request #${cr.id} approved a budget change of ${impact}: the new budget must be ${oldB == null ? 'the old budget' : oldB} + ${impact}${oldB == null ? '' : ' = ' + (oldB + impact)}`);
  }
  return null;
}

// Review actions are ppm_events rows (entity 'project'): review_assign · info_request · info_response · review_return.
const ACTIONS = Object.freeze(['review_assign', 'info_request', 'info_response', 'review_return']);
/**
 * Derive the review state of a project from its ledger rows ({id, action, field, new_value, note, actor_id, actor, at}).
 * Open information requests are those without a later response naming them.
 */
function reviewState(events) {
  const rows = (events || []).filter((e) => ACTIONS.includes(e.action)).sort((a, b) => Number(a.id) - Number(b.id));
  const reviewers = new Map();
  const requests = [];
  for (const e of rows) {
    if (e.action === 'review_assign') reviewers.set(String(e.field || 'general'), { step: String(e.field || 'general'), user_id: e.new_value == null ? null : Number(e.new_value), name: e.note || null, by: e.actor || null, at: e.at });
    else if (e.action === 'info_request') requests.push({ id: Number(e.id), step: e.field || null, question: e.note || '', by: e.actor || null, by_id: e.actor_id == null ? null : Number(e.actor_id), at: e.at, answer: null, answered_by: null, answered_at: null });
    else if (e.action === 'info_response') {
      const r = requests.find((q) => String(q.id) === String(e.field || '').replace(/^request:/, ''));
      if (r) { r.answer = e.note || ''; r.answered_by = e.actor || null; r.answered_at = e.at; }
    }
  }
  return {
    reviewers: [...reviewers.values()],
    requests,
    open_requests: requests.filter((r) => r.answer == null).length,
    returns: rows.filter((e) => e.action === 'review_return').map((e) => ({ from: e.field || null, reason: e.note || '', by: e.actor || null, at: e.at })),
  };
}

const text = (v, min, max) => { const s = String(v == null ? '' : v).trim(); return s.length >= min ? s.slice(0, max) : null; };
const bad = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', reason, status: 400 });
const STEP_KEYS = ['general', ...REVIEW_STEPS.map((s) => s.key)];
function normaliseStep(v) { const s = String(v == null || v === '' ? 'general' : v).trim(); if (!STEP_KEYS.includes(s)) throw bad(`step must be one of ${STEP_KEYS.join(', ')}`, 'BAD_STEP'); return s; }
function normaliseQuestion(v) { const s = text(v, 10, 2000); if (!s) throw bad('a question of 10 characters or more is required', 'QUESTION_REQUIRED'); return s; }
function normaliseAnswer(v) { const s = text(v, 3, 4000); if (!s) throw bad('an answer of 3 characters or more is required', 'ANSWER_REQUIRED'); return s; }
function normaliseReason(v) { const s = text(v, 10, 2000); if (!s) throw bad('a reason of 10 characters or more is required', 'REASON_REQUIRED'); return s; }

module.exports = { selfApprovalRefusal, reviewTemplate, REVIEW_STEPS, REVIEW_GATE, ROLE_CATALOGUE, FROZEN_FIELDS, freezeRefusal, reviewState, ACTIONS, STEP_KEYS, normaliseStep, normaliseQuestion, normaliseAnswer, normaliseReason };
