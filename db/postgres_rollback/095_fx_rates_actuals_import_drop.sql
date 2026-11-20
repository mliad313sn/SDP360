-- MANUAL rollback of db/postgres/reports/095_fx_rates_actuals_import.sql. Kept OUTSIDE db/postgres/ so the
-- migrator never applies it. Set actuals_import_enabled = '0' first (the default). Removes the dated FX rates, the
-- display-currency preferences, the saved import mappings and the import batch records. The ACTUALS already written
-- to ppm_budget_periods stay (they are ordinary budget-period rows, ledgered in ppm_events). Take a pg_dump before.
-- Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/095_fx_rates_actuals_import.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS actuals_import_batches;
DROP TABLE IF EXISTS actuals_import_templates;
DROP TABLE IF EXISTS user_finance_prefs;
DROP TABLE IF EXISTS fx_rates;
COMMIT;
