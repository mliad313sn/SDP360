'use strict';
// SDP360 — sync run / watermark / lock persistence for services/sync/syncRunner.js.
//
// PostgreSQL only (PO-08), through services/pgDb.js makePgDb() (`?` placeholders → $n).
// Schema: db/postgres/sync/001_init.sql, applied by db/migrate.js.


function iso(ms) { return new Date(ms).toISOString(); }

/**
 * @param {object} db   - pgDb instance
 * @param {object} [o]
 * @param {string} [o.owner] - lock owner label (host:pid)
 */
function makeSyncStore(db, o = {}) {
  const owner = o.owner || `${require('os').hostname()}:${process.pid}`;

  return {
    async acquireLock(job, nowMs, ttlMs) {
      const cur = await db.prepare('SELECT locked_at FROM sync_locks WHERE job = ?').get(job);
      if (cur) {
        const age = nowMs - Date.parse(cur.locked_at);
        if (age < ttlMs) return false;
        // stale lock from a crashed run → steal it
        await db.prepare('DELETE FROM sync_locks WHERE job = ?').run(job);
      }
      try {
        await db.prepare('INSERT INTO sync_locks (job, locked_at, owner) VALUES (?, ?, ?)').run(job, iso(nowMs), owner);
        return true;
      } catch (e) {
        return false; // lost the race on the PRIMARY KEY
      }
    },
    async releaseLock(job) { await db.prepare('DELETE FROM sync_locks WHERE job = ?').run(job); },
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

module.exports = { makeSyncStore };
