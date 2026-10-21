'use strict';
// E2 / F5 — the two decision steps of the SSO callback, kept out of server.js so the
// callback stays short and the rules are unit-testable without an Express boot.
//
//   matchAndLink(rdb, claims, settings) → { user } | { deny: '<neutral sso_error code>' }
//     · rdb.findUserByEntra: oid FIRST; the e-mail fallback is restricted inside reports-db
//       (unlinked rows only, verified `email`/`upn` claim only, never break-glass / super_admin).
//     · rdb.linkUserEntra: stamps the oid on first match; a DIFFERENT existing oid throws
//       `sso_link_conflict` (logged as a risk event by reports-db) → refused with the SAME
//       neutral code as "not provisioned" so the response leaks nothing about the account.
//
//   provisionFromGroups(rdb, user, claims, settings, ip)
//     · Entra omits `groups` and sets `_claim_names.groups` when a user is in too many groups
//       (overage). Treating that as "member of no group" could strip roles, so we log
//       'sso_groups_overage' (risk) and apply NO group-based provisioning for this login.
//     · Otherwise the pure services/ssoProvisioning plan is applied (one update).

const DENY = 'not_provisioned';

async function matchAndLink(rdb, claims, settings = {}) {
  const user = await rdb.findUserByEntra({
    oid: claims.oid, email: claims.email, email_source: claims.email_source, breakglassUser: settings.breakglassUser,
  });
  if (!user) {
    console.warn(`[SSO] denied — no provisioned user for ${claims.email} (oid ${claims.oid}, claim ${claims.email_source})`);
    return { user: null, deny: DENY };
  }
  try { await rdb.linkUserEntra(user.id, claims.oid, claims.email); }
  catch (e) {
    if (e && e.code === 'sso_link_conflict') {
      console.warn(`[SSO] denied — link conflict for user=${user.username}`);
      return { user: null, deny: DENY };
    }
    throw e;
  }
  return { user, deny: null };
}

async function provisionFromGroups(rdb, user, claims, settings = {}, ip = null) {
  if (claims && claims.groups_overage) {
    rdb.logEvent({ category:'auth', action:'sso_groups_overage', actor:'sso', actor_id:user.id, target:user.username, ip, risk:1,
                   details:{ note:'groups claim omitted by Entra (_claim_names); no role provisioning applied' } });
    console.warn(`[SSO] groups overage for user=${user.username} — no group-based provisioning applied`);
    return { applied:false, overage:true };
  }
  try {
    const prov = require('./ssoProvisioning');
    const plan = prov.planProvisioning(user, claims.groups, settings.groupMap);
    if (plan.changed) {
      await rdb.updateUser(user.id, plan.patch);
      rdb.logEvent({ category:'identity', action:'user_role_changed', actor:'sso', actor_id:user.id, target:user.username, details:{ via:'entra_group_map', ...plan.patch } });
    }
    return { applied: !!plan.changed, overage:false };
  } catch (e) { console.warn('[SSO] group provisioning skipped:', e.message); return { applied:false, overage:false }; }
}

module.exports = { matchAndLink, provisionFromGroups, DENY };
