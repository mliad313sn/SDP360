'use strict';
// ─────────────────────────────────────────────────────────────────────────
// Rate-limit store (rate_limit_hits: bump / peek / reset) — moved out of reports-db.js (P06, monolith reduction). Same SQL, same behaviour; reports-db.js
// builds the store with its PostgreSQL handle getter and re-exports every function under the same name
// (pinned by tests/p06-reports-db-surface.test.js).
// ─────────────────────────────────────────────────────────────────────────

function createRateLimitStore({ handle }) {
  const pgHandle = handle;
  // Step 4 — persistent rate-limit bucket: one row per (scope, key); a row older than the
  // window restarts. Returns { start, count }. Dual-backend; same SQL shape.
  function rateLimitBump(scope, key, now, windowMs) {
    return _rateLimitBumpPg(scope, key, now, windowMs);
  }
  async function _rateLimitBumpPg(scope, key, now, windowMs) {
    const H = pgHandle();
    const row = await H.prepare(`SELECT window_start, count FROM rate_limit_hits WHERE scope=? AND key=?`).get(scope, key);
    if (!row || now - Number(row.window_start) > windowMs) {
      await H.prepare(`INSERT INTO rate_limit_hits (scope, key, window_start, count) VALUES (?,?,?,1)
        ON CONFLICT (scope, key) DO UPDATE SET window_start = excluded.window_start, count = 1`).run(scope, key, now);
      return { start: now, count: 1 };
    }
    await H.prepare(`UPDATE rate_limit_hits SET count = count + 1 WHERE scope=? AND key=?`).run(scope, key);
    return { start: Number(row.window_start), count: Number(row.count) + 1 };
  }

  // SEC-01 — per-account login throttle (services/accountThrottle.js): read a bucket without counting, clear it.
  async function rateLimitPeek(scope, key, now, windowMs) {
    const row = await pgHandle().prepare(`SELECT window_start, count FROM rate_limit_hits WHERE scope=? AND key=?`).get(scope, key);
    if (!row || now - Number(row.window_start) > windowMs) return { start: now, count: 0 };
    return { start: Number(row.window_start), count: Number(row.count) };
  }
  async function rateLimitReset(scope, key) {
    await pgHandle().prepare(`DELETE FROM rate_limit_hits WHERE scope=? AND key=?`).run(scope, key);
  }

  return { rateLimitBump, rateLimitPeek, rateLimitReset };
}

module.exports = { createRateLimitStore };
