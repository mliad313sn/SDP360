-- A-19a — soft delete for inspections (switch report_config soft_delete_enabled, default '0' = hard delete).
-- Additive and idempotent: three nullable columns, no existing row changes. Readers filter deleted_at IS NULL.
ALTER TABLE insp_inspections ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE insp_inspections ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE insp_inspections ADD COLUMN IF NOT EXISTS delete_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_insp_inspections_deleted ON insp_inspections (deleted_at) WHERE deleted_at IS NOT NULL;
