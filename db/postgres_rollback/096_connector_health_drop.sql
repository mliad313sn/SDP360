-- MANUAL rollback of db/postgres/reports/096_connector_health.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Removes the fix-task history and the recorded prefill provenance for good — take a pg_dump
-- before. The application keeps working without them (the provenance badge reads "not recorded", the
-- Connector Health page lists no task). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/096_connector_health.sql';
DROP TABLE IF EXISTS connector_fix_tasks;
ALTER TABLE infra_kpis DROP COLUMN IF EXISTS value_data_through;
ALTER TABLE infra_kpis DROP COLUMN IF EXISTS value_source;
