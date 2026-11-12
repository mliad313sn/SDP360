-- MANUAL rollback of db/postgres/reports/080_task_allocation_check.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (no data is lost: only the 0..100 CHECK on portfolio_tasks.allocation_pct goes). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/080_task_allocation_check.sql';
ALTER TABLE portfolio_tasks DROP CONSTRAINT IF EXISTS portfolio_tasks_allocation_pct_range;
