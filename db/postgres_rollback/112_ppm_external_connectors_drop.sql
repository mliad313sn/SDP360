-- MANUAL rollback of db/postgres/reports/112_ppm_external_connectors.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_jira_sync_enabled and ppm_azdo_sync_enabled to '0' first (the defaults). Removes the
-- per-project opt-ins and the task ↔ work-item links for good — the native tasks created by a sync STAY (they are
-- ordinary portfolio_tasks rows). Take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/112_ppm_external_connectors.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS ppm_external_links;
DROP TABLE IF EXISTS ppm_external_sources;
COMMIT;
