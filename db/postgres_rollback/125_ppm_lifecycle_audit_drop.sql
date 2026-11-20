-- MANUAL rollback of db/postgres/reports/125_ppm_lifecycle_audit.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_extended_lifecycle_enabled, ppm_review_workflow_enabled, ppm_field_audit_enabled and
-- ppm_business_case_freeze_enabled to '0' first (the defaults). Fails (and changes nothing) while a gate checklist is
-- defined for an extended stage: move or delete those checklists first. The ppm_events rows written by the lot STAY
-- (append-only ledger). created_by / updated_by are dropped for good. Take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/125_ppm_lifecycle_audit.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
ALTER TABLE ppm_gate_checklists DROP CONSTRAINT IF EXISTS ppm_gate_checklists_gate_to_check;
ALTER TABLE ppm_gate_checklists ADD CONSTRAINT ppm_gate_checklists_gate_to_check CHECK (gate_to IN ('proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed'));
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS updated_by;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS created_by;
COMMIT;
