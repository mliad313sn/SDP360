'use strict';
// A6 (P6) — break-glass time-box (ADR docs/ai-decisions/ADR-P6-decisions-and-breakglass.md).
//
// The break-glass account is the password sign-in kept for an Entra outage (SSO mode 'available' / 'only'). Every use
// is already a RISK event (server.js `breakglass_login`). Switch report_config `breakglass_timebox_enabled`
// (default '0' = today: 24 h session, no reason asked):
//   '1' → the sign-in needs a reason (≥ REASON_MIN characters, refused 400 otherwise, logged on the risk event) and
//         the session it mints is capped at `breakglass_session_minutes` (default 60, clamped 5..1440).
// It applies only when the sign-in IS a break-glass use (same test as the risk event): SSO mode off = the account is
// an ordinary admin, nothing changes. A config that cannot be read = today's behaviour (never locks the door shut).

const REASON_MIN = 10;
const DEFAULT_MINUTES = 60;

function minutesFrom(cfg) {
  const n = Number(cfg && cfg.breakglass_session_minutes);
  return Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(1440, Math.floor(n))) : DEFAULT_MINUTES;
}
const isBreakglassUse = (sso, username) => !!(sso && sso.breakglassUser && username === sso.breakglassUser && sso.mode !== 'off');

/** PURE. { applies, minutes, reason } or { refuse: {status, code, error} }. */
function decide({ cfg, sso, username, reason }) {
  if (!isBreakglassUse(sso, username) || String((cfg && cfg.breakglass_timebox_enabled) || '0') !== '1') return { applies: false };
  const why = String(reason == null ? '' : reason).trim();
  if (why.length < REASON_MIN) return { refuse: { status: 400, code: 'REASON_REQUIRED', error: `break-glass sign-in: a reason is required (at least ${REASON_MIN} characters)` } };
  return { applies: true, minutes: minutesFrom(cfg), reason: why.slice(0, 500) };
}

/** Reads the config (unreadable = switch off) and decides. */
async function begin(rdb, { sso, username, reason }) {
  let cfg = {};
  try { cfg = (await require('./reportConfig').getConfig(rdb && rdb.db)) || {}; } catch (_) { cfg = {}; }
  return decide({ cfg, sso, username, reason });
}

/** Shortens the freshly minted session to `minutes` from now (never lengthens it). */
async function capSession(rdb, token, minutes) {
  if (!token) return;
  await rdb.pgHandle().prepare(`UPDATE sessions SET expires_at = LEAST(expires_at, now() + make_interval(mins => CAST(? AS INTEGER))) WHERE token = ?`).run(Number(minutes), token);
}

module.exports = { REASON_MIN, DEFAULT_MINUTES, minutesFrom, isBreakglassUse, decide, begin, capSession };
