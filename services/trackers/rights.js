'use strict';
// Step 7 / 10 — who reads and who types in a business tracker, decided from the published definition and the person's
// rights. Shared by routes/trackers.js and the field app (routes/field.js).
const userSites = require('../userSites');

/** Units this person may READ: every unit, unless the tracker is "for one site" and the person is not a group reader. */
function readableUnits(user, definition, { has, canReadGroup }) {
  if (definition.audience.site_scope !== 'own' || canReadGroup(user)) return definition.units;
  return definition.units.filter(x => x.site_id && userSites.hasSite(user, x.site_id));
}

/** Units this person may TYPE into (empty during a parallel run or without an entry role). */
function writableUnits(user, definition, { has }) {
  if (definition.legacy_mirror) return [];
  const anyUnit = has(user, 'super_admin') || has(user, 'tracker-publisher');
  if (!anyUnit && !definition.entry.roles.some(r => has(user, r))) return [];
  if (anyUnit || !definition.entry.own_unit_only) return definition.units;
  return definition.units.filter(x => x.site_id && userSites.hasSite(user, x.site_id));
}

module.exports = { readableUnits, writableUnits };
