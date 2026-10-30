'use strict';
// Governance policy registry — pure rules (bounds, relaxation, resolution) and the store on PostgreSQL
// (global vs site scope, protected relaxation needs super_admin + reason, history append-only, clear = inherit).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gov-pol-'));
const { test } = require('node:test');
const assert = require('node:assert/strict');
const GP = require('../services/governancePolicy');

test('registry: every parameter has a default inside its bounds, a description in both languages, an area', () => {
  for (const p of GP.PARAMS) {
    assert.ok(p.en && p.fr && p.area, p.key);
    assert.deepEqual(GP.coerce(p, p.default), p.default, `${p.key} default valid`);
  }
  assert.equal(new Set(GP.PARAMS.map((p) => p.key)).size, GP.PARAMS.length, 'unique keys');
});

test('coerce: bounds and types refused', () => {
  const b = GP.BY_KEY.get('reports.four_eyes'), n = GP.BY_KEY.get('meetings.missed_grace_hours'), i = GP.BY_KEY.get('handoffs.reason_min');
  assert.equal(GP.coerce(b, 'false'), false); assert.throws(() => GP.coerce(b, 'maybe'), /true or false/);
  assert.equal(GP.coerce(n, '12.5'), 12.5); assert.throws(() => GP.coerce(n, 0), /minimum 1/); assert.throws(() => GP.coerce(n, 99999), /maximum/);
  assert.throws(() => GP.coerce(i, 4.5), /whole number/); assert.throws(() => GP.coerce(i, ''), /number/);
});

test('relaxes: direction of each kind of rule', () => {
  const r = (k, a, b) => GP.relaxes(GP.BY_KEY.get(k), a, b);
  assert.equal(r('reports.four_eyes', true, false), true); assert.equal(r('reports.four_eyes', false, true), false);
  assert.equal(r('reports.override_allowed', false, true), true);
  assert.equal(r('freshness.helpdesk_hours', 3, 6), true); assert.equal(r('freshness.helpdesk_hours', 3, 1), false);
  assert.equal(r('handoffs.reason_min', 5, 3), true); assert.equal(r('handoffs.reason_min', 5, 20), false);
});

test('resolveFrom: site → global → default; a platform-only rule ignores a site value', () => {
  const rows = { global: { 'meetings.missed_grace_hours': 24, 'freshness.helpdesk_hours': 6 }, 'site:3': { 'meetings.missed_grace_hours': 96, 'freshness.helpdesk_hours': 1 } };
  assert.deepEqual(GP.resolveFrom(rows, 'meetings.missed_grace_hours', 3), { value: 96, source: 'site' });
  assert.deepEqual(GP.resolveFrom(rows, 'meetings.missed_grace_hours', 4), { value: 24, source: 'global' });
  assert.deepEqual(GP.resolveFrom(rows, 'meetings.missed_grace_hours', null), { value: 24, source: 'global' });
  assert.deepEqual(GP.resolveFrom({}, 'meetings.missed_grace_hours', 3), { value: 48, source: 'default' });
  assert.deepEqual(GP.resolveFrom(rows, 'freshness.helpdesk_hours', 3), { value: 6, source: 'global' }, 'freshness is not site-scoped');
});

test('store on PostgreSQL: guardrails, history, site scope, clear = inherit, cache invalidated', async () => {
  await require('./_pg-fresh').truncate(['governance_policies', 'governance_policy_history', 'governance_policy_proposals']);
  const st = GP.makePolicyStore(() => require('../reports-db').pgHandle());
  const admin = { id: 1, isAdmin: true, isSuper: false }, sup = { id: 2, isAdmin: true, isSuper: true };
  await assert.rejects(async () => st.set({ scope: 'global', key: 'nope', value: 1, reason: 'x y z', actor: sup }), /unknown policy/);
  await assert.rejects(async () => st.set({ scope: 'site:3', key: 'freshness.helpdesk_hours', value: 1, reason: 'abc', actor: sup }), /whole platform/);
  await assert.rejects(async () => st.set({ scope: 'global', key: 'reports.four_eyes', value: false, reason: 'small office only', actor: admin }), (e) => e.status === 403, 'relaxing a protected rule needs a super_admin');
  await assert.rejects(async () => st.set({ scope: 'global', key: 'reports.four_eyes', value: false, reason: 'short', actor: sup }), /10\+ characters/);
  await assert.rejects(async () => st.set({ scope: 'global', key: 'handoffs.reason_min', value: 8, reason: '', actor: admin }), /reason is required/);
  // tightening a protected rule: admin is enough
  let c = await st.set({ scope: 'global', key: 'freshness.helpdesk_hours', value: 2, reason: 'tighter SLA', actor: admin });
  assert.equal(c.relaxes, false); assert.equal((await st.snapshot({}))['freshness.helpdesk_hours'], 2);
  // site override of a protected rule, relaxing → super_admin
  // dual approval (committee P0-1): the relaxation is only a proposal until a SECOND super_admin approves
  const sup2 = { id: 3, isAdmin: true, isSuper: true };
  c = await st.set({ scope: 'site:7', key: 'publication.four_eyes', value: false, reason: 'one-person office in Dakar', actor: sup });
  assert.equal(c.relaxes, true); assert.ok(c.pending && c.pending.id, 'pending proposal');
  assert.equal((await st.snapshot({ siteId: 7 }))['publication.four_eyes'], true, 'nothing changes before approval');
  await assert.rejects(async () => st.set({ scope: 'site:7', key: 'publication.four_eyes', value: false, reason: 'one-person office in Dakar', actor: sup2 }), (e) => e.status === 409, 'one pending proposal per rule');
  await assert.rejects(async () => st.decide(c.pending.id, 'approve', { actor: sup, reason: 'self' }), (e) => e.status === 403, 'the proposer never approves');
  await assert.rejects(async () => st.decide(c.pending.id, 'approve', { actor: admin, reason: 'admin' }), (e) => e.status === 403, 'an admin never approves');
  const ap = await st.decide(c.pending.id, 'approve', { actor: sup2, reason: 'agreed until hire' });
  assert.equal(ap.status, 'approved'); assert.ok(ap.expires_at, 'a relaxation is temporary');
  assert.ok(Date.parse(ap.expires_at) - Date.now() <= 90 * 864e5 + 6e4, 'capped by governance.relaxation_max_days');
  await assert.rejects(async () => st.decide(c.pending.id, 'approve', { actor: sup2, reason: 'again' }), (e) => e.status === 409);
  assert.equal((await st.snapshot({ siteId: 7 }))['publication.four_eyes'], false);
  const hp = (await st.history({})).find((x) => x.key === 'publication.four_eyes');
  assert.equal(Number(hp.proposed_by), 2); assert.equal(Number(hp.approved_by), 3);
  // a rejected proposal changes nothing
  const rj = await st.set({ scope: 'site:8', key: 'reports.four_eyes', value: false, reason: 'small office request', actor: sup });
  assert.equal((await st.decide(rj.pending.id, 'reject', { actor: sup2, reason: 'no, keep four-eyes' })).status, 'rejected');
  assert.equal((await st.snapshot({ siteId: 8 }))['reports.four_eyes'], true);
  assert.equal((await st.listProposals({})).length, 0);
  // oversight: the approved relaxation, and the site-7 deviation flagged less strict
  const ov = await st.oversight({});
  assert.equal(ov.relaxations.length, 1); assert.equal(ov.proposals.length, 2);
  assert.ok(ov.deviations.some((d) => d.scope === 'site:7' && d.key === 'publication.four_eyes' && d.less_strict));
  assert.equal((await st.snapshot({ siteId: 8 }))['publication.four_eyes'], true, 'other sites keep the default');
  // clearing the override re-tightens (not a relaxation) and returns to inherit
  c = await st.set({ scope: 'site:7', key: 'publication.four_eyes', value: null, reason: 'second person hired', actor: admin });
  assert.equal(c.after, true); assert.equal(c.relaxes, false);
  const h = await st.history({});
  assert.equal(h.length, 3); assert.equal(h.filter((x) => x.relaxes).length, 1);
  assert.deepEqual(h.map((x) => x.key), ['publication.four_eyes', 'publication.four_eyes', 'freshness.helpdesk_hours']);
  const v = await st.view({ siteIds: [7] });
  assert.equal(v.find((p) => p.key === 'freshness.helpdesk_hours').effective, 2);
});

test('pure rule modules honour the policy they are given', () => {
  const G = require('../services/publishGate'), SL = require('../services/sessionLifecycle'), HL = require('../services/handoffLifecycle');
  const def = { review_state: null };
  assert.equal(G.definitionConflict(def, { id: 1 }).code, 'NOT_SUBMITTED');
  assert.equal(G.definitionConflict(def, { id: 1 }, { 'publication.four_eyes': false }), null);
  assert.equal(G.publishDecision({ review_state: 'submitted', submitted_by: 1 }, { id: 1 }, { isAdmin: true, overrideReason: 'x'.repeat(12), policy: { 'publication.override_allowed': false } }).allow, false);
  assert.equal(G.dutyConflict('review', { created_by: 1 }, { id: 1 }, { 'reports.four_eyes': false }), null);
  const now = Date.parse('2026-10-28T12:00:00Z');
  assert.equal(G.freshness(['helpdesk'], { 'zoho.requests': '2026-10-28T08:00:00Z' }, now).fresh, false, 'default 3 h');
  assert.equal(G.freshness(['helpdesk'], { 'zoho.requests': '2026-10-28T08:00:00Z' }, now, { 'freshness.helpdesk_hours': 6 }).fresh, true);
  const planned = { status: 'planned', scheduled_at: '2026-10-27T09:00:00Z' };
  assert.equal(SL.stage(planned, new Date(now)), 'planned');
  assert.equal(SL.stage(planned, new Date(now), { 'meetings.missed_grace_hours': 12 }), 'missed');
  assert.equal(SL.check({ status: 'closed', closed_by: 1 }, 'accept', { id: 1, canDecide: true }, { policy: { 'meetings.minutes_four_eyes': false } }), null);
  assert.equal(SL.compliance([{ status: 'cancelled', exception_status: 'pending' }], new Date(now), { 'meetings.cancel_requires_approval': false }).excused, 1);
  const h = { status: 'requested', requested_by: 1, receiver_id: 2 };
  assert.equal(HL.check(h, 'rejected', { id: 2, hasSite: true }, { reason: 'nope!', policy: { 'handoffs.reason_min': 20 } }).status, 400);
  const rows = [{ ...h, id: 1, due_date: '2026-10-25' }];
  assert.equal(HL.overdue(rows, '2026-10-28').length, 1);
  assert.equal(HL.overdue(rows, '2026-10-28', { 'handoffs.escalation_grace_days': 5 }).length, 0);
  assert.equal(HL.overdue(rows, '2026-10-28', { 'handoffs.overdue_escalation': false }).length, 0);
});
