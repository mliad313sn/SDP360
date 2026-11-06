'use strict';
// E-S04 (audit S-07, SEC-01 F7) — Entra leaver job, DRY-RUN first.
//
// For every ACTIVE local account linked to an Entra object (users.entra_oid), ask Microsoft Graph whether the
// object is disabled or deleted, and produce a list { account, linked oid (masked), Graph state, would deactivate }.
//   • Does NOTHING (no Graph call at all) unless report_config entra_deprovision_enabled = '1' AND the SSO settings
//     resolve ready (tenant + client id + secret).
//   • Deactivates (rdb.updateUser active=0 — the Admin ▸ Users path; validateSession then refuses the open
//     sessions on their next request) ONLY when entra_deprovision_apply = '1'.
//   • A Graph 401/403 = "consent_missing" (User.Read.All application permission is human gate 2): the run stops,
//     nothing is deactivated. Any other Graph error on one account = "unknown" for that account, never a deactivation.
//   • The break-glass account (sso_breakglass_user) is never touched.
// The code requests no permission by itself: it uses the app registration's client-credentials token, whatever
// the tenant administrator has (or has not) consented to.
const GRAPH = 'https://graph.microsoft.com/v1.0';

const mask = (oid) => { const s = String(oid || ''); return s.length > 8 ? s.slice(0, 4) + '…' + s.slice(-4) : s ? '…' : ''; };

/** Default transport: axios-like ({ method, url, headers, data }) → { status, data }. Never throws on HTTP status. */
async function _http({ method = 'GET', url, headers = {}, data }) {
  const axios = require('axios');
  const r = await axios({ method, url, headers, data, timeout: 15000, validateStatus: () => true });
  return { status: r.status, data: r.data };
}

async function appToken(cfg, http) {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString();
  const r = await http({ method: 'POST', url: `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: body });
  if (r.status === 200 && r.data && r.data.access_token) return { token: r.data.access_token };
  return { error: 'token_failed', status: r.status };   // wrong secret / tenant: no deactivation, the run reports it
}

/** Pure: Graph answer for one object → state. */
function graphState(r) {
  if (!r) return 'unknown';
  if (r.status === 401 || r.status === 403) return 'consent_missing';
  if (r.status === 404) return 'deleted';
  if (r.status === 200 && r.data && r.data.accountEnabled === false) return 'disabled';
  if (r.status === 200 && r.data && r.data.accountEnabled === true) return 'enabled';
  return 'unknown';
}

/**
 * Run once. deps: { rdb, getConfig, resolveSso, http, now }.
 * → { skipped, reason } | { status: 'consent_missing'|'ok', dry_run, rows: [...], deactivated }
 */
async function run(deps = {}) {
  const rdb = deps.rdb || require('../reports-db');
  const cfg = deps.cfg || await (deps.getConfig ? deps.getConfig() : require('./reportConfig').getConfig(rdb.db));
  if (String((cfg && cfg.entra_deprovision_enabled) || '0') !== '1') return { skipped: true, reason: 'entra_deprovision_enabled is 0' };
  const sso = await (deps.resolveSso ? deps.resolveSso() : require('./ssoSettings').resolveSsoSettings(rdb.db));
  if (!sso || !sso.ready) return { skipped: true, reason: 'SSO settings are not ready (tenant, client id, secret)' };
  const apply = String((cfg && cfg.entra_deprovision_apply) || '0') === '1';
  const http = deps.http || _http;
  const breakglass = String(sso.breakglassUser || '').toLowerCase();

  const linked = await rdb.pgHandle().prepare("SELECT id, username, full_name, site_id, entra_oid FROM users WHERE COALESCE(active, 1) = 1 AND entra_oid IS NOT NULL AND entra_oid <> '' ORDER BY id").all();
  const tok = await appToken(sso.cfg, http);
  if (tok.error) return { status: tok.error, dry_run: !apply, rows: [], deactivated: 0, accounts: linked.length };

  const rows = [];
  let deactivated = 0;
  for (const u of linked) {
    const row = { user_id: Number(u.id), username: u.username, entra_oid: mask(u.entra_oid), graph_state: 'unknown', would_deactivate: false, deactivated: false };
    if (String(u.username || '').toLowerCase() === breakglass) { row.graph_state = 'skipped_breakglass'; rows.push(row); continue; }
    let r = null;
    try { r = await http({ method: 'GET', url: `${GRAPH}/users/${encodeURIComponent(u.entra_oid)}?$select=id,accountEnabled`, headers: { authorization: 'Bearer ' + tok.token } }); }
    catch (_) { r = null; }
    row.graph_state = graphState(r);
    if (row.graph_state === 'consent_missing') return { status: 'consent_missing', dry_run: !apply, rows: [], deactivated, accounts: linked.length };
    row.would_deactivate = row.graph_state === 'disabled' || row.graph_state === 'deleted';
    if (row.would_deactivate && apply) {
      const full = ((await rdb.listUsers()) || []).find((x) => Number(x.id) === row.user_id);
      if (full) {
        await rdb.updateUser(row.user_id, { full_name: full.full_name, site_id: full.site_id, active: 0, roles: full.roles, extra_site_ids: full.extra_site_ids || [] });
        row.deactivated = true; deactivated++;
        try {
          rdb.logEvent({ category: 'identity', action: 'user_deactivated', actor: 'system', actor_id: null, target: full.username, risk: 1,
            details: { via: 'entra_deprovision', user_id: row.user_id, graph_state: row.graph_state } });
        } catch (_) { /* a dead log never blocks */ }
      }
    }
    rows.push(row);
  }
  return { status: 'ok', dry_run: !apply, rows, deactivated, accounts: linked.length,
    would_deactivate: rows.filter((r) => r.would_deactivate).length };
}

module.exports = { run, graphState, mask, appToken };
