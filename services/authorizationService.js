'use strict';
// C-17 (G42 / A01) — the single capability evaluator. `can(user, capId, ctx)` → {allow, reason_code, needed}.
//
// Today it reproduces the legacy role guards EXACTLY (zero escalation, proven per route and per role
// set by tests/capability-registry.test.js): a capability is allowed iff the user holds ANY of its
// `legacy` roles through reports-db.userHasRole (hierarchy implied). It only ever ADDS denials:
//   • unknown capability            → deny `unknown_capability` (never a silent allow)
//   • no session / no roles         → deny `no_session` / `missing_role`
//   • ctx.siteId on a `site` capability outside the caller's sites (admin tier exempt) → `site_out_of_scope`
// Grants with expiry, qualifications and SoD (C-18/C-19) will plug in here as further denials.
const registry = require('./capabilityRegistry');
const userSites = require('./userSites');

function _hasRole(user, role) { return require('../reports-db').userHasRole(user, role); }

function can(user, capId, ctx = {}, hasRole = _hasRole) {
  const cap = registry.get(capId);
  if (!cap) return { allow: false, reason_code: 'unknown_capability', needed: null, capability: null };
  const needed = [...cap.legacy];
  if (!user || typeof user !== 'object') return { allow: false, reason_code: 'no_session', needed, capability: cap.id };
  if (!cap.legacy.some((r) => hasRole(user, r))) return { allow: false, reason_code: 'missing_role', needed, capability: cap.id };
  if (cap.scope === 'site' && ctx.siteId != null && !hasRole(user, 'admin') && !userSites.hasSite(user, ctx.siteId)) {
    return { allow: false, reason_code: 'site_out_of_scope', needed, capability: cap.id };
  }
  return { allow: true, reason_code: 'granted_by_role', needed, capability: cap.id };
}

/** Capability ids the user holds today (no ctx: site narrowing is per object). */
function effectiveCaps(user, hasRole = _hasRole) {
  return registry.list().filter((c) => can(user, c.id, {}, hasRole).allow).map((c) => c.id);
}

/** The "why" answer for the no-access page: by capability id, or by the role set a page gate needed. */
function why(user, { cap, need } = {}, hasRole = _hasRole) {
  let c = cap ? registry.get(cap) : null;
  if (!c && !cap && Array.isArray(need) && need.length) c = registry.byRoles(need).find((x) => !x.inline) || null;
  if (!c) return { allow: false, reason_code: 'unknown_capability', needed: need && need.length ? need : null, capability: null };
  const d = can(user, c.id, {}, hasRole);
  return { ...d, capability: { id: c.id, en: c.en, fr: c.fr, risk: c.risk, scope: c.scope } };
}

module.exports = { can, effectiveCaps, why };
