'use strict';
// C-19 (PO decision R7) — WHO may decide an access request. PURE. Default policy, editable through
// report_config `access_approver_policy` (JSON; an unreadable value falls back to this default).
//   • Platform roles (admin, executive, super_admin, tracker-admin, audit-viewer): a super_admin.
//   • Site-scoped roles (every other role): an admin-tier user who HOLDS every site the request names (or, if it
//     names none, every site of the subject); a super_admin may also decide them.
//   • Never the requester, the subject or a deputy of either — that part is services/sodPolicy.js (access.decide).
// Widens C-18's "super_admin only" rule: a super_admin can still decide everything.
const DEFAULT_POLICY = Object.freeze({
  platform_roles: Object.freeze(['admin', 'executive', 'super_admin', 'tracker-admin', 'audit-viewer']),
  platform_approver_role: 'super_admin',
  site_approver_role: 'admin',
  site_approver_must_hold_site: true,
});

function parsePolicy(raw) {
  let p = raw;
  if (typeof raw === 'string') { try { p = raw.trim() ? JSON.parse(raw) : {}; } catch (_) { p = {}; } }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
  const roles = Array.isArray(p.platform_roles) && p.platform_roles.length ? p.platform_roles.map(String) : DEFAULT_POLICY.platform_roles;
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  return { platform_roles: [...roles], platform_approver_role: str(p.platform_approver_role, DEFAULT_POLICY.platform_approver_role),
    site_approver_role: str(p.site_approver_role, DEFAULT_POLICY.site_approver_role),
    site_approver_must_hold_site: p.site_approver_must_hold_site === undefined ? true : !!p.site_approver_must_hold_site };
}

/**
 * May `actor` decide request `r` under `policy`? null = yes, else { status, code, error }.
 * @param {object} o { policy, hasRole(user, role), actorSiteIds: number[], subjectSiteIds: number[] }
 */
function approverCheck(r, actor, { policy = DEFAULT_POLICY, hasRole, actorSiteIds = [], subjectSiteIds = [] } = {}) {
  const deny = (error) => ({ status: 403, code: 'FORBIDDEN', error });
  if (!actor || typeof hasRole !== 'function') return deny('no approver');
  const p = parsePolicy(policy);
  if (hasRole(actor, p.platform_approver_role)) return null;
  const platform = (r.roles || []).filter((x) => p.platform_roles.includes(x));
  if (platform.length) return deny(`a platform role (${platform.join(', ')}) is approved only by a ${p.platform_approver_role}`);
  if (!hasRole(actor, p.site_approver_role)) return deny(`only an ${p.site_approver_role}-tier user holding the site may decide this request`);
  if (!p.site_approver_must_hold_site) return null;
  const sites = (r.site_ids && r.site_ids.length ? r.site_ids : subjectSiteIds).map(Number);
  if (!sites.length) return deny(`no site to scope this request — only a ${p.platform_approver_role} may decide it`);
  const mine = new Set((actorSiteIds || []).map(Number));
  const missing = sites.filter((s) => !mine.has(s));
  if (missing.length) return deny(`you do not hold site ${missing.join(', ')} — an admin-tier user of that site decides`);
  return null;
}

module.exports = { DEFAULT_POLICY, parsePolicy, approverCheck };
