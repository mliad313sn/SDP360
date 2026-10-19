-- SDP360 — synchronisation run log, watermarks and locks (Phase 1 Foundation & Sync).
-- Written by services/sync/syncStore.js through services/sync/syncRunner.js.
-- Idempotent. Identity id = house-rule-safe (not BIGSERIAL), see 006_system_log.sql.

CREATE TABLE IF NOT EXISTS sync_runs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running',   -- running | ok | error
  attempts    INTEGER NOT NULL DEFAULT 0,
  rows        INTEGER,
  duplicates  INTEGER,
  upserted    INTEGER,
  deleted     INTEGER,
  error       TEXT,                               -- scrubbed: never carries a token or key
  meta        TEXT                                -- JSON: watermark at start, source, etc.
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_job_started ON sync_runs(job, started_at);

CREATE TABLE IF NOT EXISTS sync_watermarks (
  job        TEXT PRIMARY KEY,
  value      TEXT,                                -- ISO timestamp or opaque cursor
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_locks (
  job       TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  owner     TEXT                                  -- host:pid that holds the lock
);
