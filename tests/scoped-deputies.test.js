'use strict';
// C-21 (G45 G46 G47 · A04 A10 · R8 R11) — pure rules: scoped deputies, duty queue routing, shift handover
// acceptance (SoD through services/sodPolicy), optional commitment owner link.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../services/governanceRoles');
const Q = require('../services/dutyQueue');
const S = require('../services/shiftHandover');
const { ownerAccount } = require('../services/commitmentOwner');
const { _withQueue } = require('../services/escalationRouting');
const L = require('../services/handoffLifecycle');

const DAY = '2026-11-05';
const dep = (o) => ({ id: 1, user_id: 10, deputy_id: 20, start_date: '2026-11-01', end_date: '2026-11-30', ...o });

test('an unscoped deputy behaves as before; a scoped one counts only inside its sites, roles and window', () => {
  assert.deepEqual(R.principalsOf([dep()], 20, DAY), [10]);
  const scoped = dep({ scope_site_ids: '[3]', scope_roles: '["site-it-support","handoffs"]' });
  assert.deepEqual(R.principalsOf([scoped], 20, DAY), [], 'no context → a scoped deputy does not count (fail closed)');
  assert.deepEqual(R.principalsOf([scoped], 20, DAY, { siteId: 3, register: 'handoffs' }), [10]);
  assert.deepEqual(R.principalsOf([scoped], 20, DAY, { siteId: 4, register: 'handoffs' }), [], 'out of site scope');
  assert.deepEqual(R.principalsOf([scoped], 20, DAY, { siteId: 3, family: 'network-oncall' }), [], 'out of duty-family scope');
  assert.deepEqual(R.principalsOf([scoped], 20, DAY, { siteId: 3, role: 'handoffs.escalation_target' }), [10], 'a role of the scoped register');
  assert.deepEqual(R.principalsOf([scoped], 20, '2026-12-02', { siteId: 3, register: 'handoffs' }), [], 'outside the date window');
  assert.deepEqual(R.principalsOf([scoped], 20, DAY, { any: true }), [10], 'SoD view: any scope');
  // no chain: the deputy of a deputy is not a deputy of the first person
  assert.deepEqual(R.principalsOf([dep(), dep({ id: 2, user_id: 20, deputy_id: 30 })], 30, DAY), [20]);
});

test('scope validation: known tokens, site ids only', () => {
  const base = { user_id: 1, deputy_id: 2, start_date: '2026-11-01', end_date: '2026-11-10', reason: 'annual leave' };
  assert.equal(R.validateDeputy(base), null);
  assert.equal(R.validateDeputy({ ...base, scope_site_ids: [3, 4], scope_roles: ['site-it-support', 'commitments.reviewer'] }), null);
  assert.equal(R.validateDeputy({ ...base, scope_roles: ['root'] }).status, 400);
  assert.equal(R.validateDeputy({ ...base, scope_site_ids: ['x'] }).status, 400);
  assert.equal(R.validateDeputy({ ...base, scope_site_ids: [] }).status, 400);
});

test('escalation uses only an in-scope, in-window, active deputy', () => {
  const data = {
    matrix: [{ id: 1, register: 'handoffs', severity: '*', site_id: null, after_days: 0, role: 'handoffs.escalation_target' }],
    assignments: [{ id: 1, role: 'handoffs.escalation_target', site_id: 5, user_id: 10, effective_from: '2026-01-01' }],
    deputies: [dep({ deputy_id: 20, scope_site_ids: '[5]', scope_roles: '["handoffs"]' }), dep({ id: 2, deputy_id: 21, scope_site_ids: '[6]' }), dep({ id: 3, deputy_id: 22, scope_roles: '["commitments"]' })],
  };
  const q = { register: 'handoffs', siteId: 5, overdueDays: 2, today: DAY };
  assert.deepEqual(R.escalationTarget(data, q).targets, [10, 20]);
  const opts = { active: new Set([10, 21, 22]), sitesOf: () => [5, 6] };   // 20 deactivated
  assert.deepEqual(R.escalationTarget(data, q, opts).targets, [10]);
});

test('duty queue: on duty + eligible now; the queue comes first, the person stays the fallback', () => {
  const shifts = [{ site_id: 5, family: 'site-it-support', user_id: 40, starts_at: '2026-11-05T06:00:00Z', ends_at: '2026-11-05T18:00:00Z' },
    { site_id: 5, family: 'site-it-support', user_id: 41, starts_at: '2026-11-05T06:00:00Z', ends_at: '2026-11-05T18:00:00Z' },
    { site_id: 5, family: 'network-oncall', user_id: 42, starts_at: '2026-11-05T06:00:00Z', ends_at: '2026-11-05T18:00:00Z' }];
  const account = { active: new Set([40, 42]), sitesOf: () => [5] };
  const m = Q.onDuty({ shifts, account, siteId: 5, at: '2026-11-05T10:00:00Z' });
  assert.deepEqual(m, [40], 'inactive 41 skipped, other family skipped');
  assert.deepEqual(Q.onDuty({ shifts, account, siteId: 5, at: '2026-11-05T19:00:00Z' }), []);
  assert.deepEqual(Q.onDuty({ shifts, account: null, siteId: 5, at: '2026-11-05T10:00:00Z' }), [], 'no account state → nobody');
  const e = { matched: { id: 1 }, role: 'r', targets: [10], gap: false, why: 'ok' };
  const a = Q.applyQueue(e, m, { siteId: 5 });
  assert.deepEqual(a.targets, [40]); assert.deepEqual(a.person_targets, [10]); assert.equal(a.queue.size, 1);
  assert.deepEqual(Q.applyQueue(e, [], { siteId: 5 }).targets, [10], 'empty queue → the person');
});

test('queue routing is off by default (policy handoffs.queue_receivers false = unchanged)', async () => {
  const e = { targets: [10], gap: false, why: 'ok' };
  const dutyStore = { shifts: async () => [{ site_id: 5, family: 'site-it-support', user_id: 40, starts_at: '2026-11-05T06:00:00Z', ends_at: '2026-11-05T18:00:00Z' }], accountState: async () => ({ active: new Set([40]), sitesOf: () => [5] }) };
  const now = () => '2026-11-05T10:00:00Z';
  assert.deepEqual(await _withQueue(e, 5, { policyFor: async () => ({ 'handoffs.queue_receivers': false }), dutyStore, now }), e);
  assert.deepEqual((await _withQueue(e, 5, { policyFor: async () => ({ 'handoffs.queue_receivers': true }), dutyStore, now })).targets, [40]);
  assert.deepEqual(require('../services/governancePolicy').DEFAULTS['handoffs.queue_receivers'], false);
});

test('shift handover: only the incoming person or their in-scope deputy decides; SoD via sodPolicy', () => {
  const h = { id: 1, site_id: 5, family: 'site-it-support', from_user: 1, to_user: 2, created_by: 1, status: 'pending' };
  const act = (o) => ({ id: 2, active: true, isAdmin: false, hasSite: true, deputyFor: [], sodDeputyFor: [], ...o });
  assert.equal(S.checkDecision(h, act(), 'accepted'), null);
  assert.equal(S.checkDecision(h, act({ id: 1 }), 'accepted').code, 'SOD', 'the outgoing person never accepts');
  assert.equal(S.checkDecision(h, act({ id: 9, isAdmin: true }), 'accepted').status, 403, 'the admin tier does not accept on their behalf');
  assert.equal(S.checkDecision(h, act({ id: 3, deputyFor: [2], sodDeputyFor: [2] }), 'accepted'), null, 'deputy of the incoming person, in scope');
  assert.equal(S.checkDecision(h, act({ id: 3, deputyFor: [], sodDeputyFor: [2] }), 'accepted').status, 403, 'deputy out of scope refused');
  assert.equal(S.checkDecision(h, act({ id: 3, deputyFor: [2], sodDeputyFor: [2, 1] }), 'accepted').code, 'SOD', 'a deputy of the outgoing person never accepts');
  assert.equal(S.checkDecision(h, act(), 'refused').status, 400, 'a refusal needs a reason');
  assert.equal(S.checkDecision({ ...h, status: 'accepted' }, act(), 'accepted').status, 409);
  assert.equal(S.actingFor(h, act({ id: 3 })), 2);
  assert.equal(S.validateCreate({ site_id: 5, family: 'site-it-support', to_user: 1 }, { families: ['site-it-support'], actorId: 1 }).status, 400, 'not to yourself');
  const f = S.flag([{ ...h, created_at: '2026-11-05T00:00:00Z' }, { ...h, id: 2, status: 'accepted', created_at: '2026-11-04T00:00:00Z' }], '2026-11-05T10:00:00Z', 8);
  assert.equal(f[0].stale, true); assert.equal(f[0].status, 'pending', 'flagged, never auto-accepted'); assert.equal(f[1].stale, false);
});

test('a deputy never verifies work done as a deputy (handoff, any scope, through sodPolicy)', () => {
  const h = { status: 'delivered', requested_by: 1, receiver_id: 2, delivered_by: 2, site_id: 5 };
  const a = { id: 3, isAdmin: false, active: true, hasSite: true, deputyFor: [1], sodDeputyFor: [1, 2] };
  assert.equal(L.check(h, 'verified', a).code, 'SOD');
  assert.equal(L.check({ ...h, delivered_by: 3 }, 'verified', { ...a, sodDeputyFor: [1] }).code, 'SOD', 'the deputy delivered it themselves');
  assert.equal(L.check({ ...h, delivered_by: 2 }, 'verified', { ...a, sodDeputyFor: [1] }), null);
});

test('R11 — commitment owner: optional account link by username / e-mail, free text kept', () => {
  const users = [{ id: 7, username: 'jdoe', email: 'j.doe@x.com', full_name: 'J Doe', active: 1 }, { id: 8, username: 'old', active: 0 }];
  assert.deepEqual(ownerAccount(' J.Doe@X.com ', users), { id: 7, name: 'J Doe' });
  assert.equal(ownerAccount('J Doe', users), null, 'never by full name');
  assert.equal(ownerAccount('old', users), null, 'inactive account');
  assert.equal(ownerAccount('', users), null);
});
