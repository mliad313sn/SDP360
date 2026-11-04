'use strict';
// ADR-006 — the pure resolver (services/governanceRoles.js) and the commitment escalation routing.
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../services/governanceRoles');
const route = require('../services/escalationRouting');

const A = (role, site_id, user_id, o = {}) => ({ id: Math.random(), role, site_id, user_id, effective_from: '2026-01-01', effective_to: null, ...o });
const D = '2026-10-29';

test('holders: site rows win over platform rows; effective dates and ended rows respected', () => {
  const rows = [A('commitments.reviewer', null, 1), A('commitments.reviewer', 7, 2), A('commitments.reviewer', 7, 3, { effective_to: '2026-10-01' }), A('commitments.reviewer', 7, 4, { ended_at: '2026-10-02' }), A('commitments.reviewer', 7, 5, { effective_from: '2026-11-01' })];
  assert.deepEqual(R.holders(rows, 'commitments.reviewer', 7, D), [2]);
  assert.deepEqual(R.holders(rows, 'commitments.reviewer', 8, D), [1], 'no site holder → platform holder');
  assert.deepEqual(R.holders([], 'commitments.reviewer', 7, D), []);
});

test('deputies: dated, revocable, both directions', () => {
  const dep = [{ user_id: 1, deputy_id: 2, start_date: '2026-10-20', end_date: '2026-11-05' }, { user_id: 3, deputy_id: 2, start_date: '2026-10-01', end_date: '2026-10-10' }, { user_id: 4, deputy_id: 2, start_date: '2026-10-20', end_date: '2026-11-05', revoked_at: 'x' }];
  assert.deepEqual(R.principalsOf(dep, 2, D), [1]);
  assert.deepEqual(R.deputiesOf(dep, 1, D), [2]);
  assert.deepEqual(R.deputiesOf(dep, 1, '2026-11-06'), []);
});

test('escalation target: site over platform, highest level reached, exact severity, deputies added, gap when nobody holds it', () => {
  const matrix = [
    { id: 1, register: 'commitments', severity: '*', site_id: null, after_days: 0, role: 'commitments.escalation_target' },
    { id: 2, register: 'commitments', severity: 'critical', site_id: null, after_days: 0, role: 'commitments.group_escalation' },
    { id: 3, register: 'commitments', severity: '*', site_id: 7, after_days: 0, role: 'commitments.escalation_target' },
    { id: 4, register: 'commitments', severity: '*', site_id: 7, after_days: 5, role: 'commitments.group_escalation' },
    { id: 5, register: 'commitments', severity: '*', site_id: 9, after_days: 0, role: 'meetings.chair', retired_at: 'x' },
  ];
  const assignments = [A('commitments.escalation_target', 7, 10), A('commitments.group_escalation', null, 20)];
  const deputies = [{ user_id: 10, deputy_id: 11, start_date: '2026-10-01', end_date: '2026-11-30' }];
  const ctx = { matrix, assignments, deputies };
  let e = R.escalationTarget(ctx, { register: 'commitments', severity: 'high', siteId: 7, overdueDays: 2, today: D });
  assert.equal(e.matched.id, 3); assert.deepEqual(e.targets, [10, 11]);
  e = R.escalationTarget(ctx, { register: 'commitments', severity: 'high', siteId: 7, overdueDays: 6, today: D });
  assert.equal(e.matched.id, 4); assert.deepEqual(e.targets, [20]);
  e = R.escalationTarget(ctx, { register: 'commitments', severity: 'critical', siteId: 8, overdueDays: 0, today: D });
  assert.equal(e.matched.id, 2, 'exact severity over *');
  e = R.escalationTarget(ctx, { register: 'commitments', severity: 'low', siteId: 8, overdueDays: 0, today: D });
  assert.equal(e.matched.id, 1); assert.equal(e.gap, true, 'platform target nobody holds');
  e = R.escalationTarget(ctx, { register: 'handoffs', severity: '*', siteId: 7, overdueDays: 9, today: D });
  assert.equal(e.matched, null); assert.equal(e.gap, false, 'no rule = the behaviour until now (recorded, nobody named)');
  const gaps = R.coverageGaps(ctx, [{ id: 7, name: 'Hounde' }, { id: 8, name: 'Mana' }], D);
  assert.ok(gaps.some((g) => g.site_id === 8 && g.role === 'commitments.escalation_target'));
  assert.ok(!gaps.some((g) => g.site_id === 7 && g.role === 'commitments.escalation_target' && g.kind === 'role'));
  assert.ok(gaps.some((g) => g.kind === 'role' && g.role === 'handoffs.escalation_target'));
});

test('validation: catalogue roles, bounded deputies, matrix registers and severities', () => {
  assert.ok(R.validateAssignment({ role: 'x', user_id: 1, effective_from: '2026-10-01', reason: 'because' }));
  assert.equal(R.validateAssignment({ role: 'reports.publisher', user_id: 1, effective_from: '2026-10-01', reason: 'because' }), null);
  assert.ok(R.validateAssignment({ role: 'reports.publisher', user_id: 1, effective_from: '2026-10-01', effective_to: '2026-09-01', reason: 'because' }));
  assert.ok(R.validateDeputy({ user_id: 1, deputy_id: 1, start_date: '2026-10-01', end_date: '2026-10-02', reason: 'leave' }));
  assert.ok(R.validateDeputy({ user_id: 1, deputy_id: 2, start_date: '2026-10-01', end_date: '2027-10-02', reason: 'leave' }));
  assert.equal(R.validateDeputy({ user_id: 1, deputy_id: 2, start_date: '2026-10-01', end_date: '2026-10-20', reason: 'leave' }), null);
  assert.ok(R.validateMatrix({ register: 'handoffs', severity: 'critical', role: 'handoffs.escalation_target', after_days: 1, reason: 'level one' }), 'handoffs have no severity');
  assert.ok(R.validateMatrix({ register: 'commitments', severity: 'high', role: 'commitments.escalation_target', after_days: -1, reason: 'level one' }));
  assert.equal(R.validateMatrix({ register: 'commitments', severity: 'high', role: 'commitments.escalation_target', after_days: 2, reason: 'level one' }), null);
});

test('commitment escalations reach the matrix target only when the notice switch is on', async () => {
  const cmtStore = { escalate: async () => ({ raised: [{ key: 'A02:1', kind: 'A02', commitment_id: 1, site_id: 7 }], kept: 0, cleared: 0 }), getRaw: async () => ({ id: 1, site_id: 7, severity: 'high', due_date: '2026-10-20', title: 'Fix the generator transfer switch' }) };
  const rolesStore = { escalationTarget: async (q) => R.escalationTarget({ matrix: [{ id: 3, register: 'commitments', severity: '*', site_id: 7, after_days: 5, role: 'commitments.escalation_target' }], assignments: [A('commitments.escalation_target', 7, 10)], deputies: [] }, { ...q, today: D }) };
  const sent = [];
  let r = await route.routeCommitmentEscalations({ cmtStore, rolesStore, notify: async (n) => sent.push(n), notifyEnabled: false, today: D });
  assert.equal(r.raised, 1); assert.equal(sent.length, 0, 'switch off = ledger only, as before');
  r = await route.routeCommitmentEscalations({ cmtStore, rolesStore, notify: async (n) => sent.push(n), notifyEnabled: true, today: D });
  assert.equal(r.notified, 1); assert.equal(sent[0].userId, 10); assert.match(sent[0].body, /overdue 9 d/);
  r = await route.routeCommitmentEscalations({ cmtStore, rolesStore, notify: async (n) => sent.push(n), notifyEnabled: true, today: '2026-10-22' });
  assert.equal(r.notified, 0, 'below the matrix level (2 d < 5 d): no target'); assert.equal(r.gaps.length, 0);
});

test('working calendar: holidays, shutdowns and (by policy) weekends do not count', () => {
  const WC = require('../services/workCalendar');
  const HL = require('../services/handoffLifecycle');
  const SL = require('../services/sessionLifecycle');
  assert.equal(WC.workingDaysAfter('2026-10-20', '2026-10-28', {}), 8, 'no calendar = calendar days (the behaviour until now)');
  const pol = WC.withOffDays({ 'handoffs.escalation_grace_days': 2 }, ['2026-10-27', '2026-10-28']);
  assert.deepEqual(Object.keys(pol), ['handoffs.escalation_grace_days'], 'off days are not a policy key');
  assert.equal(WC.workingDaysAfter('2026-10-25', '2026-10-28', pol), 1);
  const h = [{ id: 1, status: 'accepted', due_date: '2026-10-25' }];
  assert.equal(HL.overdue(h, '2026-10-28', { 'handoffs.escalation_grace_days': 2 }).length, 1, 'without the shutdown: escalated');
  assert.equal(HL.overdue(h, '2026-10-28', pol).length, 0, 'two shutdown days: still inside the grace');
  const we = WC.withOffDays({ 'calendar.skip_weekends': true }, []);
  assert.equal(WC.workingDaysAfter('2026-10-23', '2026-10-26', we), 1, 'Friday → Monday = one working day');
  const s = [{ status: 'planned', scheduled_at: '2026-10-27T09:00:00Z' }, { status: 'planned', scheduled_at: '2026-10-21T09:00:00Z' }];
  const c0 = SL.compliance(s, new Date('2026-10-29T12:00:00Z'), {});
  assert.equal(c0.unexcused, 2);
  const c1 = SL.compliance(s, new Date('2026-10-29T12:00:00Z'), WC.withOffDays({}, ['2026-10-27']));
  assert.equal(c1.unexcused, 1); assert.equal(c1.calendar_excused, 1, 'missed on a site holiday = excused');
});

test('commitment verification: role holder when nobody is named, the named reviewer\'s deputy, never a deputy of the owner', () => {
  const CL = require('../services/commitmentLifecycle');
  const c = { status: 'awaiting_verification', reviewer: '', accountable_owner: 'alice', created_by: 'bob', severity: 'low' };
  const carol = { id: 5, username: 'carol' };
  assert.equal(CL.checkTransition(c, 'verified_closed', carol).ok, false, 'no role, no name: as before');
  assert.equal(CL.checkTransition(c, 'verified_closed', { ...carol, roleReviewer: true }).ok, true, 'holds commitments.reviewer for the site');
  const named = { ...c, reviewer: 'dave' };
  assert.equal(CL.checkTransition(named, 'verified_closed', { ...carol, roleReviewer: true }).ok, false, 'a named reviewer wins over the role');
  assert.equal(CL.checkTransition(named, 'verified_closed', { ...carol, principals: [{ username: 'dave' }] }).ok, true, 'the named reviewer\'s deputy');
  const r = CL.checkTransition(c, 'verified_closed', { ...carol, roleReviewer: true, principals: [{ username: 'alice' }] });
  assert.equal(r.ok, false); assert.match(r.reason, /cannot verify their own/, 'standing in for the owner = being the owner');
});

// A10 / C-03 — governance.skip_inactive_holders: the resolver takes the account state as optional input.
const OPTS = (active, sites) => ({ active: new Set(active), sitesOf: (id) => (id in sites ? sites[id] : []) });
test('A10 policy off (no opts): an inactive holder still counts — the behaviour until now', () => {
  const rows = [A('handoffs.escalation_target', 7, 2), A('handoffs.escalation_target', null, 9)];
  const matrix = [{ id: 1, register: 'handoffs', severity: '*', site_id: null, after_days: 0, role: 'handoffs.escalation_target' }];
  assert.deepEqual(R.holders(rows, 'handoffs.escalation_target', 7, D), [2]);
  assert.deepEqual(R.escalationTarget({ matrix, assignments: rows, deputies: [] }, { register: 'handoffs', siteId: 7, overdueDays: 3, today: D }).targets, [2]);
  assert.deepEqual(R.coverageGaps({ assignments: rows, matrix, deputies: [] }, [{ id: 7, name: 'Hounde' }], D).filter((g) => g.role === 'handoffs.escalation_target'), []);
});

test('A10 policy on: inactive / site-removed holders skipped, platform holder used, gaps listed', () => {
  const rows = [A('handoffs.escalation_target', 7, 2), A('handoffs.escalation_target', 7, 3), A('handoffs.escalation_target', null, 9), A('commitments.escalation_target', 7, 4)];
  const opts = OPTS([3, 4, 9], { 3: [8], 4: [7], 9: null });   // 2 inactive · 3 lost site 7 · 9 admin tier (unscoped)
  assert.deepEqual(R.holders(rows, 'handoffs.escalation_target', 7, D, opts), [9], 'no eligible site holder → platform holder');
  assert.equal(R.holderIneligible(opts, 2, 7), 'inactive');
  assert.equal(R.holderIneligible(opts, 3, 7), 'site_removed');
  assert.equal(R.holderIneligible(opts, 9, 7), null);
  const matrix = [{ id: 1, register: 'handoffs', severity: '*', site_id: null, after_days: 0, role: 'handoffs.escalation_target' }];
  const e = R.escalationTarget({ matrix, assignments: rows, deputies: [] }, { register: 'handoffs', siteId: 7, overdueDays: 3, today: D }, opts);
  assert.deepEqual(e.targets, [9]); assert.equal(e.gap, false); assert.deepEqual(e.skipped.sort(), [2, 3]);
  const gaps = R.coverageGaps({ assignments: rows, matrix, deputies: [] }, [{ id: 7, name: 'Hounde' }], D, opts);
  assert.deepEqual(gaps.filter((g) => g.kind === 'inactive_holder').map((g) => [g.user_id, g.reason]).sort(), [[2, 'inactive'], [3, 'site_removed']]);
  assert.ok(!gaps.some((g) => g.kind === 'role'), 'the platform holder still covers both roles');
  // nobody eligible at all → a role gap
  const dead = [A('handoffs.escalation_target', 7, 2), A('commitments.escalation_target', 7, 2)];
  const g2 = R.coverageGaps({ assignments: dead, matrix: [], deputies: [] }, [{ id: 7, name: 'Hounde' }], D, OPTS([], {}));
  assert.deepEqual(g2.filter((g) => g.kind === 'role').map((g) => g.role).sort(), ['commitments.escalation_target', 'handoffs.escalation_target']);
});

test('A10 policy on: an inactive holder is replaced by an eligible deputy; an ineligible deputy is skipped; next rule as fallback', () => {
  const rows = [A('handoffs.escalation_target', 7, 2), A('handoffs.group_escalation', 7, 5)];
  const deputies = [{ id: 11, user_id: 2, deputy_id: 6, start_date: '2026-10-01', end_date: '2026-11-30' }, { id: 12, user_id: 2, deputy_id: 8, start_date: '2026-10-01', end_date: '2026-11-30' }];
  const matrix = [{ id: 1, register: 'handoffs', severity: '*', site_id: 7, after_days: 0, role: 'handoffs.escalation_target' }, { id: 2, register: 'handoffs', severity: '*', site_id: 7, after_days: 5, role: 'handoffs.group_escalation' }];
  // 2 inactive; deputy 6 active on site 7; deputy 8 active but no longer on any of 2's sites
  const opts = OPTS([5, 6, 8], { 2: [7], 5: [7], 6: [7], 8: [9] });
  const e = R.escalationTarget({ matrix, assignments: rows, deputies }, { register: 'handoffs', siteId: 7, overdueDays: 1, today: D }, opts);
  assert.deepEqual(e.targets, [6]); assert.deepEqual(e.skipped.sort(), [2, 8]);
  // level 2 reached but its holder (5) is inactive and has no deputy → falls to the level-1 rule
  const opts2 = OPTS([6], { 2: [7], 5: [7], 6: [7] });
  const f = R.escalationTarget({ matrix, assignments: rows, deputies }, { register: 'handoffs', siteId: 7, overdueDays: 9, today: D }, opts2);
  assert.equal(f.matched.id, 1); assert.equal(f.fallback_from.id, 2); assert.deepEqual(f.targets, [6]);
  // nobody eligible anywhere → gap on the rule reached
  const g = R.escalationTarget({ matrix, assignments: rows, deputies }, { register: 'handoffs', siteId: 7, overdueDays: 9, today: D }, OPTS([], {}));
  assert.equal(g.gap, true); assert.equal(g.matched.id, 2); assert.deepEqual(g.targets, []);
  // the deputy gap list: deputy 8 of holder 2 lost the site
  const gaps = R.coverageGaps({ assignments: rows, matrix, deputies }, [{ id: 7, name: 'Hounde' }], D, opts);
  assert.deepEqual(gaps.filter((x) => x.kind === 'inactive_deputy').map((x) => [x.deputy_id, x.reason]), [[8, 'site_removed']]);
});
