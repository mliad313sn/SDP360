'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Internal API key resolution (fiche C2, 2026-10-20).
//
// The dashboard used to DERIVE a fallback key from ZOHO_CLIENT_SECRET (or the literal
// 'fallback-secret') when DASHBOARD_API_KEY was absent — an incomplete installation was
// therefore exploitable with a guessable key. Rule now:
//   • NODE_ENV=production → DASHBOARD_API_KEY is REQUIRED and must be ≥ 32 characters;
//     otherwise the server refuses to start (explicit message, exit code 78 like SDP_CONFIG_KEY).
//   • any other environment → a random 32-byte key is generated PER BOOT and logged masked
//     (first 8 characters only) so a developer can still drive tools/ scripts by hand.
// Pure: takes the env object and a logger, never touches process.env itself.
// ─────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const MIN_LENGTH = 32;

function resolveApiKey(env, log) {
  const logger = log || console;
  const provided = String((env && env.DASHBOARD_API_KEY) || '');
  const isProd = String((env && env.NODE_ENV) || '').toLowerCase() === 'production';
  if (isProd) {
    if (!provided) {
      return { ok: false, key: null, reason: `DASHBOARD_API_KEY is required in production (at least ${MIN_LENGTH} characters). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" and add it to .env.` };
    }
    if (provided.length < MIN_LENGTH) {
      return { ok: false, key: null, reason: `DASHBOARD_API_KEY is too short (${provided.length} characters, minimum ${MIN_LENGTH}) — refusing to start in production.` };
    }
    return { ok: true, key: provided, generated: false };
  }
  if (provided) return { ok: true, key: provided, generated: false };
  const key = crypto.randomBytes(32).toString('hex');
  logger.warn(`[STARTUP] DASHBOARD_API_KEY not set — generated a per-boot random key (${key.slice(0, 8)}…). Set DASHBOARD_API_KEY in .env (≥ ${MIN_LENGTH} chars) so scheduled tools keep working across restarts.`);
  return { ok: true, key, generated: true };
}

module.exports = { resolveApiKey, MIN_LENGTH };
