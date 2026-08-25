'use strict';
// Site Awareness — resolve a canonical site_id to each module's own code, and list the sites a
// business user may view. PURE: readers injected, no DB. A missing code stays NULL (never guessed
// — a wrong code false-greens a site; the tab reads "non applicable"). CLAUDE.md null≠0 rule.
// site_module_codes only carries 'meetings' (+ meraki/opmanager); inspection/tracker codes come
// from those modules' own name→code maps, injected as inspectionSiteCode/trackerSiteCode.

// A module's siteNameToCode SITE_MAP keys inconsistently — some UPPERCASE ('LAFIGUE'→SML), some
// mixed ('Sabodala'→SGO), and EVERY site by its zoho_group ('Lafigue IT Agents'→SML). reports.db
// sites.name is mixed-case ('Lafigue'), which the tracker's exact-match lookup misses. So try the
// name, its UPPERCASE, and each zoho_group token — first non-null wins. A wrong code false-greens
// a site, so we only accept a real hit; still null → the tab reads "non applicable".
function _codeFromName(fn, site) {
  if (typeof fn !== 'function' || !site) return null;
  const cands = [];
  if (site.name) { cands.push(site.name); cands.push(String(site.name).toUpperCase()); }
  if (site.zoho_group) String(site.zoho_group).split(',').forEach((g) => { const t = g.trim(); if (t) cands.push(t); });
  for (const c of cands) { try { const v = fn(c); if (v) return v; } catch (_) {} }
  return null;
}

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
    meetings_code: codeIn('meetings') || _codeFromName(deps.meetingsSiteCode, site),
    inspection_code: codeIn('inspection') || _codeFromName(deps.inspectionSiteCode, site),
    tracker_code: codeIn('tracker') || _codeFromName(deps.trackerSiteCode, site),
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
