-- MANUAL rollback of db/postgres/reports/044_project_page.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (task progress / effort, milestone owners and the RAID kind are lost (every RAID row becomes a plain risk again)). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/044_project_page.sql';
ALTER TABLE portfolio_risks      DROP COLUMN IF EXISTS kind;
ALTER TABLE portfolio_milestones DROP COLUMN IF EXISTS owner;
ALTER TABLE portfolio_tasks      DROP COLUMN IF EXISTS effort_hours;
ALTER TABLE portfolio_tasks      DROP COLUMN IF EXISTS progress_pct;
