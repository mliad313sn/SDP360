-- A-19b — soft delete for PVs (switch report_config soft_delete_enabled, default '0' = hard delete).
-- Additive and idempotent: three nullable columns, no existing row changes. Readers filter deleted_at IS NULL;
-- issues / actions / projects of a deleted PV stay in place (hidden through the parent join).
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS delete_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_md_meetings_deleted ON md_meetings (deleted_at) WHERE deleted_at IS NOT NULL;
