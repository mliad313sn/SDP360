-- A-19c — soft delete for portfolio nodes and meeting cadences (switch report_config soft_delete_enabled,
-- default '0' = today's hard delete with its ON DELETE CASCADE down the tree). Additive and idempotent.
-- A deleted parent hides its children (governanceStore.portfolio() drops them); the children are never stamped.
ALTER TABLE portfolio_programmes   ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_programmes   ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_programmes   ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_objectives   ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_objectives   ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_objectives   ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_projects     ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_projects     ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_projects     ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_tasks        ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_tasks        ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_tasks        ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_milestones   ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_milestones   ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_milestones   ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_deliverables ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_deliverables ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_deliverables ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE portfolio_risks        ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE portfolio_risks        ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE portfolio_risks        ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE meeting_cadences       ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE meeting_cadences       ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE meeting_cadences       ADD COLUMN IF NOT EXISTS delete_reason TEXT;
