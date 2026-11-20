'use strict';
// N-R5-5 (P11 round 5) — an administrator's password reset revokes every session of the target (a reset used to evict
// a compromised account must log the attacker out). `exceptToken` keeps the caller's own session on a self-reset.
// Kept out of reports-db.js (monolith ratchet); uses its PostgreSQL handle.
async function revokeUserSessions(userId, { exceptToken = null } = {}) {
  const H = require('../reports-db').pgHandle();
  const r = exceptToken
    ? await H.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(Number(userId), String(exceptToken))
    : await H.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(userId));
  return { deleted: r.changes };
}
module.exports = { revokeUserSessions };
