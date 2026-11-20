'use strict';
// P11 round 3 N-R3-3 — the monthly / yearly / objectives / weekly-summary report routes in server.js read their
// period straight from the path (parseInt → NaN, new Date(NaN).toISOString() → "Invalid time value", or 'NaN'
// reaching PostgreSQL as an integer → 22P02), so a malformed URL answered 500. `check` is a route middleware placed
// AFTER the session / role middlewares (an unauthorised caller still gets 401 / 403): a malformed value of any of
// the four parameter names is a client error, 400, before any database call.
const { fail, typed } = require('./httpError');

const RULES = {
  site_id: { re: /^[1-9]\d{0,9}$/, what: 'site id (positive integer)' },
  year: { re: /^\d{4}$/, min: 1900, max: 2999, what: 'year (YYYY)' },
  month: { re: /^\d{1,2}$/, min: 1, max: 12, what: 'month (1-12)' },
  week: { re: /^\d{1,2}$/, min: 1, max: 53, what: 'ISO week (1-53)' },
};

/** Pure: null when the value is valid for that parameter, else the refusal text. */
function paramError(name, value) {
  const r = RULES[name]; if (!r) return null;
  const v = String(value == null ? '' : value);
  if (!r.re.test(v)) return `invalid ${r.what}`;
  const n = Number(v);
  if ((r.min != null && n < r.min) || (r.max != null && n > r.max)) return `invalid ${r.what}`;
  return null;
}

function check(req, res, next) {
  for (const [name, value] of Object.entries(req.params || {})) {
    const err = paramError(name, value);
    if (err) return fail(res, typed('VALIDATION', err, 400));
  }
  return next();
}

module.exports = { check, paramError, RULES };
