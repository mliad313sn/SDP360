-- PORTFOLIO LOT 5 (IT portfolio reconstruction spec §15, §26, §28) — extended lifecycle, review workflow, field audit.
-- ADDITIVE and idempotent. Nothing changes meaning while the PROPOSED switches stay '0' (= today):
--   portfolio_projects.created_by / updated_by  written only while ppm_field_audit_enabled or ppm_review_workflow_enabled
--                                               is '1' (user id of the session; NULL = unknown, never guessed)
--   ppm_gate_checklists.gate_to CHECK           widened to the extended stages so a checklist can be defined for a new
--                                               stage — only reachable while ppm_extended_lifecycle_enabled = '1'
-- portfolio_projects.stage stays TEXT without a CHECK (unchanged). Every review action, field change and frozen-field
-- change request is a row of the existing hash-chained, append-only ppm_events ledger: no new audit table.
-- Rollback: db/postgres_rollback/125_ppm_lifecycle_audit_drop.sql (manual).
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS updated_by INTEGER;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ppm_gate_checklists_gate_to_check' AND conrelid = 'ppm_gate_checklists'::regclass) THEN
    ALTER TABLE ppm_gate_checklists DROP CONSTRAINT ppm_gate_checklists_gate_to_check;
  END IF;
  ALTER TABLE ppm_gate_checklists ADD CONSTRAINT ppm_gate_checklists_gate_to_check CHECK (gate_to IN ('idea', 'assessment', 'proposal', 'approval', 'in_progress', 'on_hold', 'handover', 'benefits_review', 'closure', 'closed', 'deferred', 'rejected', 'cancelled'));
END $$;
