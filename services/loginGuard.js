'use strict';
// UAT-OI-02 (G3-UX) + SEC-01 — the sign-in guards around POST /api/reports/auth/login, in one place.
//
// Today (login_limit_failures_only = '0'): the per-IP limiter in server.js (services/rateLimit.js, scope 'login')
// counts EVERY attempt — 10 per 15 min per address — so a site whose people all appear under one address (NAT,
// shared kiosk) is locked out after 10 SUCCESSFUL sign-ins. The per-account throttle (services/accountThrottle.js)
// runs only when auth_account_throttle_enabled = '1'.
//
// login_limit_failures_only = '1':
//   * the per-IP limiter stops counting (skipIpLimiter → true);
//   * FAILED attempts are counted per address + login name (scope 'login-fail-pair', cap 10 per 15 min); a
//     successful sign-in clears that pair — a colleague's success never clears someone else's failures;
//   * FAILED attempts are also counted per address alone (scope 'login-fail-ip', cap SPRAY_FACTOR × 10, never
//     cleared by a success) so one address cannot spray guesses across many login names;
//   * the per-login-name failure limit (accountThrottle) is FORCED on with its configured max/window, whatever
//     auth_account_throttle_enabled says — dropping success counting never removes a per-username limit.
// Store = reports-db rate_limit_hits (rateLimitPeek / rateLimitBump / rateLimitReset), no migration. A store
// failure fails OPEN on the read (the per-account bucket logic does the same) — never a lock-out of everyone.
const throttle = require('./accountThrottle');

const IP_MAX = 10;
const WINDOW_MS = 15 * 60 * 1000;
const SPRAY_FACTOR = 5;
const PAIR = 'login-fail-pair';
const SPRAY = 'login-fail-ip';
const MSG_IP = 'Too many login attempts. Please wait 15 minutes before trying again.';
const MSG_ACCOUNT = 'Too many failed sign-ins for this account. Please wait before trying again.';

const ipOf = (req) => String((req && (req.ip || (req.connection && req.connection.remoteAddress))) || 'unknown');
const pairKey = (req, login) => ipOf(req) + '|' + String(login || '').trim().toLowerCase().slice(0, 200);

function settings(cfg) {
  const c = cfg || {};
  const failuresOnly = String(c.login_limit_failures_only) === '1';
  const thr = throttle.settings(c);
  if (failuresOnly) thr.enabled = true;
  return { failuresOnly, throttle: thr, ipMax: IP_MAX, sprayMax: IP_MAX * SPRAY_FACTOR, windowMs: WINDOW_MS };
}

async function _config(rdb) {
  try { return await require('./reportConfig').getConfig(rdb.db); } catch (_) { return {}; }
}

/** For the per-IP limiter's `skip` option: true when failures-only counting replaces it. */
async function skipIpLimiter(rdb) {
  return settings(await _config(rdb)).failuresOnly;
}

async function _over(store, scope, key, max, s, now) {
  try {
    const e = await store.rateLimitPeek(scope, key, now, s.windowMs);
    if (e.count < max) return null;
    return Math.max(1, Math.ceil((e.start + s.windowMs - now) / 1000));
  } catch (_) { return null; }
}

/**
 * Before the password is checked. Returns { blocked:false, s } or
 * { blocked:true, s, retryAfterSec, error, reason }.
 */
async function begin(rdb, req, login, now = Date.now()) {
  const s = settings(await _config(rdb));
  const acc = await throttle.check(rdb, login, s.throttle, now);
  if (acc.blocked) return { blocked: true, s, retryAfterSec: acc.retryAfterSec, error: MSG_ACCOUNT, reason: 'account_throttled' };
  if (s.failuresOnly) {
    const pair = await _over(rdb, PAIR, pairKey(req, login), s.ipMax, s, now);
    if (pair) return { blocked: true, s, retryAfterSec: pair, error: MSG_IP, reason: 'address_failures' };
    const spray = await _over(rdb, SPRAY, ipOf(req), s.sprayMax, s, now);
    if (spray) return { blocked: true, s, retryAfterSec: spray, error: MSG_IP, reason: 'address_spray' };
  }
  return { blocked: false, s };
}

async function failure(rdb, req, login, s, now = Date.now()) {
  await throttle.recordFailure(rdb, login, s.throttle, now);
  if (!s.failuresOnly) return;
  try { await rdb.rateLimitBump(PAIR, pairKey(req, login), now, s.windowMs); } catch (_) { /* fail open */ }
  try { await rdb.rateLimitBump(SPRAY, ipOf(req), now, s.windowMs); } catch (_) { /* fail open */ }
}

async function success(rdb, req, login, s) {
  await throttle.clear(rdb, login, s.throttle);
  if (!s.failuresOnly) return;
  try { await rdb.rateLimitReset(PAIR, pairKey(req, login)); } catch (_) { /* fail open */ }
}

module.exports = { settings, skipIpLimiter, begin, failure, success, PAIR, SPRAY, IP_MAX, SPRAY_FACTOR, MSG_IP, MSG_ACCOUNT };
