'use strict';
// SEC-01 — per-ACCOUNT failed-login throttle (reference: services/authThrottle.js on the 1.11 line).
// The per-IP limiter (server.js loginLimiter) counts every attempt from one address; a guessing run spread over
// several addresses was never slowed for one account. This bucket counts FAILED sign-ins per login name in the
// existing rate_limit_hits table (scope 'login-user'), so it survives a restart and needs no migration.
// Switch: report_config auth_account_throttle_enabled ('0' = today, nothing counted). Any store failure lets the
// sign-in through (fail open — the per-IP limiter still applies) rather than locking every account out.
const SCOPE = 'login-user';
const key = (login) => String(login || '').trim().toLowerCase().slice(0, 200);

function settings(cfg) {
  const c = cfg || {};
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : d; };
  return { enabled: String(c.auth_account_throttle_enabled) === '1', max: int(c.auth_account_throttle_max, 10, 1, 1000),
    windowMs: int(c.auth_account_throttle_window_min, 15, 1, 1440) * 60 * 1000 };
}
/** { blocked, retryAfterSec } — never counts. */
async function check(store, login, s, now = Date.now()) {
  if (!s.enabled || !key(login)) return { blocked: false };
  try {
    const e = await store.rateLimitPeek(SCOPE, key(login), now, s.windowMs);
    if (e.count < s.max) return { blocked: false };
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((e.start + s.windowMs - now) / 1000)) };
  } catch (_) { return { blocked: false }; }
}
async function recordFailure(store, login, s, now = Date.now()) {
  if (!s.enabled || !key(login)) return;
  try { await store.rateLimitBump(SCOPE, key(login), now, s.windowMs); } catch (_) { /* fail open */ }
}
async function clear(store, login, s) {
  if (!s.enabled || !key(login)) return;
  try { await store.rateLimitReset(SCOPE, key(login)); } catch (_) { /* fail open */ }
}
module.exports = { SCOPE, settings, check, recordFailure, clear };
