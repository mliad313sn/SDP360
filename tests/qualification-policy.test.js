'use strict';
// C-19 (G41 · R10) — qualification evidence rules (pure) and the capability denial it adds when switched on.
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../services/qualificationPolicy');
const authz = require('../services/authorizationService');

const T = '2026-11-05';
const base = { user_id: 5, kind: 'site-induction', issuer: 'HSE Houndé', issued_on: '2026-01-10', expires_on: '2027-01-10', evidence_ref: 'IND-2026-114' };

test('R10 kinds and record validation (issuer + evidence reference required, sane dates)', () => {
  assert.deepEqual(Q.DEFAULT_KINDS, ['site-induction', 'electrical-authorisation', 'working-at-height', 'confined-space']);
  assert.ok(Q.validateRecord(base, { today: T }).value);
  assert.match(Q.validateRecord({ ...base, kind: 'forklift' }, { today: T }).error.error, /unknown qualification kind/);
  assert.match(Q.validateRecord({ ...base, issuer: '' }, { today: T }).error.error, /issuer/);
  assert.match(Q.validateRecord({ ...base, evidence_ref: '' }, { today: T }).error.error, /evidence_ref/);
  assert.match(Q.validateRecord({ ...base, expires_on: '2025-01-01' }, { today: T }).error.error, /before issued_on/);
  assert.match(Q.validateRecord({ ...base, issued_on: '2027-01-01', expires_on: null }, { today: T }).error.error, /future/);
});

test('verification: admin tier, never the holder nor the recorder nor their deputy; only a recorded record', () => {
  const q = { id: 1, user_id: 5, recorded_by: 6, status: 'recorded' };
  assert.equal(Q.verifyCheck(q, { id: 7 }, { isAdminTier: true }), null);
  assert.equal(Q.verifyCheck(q, { id: 7 }, { isAdminTier: false }).status, 403);
  assert.match(Q.verifyCheck(q, { id: 5 }, { isAdminTier: true }).error, /your own/);
  assert.match(Q.verifyCheck(q, { id: 6 }, { isAdminTier: true }).error, /recorded/);
  assert.match(Q.verifyCheck(q, { id: 7 }, { isAdminTier: true, deputyIds: new Set([7]) }).error, /deputy/);
  assert.equal(Q.verifyCheck({ ...q, status: 'verified' }, { id: 7 }, { isAdminTier: true }).status, 409);
});

test('evaluate: valid only when verified and not expired; reasons name the kinds', () => {
  const v = { kind: 'site-induction', status: 'verified', expires_on: '2027-01-01' };
  assert.equal(Q.evaluate(['site-induction'], [v], T).ok, true);
  const e = Q.evaluate(['site-induction', 'working-at-height'], [{ ...v, expires_on: '2026-01-01' }], T);
  assert.deepEqual([e.ok, e.expired, e.missing], [false, ['site-induction'], ['working-at-height']]);
  assert.match(e.reason, /missing working-at-height; expired site-induction/);
  assert.deepEqual(Q.evaluate(['site-induction'], [{ ...v, status: 'recorded' }], T).unverified, ['site-induction']);
  assert.equal(Q.evaluate(['site-induction'], [{ ...v, status: 'revoked' }], T).missing[0], 'site-induction');
});

test('requirementsFor: catalogue prereq ∪ editable config; capability denial only when enabled', () => {
  assert.deepEqual(Q.requirementsFor('field.capture', '{}'), [], 'today: no capability declares a qualification');
  assert.deepEqual(Q.requirementsFor('field.capture', '{"field.capture":["site-induction"]}'), ['site-induction']);
  assert.deepEqual(Q.requirementsFor('field.capture', 'garbage'), []);
  const user = { id: 5, roles: ['field-tech'] };
  const hasRole = (u, r) => (u.roles || []).includes(r);
  const ctx = (enabled, records) => ({ qualification: { enabled, required: ['site-induction'], records, today: T } });
  assert.equal(authz.can(user, 'field.capture', {}, hasRole).allow, true);
  assert.equal(authz.can(user, 'field.capture', ctx(false, []), hasRole).allow, true, 'switch off = today');
  const d = authz.can(user, 'field.capture', ctx(true, []), hasRole);
  assert.deepEqual([d.allow, d.reason_code], [false, 'qualification_missing']);
  assert.equal(authz.can(user, 'field.capture', ctx(true, [{ kind: 'site-induction', status: 'verified', expires_on: '2026-01-01' }]), hasRole).reason_code, 'qualification_expired');
});
