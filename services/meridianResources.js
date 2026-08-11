'use strict';
// F1 — Pure: SDP sites (listSiteModuleCodes('meetings') rows {site_id,code,name}) +
// people (listPeople rows {id,full_name,role,site_code,active}) → the C1 resource-sync
// payload. Person id = "SDP-U<userId>" (stable). pmo.site.id = the meetings module code
// (satisfies Meridian's ^[A-Z0-9_-]{2,16}$ CHECK). Sites emitted first; a person whose
// site_code isn't in the synced site set is dropped (Meridian person→site FK is RESTRICT).
function buildResourcePayload({ sites = [], people = [] } = {}) {
  const siteRows = sites.map(s => ({ id: s.code, name: s.name || s.code, country: null, region: null }));
  const known = new Set(siteRows.map(s => s.id));
  let skipped = 0;
  const peopleRows = [];
  for (const u of people) {
    if (!known.has(u.site_code)) { skipped++; continue; }
    peopleRows.push({
      id: `SDP-U${u.id}`,
      name: u.full_name || String(u.id),
      role: u.role || 'staff',
      site_id: u.site_code,
      active: u.active !== false,   // absent or true → true; only explicit false → false
    });
  }
  return { sites: siteRows, people: peopleRows, _skipped_unknown_site: skipped };
}

module.exports = { buildResourcePayload };
