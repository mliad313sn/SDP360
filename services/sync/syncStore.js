'use strict';
// SDP360 — sync run / watermark / lock persistence for services/sync/syncRunner.js.
//
// Works against EITHER backend through the shared `prepare(sql).run/get/all` surface:
//   • better-sqlite3 (synchronous — `await` on a plain value is a no-op)
//   • services/pgDb.js makePgDb() (asynchronous)
// Placeholders are written in sqlite `?` style; pgDb translates them to $n.
// Schema: db/postgres/sync/001_init.sql (pg) — the sqlite DDL below is its byte-for-byte twin.

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  attempts INTEGER NOT NULL DEFAULT 0,
  rows INTEGER,
  duplicates INTEGER,
  upserted INTEGER,
  deleted INTEGER,
  error TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_job_started ON sync_runs(job, started_at);
CREATE TABLE IF NOT EXISTS sync_watermarks (
  job TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_locks (
  job TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  owner TEXT
);`;

function iso(ms) { return new Date(ms).toISOString(); }

/**
 * @param {object} db   - better-sqlite3 Database or pgDb instance
 * @param {object} [o]
 * @param {string} [o.owner] - lock owner label (host:pid)
 * @param {boolean} [o.init=true] - create tables (sqlite only; pg uses the SQL migration file)
 */
function makeSyncStore(db, o = {}) {
  const owner = o.owner || `${require('os').hostname()}:${process.pid}`;
  const isSqlite = typeof db.exec === 'function' && typeof db.pragma === 'function';
  if (isSqlite && o.init !== false) db.exec(SQLITE_DDL);

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
      return r.lastInsertRowid != null ? Number(r.lastInsertRowid) : r.lastID;
    },
    async finishRun(id, p) {
      await db.prepare(
        `UPDATE sync_runs SET finished_at = ?, status = ?, attempts = ?, rows = ?, duplicates = ?, upserted = ?, deleted = ?, error = ?
         WHERE id = ?`
      ).run(p.finished_at != null ? iso(p.finished_at) : null, p.status, p.attempts || 0,
        p.rows == null ? null : p.rows, p.duplicates == null ? null : p.duplicates,
        p.upserted == null ? null : p.upserted, p.deleted == null ? null : p.deleted,
        p.error == null ? null : String(p.error), id);
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
    async health() {
      const rows = await db.prepare(
        `SELECT job, MAX(CASE WHEN status='ok' THEN finished_at END) AS last_ok,
                MAX(CASE WHEN status='error' THEN finished_at END) AS last_error,
                SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
         FROM sync_runs GROUP BY job ORDER BY job`).all();
      return rows;
    },
  };
}

module.exports = { makeSyncStore, SQLITE_DDL };
