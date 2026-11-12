-- MANUAL rollback of db/postgres/reports/052_portfolio_soft_delete.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (every soft-deleted portfolio node and cadence comes BACK as live, because the stamp is what hid it; purge or restore them first, set soft_delete_enabled='0' and deploy code that does not read deleted_at). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/052_portfolio_soft_delete.sql';
ALTER TABLE meeting_cadences       DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE meeting_cadences       DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE meeting_cadences       DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_risks        DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_risks        DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_risks        DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_deliverables DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_deliverables DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_deliverables DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_milestones   DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_milestones   DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_milestones   DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_tasks        DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_tasks        DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_tasks        DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_projects     DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_projects     DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_projects     DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_objectives   DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_objectives   DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_objectives   DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE portfolio_programmes   DROP COLUMN IF EXISTS delete_reason;
ALTER TABLE portfolio_programmes   DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE portfolio_programmes   DROP COLUMN IF EXISTS deleted_at;
