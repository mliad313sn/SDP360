'use strict';
// Site Awareness — resolve a canonical site_id to each module's own code, and list the sites a
// business user may view. PURE: readers injected, no DB. A missing code stays NULL (never guessed
// — a wrong code false-greens a site; the tab reads "non applicable"). CLAUDE.md null≠0 rule.
// site_module_codes only carries 'meetings' (+ meraki/opmanager); inspection/tracker codes come
// from those modules' own name→code maps, injected as inspectionSiteCode/trackerSiteCode.

function resolveSite(deps, site_id) {
  const sid = Number(site_id);
  const sites = (deps.listSites && deps.listSites({ includeInactive: true })) || [];
  const site = sites.find((s) => Number(s.id) === sid) || null;
  if (!site) return null;
  const codeIn = (module) => {
    const rows = (deps.listSiteModuleCodes && deps.listSiteModuleCodes(module)) || [];
    const hit = rows.find((r) => Number(r.site_id) === sid);
    return hit ? hit.code : null;
  };
  return {
    site_id: sid,
    site_name: site.name || null,
    helpdesk_group: (String(site.zoho_group || '').trim() || null),
    meetings_code: codeIn('meetings'),
    inspection_code: codeIn('inspection') || (deps.inspectionSiteCode ? deps.inspectionSiteCode(site.name) : null) || null,
    tracker_code: codeIn('tracker') || (deps.trackerSiteCode ? deps.trackerSiteCode(site.name) : null) || null,
  };
}

function listAuthorizedSites(deps, user) {
  const all = ((deps.listSites && deps.listSites({ includeInactive: false })) || [])
    .map((s) => ({ site_id: Number(s.id), site_name: s.name || null }));
  const has = (r) => deps.userHasRole && deps.userHasRole(user, r);
  if (has('group-business') || has('executive') || has('super_admin')) return all;
  const sid = user && user.site_id != null ? Number(user.site_id) : null;
  return sid == null ? [] : all.filter((s) => s.site_id === sid);
}

module.exports = { resolveSite, listAuthorizedSites };
