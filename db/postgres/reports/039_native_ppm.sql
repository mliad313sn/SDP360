-- G11 / G12 / G14 (programme 2026-10-29) — native PPM: stage gates, charter and baseline on projects, a WBS of
-- tasks with dependencies, an RFI → project lineage, and one append-only, hash-chained ledger (ppm_events) for
-- every gate passage, financial edit and RFI decision. ADDITIVE and idempotent; nothing existing changes meaning.
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'proposal';
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS charter TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS sponsor TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS baseline_start TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS forecast_end TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS actual_start TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS actual_end TEXT;
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS spend_type TEXT;              -- capex | opex | mixed (no amount implied)
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS rfi_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_projects_rfi ON portfolio_projects(rfi_id) WHERE rfi_id IS NOT NULL;
-- projects that existed before stage gates were introduced keep their life: an active project is in progress
UPDATE portfolio_projects SET stage = CASE status WHEN 'active' THEN 'in_progress' WHEN 'on_hold' THEN 'on_hold' WHEN 'done' THEN 'closed' WHEN 'cancelled' THEN 'closed' ELSE 'proposal' END
  WHERE stage = 'proposal' AND status <> 'planned';

CREATE TABLE IF NOT EXISTS portfolio_tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  parent_id BIGINT REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  wbs_code TEXT, name TEXT NOT NULL, owner TEXT,
  start_date TEXT, end_date TEXT, baseline_start TEXT, baseline_end TEXT, forecast_end TEXT, actual_start TEXT, actual_end TEXT,
  duration_days INTEGER, allocation_pct INTEGER DEFAULT 100, status TEXT NOT NULL DEFAULT 'todo', depends_on TEXT,
  sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_portfolio_tasks_project ON portfolio_tasks(project_id, sort_order);

CREATE TABLE IF NOT EXISTS ppm_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity TEXT NOT NULL, entity_id BIGINT NOT NULL, action TEXT NOT NULL,
  field TEXT, old_value TEXT, new_value TEXT, currency TEXT, note TEXT,
  actor_id INTEGER, actor TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ppm_events_entity ON ppm_events(entity, entity_id, id);
ALTER TABLE ppm_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE ppm_events ADD COLUMN IF NOT EXISTS row_hash TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_events_append_only') THEN
    CREATE TRIGGER ppm_events_append_only BEFORE UPDATE OR DELETE ON ppm_events FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_events_hash_chain') THEN
    CREATE TRIGGER ppm_events_hash_chain BEFORE INSERT ON ppm_events FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
