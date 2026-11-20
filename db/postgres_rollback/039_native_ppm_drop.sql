-- MANUAL rollback of db/postgres/reports/039_native_ppm.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (this DESTROYS the hash-chained PPM ledger ppm_events (gate passages, financial edits, RFI decisions) and every WBS task — audit evidence that cannot be rebuilt; a human decision, never a routine step). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/039_native_ppm.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS ppm_events;
DROP TABLE IF EXISTS portfolio_tasks;
DROP INDEX IF EXISTS uq_portfolio_projects_rfi;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS rfi_id;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS spend_type;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS actual_end;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS actual_start;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS forecast_end;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS baseline_start;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS sponsor;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS charter;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS stage;
COMMIT;
