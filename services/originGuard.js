'use strict';
// Security review (CISO, 2026-10-29) — cross-site request forgery guard.
// The session cookie is SameSite=Lax, which already stops most cross-site POSTs; this is the second,
// explicit layer: a state-changing request (POST/PUT/PATCH/DELETE) coming FROM A BROWSER must come from
// this application's own origin. Server-to-server callers (tools/, scheduled jobs, external API clients)
// send no Origin and no Sec-Fetch-Site header and are not concerned.
//
//   Origin present      → must be one of the allowed origins, or the same host the request was sent to
//   no Origin           → refused only when the browser says Sec-Fetch-Site: cross-site
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(origin) { try { return new URL(origin).host.toLowerCase(); } catch (_) { return null; } }

function decide(req, allowed = []) {
  if (SAFE.has(String(req.method || 'GET').toUpperCase())) return null;
  const h = req.headers || {};
  const origin = h.origin;
  if (origin && origin !== 'null') {
    if (allowed.includes(origin)) return null;
    const oh = hostOf(origin); const host = String(h.host || '').toLowerCase();
    if (oh && host && oh === host) return null;
    return 'cross-origin request refused';
  }
  if (origin === 'null') return 'opaque origin refused';
  if (String(h['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 'cross-site request refused';
  return null;
}

function middleware({ allowed = [], log = null } = {}) {
  return (req, res, next) => {
    const why = decide(req, allowed);
    if (!why) return next();
    try { if (log) log(req, why); } catch (_) {}
    res.status(403).json({ ok: false, code: 'CROSS_ORIGIN', error: why });
  };
}

module.exports = { decide, middleware };
