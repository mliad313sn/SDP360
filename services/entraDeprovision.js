'use strict';
// Step 4 (SDP-DASH-2.0) — automatic deactivation when a person leaves. Daily job
// `entra.deprovision` (armed off: sso_deprovision_enabled='1'). For each ACTIVE dashboard account
// linked to an Entra identity (entra_oid), Microsoft Graph is asked whether the identity still
// exists and is enabled; a deleted (404) or disabled (accountEnabled=false) identity →
// the account is deactivated and its sessions closed (System Logs: user_deactivated, risk).
//
// Needs the APPLICATION permission User.Read.All on the app registration (admin consent) — the
// app-only token is obtained with the client secret already configured for SSO. Any other
// Graph error (network, 401/403, throttling) deactivates NOBODY and fails the run, so a
// misconfiguration can never empty the user base. A safety cap refuses to deactivate more than
// 20 % of the linked accounts in one run (same idea as the sync truncation guard).

const GRAPH = 'https://graph.microsoft.com/v1.0';

async function appToken(cfg, http) {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await http.post(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  if (!r || !r.data || !r.data.access_token) throw new Error('no app token from Entra');
  return r.data.access_token;
}

/** {status:'active'|'disabled'|'deleted'} for one identity; throws on any other error. */
async function identityStatus(oid, token, http) {
  try {
    const r = await http.get(`${GRAPH}/users/${encodeURIComponent(oid)}?$select=id,accountEnabled`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
    return { status: r.data && r.data.accountEnabled === false ? 'disabled' : 'active' };
  } catch (e) {
    if (e && e.response && e.response.status === 404) return { status: 'deleted' };
    throw e;
  }
}

/** PURE: which accounts to deactivate, with the safety cap. */
function plan(results, { maxShare = 0.2 } = {}) {
  const gone = results.filter(r => r.status === 'deleted' || r.status === 'disabled');
  const total = results.length;
  const blocked = total > 0 && gone.length > Math.max(1, Math.floor(total * maxShare));
  return { gone, total, blocked };
}

async function run({ rdb, cfg, enabled, http, dryRun = false, logEvent = () => {} } = {}) {
  if (!enabled) return { skipped: true, reason: 'sso_deprovision_enabled is off' };
  if (!cfg || !cfg.tenantId || !cfg.clientId || !cfg.clientSecret) return { skipped: true, reason: 'Entra app registration not configured' };
  const h = http || require('axios');
  const users = await rdb.listEntraLinkedUsers();
  const token = await appToken(cfg, h);
  const results = [];
  for (const u of users) results.push({ ...u, ...(await identityStatus(u.entra_oid, token, h)) });
  const p = plan(results);
  if (p.blocked) throw new Error(`refused: ${p.gone.length} of ${p.total} accounts would be deactivated (cap 20 %) — check the Entra configuration`);
  if (!dryRun) {
    for (const u of p.gone) {
      await rdb.deactivateUser(u.id);
      logEvent({ category: 'identity', action: 'user_deactivated', actor: 'entra.deprovision', target: u.username, details: { reason: u.status } });
    }
  }
  return { checked: p.total, deactivated: dryRun ? 0 : p.gone.length, would_deactivate: p.gone.map(u => `${u.username} (${u.status})`), dryRun };
}

module.exports = { run, plan, identityStatus, appToken };
