-- Step 1 (SDP-DASH-2.0) — sync runner journal. Mirror of the sqlite schema in
-- services/sync/store.js. One row per job run (sync_runs, purged after the retention
-- window) + one row per job with the streak/alert state (sync_job_state).
CREATE TABLE IF NOT EXISTS sync_runs (
  run_id       TEXT PRIMARY KEY,
  job_key      TEXT NOT NULL,
  run_trigger  TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 1,
  duration_ms  INTEGER,
  error        TEXT,
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS ix_sync_runs_job ON sync_runs (job_key, started_at);

CREATE TABLE IF NOT EXISTS sync_job_state (
  job_key              TEXT PRIMARY KEY,
  last_status          TEXT,
  last_run_at          TEXT,
  last_ok_at           TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_alerted_at   TEXT,
  stale_alerted_at     TEXT
);
