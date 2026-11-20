'use strict';
// P11 round 6 R6-A1 — one-time operator tokens (migration 136, ADR docs/ai-decisions/ADR-P11-R6-operator-tokens.md).
// A logged-in super_admin issues a token in the web UI; tools/ops/activate-switches.js consumes it to learn WHO is
// running it. The requester of record of a four-eyes Policy Center request filed by the CLI is the token's account,
// never a typed name. Only sha256(token) is stored; a token works once and for TTL_MINUTES. Nothing here grants a
// right: the consumer still checks that the account is an active super_admin.
const crypto = require('crypto');

const TTL_MINUTES = 10;
const PREFIX = 'sdpop_';
const hash = (t) => crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex');
const looksLikeToken = (t) => typeof t === 'string' && new RegExp(`^${PREFIX}[A-Za-z0-9_-]{40,}$`).test(t.trim());

/** Issue a token for `user` ({id, username}). Returns { token, id, expires_at } — the token is shown once. */
async function issue(db, user, { purpose = 'activate-switches', ttlMinutes = TTL_MINUTES, now = Date.now() } = {}) {
  if (!user || user.id == null) throw new Error('operator token: user unknown');
  const token = PREFIX + crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now + ttlMinutes * 60000).toISOString();
  const r = await db.prepare('INSERT INTO operator_tokens (token_hash, user_id, username, purpose, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .run(hash(token), Number(user.id), String(user.username || ''), String(purpose), expires);
  return { token, id: r && r.lastID != null ? Number(r.lastID) : null, expires_at: expires, ttl_minutes: ttlMinutes };
}

/**
 * Check a token. consume:true burns it atomically (a second use, or a concurrent one, gets null).
 * Returns { id, user_id, username } or { refusal }.
 */
async function check(db, token, { purpose = 'activate-switches', consume = true, consumedBy = null } = {}) {
  if (!looksLikeToken(token)) return { refusal: 'not an operator token (issue one in the Policy Center page: "CLI operator token")' };
  const h = hash(String(token).trim());
  const row = consume
    ? await db.prepare("UPDATE operator_tokens SET consumed_at = now(), consumed_by = ? WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > now() RETURNING id, user_id, username")
      .get(consumedBy == null ? null : String(consumedBy).slice(0, 200), h, String(purpose))
    : await db.prepare('SELECT id, user_id, username FROM operator_tokens WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > now()').get(h, String(purpose));
  if (!row) return { refusal: 'operator token unknown, already used or expired (tokens work once, for 10 minutes)' };
  return { id: Number(row.id), user_id: Number(row.user_id), username: row.username };
}

module.exports = { issue, check, hash, looksLikeToken, TTL_MINUTES, PREFIX };
