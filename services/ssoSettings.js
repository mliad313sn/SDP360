'use strict';
// F2a — resolve Entra SSO settings at REQUEST TIME from report_config (DB) with
// process.env fallback and hardcoded defaults, so admin config-page changes take
// effect without a restart. Cached briefly; invalidate() clears it (called after a
// config save). getConfig(db) is dual-backend (sync sqlite / Promise pg), so this
// is async. Deps are injectable for tests.
const reportConfig = require('./reportConfig');

const DEFAULT_REDIRECT = 'https://itops-dashboard.edv-ops.com/api/auth/sso/callback';
const TTL_MS = 60000;
let _cache = null, _at = 0;

// First non-empty of DB value, env value, default.
function _pick(dbVal, envVal, def) {
  const d = (dbVal == null ? '' : String(dbVal)).trim();
  if (d) return d;
  const e = (envVal == null ? '' : String(envVal)).trim();
  if (e) return e;
  return def;
}

function _invalidate() { _cache = null; _at = 0; }

async function resolveSsoSettings(db, deps = {}) {
  const env = deps.env || process.env;
  const getConfig = deps.getConfig || ((d) => reportConfig.getConfig(d));
  const now = deps.now ? deps.now() : Date.now();
  if (_cache && (now - _at) < TTL_MS) return _cache;

  // pg getConfig has no try/catch (reportConfig.js) and can reject; /api/auth/config
  // is hit on every login-page load. Degrade to env/defaults on failure — this also
  // reinforces the "env still wins" safety property.
  let c = {};
  try { c = (await getConfig(db)) || {}; }
  catch (e) { console.warn('[sso-settings] config read failed, using .env/defaults:', e.message); }

  let mode = _pick(c.sso_mode, env.SSO_MODE, '').toLowerCase();
  if (!/^(off|available|only)$/.test(mode)) {
    // legacy SSO_ENABLED=true → 'only', else 'off' (matches the old boot derivation)
    mode = /^(1|true|yes)$/i.test(String(env.SSO_ENABLED || '')) ? 'only' : 'off';
  }

  const cfg = {
    tenantId:     _pick(c.entra_tenant_id,     env.ENTRA_TENANT_ID,     ''),
    clientId:     _pick(c.entra_client_id,     env.ENTRA_CLIENT_ID,     ''),
    clientSecret: _pick(c.entra_client_secret, env.ENTRA_CLIENT_SECRET, ''),
    redirectUri:  _pick(c.entra_redirect_uri,  env.ENTRA_REDIRECT_URI,  DEFAULT_REDIRECT),
    // The old boot cfg set scopes='openid profile email'; the callback's
    // updateUserProfileFromEntra reads Graph /me → needs User.Read, which is in the
    // app registration. Set it explicitly (intentional, documented).
    scopes: 'openid profile email User.Read',
  };

  const settings = {
    mode,
    ssoEnabled: mode !== 'off',
    breakglassUser: _pick(c.sso_breakglass_user, env.SSO_BREAKGLASS_USER, 'admin'),
    cfg,
    ready: !!(cfg.tenantId && cfg.clientId && cfg.clientSecret),
  };
  _cache = settings; _at = now;
  return settings;
}

module.exports = { resolveSsoSettings, _invalidate, DEFAULT_REDIRECT };
