'use strict';
// PostgreSQL is the ONLY database (PO-08, 2026-10-28 — SQLite removed from the code base).
// The server refuses to start without a PostgreSQL connection string. Offline field capture
// runs in the browser (service worker + local queue); it never needed a server-side SQLite.
// Pure: reads an env object, no I/O.

function pgUrl(env = process.env) { return String(env.PG_URL || env.DATABASE_URL || '').trim(); }

/** @returns {{ok:boolean, url_set:boolean, message:string}} */
function check(env = process.env) {
  const set = !!pgUrl(env);
  return { ok: set, url_set: set, message: set ? 'PostgreSQL connection configured' : 'PG_URL (or DATABASE_URL) is not set — PostgreSQL is the only supported database' };
}

// The secrets key (SDP_CONFIG_KEY) is mandatory when the operator declares production explicitly
// (REQUIRE_CONFIG_KEY=1 or REQUIRE_POSTGRES=1), as on the 1.11 line.
const MIN_KEY_CHARS = 16;
function checkConfigKey(env = process.env) {
  const required = String(env.REQUIRE_CONFIG_KEY || '').trim() === '1' || String(env.REQUIRE_POSTGRES || '').trim() === '1';
  const set = String(env.SDP_CONFIG_KEY || '').length >= MIN_KEY_CHARS;
  return { ok: set || !required, required, set, message: set ? 'secrets key set' : `SDP_CONFIG_KEY missing or shorter than ${MIN_KEY_CHARS} characters` };
}

/** Throws when the requirements are not met; otherwise returns check() + config_key. */
function assertBootAllowed(env = process.env) {
  const c = check(env);
  if (!c.ok) { const e = new Error(c.message); e.code = 'PG_URL_REQUIRED'; throw e; }
  const k = checkConfigKey(env);
  if (!k.ok) { const e = new Error(`production mode but ${k.message} — secrets would be stored in clear`); e.code = 'CONFIG_KEY_REQUIRED'; throw e; }
  return { ...c, config_key: k };
}

module.exports = { pgUrl, check, checkConfigKey, assertBootAllowed };
