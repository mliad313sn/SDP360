'use strict';
// Zoho Analytics (Analytics Plus) connection — the helpdesk data source — editable in
// Admin ▸ Intégration API ▸ Analytics (2026-10-04) instead of only in .env.
// Each value resolves DATABASE (report_config analytics_*) → .env → built-in default,
// so deploying this changes nothing until the admin form is saved. Cached 60 s,
// invalidated on save; a FAILED database read (pg not ready at boot) is never cached.
//
// NOT covered on purpose: DASH_API_KEY stays derived from process.env.ZOHO_CLIENT_SECRET
// (server.js) — deriving it from an admin-editable value would silently change the key
// external pages use, and break them (see the X-Dash-Key stale-401 pitfall).

const DEFAULTS = {
  workspaceId: '106803000000002012',
  orgId: '878991289',
  accountsUrl: 'https://accounts.zoho.com',
};
const MAP = [
  // [field, config key, env var]
  ['clientId',     'analytics_client_id',     'ZOHO_CLIENT_ID'],
  ['clientSecret', 'analytics_client_secret', 'ZOHO_CLIENT_SECRET'],
  ['refreshToken', 'analytics_refresh_token', 'ZOHO_REFRESH_TOKEN'],
  ['workspaceId',  'analytics_workspace_id',  'WORKSPACE_ID'],
  ['orgId',        'analytics_org_id',        'ORG_ID'],
  ['accountsUrl',  'analytics_accounts_url',  'ZOHO_ACCOUNTS_URL'],
];

function mergeAnalyticsSettings(cfg, env) {
  const c = cfg || {}, e = env || {};
  const out = { sources: {} };
  for (const [field, key, envName] of MAP) {
    const db = String(c[key] == null ? '' : c[key]).trim();
    const ev = String(e[envName] == null ? '' : e[envName]).trim();
    if (db) { out[field] = db; out.sources[field] = 'db'; }
    else if (ev) { out[field] = ev; out.sources[field] = 'env'; }
    else if (DEFAULTS[field]) { out[field] = DEFAULTS[field]; out.sources[field] = 'default'; }
    else { out[field] = ''; out.sources[field] = 'none'; }
  }
  out.accountsUrl = out.accountsUrl.replace(/\/+$/, '');
  out.ready = !!(out.clientId && out.clientSecret && out.refreshToken);
  return out;
}

let _cache = null, _cacheAt = 0;
const TTL = 60000;

async function resolveAnalyticsSettings(db, { getConfig, env } = {}) {
  if (_cache && Date.now() - _cacheAt < TTL) return _cache;
  const read = getConfig || ((d) => require('./reportConfig').getConfig(d || require('../reports-db').db));
  let cfg = null;
  try { cfg = await read(db); } catch (e) { cfg = null; }
  const s = mergeAnalyticsSettings(cfg || {}, env || process.env);
  if (cfg) { _cache = s; _cacheAt = Date.now(); }
  return s;
}
function _invalidate() { _cache = null; _cacheAt = 0; }

module.exports = { mergeAnalyticsSettings, resolveAnalyticsSettings, _invalidate, DEFAULTS };
