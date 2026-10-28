'use strict';
// PostgreSQL-only server (user decision 2026-10-28: "all must be under PostgreSQL, no SQLite except for
// offline mode"). Transplanted from the 1.11 line (step 2) with the policy INVERTED: the server REFUSES TO
// START while any module is on sqlite, unless SDP_ALLOW_SQLITE=1 is set explicitly — reserved for the test
// suite and local development. Offline field capture runs in the browser (service worker + local queue),
// it never needed a server-side SQLite. Pure: reads an env object, no I/O.

const MODULES = { reports: 'REPORTS_BACKEND', tracker: 'TRACKER_BACKEND', meetings: 'MEETINGS_BACKEND',
  inspection: 'INSPECTION_BACKEND', assets: 'ASSETS_BACKEND' };

function backends(env = process.env) {
  const out = {};
  for (const [m, k] of Object.entries(MODULES)) out[m] = String(env[k] || '').trim().toLowerCase() === 'postgres' ? 'postgres' : 'sqlite';
  return out;
}

/** @returns {{ok:boolean, required:boolean, sqlite:string[], backends:object, message:string}} */
function check(env = process.env) {
  const b = backends(env);
  const sqlite = Object.keys(b).filter((m) => b[m] === 'sqlite');
  const required = String(env.SDP_ALLOW_SQLITE || '').trim() !== '1';
  const message = sqlite.length
    ? `module(s) on SQLite: ${sqlite.join(', ')} — set ${sqlite.map((m) => MODULES[m] + '=postgres').join(' ')} (SDP_ALLOW_SQLITE=1 only for tests/dev)`
    : 'all modules on PostgreSQL';
  return { ok: !sqlite.length || !required, required, sqlite, backends: b, message };
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
  if (!c.ok) { const e = new Error(`PostgreSQL required: ${c.message}`); e.code = 'SQLITE_NOT_ALLOWED'; throw e; }
  const k = checkConfigKey(env);
  if (!k.ok) { const e = new Error(`production mode but ${k.message} — secrets would be stored in clear`); e.code = 'CONFIG_KEY_REQUIRED'; throw e; }
  return { ...c, config_key: k };
}

module.exports = { backends, check, checkConfigKey, assertBootAllowed, MODULES };
