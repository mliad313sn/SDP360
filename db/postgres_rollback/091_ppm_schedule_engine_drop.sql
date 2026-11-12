-- MANUAL rollback of db/postgres/reports/091_ppm_schedule_engine.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Removes the scheduling fields for good (mode, task type, constraints, deadlines, link types) —
-- take a pg_dump before; set ppm_schedule_engine_v2_ui = '0' first. The engine then schedules every task as
-- auto / finish-to-start (the shipped default). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/091_ppm_schedule_engine.sql';
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS schedule_mode;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS task_type;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS effort_driven;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS deadline;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS constraint_type;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS constraint_date;
ALTER TABLE portfolio_tasks DROP COLUMN IF EXISTS dependency_links;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS finish_deadline;
