-- MANUAL rollback of db/postgres/reports/072_ppm_budget_periods.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the budget-per-period rows and the benefit owner links are lost; set ppm_budget_periods_enabled / benefit_owner_link_enabled to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/072_ppm_budget_periods.sql';
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS owner_user_id;
DROP TABLE IF EXISTS ppm_budget_periods;
