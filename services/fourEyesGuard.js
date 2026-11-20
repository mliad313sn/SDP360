'use strict';
// N-R5-1 (P11 round 5) — while the Policy Center is on (report_config policy_center_enabled = '1'), a four-eyes rule
// (docs/ops/policy-catalogue.json four_eyes: true, source report_config) changes only through the center's request flow
// (routes/policyCenter.js, a second super_admin approves). Fix 14 (N-R4-1) closed the legacy PUT /api/reports/config;
// round 5 found a third door (PUT /api/teams-sla/settings armed teams_sla_enabled alone). This module is the ONE rule
// every route that writes report_config goes through: guardedSetConfig() refuses (typed 409 CONFLICT, pointing to the
// Policy Center) when a four-eyes key would change in a direction that needs a second person
// (services/policyCatalogue.needsSecondPerson — a move TOWARDS the catalogue's strict value stays immediate, like in
// the center itself). Center off → nothing changes (today's behaviour).
// tests/four-eyes-guard.test.js lists every setConfig caller under routes/ and services/: only this module,
// services/reportConfig.js and routes/policyCenter.js (the request flow itself) may call reportConfig.setConfig.
const { typed } = require('./httpError');

const str = (v) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Four-eyes keys of `patch` that a single person may not change now.
 * @param {object} cur    current config (reportConfig.getConfig)
 * @param {object} patch  keys about to be written
 * @param {{anyChange?:boolean}} [o]  anyChange: refuse any value change, even towards strict (the legacy generic PUT)
 * @returns {string[]}
 */
function blockedKeys(cur, patch, o = {}) {
  if (!cur || String(cur.policy_center_enabled) !== '1' || !patch || typeof patch !== 'object') return [];
  const PC = require('./policyCatalogue');
  const by = PC.build().by;
  return Object.keys(patch).filter((k) => {
    const e = by.get(k);
    if (!e || e.source !== 'report_config' || !e.four_eyes) return false;
    // N-R6-1 — compare the value setConfig will actually STORE (reportConfig.canonicalValue, which also refuses a
    // non-switch value for a switch with a 400), not a guard-local normalisation that the store did not share.
    const next = require('./reportConfig').canonicalValue(k, patch[k]), now = str(cur[k]);
    if (next === now) return false;
    return o.anyChange ? true : PC.needsSecondPerson(e, now, next);
  });
}

function refusal(keys) {
  const many = keys.length > 1;
  const e = typed('CONFLICT', `four-eyes rule${many ? 's' : ''} ${keys.join(', ')}: the Policy Center is on — change ${many ? 'them' : 'it'} through PUT /api/policy-center/rules/<key> (a second super_admin approves when needed)`, 409);
  e.four_eyes_keys = keys;
  return e;
}

/** Throws the typed 409 when a four-eyes key would change alone; returns nothing otherwise. */
async function assertFourEyesFree(db, patch, o = {}) {
  const RC = require('./reportConfig');
  const cur = o.current || await RC.getConfig(db);
  const keys = blockedKeys(cur, patch, o);
  if (keys.length) throw refusal(keys);
}

/** reportConfig.setConfig behind the four-eyes guard — the only config writer routes may use. */
async function guardedSetConfig(db, patch, user, o = {}) {
  await assertFourEyesFree(db, patch, o);
  return require('./reportConfig').setConfig(db, patch, user);
}

module.exports = { blockedKeys, refusal, assertFourEyesFree, guardedSetConfig };
