'use strict';
// Step 4 — Entra group → dashboard role / site provisioning. PURE.
//
// Config `sso_group_map` (Admin ▸ Microsoft SSO, or SSO_GROUP_MAP in .env) is a JSON array:
//   [{ "group": "<Entra group object id>", "roles": ["editor","tracker-editor"], "site_id": 3 },
//    { "group": "<id>", "roles": ["admin"] }]
// On each SSO login the user's `groups` claim is matched; the UNION of the matched roles
// replaces the stored roles and the first matched site_id (if any) becomes the primary site.
// No match = no change (pre-provisioned accounts keep what the admin set). A user whose
// roles would become EMPTY is also left untouched — a mapping mistake must not lock people out.
// super_admin is never granted through a group (break-glass stays a human decision).

const ROLE_ORDER = ['viewer', 'editor', 'admin', 'executive'];
const FEATURE_ROLES = new Set(['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'group-business']);

function parseGroupMap(raw) {
  if (!raw) return [];
  let arr; try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((e) => e && typeof e.group === 'string' && e.group.trim())
    .map((e) => ({ group: e.group.trim().toLowerCase(), roles: (Array.isArray(e.roles) ? e.roles : []).map(String).filter((r) => r !== 'super_admin'), site_id: Number.isInteger(Number(e.site_id)) && Number(e.site_id) > 0 ? Number(e.site_id) : null }));
}

/** Highest hierarchical role among a set (the `role` column), null when none. */
function primaryRole(roles) {
  let best = null;
  for (const r of roles) { const i = ROLE_ORDER.indexOf(r); if (i > ROLE_ORDER.indexOf(best)) best = r; }
  return best;
}

/**
 * @returns {{ changed:boolean, patch:object, matched:string[] }}
 */
function planProvisioning(user, groups, map) {
  const out = { changed: false, patch: {}, matched: [] };
  if (!user || !Array.isArray(map) || !map.length) return out;
  const have = new Set((groups || []).map((g) => String(g).toLowerCase()));
  const hits = map.filter((e) => have.has(e.group));
  if (!hits.length) return out;
  out.matched = hits.map((h) => h.group);
  const roles = [...new Set(hits.flatMap((h) => h.roles))].filter((r) => ROLE_ORDER.includes(r) || FEATURE_ROLES.has(r));
  const current = new Set(Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []));
  if (current.has('super_admin')) return out;                       // never touched by a map
  if (roles.length) {
    const same = roles.length === current.size && roles.every((r) => current.has(r));
    if (!same) { out.patch.roles = roles; out.patch.role = primaryRole(roles) || 'viewer'; out.changed = true; }
  }
  const site = hits.map((h) => h.site_id).find((x) => x != null);
  if (site != null && Number(user.site_id) !== site) { out.patch.site_id = site; out.changed = true; }
  return out;
}

module.exports = { parseGroupMap, planProvisioning, primaryRole, ROLE_ORDER, FEATURE_ROLES };
