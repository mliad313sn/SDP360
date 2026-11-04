'use strict';
// C-18 (G40 / A09) — the pure access request state machine: transitions, separation of duties, scope binding,
// validation of requests and template payloads, and which roles survive the end of a grant.
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../services/accessRequestLifecycle');
const rdb = require('../reports-db');

const KNOWN = [...rdb.ROLE_HIERARCHY, ...rdb.FEATURE_ROLES_KNOWN];
const T = '2026-11-04';
const req = (o = {}) => ({ id: 1, status: 'REQUESTED', subject_user_id: 10, requested_by: 11, roles: ['finance-viewer'], site_ids: [2], valid_from: T, valid_to: '2026-12-31', ...o });
const SUPER = { id: 99 };

test('transitions follow REQUESTED→REVIEWING→APPROVED|REJECTED→ACTIVE→EXPIRED|REVOKED', () => {
  assert.equal(L.check(req(), 'review', SUPER, { isApprover: true }), null);
  assert.equal(L.check(req({ status: 'REVIEWING' }), 'approve', SUPER, { isApprover: true }), null);
  assert.equal(L.check(req({ status: 'APPROVED' }), 'activate', null, { today: T }), null);
  assert.equal(L.check(req({ status: 'ACTIVE' }), 'expire', null, {}), null);
  assert.equal(L.check(req({ status: 'REJECTED' }), 'approve', SUPER, { isApprover: true }).status, 409);
  assert.equal(L.check(req({ status: 'EXPIRED' }), 'revoke', SUPER, { isApprover: true }).status, 409);
  assert.equal(L.check(req({ status: 'ACTIVE' }), 'approve', SUPER, { isApprover: true }).status, 409);
  assert.deepEqual([...L.STATES], ['REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'REVOKED']);
});

test('separation of duties: subject, requester, their deputies and non-super_admins never decide', () => {
  assert.equal(L.check(req(), 'approve', { id: 10 }, { isApprover: true }).status, 403, 'subject');
  assert.equal(L.check(req(), 'approve', { id: 11 }, { isApprover: true }).status, 403, 'requester');
  assert.equal(L.check(req(), 'reject', SUPER, { isApprover: true, deputyIds: new Set([99]) }).status, 403, 'deputy of requester/subject');
  assert.equal(L.check(req(), 'approve', { id: 50 }, { isApprover: false }).status, 403, 'not an approver');
  assert.equal(L.check(req(), 'approve', SUPER, { isApprover: true, deputyIds: new Set([7]) }), null);
});

test('revoke: the requester may withdraw an undecided request; only a super_admin ends an access', () => {
  assert.equal(L.check(req(), 'revoke', { id: 11 }, { isApprover: false }), null);
  assert.equal(L.check(req({ status: 'ACTIVE' }), 'revoke', { id: 11 }, { isApprover: false }).status, 403);
  assert.equal(L.check(req({ status: 'ACTIVE' }), 'revoke', SUPER, { isApprover: true }), null);
});

test('approval is bound to subject × roles × sites × dates, not to a template', () => {
  const r = req();
  const k = L.scopeKey(r);
  assert.equal(L.scopeKey({ ...r, roles: ['finance-viewer'], site_ids: [2] }), k, 'order-insensitive');
  assert.notEqual(L.scopeKey({ ...r, roles: ['finance-viewer', 'admin'] }), k);
  assert.notEqual(L.scopeKey({ ...r, valid_to: '2027-01-31' }), k);
  assert.equal(L.check({ ...r, status: 'APPROVED', approved_scope: k }, 'activate', null, { today: T }), null);
  assert.equal(L.check({ ...r, status: 'APPROVED', approved_scope: k, roles: ['admin'] }, 'activate', null, { today: T }).status, 409);
  assert.equal(L.check({ ...r, status: 'APPROVED', valid_from: '2026-12-01' }, 'activate', null, { today: T }).status, 409, 'not yet valid');
});

test('validateRequest: roles known, never super_admin, dates sane, justification, template bounds', () => {
  const ok = L.validateRequest({ subject_user_id: 3, roles: ['finance-viewer', 'finance-viewer'], valid_from: T, valid_to: '2026-12-01', justification: 'Monthly close needs it' }, { knownRoles: KNOWN, today: T });
  assert.deepEqual(ok.value.roles, ['finance-viewer']);
  const bad = (b, o = {}) => L.validateRequest({ subject_user_id: 3, roles: ['viewer'], valid_from: T, valid_to: '2026-12-01', justification: 'long enough text', ...b }, { knownRoles: KNOWN, today: T, ...o }).error;
  assert.ok(bad({ roles: ['super_admin'] }));
  assert.ok(bad({ roles: ['wizard'] }));
  assert.ok(bad({ valid_to: '2026-10-01', valid_from: '2026-09-01' }), 'past');
  assert.ok(bad({ justification: 'short' }));
  assert.ok(bad({ valid_to: '2028-12-01' }), 'longer than the cap');
  assert.ok(bad({ roles: ['admin'] }, { template: { roles: ['viewer'], max_days: 30 } }), 'role outside the template');
  assert.ok(bad({}, { template: { roles: ['viewer'], max_days: 10 } }), 'longer than template max_days');
  const tpl = L.validateRequest({ subject_user_id: 3, valid_from: T, valid_to: '2026-11-10', justification: 'from template ok' }, { knownRoles: KNOWN, today: T, template: { roles: ['viewer', 'editor'], max_days: 30 } });
  assert.deepEqual(tpl.value.roles, ['editor', 'viewer'], 'template roles by default');
});

test('validateTemplatePayload: known roles only, no super_admin, defaults', () => {
  assert.deepEqual(L.validateTemplatePayload({ roles: ['editor', 'tracker-editor'] }, { knownRoles: KNOWN }).value, { roles: ['editor', 'tracker-editor'], site_rule: 'primary', max_days: 180 });
  assert.ok(L.validateTemplatePayload({ roles: ['super_admin'] }, { knownRoles: KNOWN }).error);
  assert.ok(L.validateTemplatePayload({ roles: [] }, { knownRoles: KNOWN }).error);
});

test('planRemoval: a role leaves only when no other live grant nor an earlier direct source holds it', () => {
  const g = (o) => ({ role: null, site_id: null, held_before: false, valid_from: '2026-01-01', valid_to: '2026-12-31', ended_at: null, ...o });
  const ending = [g({ role: 'finance-viewer' }), g({ role: 'editor', held_before: true }), g({ site_id: 4 }), g({ role: 'audit-viewer' })];
  const others = [g({ role: 'audit-viewer' }), g({ site_id: 4, valid_to: '2026-01-31' })];
  assert.deepEqual(L.planRemoval(ending, others, T), { roles: ['finance-viewer'], sites: [4] });
});

test('rolesRequiringRequest follows the C-17 catalogue through the hierarchy', () => {
  assert.deepEqual(L.rolesRequiringRequest(['viewer', 'editor', 'finance-viewer', 'executive', 'admin', 'tracker-editor'], rdb.userHasRole), ['admin', 'executive', 'finance-viewer']);
});
