-- R2-WORKBENCH (REBUILD-SPEC R5, gaps of docs/audits/2026-11-12-enterprise-review/WORKBENCH-GAPS.md). ADDITIVE and
-- idempotent: new tables only, no existing row changes meaning. Each table is read and written only while its
-- PROPOSED report_config switch is '1' (the routes answer 404 while '0' = today). Every write is also a hash-chained
-- ppm_events row (entity 'project').

-- R2-WB-04 — project team: named members with a role, an optional link to a user account (the label stays — owners
-- remain free text, no existing owner is migrated), an optional allocation to the project (NULL = unknown, never
-- 0 % nor 100 %) and an optional window. Switch ppm_project_team_enabled.
CREATE TABLE IF NOT EXISTS ppm_project_members (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  user_id        INTEGER,
  label          TEXT NOT NULL,
  role           TEXT,
  allocation_pct NUMERIC CHECK (allocation_pct IS NULL OR (allocation_pct >= 0 AND allocation_pct <= 100)),
  from_day       TEXT CHECK (from_day IS NULL OR from_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  to_day         TEXT CHECK (to_day IS NULL OR to_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_by     INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ppm_project_members_project ON ppm_project_members(project_id);
