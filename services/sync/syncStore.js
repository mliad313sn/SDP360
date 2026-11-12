'use strict';
// SDP360 — sync run / watermark / lock persistence for services/sync/syncRunner.js.
//
// PostgreSQL only (PO-08), through services/pgDb.js makePgDb() (`?` placeholders → $n).
// Schema: db/postgres/sync/001_init.sql, applied by db/migrate.js.


const crypto = require('crypto');

function iso(ms) { return new Date(ms).toISOString(); }

/** The error a run gets when it no longer holds its lease (never retried, nothing written after it). */
function leaseLost(job) {
  const e = new Error(`${job}: lease lost — another run holds the lock now; this run stopped before writing`);
  e.code = 'LEASE_LOST'; e.transient = false; e.leaseLost = true;
  return e;
}

/**
 * @param {object} db   - pgDb instance
 * @param {object} [o]
 * @param {string} [o.owner] - lock owner label (host:pid)
 */
function makeSyncStore(db, o = {}) {
  const owner = o.owner || `${require('os').hostname()}:${process.pid}`;

  return {
    // G1-SYNC (R8 holes 1-2) — compare-and-set lease. ONE statement takes a free lock or steals a stale one
    // (locked_at older than now - ttl); two runs racing a stale lock cannot both win because the conflict
    // UPDATE re-checks the row it locks. Returns the lease token (truthy) or false.
    async acquireLock(job, nowMs, ttlMs) {
      const token = crypto.randomUUID();
      const row = await db.prepare(
        `INSERT INTO sync_locks (job, locked_at, owner, token) VALUES (?, ?, ?, ?)
         ON CONFLICT (job) DO UPDATE SET locked_at = excluded.locked_at, owner = excluded.owner, token = excluded.token
         WHERE sync_locks.locked_at <= ?
         RETURNING token`
      ).get(job, iso(nowMs), owner, token, iso(nowMs - ttlMs));
      return row && row.token === token ? token : false;
    },
    // Deletes the lock only while it is still ours: a slow run whose lease was taken over leaves the new holder alone.
    async releaseLock(job, token) {
      if (!token) return false;
      const r = await db.prepare('DELETE FROM sync_locks WHERE job = ? AND token = ?').run(job, String(token));
      return !!(r && r.changes);
    },
    /** True while `token` still holds the lease of `job`. */
    async checkFence(job, token) {
      if (!token) return false;
      return !!(await db.prepare('SELECT 1 AS ok FROM sync_locks WHERE job = ? AND token = ?').get(job, String(token)));
    },
    /** Heartbeat: extends the lease of a live run (only while the token is still ours). */
    async renewLock(job, token, nowMs) {
      if (!token) return false;
      const r = await db.prepare('UPDATE sync_locks SET locked_at = ? WHERE job = ? AND token = ?').run(iso(nowMs), job, String(token));
      return !!(r && r.changes);
    },
    /**
     * Fenced write: runs `fn` in ONE transaction that first takes pg_advisory_xact_lock(hashtext(job)) and then
     * verifies the lease; a lost lease throws LEASE_LOST before anything is written. Use it for DELETE+INSERT
     * replaces so two writers of one job serialise instead of interleaving.
     */
    async fencedTransaction(job, token, fn) {
      return db.runTransaction(async () => {
        await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?)) AS l').get(job);
        const ok = await db.prepare('SELECT 1 AS ok FROM sync_locks WHERE job = ? AND token = ?').get(job, String(token || ''));
        if (!ok) throw leaseLost(job);
        return fn();
      });
    },
    async getWatermark(job) {
      const r = await db.prepare('SELECT value FROM sync_watermarks WHERE job = ?').get(job);
      return r ? r.value : null;
    },
    async setWatermark(job, value) {
      await db.prepare(
        `INSERT INTO sync_watermarks (job, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(job) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(job, value == null ? null : String(value), iso(Date.now()));
    },
    async startRun(job, nowMs, meta) {
      const r = await db.prepare('INSERT INTO sync_runs (job, started_at, status, meta) VALUES (?, ?, ?, ?)')
        .run(job, iso(nowMs), 'running', meta == null ? null : JSON.stringify(meta));
      return r.lastID != null ? Number(r.lastID) : null;
    },
    async finishRun(id, p) {
      await db.prepare(
        `UPDATE sync_runs SET finished_at = ?, status = ?, attempts = ?, rows = ?, duplicates = ?, upserted = ?, deleted = ?, error = ?,
                meta = COALESCE(?, meta)
         WHERE id = ?`
      ).run(p.finished_at != null ? iso(p.finished_at) : null, p.status, p.attempts || 0,
        p.rows == null ? null : p.rows, p.duplicates == null ? null : p.duplicates,
        p.upserted == null ? null : p.upserted, p.deleted == null ? null : p.deleted,
        p.error == null ? null : String(p.error), p.meta == null ? null : JSON.stringify(p.meta), id);
    },
    async lastSuccessfulRun(job) {
      const r = await db.prepare(`SELECT * FROM sync_runs WHERE job = ? AND status = 'ok' ORDER BY id DESC LIMIT 1`).get(job);
      return r || null;
    },
    // Observability helpers for /api/sync/status and the admin page.
    async recentRuns(job, limit = 20) {
      return job
        ? db.prepare('SELECT * FROM sync_runs WHERE job = ? ORDER BY id DESC LIMIT ?').all(job, limit)
        : db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit);
    },
    // E-D04 — the last N successful runs of one job, newest first (drift detector input).
    async recentOkRuns(job, limit = 10) {
      return db.prepare(`SELECT id, rows, duplicates, finished_at FROM sync_runs WHERE job = ? AND status = 'ok' ORDER BY id DESC LIMIT ?`).all(job, limit);
    },
    // F-ARCH-09 — finish time of the newest successful run of ANY job (readiness probe). Skips and errors do not count.
    async lastOkAt() {
      const r = await db.prepare(`SELECT MAX(finished_at) AS t FROM sync_runs WHERE status = 'ok'`).get();
      return (r && r.t) || null;
    },
    async health() {
      const rows = await db.prepare(
        `SELECT job, MAX(CASE WHEN status='ok' THEN finished_at END) AS last_ok,
                MAX(CASE WHEN status='error' THEN finished_at END) AS last_error,
                SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
                MAX(CASE WHEN status='skipped' THEN finished_at END) AS last_skipped,
                MAX(CASE WHEN status='skipped' THEN id END) AS last_skipped_id
         FROM sync_runs GROUP BY job ORDER BY job`).all();
      // F-ARCH-01 — a skip is not a collection: last_ok stays the last status 'ok' run; the newest skip and
      // its reason ride beside it so health can say "not configured" instead of "fresh".
      const ids = rows.map((r) => r.last_skipped_id).filter((x) => x != null);
      const why = new Map();
      const metas = ids.length ? await db.prepare(`SELECT id, meta FROM sync_runs WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
      for (const m of metas) {
        let reason = null; try { reason = m.meta ? (JSON.parse(m.meta).skipped || null) : null; } catch (_) { reason = null; }
        why.set(String(m.id), reason);
      }
      for (const r of rows) { r.skip_reason = r.last_skipped_id != null ? (why.get(String(r.last_skipped_id)) || null) : null; delete r.last_skipped_id; }
      return rows;
    },
  };
}

module.exports = { makeSyncStore, leaseLost };
