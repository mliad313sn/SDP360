-- MANUAL rollback of db/postgres/reports/043_portfolio_scope.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the extra sites of multi-site projects are lost; set portfolio_site_scope_reads / portfolio_editor_plan_writes to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/043_portfolio_scope.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS portfolio_project_sites;
COMMIT;
