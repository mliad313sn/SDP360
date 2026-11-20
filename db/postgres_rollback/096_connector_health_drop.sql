-- MANUAL rollback of db/postgres/reports/096_connector_health.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Removes the fix-task history and the recorded prefill provenance for good — take a pg_dump
-- before. The application keeps working without them (the provenance badge reads "not recorded", the
-- Connector Health page lists no task). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/096_connector_health.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS connector_fix_tasks;
ALTER TABLE infra_kpis DROP COLUMN IF EXISTS value_data_through;
ALTER TABLE infra_kpis DROP COLUMN IF EXISTS value_source;
COMMIT;
