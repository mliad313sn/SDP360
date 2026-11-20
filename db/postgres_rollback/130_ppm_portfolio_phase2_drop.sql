-- MANUAL rollback of db/postgres/reports/130_ppm_portfolio_phase2.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_structured_dependencies_enabled, ppm_resource_demand_enabled,
-- ppm_effort_scoring_enabled, ppm_documents_enabled, ppm_scenarios_enabled and ext_api_portfolio_enabled to '0' first
-- (the defaults). Removes the structured dependencies, demand lines, effort factors, document metadata and the residual
-- risk / due date columns for good — the projects, their risks and the legacy depends_on JSON STAY. The document FILES
-- stay in the blob store (data/blobs/ppm-doc/<project id>/): delete them by hand only after a backup. Take a pg_dump
-- first. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/130_ppm_portfolio_phase2.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS ppm_project_documents;
DROP TABLE IF EXISTS ppm_project_effort;
DROP TABLE IF EXISTS ppm_project_demand;
DROP TABLE IF EXISTS ppm_project_dependencies;
ALTER TABLE portfolio_risks DROP CONSTRAINT IF EXISTS portfolio_risks_residual_range;
ALTER TABLE portfolio_risks DROP COLUMN IF EXISTS due_date;
ALTER TABLE portfolio_risks DROP COLUMN IF EXISTS residual_impact;
ALTER TABLE portfolio_risks DROP COLUMN IF EXISTS residual_probability;
COMMIT;
