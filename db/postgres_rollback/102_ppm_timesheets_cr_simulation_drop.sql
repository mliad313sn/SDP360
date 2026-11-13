-- MANUAL rollback of db/postgres/reports/102_ppm_timesheets_cr_simulation.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Set report_config ppm_timesheet_approval_enabled = '0' and ppm_cr_simulation_enabled = '0' first (the
-- defaults). Removes the timesheet week states (submissions, approvals, rejections) and the stored change-request task
-- changes and simulations for good — take a pg_dump before. The time entries themselves and the ppm_events rows stay.
-- Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/102_ppm_timesheets_cr_simulation.sql';
ALTER TABLE ppm_change_requests DROP COLUMN IF EXISTS simulated_at;
ALTER TABLE ppm_change_requests DROP COLUMN IF EXISTS simulation_json;
ALTER TABLE ppm_change_requests DROP COLUMN IF EXISTS task_changes_json;
DROP TABLE IF EXISTS ppm_timesheet_weeks;
