'use strict';
// E-S03 (audit S-05) — access recertification pure core: lines, R7 approver (never the subject), answers,
// revoke plan, orphan list (a NULL last sign-in is UNKNOWN, never "old"), progress.
const { test } = require('node:test');
const assert = require('node:assert');
const RC = require('../services/accessRecert');
const { DEFAULTS } = require('../services/reportConfig');

const LEVELS = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const hasRole = (u, r) => {
  const roles = u.roles || [];
  if (roles.includes(r)) return true;
  const i = LEVELS.indexOf(r); if (i < 0) return false;
  return roles.some((x) => LEVELS.indexOf(x) >= i);
};
const U = (id, roles, site, extra = [], more = {}) => ({ id, username: 'u' + id, full_name: 'U' + id, roles, site_id: site, extra_site_ids: extra, active: 1, ...more });
const users = [
  U(1, ['super_admin'], null), U(2, ['admin'], 10), U(3, ['editor', 'tracker-editor'], 10), U(4, ['editor'], 20, [10]),
  U(5, ['admin'], 20), U(6, ['viewer'], 10, [], { active: 0 }), U(7, ['editor'], null),
];

test('switches default to today: feature off, revoke recorded only', () => {
  assert.equal(DEFAULTS.access_recert_enabled, '0');
  assert.equal(DEFAULTS.access_recert_apply, '0');
  assert.equal(DEFAULTS.access_recert_orphan_days, '90');
});

test('buildLines: active accounts only, account × role and account × site, scoped to one site', () => {
  const all = RC.buildLines(users);
  assert.ok(!all.some((l) => l.user_id === 6), 'inactive account skipped');
  assert.deepEqual(all.filter((l) => l.user_id === 4).map((l) => `${l.kind}:${l.role || l.site_id}`), ['role:editor', 'site:20', 'site:10']);
  const s10 = RC.buildLines(users, { scopeSiteId: 10 });
  assert.deepEqual([...new Set(s10.map((l) => l.user_id))], [2, 3, 4]);
  assert.ok(s10.filter((l) => l.kind === 'site').every((l) => l.site_id === 10));
  assert.ok(s10.filter((l) => l.kind === 'role').every((l) => l.site_id === 10));
});

test('approver: R7 rule, a site admin preferred, never the subject; a platform role goes to a super_admin', () => {
  const l3 = { kind: 'role', user_id: 3, role: 'tracker-editor', site_id: 10 };
  assert.equal(RC.resolveApprover(l3, users, { hasRole }), 2, 'admin of site 10');
  const l2 = { kind: 'role', user_id: 2, role: 'admin', site_id: 10 };
  assert.equal(RC.resolveApprover(l2, users, { hasRole }), 1, 'admin is a platform role → super_admin');
  const l1 = { kind: 'role', user_id: 1, role: 'super_admin', site_id: null };
  assert.equal(RC.resolveApprover(l1, users, { hasRole }), null, 'no other super_admin → UNKNOWN (null)');
  assert.match(RC.canAnswer(l3, users[2], { users, hasRole }), /cannot answer its own line/);
  assert.match(RC.canAnswer(l3, users[4], { users, hasRole }), /do not hold site 10/);
  assert.equal(RC.canAnswer(l3, users[0], { users, hasRole }), null);
});

test('answers: keep / revoke / unknown with a reason', () => {
  assert.ok(RC.validateAnswer({ answer: 'maybe', reason: 'because' }).error);
  assert.ok(RC.validateAnswer({ answer: 'keep', reason: 'ok' }).error);
  assert.deepEqual(RC.validateAnswer({ answer: 'REVOKE', reason: '  left the site  ' }).value, { answer: 'revoke', reason: 'left the site' });
});

test('applyPlan: revoke a role (never zero roles) or a site (primary moves to an extra site)', () => {
  assert.deepEqual(RC.applyPlan(users[2], { kind: 'role', role: 'tracker-editor' }).roles, ['editor']);
  assert.deepEqual(RC.applyPlan(users[6], { kind: 'role', role: 'editor' }).roles, ['viewer']);
  const s = RC.applyPlan(users[3], { kind: 'site', site_id: 20 });
  assert.equal(s.site_id, 10); assert.deepEqual(s.extra_site_ids, []);
  assert.equal(RC.applyPlan(users[3], { kind: 'role', role: 'admin' }), null, 'nothing to remove');
});

test('orphans: idle beyond N, editor without site, inactive site, role no template grants; NULL login is UNKNOWN, never old', () => {
  const last = new Map([[2, '2026-01-01T08:00:00Z'], [3, '2026-11-01T08:00:00Z']]);
  const o = RC.orphans(users, { lastLoginById: last, sites: [{ id: 10, name: 'A', active: 1 }, { id: 20, name: 'B', active: 0 }],
    templateRoles: new Set(['editor', 'viewer', 'admin']), today: '2026-11-05', days: 90, hasRole });
  const by = new Map(o.rows.map((r) => [r.user_id, r.reasons.map((x) => x.code)]));
  assert.deepEqual(by.get(2), ['no_login']);
  assert.deepEqual(by.get(3), ['role_without_template']);
  assert.ok(by.get(4).includes('inactive_site') && !by.get(4).includes('no_login'), 'unknown login is not counted as old');
  assert.ok(by.get(7).includes('editor_without_site'));
  assert.deepEqual(o.last_login_unknown.map((x) => x.user_id).sort(), [1, 4, 5, 7]);
  assert.equal(o.templates_known, true);
  const none = RC.orphans(users, { today: '2026-11-05', days: 90, hasRole, templateRoles: null });
  assert.equal(none.templates_known, false);
  assert.ok(!none.rows.some((r) => r.reasons.some((x) => x.code === 'role_without_template' || x.code === 'no_login')));
});

test('progress counts', () => {
  const p = RC.progress([{ answer: 'keep', approver_user_id: 2 }, { answer: 'revoke', applied_at: 'x', approver_user_id: 2 }, { answer: null, approver_user_id: null }]);
  assert.deepEqual(p, { total: 3, answered: 2, pending: 1, keep: 1, revoke: 1, unknown: 0, applied: 1, no_approver: 1 });
});
