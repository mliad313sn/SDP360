'use strict';
// P11 round 6 R6-A1 — one-time operator tokens (migration 136, ADR docs/ai-decisions/ADR-P11-R6-operator-tokens.md).
// A logged-in super_admin issues a token in the web UI; tools/ops/activate-switches.js consumes it to learn WHO is
// running it. The requester of record of a four-eyes Policy Center request filed by the CLI is the token's account,
// never a typed name. Only sha256(token) is stored; a token works once and for TTL_MINUTES. Nothing here grants a
// right: the consumer still checks that the account is an active super_admin.
//
// P11 round 7 R7-A1 (migration 138, ADR docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md): the token row
// carries a BINDING = HMAC-SHA256 keyed from SDP_CONFIG_KEY (not in the database) over token hash ‖ account ‖ purpose ‖
// expiry. A row INSERTed with the application database login — which the CLI needs anyway — has no valid binding and
// is refused; so is a token whose operator_token_issued event is missing from system_log. Without SDP_CONFIG_KEY the
// flow is refused (fail closed). The issuance event is written by the same application role, so it is a cross-check,
// not a control on its own. What the binding stops: someone holding ONLY the database login. P11 r8 N-R8-2 — residual,
// stated honestly: whoever holds BOTH the application database credentials AND SDP_CONFIG_KEY — in practice anyone who
// can read the server's .env, which tools/ops/activate-switches.js loads and which holds PG_URL and SDP_CONFIG_KEY side
// by side — can forge a bound token plus its issuance event. Keeping the key out of the CLI operator's reach (separate
// service account / secret store) is a separation-of-duties decision for humans (InfoSec, gate G01 / HD-S04), not
// something this code can enforce.
const crypto = require('crypto');

const TTL_MINUTES = 10;
const PREFIX = 'sdpop_';
const hash = (t) => crypto.createHash('sha256').update(String(t || ''), 'utf8').digest('hex');
const looksLikeToken = (t) => typeof t === 'string' && new RegExp(`^${PREFIX}[A-Za-z0-9_-]{40,}$`).test(t.trim());
const NO_KEY = 'operator tokens are refused: SDP_CONFIG_KEY is not set on this server (the token binding needs it — fail closed)';

/** Binding key derived from SDP_CONFIG_KEY (null when it is not set). */
function bindingKey(env = process.env) {
  const k = String(env.SDP_CONFIG_KEY || '');
  if (!k) return null;
  return crypto.createHmac('sha256', k).update('sdp-operator-token-binding-v1').digest();
}
const _iso = (v) => { const d = v instanceof Date ? v : new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
/** HMAC over the facts a forger would have to choose: token hash, account, purpose, expiry. */
function binding(key, row) {
  return crypto.createHmac('sha256', key).update(JSON.stringify([String(row.token_hash), String(Number(row.user_id)), String(row.purpose), _iso(row.expires_at)])).digest('hex');
}
const _eq = (a, b) => { const x = Buffer.from(String(a || ''), 'utf8'); const y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Issue a token for `user` ({id, username}). Returns { token, id, expires_at } — the token is shown once. */
async function issue(db, user, { purpose = 'activate-switches', ttlMinutes = TTL_MINUTES, now = Date.now(), env = process.env } = {}) {
  if (!user || user.id == null) throw new Error('operator token: user unknown');
  const key = bindingKey(env);
  if (!key) throw new Error(NO_KEY);
  const token = PREFIX + crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now + ttlMinutes * 60000).toISOString();
  const h = hash(token);
  const b = binding(key, { token_hash: h, user_id: user.id, purpose, expires_at: expires });
  const r = await db.prepare('INSERT INTO operator_tokens (token_hash, user_id, username, purpose, expires_at, binding) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .run(h, Number(user.id), String(user.username || ''), String(purpose), expires, b);
  return { token, id: r && r.lastID != null ? Number(r.lastID) : null, expires_at: expires, ttl_minutes: ttlMinutes };
}

/** Is there an operator_token_issued system_log event naming this token id? (best-effort read; unreadable = no) */
async function hasIssuanceEvent(db, tokenId) {
  try {
    const rows = await db.prepare("SELECT details FROM system_log WHERE action = 'operator_token_issued' ORDER BY id DESC LIMIT 500").all();
    for (const r of rows) {
      let d = null; try { d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details; } catch (_) { d = null; }
      if (d && Number(d.token_id) === Number(tokenId)) return true;
    }
  } catch (_) { /* no system_log */ }
  return false;
}

/** Does the stored row carry a valid server binding? */
function bindingOk(row, env = process.env) {
  const key = bindingKey(env);
  return !!(key && row && row.binding && _eq(row.binding, binding(key, row)));
}

/**
 * Check a token. consume:true burns it atomically (a second use, or a concurrent one, gets null).
 * Returns { id, user_id, username } or { refusal }.
 */
async function check(db, token, { purpose = 'activate-switches', consume = true, consumedBy = null, env = process.env } = {}) {
  if (!bindingKey(env)) return { refusal: NO_KEY };
  if (!looksLikeToken(token)) return { refusal: 'not an operator token (issue one in the Policy Center page: "CLI operator token")' };
  const h = hash(String(token).trim());
  let row;
  try {
    row = await db.prepare('SELECT id, token_hash, user_id, username, purpose, expires_at, binding FROM operator_tokens WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > now()').get(h, String(purpose));
  } catch (_) { return { refusal: 'operator tokens cannot be verified on this database (migration 138 not applied?)' }; }
  if (!row) return { refusal: 'operator token unknown, already used or expired (tokens work once, for 10 minutes)' };
  if (!bindingOk(row, env)) return { refusal: 'operator token was not issued by the server (no valid binding — a row written directly into the database is refused)' };
  if (!(await hasIssuanceEvent(db, row.id))) return { refusal: `operator token #${row.id} has no operator_token_issued event in the system log — refused` };
  if (consume) {
    const burnt = await db.prepare('UPDATE operator_tokens SET consumed_at = now(), consumed_by = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > now() RETURNING id')
      .get(consumedBy == null ? null : String(consumedBy).slice(0, 200), row.id);
    if (!burnt) return { refusal: 'operator token unknown, already used or expired (tokens work once, for 10 minutes)' };
  }
  return { id: Number(row.id), user_id: Number(row.user_id), username: row.username };
}

/**
 * P11 r7 R7-A1 — for the Policy Center approval screen: what can be established about the operator token a request
 * names in its reason ("authenticated by operator token #N"). Never throws.
 * Returns null when the reason names no token, else { id, issued_event, binding_ok, account_matches }.
 */
async function evidenceForRequest(db, reason, requesterId, env = process.env) {
  const m = /authenticated by operator token #(\d+)/.exec(String(reason || ''));
  if (!m) return null;
  const id = Number(m[1]);
  let row = null;
  try { row = await db.prepare('SELECT id, token_hash, user_id, username, purpose, expires_at, binding FROM operator_tokens WHERE id = ?').get(id); } catch (_) { row = null; }
  return { id, issued_event: await hasIssuanceEvent(db, id), binding_ok: bindingOk(row, env), account_matches: !!(row && requesterId != null && Number(row.user_id) === Number(requesterId)) };
}

module.exports = { issue, check, hash, looksLikeToken, bindingKey, binding, hasIssuanceEvent, evidenceForRequest, TTL_MINUTES, PREFIX };
