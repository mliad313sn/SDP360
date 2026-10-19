'use strict';
// Step 1 (SDP-DASH-2.0) — persistence of the sync runner: one row per run (sync_runs) and
// one row per job (sync_job_state: streak of failures, last ok, alert latches).
// sqlite (schema created lazily here) + PostgreSQL (db/postgres/reports/015_sync_runs.sql,
// applied by initPgReports). Every function returns a Promise on both backends. Dates are
// ISO strings (TEXT on both engines — compared as strings, never cast).

function _h() {
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: rdb.db, isPg: false };
}

const _inited = new WeakSet();
function _initSchema(db) {
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS sync_runs (
    run_id TEXT PRIMARY KEY, job_key TEXT NOT NULL, run_trigger TEXT,
    started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER, error TEXT, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_sync_runs_job ON sync_runs (job_key, started_at);
  CREATE TABLE IF NOT EXISTS sync_job_state (
    job_key TEXT PRIMARY KEY, last_status TEXT, last_run_at TEXT, last_ok_at TEXT, last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, failure_alerted_at TEXT, stale_alerted_at TEXT
  );`);
  _inited.add(db);
}
function _db() { const x = _h(); if (!x.isPg) _initSchema(x.H); return x; }

async function recordRun(run) {
  const { H } = _db();
  await H.prepare(`INSERT INTO sync_runs (run_id, job_key, run_trigger, started_at, finished_at, status, attempts, duration_ms, error, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.run_id, run.job_key, run.trigger || null, run.started_at,
    run.finished_at || null, run.status, run.attempts || 1, run.duration_ms == null ? null : run.duration_ms,
    run.error ? String(run.error).slice(0, 1000) : null, run.detail ? String(run.detail).slice(0, 4000) : null);
}

async function getState(jobKey) {
  const { H } = _db();
  return (await H.prepare(`SELECT * FROM sync_job_state WHERE job_key = ?`).get(jobKey)) || null;
}

async function listStates() {
  const { H } = _db();
  return H.prepare(`SELECT * FROM sync_job_state ORDER BY job_key`).all();
}

/** Upsert the whole state row (the runner computes it). */
async function saveState(s) {
  const { H } = _db();
  await H.prepare(`INSERT INTO sync_job_state (job_key, last_status, last_run_at, last_ok_at, last_error,
      consecutive_failures, failure_alerted_at, stale_alerted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (job_key) DO UPDATE SET last_status = EXCLUDED.last_status, last_run_at = EXCLUDED.last_run_at,
      last_ok_at = EXCLUDED.last_ok_at, last_error = EXCLUDED.last_error,
      consecutive_failures = EXCLUDED.consecutive_failures, failure_alerted_at = EXCLUDED.failure_alerted_at,
      stale_alerted_at = EXCLUDED.stale_alerted_at`).run(s.job_key, s.last_status || null, s.last_run_at || null,
    s.last_ok_at || null, s.last_error ? String(s.last_error).slice(0, 1000) : null,
    s.consecutive_failures || 0, s.failure_alerted_at || null, s.stale_alerted_at || null);
}

async function recentRuns({ jobKey, limit = 50 } = {}) {
  const { H } = _db();
  const n = Math.min(500, Math.max(1, Number(limit) || 50));
  if (jobKey) return H.prepare(`SELECT * FROM sync_runs WHERE job_key = ? ORDER BY started_at DESC, run_id LIMIT ${n}`).all(jobKey);
  return H.prepare(`SELECT * FROM sync_runs ORDER BY started_at DESC, run_id LIMIT ${n}`).all();
}

/** Success ratio per job over the runs started on/after `since` (ISO). */
async function successStats(since) {
  const { H } = _db();
  return H.prepare(`SELECT job_key,
      SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed,
      COUNT(*) AS total
    FROM sync_runs WHERE started_at >= ? GROUP BY job_key ORDER BY job_key`).all(String(since));
}

async function purge(days = 30) {
  const { H } = _db();
  const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
  const r = await H.prepare(`DELETE FROM sync_runs WHERE started_at < ?`).run(cutoff);
  return (r && (r.changes || r.rowCount)) || 0;
}

module.exports = { recordRun, getState, listStates, saveState, recentRuns, successStats, purge };
