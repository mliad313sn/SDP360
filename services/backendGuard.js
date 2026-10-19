'use strict';
// Step 2 (SDP-DASH-2.0) — "zero SQLite in production". Each module picks its backend from
// <MODULE>_BACKEND (default sqlite, kept for the unit tests and dev). In production the operator
// sets REQUIRE_POSTGRES=1: the server then REFUSES TO START while any module is still on sqlite,
// instead of silently writing to a frozen archive. Without the flag it only warns.
// Pure: reads an env object, no I/O.

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
  const sqlite = Object.keys(b).filter(m => b[m] === 'sqlite');
  const required = String(env.REQUIRE_POSTGRES || '').trim() === '1';
  const message = sqlite.length
    ? `module(s) still on SQLite: ${sqlite.join(', ')} — set ${sqlite.map(m => MODULES[m] + '=postgres').join(' ')}`
    : 'all modules on PostgreSQL';
  return { ok: !sqlite.length || !required, required, sqlite, backends: b, message };
}

// Step 4 (SDP-DASH-2.0) — the secrets key is MANDATORY in production. Production is declared by
// REQUIRE_POSTGRES=1 (step 2) or REQUIRE_CONFIG_KEY=1. Without a usable SDP_CONFIG_KEY the stored
// secrets (SMTP, Meraki, OpManager, SSO, Teams webhooks…) would sit in clear in every dump.
const MIN_KEY_CHARS = 16;
function checkConfigKey(env = process.env) {
  const required = String(env.REQUIRE_CONFIG_KEY || '').trim() === '1' || String(env.REQUIRE_POSTGRES || '').trim() === '1';
  const set = String(env.SDP_CONFIG_KEY || '').length >= MIN_KEY_CHARS;
  return { ok: set || !required, required, set,
    message: set ? 'secrets key set' : `SDP_CONFIG_KEY missing or shorter than ${MIN_KEY_CHARS} characters` };
}

/** Throws when production requirements are not met; otherwise returns check() + config_key. */
function assertBootAllowed(env = process.env) {
  const c = check(env);
  if (!c.ok) {
    const e = new Error(`REQUIRE_POSTGRES=1 but ${c.message}`);
    e.code = 'SQLITE_IN_PRODUCTION';
    throw e;
  }
  const k = checkConfigKey(env);
  if (!k.ok) {
    const e = new Error(`production mode but ${k.message} — secrets would be stored in clear`);
    e.code = 'CONFIG_KEY_REQUIRED';
    throw e;
  }
  return { ...c, config_key: k };
}

module.exports = { backends, check, checkConfigKey, assertBootAllowed, MODULES };
