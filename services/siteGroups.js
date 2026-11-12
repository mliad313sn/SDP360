'use strict';
// The caller's Zoho helpdesk groups (lowercased), or null for the admin tier (all groups).
// A site-less non-admin gets [] — no group at all. A multi-site editor gets the union.
// Extracted from server.js (A8): the survey routes need the same perimeter as helpdesk-live / helpdesk-charts.
const userSites = require('./userSites');

async function userSiteGroups(rdb, user) {
  if (rdb.userHasRole(user, 'admin')) return null;
  const ids = userSites.siteIds(user);
  if (!ids.length) return [];
  const all = (await rdb.listSites()) || [];
  const out = [];
  for (const s of all.filter(x => ids.includes(Number(x.id)))) {
    for (const g of String(s.zoho_group || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) if (!out.includes(g)) out.push(g);
  }
  return out;
}

module.exports = { userSiteGroups };
