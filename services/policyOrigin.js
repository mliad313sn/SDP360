'use strict';
// P11 round 9 R9-A2 / N-R9-1 (fix 39, ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md).
// A Policy Center four-eyes request carries an ORIGIN SIGNATURE: HMAC-SHA256 keyed from SDP_CONFIG_KEY (which is NOT in the
// database) over the request id, the requester, the time, the trusted path that created it ('web' = the logged-in Policy
// Center route, 'cli' = tools/ops/activate-switches.js authenticated by an operator token), the change itself and the
// operator token id. Only services/policyChangeStore.create writes it. At approval a request whose signature does not
// verify is refused: a row INSERTed with the database login — whatever its `source` value — has none, and editing a
// signed row (another reason, another requester, another value, another token) breaks it.
// Residual, stated: whoever holds BOTH the database credentials AND SDP_CONFIG_KEY can still forge a signed row (G01 /
// HD-S04 separation of duties — a human decision, not something this code can enforce).
const crypto = require('crypto');

const ORIGINS = Object.freeze(['web', 'cli']);
const NO_KEY = 'Policy Center requests are refused: SDP_CONFIG_KEY is not set on this server (the request origin signature needs it — fail closed)';

function originKey(env = process.env) {
  const k = String(env.SDP_CONFIG_KEY || '');
  return k ? crypto.createHmac('sha256', k).update('sdp-policy-request-origin-v1').digest() : null;
}
const _s = (v) => (v == null ? null : String(v));
function payload(r) {
  return JSON.stringify(['pc-origin-v1', String(Number(r.id)), String(Number(r.requested_by)), String(r.requested_by_name || ''), String(r.requested_at),
    String(r.origin || ''), String(r.key), String(r.scope || 'global'), _s(r.old_value), _s(r.new_value), String(r.reason || ''),
    r.operator_token_id == null ? null : String(Number(r.operator_token_id))]);
}
function sign(key, r) { return crypto.createHmac('sha256', key).update(payload(r)).digest('hex'); }
const _eq = (a, b) => { const x = Buffer.from(String(a || ''), 'utf8'); const y = Buffer.from(String(b || ''), 'utf8'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/** Pure: does this stored request carry a valid origin signature? Returns { ok, reason }. */
function verify(r, env = process.env) {
  const key = originKey(env);
  if (!key) return { ok: false, reason: NO_KEY };
  if (!r) return { ok: false, reason: 'request not found' };
  if (!ORIGINS.includes(String(r.origin || ''))) return { ok: false, reason: 'the request records no trusted origin (written straight into the table, or filed before fix 39 — reject it and file it again)' };
  if (!r.origin_sig || !_eq(r.origin_sig, sign(key, r))) return { ok: false, reason: 'the request origin signature does not verify (row written or edited outside the application — reject it and file it again)' };
  if (r.origin === 'cli' && r.operator_token_id == null) return { ok: false, reason: 'a CLI request must name the operator token that authenticated it' };
  return { ok: true, reason: null };
}

module.exports = { ORIGINS, NO_KEY, originKey, payload, sign, verify };
