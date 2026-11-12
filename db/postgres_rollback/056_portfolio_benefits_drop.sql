-- MANUAL rollback of db/postgres/reports/056_portfolio_benefits.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (every expected / realised benefit and its verification is lost). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/056_portfolio_benefits.sql';
DROP TABLE IF EXISTS portfolio_benefits;
