'use strict';
// P06 — authorisation helpers that used to be closures inside server.js, now NAMED and catalogued so
// P02 (authorisation outcome assurance) and the authz matrix can see them. Behaviour is byte-identical to
// the inline versions they replace: same role test (reports-db.userHasRole, hierarchy-aware), same 403 body.
//   requireMoneyRead        — route guard: admin tier OR finance-viewer (capability finance.read)
//   canReadMoney(user)      — the same rule as a predicate (money stripping inside handlers)
//   requireSuperAdminInline — checked inside a handler: super_admin, else 403 { error: 'super_admin only' }
//                             (capability platform.override); returns false when it has answered.
// Each is listed in services/capabilityRegistry.NAMED_GUARDS (tests/p06-named-guards.test.js).

const _hasRole = (user, role) => require('../reports-db').userHasRole(user, role);

function canReadMoney(user) {
  return _hasRole(user, 'admin') || _hasRole(user, 'finance-viewer');
}

function requireMoneyRead(req, res, next) {
  if (canReadMoney(req.reportUser)) return next();
  return res.status(403).json({ error: 'Forbidden — required role(s): admin or finance-viewer' });
}
// C-17 — the role set this guard enforces (capabilityRegistry maps it onto finance.read).
Object.assign(requireMoneyRead, { legacyRoles: ['admin', 'finance-viewer'] });

function requireSuperAdminInline(req, res) {
  if (!_hasRole(req.reportUser, 'super_admin')) {
    res.status(403).json({ error: 'super_admin only' });
    return false;
  }
  return true;
}
Object.assign(requireSuperAdminInline, { legacyRoles: ['super_admin'], inline: true });

module.exports = { canReadMoney, requireMoneyRead, requireSuperAdminInline };
