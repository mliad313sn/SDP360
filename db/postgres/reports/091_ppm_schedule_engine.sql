-- W1-ENGINE — fields the date-based scheduling engine (services/ppm/scheduleEngine.js) reads. ADDITIVE only:
-- every column is nullable, NULL = today's behaviour (auto mode, finish-to-start links, no constraint, no deadline).
--   portfolio_tasks.schedule_mode     'auto' | 'manual' (NULL = auto). Auto: an entered start is a start-no-earlier-than.
--   portfolio_tasks.task_type         'fixed_units' | 'fixed_duration' | 'fixed_work' (NULL = no W = D × U rule)
--   portfolio_tasks.effort_driven     0 | 1 (NULL = on, the MS-Project default)
--   portfolio_tasks.deadline          YYYY-MM-DD; a later finish gives negative float
--   portfolio_tasks.constraint_type   ASAP | ALAP | SNET | SNLT | FNET | FNLT | MSO | MFO (NULL = none)
--   portfolio_tasks.constraint_date   YYYY-MM-DD (all but ASAP / ALAP need one)
--   portfolio_tasks.dependency_links  JSON [{id, type: FS|SS|FF|SF, lag: working days}] for ids in depends_on
--   portfolio_projects.finish_deadline YYYY-MM-DD; the plan's backward pass starts no later than this day
-- Rollback (manual, outside the migrator): db/postgres_rollback/091_ppm_schedule_engine_drop.sql
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS schedule_mode TEXT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS task_type TEXT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS effort_driven SMALLINT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS deadline TEXT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS constraint_type TEXT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS constraint_date TEXT;
ALTER TABLE portfolio_tasks ADD COLUMN IF NOT EXISTS dependency_links TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS finish_deadline TEXT;
