-- SDP360 — upgrade path from the 1.11 release (runs before sync/001_init.sql).
--
-- The 1.11 line created its own sync run log under the SAME name with a DIFFERENT shape
-- (run_id TEXT PRIMARY KEY, job_key, run_trigger, duration_ms, detail — 1.11
-- db/postgres/reports/015_sync_runs.sql). CREATE TABLE IF NOT EXISTS in 001_init.sql then kept
-- the 1.11 table and its CREATE INDEX on sync_runs(job, …) failed: column "job" does not exist.
--
-- Non-destructive: a 1.11-shaped sync_runs (has run_id, has no id) is RENAMED to sync_runs_v1
-- (every row kept, readable for audit), so 001_init.sql creates the 2.0 table. Its indexes keep
-- their names on purpose: a rolled-back 1.11 server finds ix_sync_runs_job already present and
-- skips it. sync_job_state (1.11 only) is not touched. No-op on a fresh or a 2.0 database.
DO $$
DECLARE
  target TEXT := 'sync_runs_v1';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'sync_runs' AND column_name = 'run_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'sync_runs' AND column_name = 'id') THEN
    IF to_regclass(quote_ident(current_schema()) || '.' || target) IS NOT NULL THEN
      target := 'sync_runs_v1_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
    END IF;
    EXECUTE format('ALTER TABLE sync_runs RENAME TO %I', target);
    RAISE NOTICE 'sync_runs (1.11 shape) kept as %', target;
  END IF;
END $$;
