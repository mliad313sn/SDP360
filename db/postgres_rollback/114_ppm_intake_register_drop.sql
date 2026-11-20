-- MANUAL rollback of db/postgres/reports/114_ppm_intake_register.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_intake_register_enabled to '0' first (the default). Removes the intake fields, the
-- project ids (PRJ-YYYY-NNN) and the portfolio reference lists for good — the projects themselves and their `key` STAY.
-- Take a pg_dump before (the project ids are meant to be permanent). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/114_ppm_intake_register.sql';
DROP TABLE IF EXISTS ppm_lookup_values;
DROP TABLE IF EXISTS ppm_project_ref_seq;
DROP TRIGGER IF EXISTS portfolio_projects_ref_immutable ON portfolio_projects;
DROP FUNCTION IF EXISTS sdp_project_ref_immutable();
DROP INDEX IF EXISTS uq_portfolio_projects_ref;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS value_states;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS workload_notes;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS required_skills;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS peak_fte;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS avg_fte;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS risk_exposure;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS delivery_effort;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS decision_required;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS budget_reference;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS budget_approval_date;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS budget_status;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS schedule_confidence;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS indicative_quarter;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS delivery_lead;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS expected_value;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS business_need;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS priority;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS tags;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS project_type;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS project_ref;
