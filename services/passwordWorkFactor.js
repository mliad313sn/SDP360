'use strict';
// E-S05 — the PBKDF2 work factor (moved out of reports-db.js, monolith ratchet). The work factor is stored per hash
// (users.password_iterations, migration 077). NULL = 100000, the count every hash before that column was made with.
// The target for NEW hashes is report_config auth_pbkdf2_iterations (default '100000'); an invalid, lower or absurd
// value falls back to 100000 (never weakens a new hash). Bounds come from services/policyRanges (N-R7-1).
const PBKDF2_LEGACY = 100000;
const RANGE = require('./policyRanges').RANGES.auth_pbkdf2_iterations;

function pbkdf2Target(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= RANGE.min && n <= RANGE.max ? n : PBKDF2_LEGACY;
}
function storedIterations(user) {
  const n = Number(user && user.password_iterations);
  return Number.isInteger(n) && n > 0 ? n : PBKDF2_LEGACY;
}

module.exports = { PBKDF2_LEGACY, pbkdf2Target, storedIterations };
