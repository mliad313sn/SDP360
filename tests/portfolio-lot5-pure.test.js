'use strict';
// PORTFOLIO LOT 5 — pure rules: extended lifecycle gates (every new gate negative + SoD), self-approval refusal (id,
// identity skeleton, owner / sponsor, unknown requester = refused), business-case freeze, review state from the ledger.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../services/projectSchedule');
const RW = require('../services/ppm/reviewWorkflow');

const ext = { extended: true };
const pm = { id: 9, username: 'pm', full_name: 'Paul Manager' };
const base = { owner: 'olivia', sponsor: 'Sam Sponsor', charter: 'Objective, scope and benefits of the project', start_date: '2026-01-01', end_date: '2026-06-30', baseline_end: '2026-06-30' };
const gate = (stage, to, actor = pm, ctx = {}, extra = {}) => S.stageGate({ ...base, ...extra, stage }, to, actor, ctx, ext);
const code = (r) => (r ? r.code : null);

test('switch off: today\'s six stages only — extended stages are unknown', () => {
  assert.strictEqual(code(S.stageGate({ ...base, stage: 'proposal' }, 'assessment', pm, {})), 'STAGE_UNKNOWN');
  assert.strictEqual(code(S.stageGate({ ...base, stage: 'in_progress' }, 'handover', pm, {})), 'STAGE_UNKNOWN');
  assert.deepStrictEqual(S.gatesFor(false), S.GATES);
  assert.strictEqual(S.needsReason('approval', 'proposal', false), false);   // today: no reason to return
});

test('extended: order is enforced and terminal exits stay terminal', () => {
  assert.strictEqual(code(gate('idea', 'approval')), 'STAGE_ORDER');
  assert.strictEqual(code(gate('rejected', 'proposal', pm, { note: 'reopen it please now' })), 'STAGE_ORDER');
  assert.strictEqual(code(gate('cancelled', 'idea', pm, { note: 'reopen it please now' })), 'STAGE_ORDER');
  assert.strictEqual(code(gate('closed', 'in_progress', pm, { note: 'reopen it please now' })), 'STAGE_ORDER');
  assert.strictEqual(code(gate('idea', 'nonsense')), 'STAGE_UNKNOWN');
  assert.strictEqual(gate('idea', 'assessment'), null);
});

test('extended: every exit and every backward move needs a reason', () => {
  for (const [from, to] of [['idea', 'rejected'], ['idea', 'cancelled'], ['assessment', 'deferred'], ['assessment', 'idea'], ['proposal', 'assessment'], ['approval', 'proposal'], ['approval', 'rejected'], ['in_progress', 'on_hold'], ['in_progress', 'cancelled'], ['handover', 'in_progress'], ['benefits_review', 'handover'], ['closure', 'in_progress'], ['deferred', 'proposal']]) {
    assert.strictEqual(code(gate(from, to, { id: 3, username: 'x' }, { openTasks: 0 })), 'GATE_REASON', `${from}>${to}`);
  }
  assert.strictEqual(code(gate('approval', 'proposal', pm, { note: 'missing budget figures' })), null);
});

test('extended: assessment → proposal needs an IT owner; → approval needs a charter', () => {
  assert.strictEqual(code(gate('assessment', 'proposal', pm, {}, { owner: '' })), 'GATE_OWNER');
  assert.strictEqual(code(gate('proposal', 'approval', pm, {}, { charter: 'short' })), 'GATE_CHARTER');
  assert.strictEqual(gate('proposal', 'approval'), null);
});

test('extended: decisions out of approval — sponsor, baseline, owner ≠ decider, sponsor ≠ decider', () => {
  assert.strictEqual(code(gate('approval', 'in_progress', pm, {}, { sponsor: '' })), 'GATE_SPONSOR');
  assert.strictEqual(code(gate('approval', 'in_progress', pm, {}, { baseline_end: null })), 'GATE_BASELINE');
  assert.strictEqual(code(gate('approval', 'in_progress', { id: 1, username: 'olivia' })), 'GATE_SOD');
  assert.strictEqual(code(gate('approval', 'in_progress', { id: 2, username: 'sam', full_name: 'Sam Sponsor' })), 'GATE_SOD_SPONSOR');
  assert.strictEqual(code(gate('approval', 'rejected', { id: 1, username: 'olivia' }, { note: 'no business case at all' })), 'GATE_SOD');
  assert.strictEqual(code(gate('approval', 'deferred', { id: 2, full_name: 'sam sponsor' }, { note: 'next budget cycle please' })), 'GATE_SOD_SPONSOR');
  assert.strictEqual(gate('approval', 'in_progress'), null);
});

test('extended: handover and closure refuse open tasks; closed refuses open high risks', () => {
  assert.strictEqual(code(gate('in_progress', 'handover', pm, { openTasks: 2 })), 'GATE_OPEN_TASKS');
  assert.strictEqual(code(gate('benefits_review', 'closure', pm, { openTasks: 1 })), 'GATE_OPEN_TASKS');
  assert.strictEqual(code(gate('closure', 'closed', pm, { openRisksHigh: 1 })), 'GATE_OPEN_RISKS');
  assert.strictEqual(gate('in_progress', 'handover', pm, { openTasks: 0 }), null);
  assert.strictEqual(gate('handover', 'benefits_review'), null);
});

test('status follows the stage for every extended stage', () => {
  for (const s of S.EXT_STAGES) assert.ok(['planned', 'active', 'on_hold', 'done', 'cancelled'].includes(S.STATUS_FOR[s]), s);
  assert.strictEqual(S.STATUS_FOR.rejected, 'cancelled');
  assert.strictEqual(S.STATUS_FOR.deferred, 'on_hold');
});

test('self-approval: unknown requester is refused (fail closed)', () => {
  assert.strictEqual(code(RW.selfApprovalRefusal(pm, base, null)), 'REVIEW_REQUESTER_UNKNOWN');
  assert.strictEqual(code(RW.selfApprovalRefusal(pm, base, { id: null, name: '' })), 'REVIEW_REQUESTER_UNKNOWN');
  assert.strictEqual(code(RW.selfApprovalRefusal({ username: 'x' }, base, { id: 1, name: 'a' })), 'REVIEW_ACTOR_UNKNOWN');
});

test('self-approval: same id, same identity skeleton (accents, case, confusables), owner, sponsor', () => {
  assert.strictEqual(code(RW.selfApprovalRefusal(pm, base, { id: 9, name: 'someone' })), 'SELF_APPROVAL');
  assert.strictEqual(code(RW.selfApprovalRefusal({ id: 4, full_name: 'Zoé Dupont' }, base, { id: 7, name: 'ZOE DUPONT' })), 'SELF_APPROVAL');
  assert.strictEqual(code(RW.selfApprovalRefusal({ id: 4, username: 'pаul' /* Cyrillic а */ }, base, { id: 7, name: 'paul' })), 'SELF_APPROVAL');
  assert.strictEqual(code(RW.selfApprovalRefusal({ id: 4, username: 'Olivia' }, base, { id: 7, name: 'x' })), 'GATE_SOD');
  assert.strictEqual(code(RW.selfApprovalRefusal({ id: 4, full_name: 'Sam Sponsor' }, base, { id: 7, name: 'x' })), 'GATE_SOD_SPONSOR');
  assert.strictEqual(RW.selfApprovalRefusal({ id: 4, username: 'dana' }, base, { id: 7, name: 'paul' }), null);
});

test('business-case freeze: frozen fields need an approved change request of the same project', () => {
  assert.strictEqual(RW.freezeRefusal(['name', 'end_date'], 1, null), null);
  const r = RW.freezeRefusal(['charter', 'budget', 'name'], 1, null);
  assert.strictEqual(r.code, 'BUSINESS_CASE_FROZEN');
  assert.deepStrictEqual(r.fields, ['charter', 'budget']);
  assert.strictEqual(code(RW.freezeRefusal(['charter'], 1, { project_id: 1, status: 'proposed' })), 'BUSINESS_CASE_FROZEN');
  assert.strictEqual(code(RW.freezeRefusal(['charter'], 1, { project_id: 2, status: 'approved' })), 'BUSINESS_CASE_FROZEN');
  // N-R6-2 — a text field unlocks only when the approved request names it (scope_fields)
  assert.strictEqual(code(RW.freezeRefusal(['charter'], 1, { project_id: 1, status: 'approved' })), 'CHANGE_REQUEST_SCOPE');
  assert.strictEqual(code(RW.freezeRefusal(['charter', 'business_need'], 1, { project_id: 1, status: 'approved', scope_fields: ['charter'] })), 'CHANGE_REQUEST_SCOPE');
  assert.strictEqual(RW.freezeRefusal(['charter'], 1, { project_id: 1, status: 'approved', scope_fields: ['charter'] }), null);
  assert.strictEqual(RW.freezeRefusal(['charter'], 1, { project_id: 1, status: 'approved', scope_fields: 'business_need,charter' }), null);
  assert.strictEqual(RW.freezeRefusal(['budget'], 1, { project_id: 1, status: 'applied', impact_budget: 100, currency: 'USD' }, { before: { budget: 500, currency: 'USD' }, vals: { budget: 600 } }), null);
});

test('P11 R5-2 — freeze: currency frozen, a change request is single-use and bound to its approved budget delta', () => {
  const cr = { id: 3, project_id: 1, status: 'approved', impact_budget: 1000, currency: 'USD' };
  const ctx = (b) => ({ before: { budget: 5000, currency: 'USD' }, vals: { budget: b } });
  assert.strictEqual(code(RW.freezeRefusal(['currency'], 1, null)), 'BUSINESS_CASE_FROZEN');
  assert.strictEqual(code(RW.freezeRefusal(['currency'], 1, cr)), 'BUSINESS_CASE_FROZEN');
  assert.strictEqual(RW.freezeRefusal(['budget'], 1, cr, ctx(6000)), null);
  assert.strictEqual(code(RW.freezeRefusal(['budget'], 1, cr, ctx(9000000))), 'CHANGE_REQUEST_SCOPE');
  assert.strictEqual(code(RW.freezeRefusal(['budget'], 1, { ...cr, used: true }, ctx(6000))), 'CHANGE_REQUEST_USED');
  assert.strictEqual(code(RW.freezeRefusal(['charter'], 1, { ...cr, used: true })), 'CHANGE_REQUEST_USED');
  assert.strictEqual(code(RW.freezeRefusal(['budget'], 1, { ...cr, impact_budget: null }, ctx(6000))), 'CHANGE_REQUEST_SCOPE');
  assert.strictEqual(code(RW.freezeRefusal(['budget'], 1, { ...cr, currency: 'EUR' }, ctx(6000))), 'CHANGE_REQUEST_SCOPE');
});

test('review state derives reviewers, open requests and returns from ledger rows', () => {
  const ev = [
    { id: 1, action: 'review_assign', field: 'budget_review', new_value: '12', note: 'Fiona', actor: 'pm', at: 't1' },
    { id: 2, action: 'info_request', field: 'budget_review', note: 'Which cost centre carries the licences?', actor: 'pm', actor_id: 9, at: 't2' },
    { id: 3, action: 'info_request', field: 'general', note: 'Who operates it after go-live?', actor: 'pm', actor_id: 9, at: 't3' },
    { id: 4, action: 'info_response', field: 'request:2', note: 'CC-4410', actor: 'olivia', at: 't4' },
    { id: 5, action: 'review_return', field: 'approval', note: 'budget split missing', actor: 'pm', at: 't5' },
    { id: 6, action: 'finance_edit', field: 'budget', note: null },
  ];
  const s = RW.reviewState(ev);
  assert.deepStrictEqual(s.reviewers.map((r) => [r.step, r.user_id]), [['budget_review', 12]]);
  assert.strictEqual(s.requests.length, 2);
  assert.strictEqual(s.requests[0].answer, 'CC-4410');
  assert.strictEqual(s.open_requests, 1);
  assert.strictEqual(s.returns.length, 1);
});

test('review template = a valid W3 checklist for the decision gate, with role slots and no auto-approval', () => {
  const GC = require('../services/ppm/gateChecklist');
  const d = GC.normaliseDefinition(RW.reviewTemplate());
  assert.strictEqual(d.items.length, 6);
  assert.ok(d.approvers.length >= 1 && d.approvers.every((a) => a.role));
  assert.strictEqual(RW.REVIEW_GATE, 'in_progress');
  assert.throws(() => RW.normaliseQuestion('short'), /10 characters/);
  assert.throws(() => RW.normaliseStep('bogus'), /step must be/);
  assert.ok(RW.ROLE_CATALOGUE.find((r) => r.spec_role === 'site_contributor').status === 'partial');
});
