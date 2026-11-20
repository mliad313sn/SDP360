-- MANUAL rollback of db/postgres/reports/093_ppm_evm.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config ppm_evm_enabled = '0' first (the default). Removes the per-task EVM fields (method, physical %,
-- baseline cost, currency, hourly rate, CapEx/OpEx) for good — take a pg_dump before. The ppm_events rows that recorded
-- the edits stay (append-only). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/093_ppm_evm.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS ppm_task_evm;
COMMIT;
