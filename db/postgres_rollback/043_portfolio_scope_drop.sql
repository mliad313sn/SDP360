-- MANUAL rollback of db/postgres/reports/043_portfolio_scope.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the extra sites of multi-site projects are lost; set portfolio_site_scope_reads / portfolio_editor_plan_writes to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/043_portfolio_scope.sql';
DROP TABLE IF EXISTS portfolio_project_sites;
