-- The two tables the 1.11 release creates under a name 2.0 also uses, in their 1.11 SHAPE
-- (1.11 db/migrate.js JOURNAL_DDL and 1.11 db/postgres/reports/015_sync_runs.sql, release
-- a079fd5). Structure only, plus synthetic rows that let the test prove nothing is lost.
-- Used by tests/pg-migrate-from-111.test.js. Not a migration, never applied in production.
CREATE TABLE schema_migrations (
  module     TEXT NOT NULL,
  filename   TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module, filename)
);
INSERT INTO schema_migrations (module, filename, checksum, applied_at) VALUES
  ('reports', '001_auth.sql',     'fixture-checksum-1', '2026-09-01T00:00:00.000Z'),
  ('reports', '015_sync_runs.sql', 'fixture-checksum-2', '2026-09-01T00:00:00.000Z');

CREATE TABLE sync_runs (
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
CREATE INDEX ix_sync_runs_job ON sync_runs (job_key, started_at);
INSERT INTO sync_runs (run_id, job_key, started_at, status) VALUES ('fixture-run-1', 'fixture.job', '2026-09-01T00:00:00.000Z', 'ok');

CREATE TABLE sync_job_state (
  job_key              TEXT PRIMARY KEY,
  last_status          TEXT,
  last_run_at          TEXT,
  last_ok_at           TEXT,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_alerted_at   TEXT,
  stale_alerted_at     TEXT
);
