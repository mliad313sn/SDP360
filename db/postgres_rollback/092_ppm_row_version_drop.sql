-- MANUAL rollback of db/postgres/reports/092_ppm_row_version.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Drops only the version columns (no data meaning is lost: they only order concurrent edits). Deploy the
-- code that no longer reads them first. Afterwards: DELETE FROM schema_migrations WHERE id = 'reports/092_ppm_row_version.sql';
ALTER TABLE portfolio_milestones DROP COLUMN IF EXISTS version;
ALTER TABLE portfolio_tasks      DROP COLUMN IF EXISTS version;
ALTER TABLE portfolio_projects   DROP COLUMN IF EXISTS version;
