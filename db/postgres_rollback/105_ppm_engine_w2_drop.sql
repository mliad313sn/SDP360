-- MANUAL rollback of db/postgres/reports/105_ppm_engine_w2.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config ppm_calendars_enabled / ppm_resources_enabled / ppm_leveling_enabled / ppm_baseline_slots_enabled /
-- ppm_mspdi_enabled to '0' first (the defaults). Removes the W2 calendars, resource pool, rates, assignments, levelling
-- delays and baseline slots for good — take a pg_dump before (the saved baseline slots are an APPEND-ONLY history).
-- The ppm_events rows that recorded the edits stay (append-only). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/105_ppm_engine_w2.sql';
DROP TABLE IF EXISTS ppm_baseline_slots;
DROP TABLE IF EXISTS ppm_assignments;
DROP TABLE IF EXISTS ppm_resource_rates;
DROP TABLE IF EXISTS ppm_resources;
DROP TABLE IF EXISTS ppm_task_engine;
DROP TABLE IF EXISTS ppm_project_engine;
DROP TABLE IF EXISTS ppm_calendar_exceptions;
DROP TABLE IF EXISTS ppm_calendars;
