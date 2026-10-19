'use strict';
// Step 4 — rate limiter with a PERSISTENT store. The in-memory token bucket in server.js
// forgets everything on restart (and pm2 restarts a crashed process within seconds), so a
// password-guessing client only had to make the server restart to get a fresh budget. This
// limiter keeps hits in the reports DB (`rate_limit_hits`) when a store is available and
// falls back to memory otherwise. Pure core (`decide`) is unit-tested; I/O is injected.

function memoryStore() {
  const m = new Map();
  return {
    async bump(scope, key, now, windowMs) {
      const k = `${scope}|${key}`; const e = m.get(k);
      if (!e || now - e.start > windowMs) { m.set(k, { start: now, count: 1 }); return { start: now, count: 1 }; }
      e.count++; return e;
    },
  };
}

/** Pure decision: { allowed, retryAfterSec } from a bumped entry. */
function decide(entry, { max, windowMs, now }) {
  if (!entry || entry.count <= max) return { allowed: true };
  return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000)) };
}

/**
 * Express middleware. `store()` returns an object with `rateLimitBump(scope, key, now, windowMs)`
 * (reports-db) — any failure there degrades to the in-memory store for that request.
 */
function persistentLimiter({ windowMs, max, message, scope = 'default', store = null, now = () => Date.now(), log = console.warn }) {
  const mem = memoryStore();
  let warned = false;
  return async (req, res, next) => {
    const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    const t = now();
    let entry = null;
    try {
      const s = store && store();
      if (s && typeof s.rateLimitBump === 'function') entry = await s.rateLimitBump(scope, ip, t, windowMs);
    } catch (e) { if (!warned) { warned = true; log(`[rate-limit] persistent store unavailable, memory fallback: ${e.message}`); } }
    if (!entry) entry = await mem.bump(scope, ip, t, windowMs);
    const d = decide(entry, { max, windowMs, now: t });
    if (d.allowed) return next();
    res.setHeader('Retry-After', d.retryAfterSec);
    return res.status(429).json({ error: message || 'Too many requests' });
  };
}

module.exports = { persistentLimiter, decide, memoryStore };
