'use strict';
// P11 round 4 R4-A2(b) — a four-eyes approver must be INDEPENDENT of the requester, not just a different account.
// One super_admin could create a second super_admin account (or grant super_admin to an account) and approve their
// own Policy Center request with it. Rule, read from the identity journal (system_log category 'identity',
// actions user_created / user_role_changed — written by routes/adminUsers.js and services/accessStore.js):
//   1. the approver was created, or had a role changed, by the requester — ever → refused;
//   2. the same, through a chain (the requester created the account that created the approver…), depth ≤ 4 → refused;
//   3. fail closed: the approver account was created, or granted super_admin, inside the cooling-off window
//      (default 7 days) and the journal does not name who did it → refused (provenance unknown);
//   4. the journal or the users table cannot be read → refused.
//   5. (N-R5-2, P11 round 5) CREDENTIAL control counts like creation: the requester reset the approver's password
//      (identity journal `password_reset`, or a `user_updated` whose changed fields include the password, e-mail /
//      SSO match key or the active flag, or `user_email_changed`) — ever, directly or through the chain → refused.
//      A super_admin who resets a second account's password can sign in as it; that account is not a second person.
// Nothing here grants a right; it only refuses.
const DAY = 864e5;
const ACTIONS = ['user_created', 'user_role_changed', 'password_reset', 'user_updated', 'user_email_changed'];
const CREDENTIAL_FIELDS = ['password', 'email', 'entra_oid', 'active'];

const parse = (t) => { try { return t ? JSON.parse(t) : {}; } catch (_) { return {}; } };
const rolesOf = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.roles) ? v.roles : (v && v.role ? [v.role] : []))).map(String);

async function rowsFor(db, username) {
  const rows = (await db.prepare(`SELECT ts, action, actor_id, details FROM system_log WHERE category = 'identity' AND action IN ('user_created', 'user_role_changed', 'password_reset', 'user_updated', 'user_email_changed') AND target = ? ORDER BY id`).all(String(username))) || [];
  return rows.filter((r) => r.action !== 'user_updated' || controlsCredentials(r));
}
// a user_updated row matters only when it touched what lets someone sign in as the account
function controlsCredentials(r) {
  const d = parse(r.details);
  if (d.password_reset === true) return true;
  return Array.isArray(d.changed) && d.changed.some((k) => CREDENTIAL_FIELDS.includes(String(k)));
}
const CREDENTIAL_ACTIONS = new Set(['password_reset', 'user_updated', 'user_email_changed']);
const grantsSuper = (r) => {
  const d = parse(r.details);
  if (r.action === 'user_created') return rolesOf(d.after).includes('super_admin') || rolesOf(d.after).length === 0;
  return rolesOf(d.after).includes('super_admin') && !rolesOf(d.before).includes('super_admin');
};

/**
 * @returns {Promise<{ok:true}|{ok:false, reason:string}>}
 */
async function checkIndependent({ db, requesterId, approver, now = Date.now(), coolingDays = 7, maxDepth = 4 }) {
  try {
    const req = Number(requesterId);
    if (!approver || approver.id == null) return { ok: false, reason: 'approver unknown' };
    const userRow = async (id) => db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(Number(id));
    const me = await userRow(approver.id);
    if (!me) return { ok: false, reason: 'approver account not found' };
    // 1 + 2: walk the journal up from the approver
    const seen = new Set([Number(me.id)]);
    let frontier = [me];
    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next = [];
      for (const u of frontier) {
        for (const r of await rowsFor(db, u.username)) {
          if (r.actor_id == null) continue;
          const a = Number(r.actor_id);
          if (a === req && CREDENTIAL_ACTIONS.has(r.action)) return { ok: false, reason: depth === 0 ? 'the requester reset the credentials (password / e-mail / activation) of the approver account — it is not a second person' : 'the approver account descends from an account whose credentials the requester reset' };
          if (a === req) return { ok: false, reason: depth === 0 ? 'the approver account was created or had its roles changed by the requester' : 'the approver account descends from an account the requester created or promoted' };
          if (!seen.has(a)) { seen.add(a); const au = await userRow(a); if (au) next.push(au); }
        }
      }
      frontier = next;
    }
    // 3: recent super_admin with no named author
    const since = now - coolingDays * DAY;
    const recent = (t) => { const x = Date.parse(t instanceof Date ? t.toISOString() : String(t || '')); return Number.isFinite(x) && x >= since; };
    const rows = await rowsFor(db, me.username);
    if (recent(me.created_at) && !rows.some((r) => r.action === 'user_created' && r.actor_id != null)) {
      return { ok: false, reason: `the approver account was created less than ${coolingDays} days ago and the journal does not say by whom — provenance unknown` };
    }
    if (rows.some((r) => grantsSuper(r) && recent(r.ts) && r.actor_id == null)) {
      return { ok: false, reason: `super_admin was granted to the approver less than ${coolingDays} days ago by an unnamed actor — provenance unknown` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'approver provenance could not be read — refused (fail closed)' };
  }
}

module.exports = { checkIndependent, ACTIONS, CREDENTIAL_FIELDS };
