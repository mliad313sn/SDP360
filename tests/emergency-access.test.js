'use strict';
// C-22 (G49 · R7) — pure emergency-access rules: 24 h hard cap, never to oneself, review due in 2 working days
// by another super_admin, overdue flag.
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../services/emergencyAccess');

const NOW = '2026-11-06T10:00:00.000Z';   // a Friday
const ctx = (o = {}) => ({ granter: { id: 1 }, isSuper: true, deputyIds: new Set(), knownRoles: ['admin', 'editor', 'field-tech', 'super_admin'], now: NOW, maxHours: '24', ...o });
const body = (o = {}) => ({ subject_user_id: 2, roles: ['field-tech'], site_ids: [3], hours: 8, reason: 'night outage at the plant', ...o });

test('24 h is a hard cap: more is refused, the policy may only lower it', () => {
  assert.match(E.validateGrant(body({ hours: 25 }), ctx()).error.error, /at most 24 h/);
  assert.match(E.validateGrant(body({ hours: 24.5 }), ctx()).error.error, /at most 24 h/);
  assert.match(E.validateGrant(body({ hours: 30 }), ctx({ maxHours: '72' })).error.error, /at most 24 h/, 'a policy above 24 is read as 24');
  assert.match(E.validateGrant(body({ hours: 10 }), ctx({ maxHours: '8' })).error.error, /at most 8 h/);
  const ok = E.validateGrant(body({ hours: 24 }), ctx()).value;
  assert.equal(Date.parse(ok.expires_at) - Date.parse(ok.starts_at), 24 * 3600e3);
  assert.equal(E.validateGrant(body({ hours: undefined }), ctx()).value.expires_at, '2026-11-07T10:00:00.000Z', 'default = the cap');
  assert.equal(E.maxHours('abc'), 24); assert.equal(E.maxHours(0), 24); assert.equal(E.maxHours(100), 24);
});

test('only a super_admin, never to oneself, never by a deputy of the beneficiary; reason and target required', () => {
  assert.equal(E.validateGrant(body(), ctx({ isSuper: false })).error.status, 403);
  assert.match(E.validateGrant(body({ subject_user_id: 1 }), ctx()).error.error, /themselves/);
  assert.match(E.validateGrant(body(), ctx({ deputyIds: new Set([1]) })).error.error, /deputy/);
  assert.match(E.validateGrant(body({ reason: 'short' }), ctx()).error.error, /reason/);
  assert.match(E.validateGrant(body({ roles: [], site_ids: [] }), ctx()).error.error, /at least one role or one site/);
  assert.match(E.validateGrant(body({ roles: ['super_admin'] }), ctx()).error.error, /never granted/);
  assert.match(E.validateGrant(body({ roles: ['nope'] }), ctx()).error.error, /unknown role/);
});

test('review due = 2 working days (Mon–Fri) after the grant', () => {
  assert.equal(E.addWorkingDays('2026-11-06T10:00:00Z'), '2026-11-10', 'Friday → Tuesday');
  assert.equal(E.addWorkingDays('2026-11-07T23:00:00Z'), '2026-11-10', 'Saturday → Tuesday');
  assert.equal(E.addWorkingDays('2026-11-09T01:00:00Z'), '2026-11-11', 'Monday → Wednesday');
  assert.equal(E.validateGrant(body(), ctx()).value.review_due, '2026-11-10');
});

test('review: a super_admin other than the granter and the beneficiary, with an outcome and notes; overdue flag', () => {
  const e = { id: 9, granted_by: 1, subject_user_id: 2, review_due: '2026-11-10', reviewed_at: null, expires_at: '2026-11-06T18:00:00Z', ended_at: null };
  const ok = { isSuper: true, outcome: 'justified', notes: 'outage confirmed by the site lead' };
  assert.match(E.reviewCheck(e, { id: 1 }, ok).error, /granted the emergency access/);
  assert.match(E.reviewCheck(e, { id: 2 }, ok).error, /beneficiary/);
  assert.equal(E.reviewCheck(e, { id: 3 }, { ...ok, isSuper: false }).status, 403);
  assert.match(E.reviewCheck(e, { id: 3 }, { ...ok, outcome: 'fine' }).error, /outcome/);
  assert.match(E.reviewCheck(e, { id: 3 }, { ...ok, notes: 'ok' }).error, /notes/);
  assert.equal(E.reviewCheck(e, { id: 3 }, ok), null);
  assert.equal(E.reviewCheck({ ...e, reviewed_at: 'x' }, { id: 3 }, ok).status, 409);
  assert.equal(E.isOverdue(e, '2026-11-10T23:59:00Z'), false, 'due day itself is not overdue');
  assert.equal(E.isOverdue(e, '2026-11-11T00:01:00Z'), true);
  assert.equal(E.isOverdue({ ...e, reviewed_at: 'x' }, '2026-12-01T00:00:00Z'), false);
  assert.equal(E.isLive(e, '2026-11-06T17:00:00Z'), true);
  assert.equal(E.isLive(e, '2026-11-06T18:00:01Z'), false);
});
