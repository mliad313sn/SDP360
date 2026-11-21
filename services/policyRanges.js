'use strict';
// N-R7-1 (P11 round 7) — the ONE table of accepted ranges for the numeric four-eyes report_config keys whose reader
// clamps or discards a value outside a range. Before this table the Policy Center decided "stricter or weaker" with
// Number(next) alone while each reader had its own private bounds: one super_admin could store
// auth_pbkdf2_iterations = 10000000 ("higher = stricter", applied at once) and the reader silently fell back to
// 100000; auth_account_throttle_max = 0 ("lower = stricter") read back as 10. The readers, the write path
// (services/reportConfig.canonicalValue → 400 before the four-eyes check, services/policyCatalogue.validateConfigValue)
// and the catalogue (docs/ops/policy-catalogue.json min / max / integer, checked equal by
// tools/agent/policy-catalogue.js and tests/p11-r7-security.smoke.test.js) all read their bounds HERE, so they cannot
// drift. No dependency on purpose: readers in services/ and reports-db.js require it without a cycle.
//
// Each row: { min, max, integer, reader } — `reader` names the function that applies the bounds (for the reviewer).
// Changing a bound is a code change reviewed like any other: it changes what a reader accepts.
const RANGES = Object.freeze({
  auth_pbkdf2_iterations:           Object.freeze({ min: 100000, max: 5000000, integer: true, reader: 'reports-db.js _pbkdf2Target' }),
  auth_account_throttle_max:        Object.freeze({ min: 1, max: 1000, integer: true, reader: 'services/accountThrottle.js settings' }),
  auth_account_throttle_window_min: Object.freeze({ min: 1, max: 1440, integer: true, reader: 'services/accountThrottle.js settings' }),
  breakglass_session_minutes:       Object.freeze({ min: 5, max: 1440, integer: true, reader: 'services/breakglassGuard.js minutesFrom' }),
  emergency_access_max_hours:       Object.freeze({ min: 1, max: 24, integer: true, reader: 'services/emergencyAccess.js maxHours' }),
});

/** The range row of `key`, or null. */
const rangeOf = (key) => RANGES[key] || null;

/** Why `raw` is outside the range of `key` (a message), or null when it is accepted (or the key has no range). */
function rangeProblem(key, raw) {
  const r = rangeOf(key);
  if (!r) return null;
  const s = String(raw == null ? '' : raw).trim();
  const n = Number(s);
  const plain = /^[+-]?\d+$/.test(s) || /^[+-]?\d+\.\d+$/.test(s);   // no exponent, no hex, no blanks inside
  if (s === '' || !plain || !Number.isFinite(n)) return `a plain number between ${r.min} and ${r.max} is expected`;
  if (r.integer && !Number.isInteger(n)) return `a whole number between ${r.min} and ${r.max} is expected`;
  if (n < r.min) return `minimum ${r.min}`;
  if (n > r.max) return `maximum ${r.max}`;
  return null;
}

module.exports = { RANGES, rangeOf, rangeProblem };
