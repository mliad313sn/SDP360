'use strict';
// Step 4 (SDP-DASH-2.0) — Entra ID groups → dashboard roles and sites. PURE.
//
// The map lives in report_config `sso_group_map` (JSON list, super_admin), e.g.
//   [{ "group": "<object id>", "label": "IT Coordinators Hounde", "roles": ["editor","tracker-editor"], "site_id": 3 }]
// With `sso_group_sync` = '1', every Microsoft sign-in RECOMPUTES the account's roles and sites
// from its groups (union of the matching rows); an account in NONE of the mapped groups is
// refused (that is how "removed from the group" becomes "no access"). With sync off (default)
// nothing changes: roles stay managed in Admin ▸ Users.
//
// The groups come from the id_token `groups` claim (app registration: Token configuration ▸
// groups claim, "Groups assigned to the application" to avoid the 200-group overage). An
// overage (`_claim_names.groups`) gives no list: the sign-in is refused rather than guessed.

const HIERARCHY = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const FEATURE = ['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer', 'site-business', 'group-business'];
const KNOWN = new Set([...HIERARCHY, ...FEATURE]);

/** JSON text → validated rows; invalid rows are reported, never silently used. */
function parseGroupMap(text) {
  const errors = [], rows = [];
  let raw;
  try { raw = text ? JSON.parse(text) : []; } catch (e) { return { rows: [], errors: ['not valid JSON: ' + e.message] }; }
  if (!Array.isArray(raw)) return { rows: [], errors: ['the map must be a JSON list'] };
  raw.forEach((r, i) => {
    const group = r && String(r.group || '').trim();
    const roles = Array.isArray(r && r.roles) ? r.roles.map(String) : [];
    const bad = roles.filter(x => !KNOWN.has(x));
    if (!group) errors.push(`row ${i + 1}: missing group id`);
    else if (!roles.length) errors.push(`row ${i + 1}: no role`);
    else if (bad.length) errors.push(`row ${i + 1}: unknown role(s) ${bad.join(', ')}`);
    else if (roles.includes('super_admin')) errors.push(`row ${i + 1}: super_admin cannot be granted by a group (keep it a named, manual grant)`);
    else rows.push({ group: group.toLowerCase(), label: r.label ? String(r.label) : '', roles,
      site_id: r.site_id == null || r.site_id === '' ? null : Number(r.site_id) });
  });
  return { rows, errors };
}

/**
 * groups (object ids from the token) + map rows → {matched, roles, site_id, extra_site_ids}.
 * Roles = union; sites = in map order, the first is the primary.
 */
function resolveAccess(groups, rows) {
  const mine = new Set((groups || []).map(g => String(g).toLowerCase()));
  const hit = (rows || []).filter(r => mine.has(r.group));
  if (!hit.length) return { matched: false, roles: [], site_id: null, extra_site_ids: [], groups: [] };
  const roles = [...new Set(hit.flatMap(r => r.roles))];
  const sites = [...new Set(hit.map(r => r.site_id).filter(s => s != null))];
  return { matched: true, roles, site_id: sites[0] ?? null, extra_site_ids: sites.slice(1), groups: hit.map(r => r.label || r.group) };
}

/** Decision for a sign-in: {action:'skip'|'apply'|'deny', access?, reason?}. */
function decide({ enabled, claims, mapText }) {
  if (!enabled) return { action: 'skip' };
  const { rows, errors } = parseGroupMap(mapText);
  if (errors.length || !rows.length) return { action: 'deny', reason: 'group_map_invalid' };
  if (claims && claims.groups_overage) return { action: 'deny', reason: 'groups_overage' };
  const access = resolveAccess(claims && claims.groups, rows);
  if (!access.matched) return { action: 'deny', reason: 'not_in_group' };
  return { action: 'apply', access };
}

module.exports = { parseGroupMap, resolveAccess, decide, KNOWN };
