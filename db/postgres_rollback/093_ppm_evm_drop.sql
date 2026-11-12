-- MANUAL rollback of db/postgres/reports/093_ppm_evm.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config ppm_evm_enabled = '0' first (the default). Removes the per-task EVM fields (method, physical %,
-- baseline cost, currency, hourly rate, CapEx/OpEx) for good — take a pg_dump before. The ppm_events rows that recorded
-- the edits stay (append-only). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/093_ppm_evm.sql';
DROP TABLE IF EXISTS ppm_task_evm;
