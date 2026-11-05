'use strict';
// C-19 (R7) — who decides an access request: platform roles by a super_admin; site-scoped roles by an admin-tier
// user holding the site; the policy is editable JSON and an unreadable value falls back to the default.
const { test } = require('node:test');
const assert = require('node:assert');
const AP = require('../services/accessApproverPolicy');
const L = require('../services/accessRequestLifecycle');

const TIER = { super_admin: 4, executive: 3, admin: 2, editor: 1, viewer: 0 };
const hasRole = (u, role) => (u.roles || []).some((r) => r === role || (TIER[r] != null && TIER[role] != null && TIER[r] >= TIER[role]));
const SUPER = { id: 1, roles: ['super_admin'] }, SITEADMIN = { id: 2, roles: ['admin'], site_id: 7 }, OTHERADMIN = { id: 3, roles: ['admin'], site_id: 8 };
const req = (o = {}) => ({ id: 1, status: 'REQUESTED', subject_user_id: 10, requested_by: 11, roles: ['tracker-editor'], site_ids: [7], ...o });
const ap = (r, a, extra = {}) => AP.approverCheck(r, a, { hasRole, actorSiteIds: [a.site_id].filter(Boolean), subjectSiteIds: [7], ...extra });

test('site-scoped role: an admin-tier user holding the site decides; another site\'s admin does not', () => {
  assert.equal(ap(req(), SITEADMIN), null);
  assert.match(ap(req(), OTHERADMIN).error, /do not hold site 7/);
  assert.equal(ap(req({ site_ids: [] }), SITEADMIN), null, 'no site in the request → the subject\'s sites');
  assert.match(ap(req({ site_ids: [] }), SITEADMIN, { subjectSiteIds: [] }).error, /only a super_admin/);
  assert.match(ap(req(), { id: 4, roles: ['editor'], site_id: 7 }).error, /admin-tier/);
});

test('platform roles (admin, executive, super_admin, tracker-admin, audit-viewer) only by a super_admin', () => {
  for (const role of ['admin', 'executive', 'tracker-admin', 'audit-viewer']) {
    assert.match(ap(req({ roles: [role] }), SITEADMIN).error, /platform role/, role);
    assert.equal(ap(req({ roles: [role] }), SUPER), null, role);
  }
  assert.match(ap(req({ roles: ['editor', 'audit-viewer'] }), SITEADMIN).error, /audit-viewer/, 'mixed request → super_admin');
});

test('the policy is editable; garbage falls back to the default', () => {
  assert.deepEqual(AP.parsePolicy('{not json'), AP.parsePolicy(AP.DEFAULT_POLICY));
  const strict = JSON.stringify({ platform_roles: ['admin', 'tracker-editor'] });
  assert.match(ap(req(), SITEADMIN, { policy: strict }).error, /platform role/);
  assert.equal(ap(req(), OTHERADMIN, { policy: { site_approver_must_hold_site: false } }), null);
});

test('with the lifecycle: SoD first (never requester, subject or their deputy — even a super_admin)', () => {
  const r = req({ requested_by: 1 });
  assert.match(L.check(r, 'approve', SUPER, { isApprover: !ap(r, SUPER) }).error, /you filed/);
  const e = ap(req(), OTHERADMIN);
  assert.match(L.check(req(), 'approve', OTHERADMIN, { isApprover: !e, approverError: e }).error, /do not hold site/);
  assert.equal(L.check(req(), 'approve', SITEADMIN, { isApprover: !ap(req(), SITEADMIN), deputyIds: new Set([99]) }), null);
  assert.equal(L.check(req(), 'approve', SITEADMIN, { isApprover: true, deputyIds: new Set([2]) }).status, 403, 'deputy');
});
