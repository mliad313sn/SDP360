'use strict';
// Step 4 (SDP-DASH-2.0) — persistent login throttle. The in-memory limiter forgot every counter
// on each pm2 restart and counted per IP only, so a password-guessing run spread over several
// addresses (or across a restart) was never slowed. Buckets live in reports.db:
//   ip:<address>  — FAILED attempts from one address (cap 30 / 15 min)
//   user:<login>  — FAILED attempts against one account, whatever the address (cap 10 / 15 min)
// Only failures count, so a site's users behind one NAT address are not blocked by each other's
// successful sign-ins; a success clears the account bucket.
// sqlite (schema created lazily here) + PostgreSQL (db/postgres/reports/017_auth_throttle.sql).
// Dual-backend: every function returns a Promise. Times are epoch milliseconds.

function _h() {
  const rdb = require('../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: rdb.db, isPg: false };
}
const _inited = new WeakSet();
function _db() {
  const x = _h();
  if (!x.isPg && !_inited.has(x.H)) {
    x.H.exec(`CREATE TABLE IF NOT EXISTS auth_throttle (
      bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL)`);
    _inited.add(x.H);
  }
  return x;
}

/** Counts one hit in `bucket` (a fresh window starts when the old one expired). */
async function hit(bucket, { windowMs, now = Date.now() }) {
  const { H } = _db();
  const row = await H.prepare(`INSERT INTO auth_throttle (bucket, hits, window_start) VALUES (?, 1, ?)
    ON CONFLICT (bucket) DO UPDATE SET
      hits = CASE WHEN auth_throttle.window_start < ? THEN 1 ELSE auth_throttle.hits + 1 END,
      window_start = CASE WHEN auth_throttle.window_start < ? THEN ? ELSE auth_throttle.window_start END
    RETURNING hits, window_start`).get(bucket, now, now - windowMs, now - windowMs, now);
  return { hits: Number(row.hits), windowStart: Number(row.window_start) };
}

/** Current state of a bucket without counting: {hits, retryAfterSec}. Expired → 0. */
async function peek(bucket, { windowMs, now = Date.now() }) {
  const { H } = _db();
  const row = await H.prepare('SELECT hits, window_start FROM auth_throttle WHERE bucket = ?').get(bucket);
  if (!row || Number(row.window_start) < now - windowMs) return { hits: 0, retryAfterSec: 0 };
  return { hits: Number(row.hits), retryAfterSec: Math.max(1, Math.ceil((Number(row.window_start) + windowMs - now) / 1000)) };
}

async function reset(bucket) {
  const { H } = _db();
  await H.prepare('DELETE FROM auth_throttle WHERE bucket = ?').run(bucket);
}

/** Drops expired buckets (called opportunistically). */
async function purge({ windowMs, now = Date.now() }) {
  const { H } = _db();
  await H.prepare('DELETE FROM auth_throttle WHERE window_start < ?').run(now - windowMs);
}

const bucketForUser = (login) => 'user:' + String(login || '').trim().toLowerCase();
const bucketForIp = (ip) => 'ip:' + String(ip || 'unknown');

module.exports = { hit, peek, reset, purge, bucketForUser, bucketForIp };
