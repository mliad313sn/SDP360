-- B5 (goal programme P7, REQ B4) — timesheet WEEK approval + change-request impact simulation. ADDITIVE and idempotent:
-- one NEW table and three NEW nullable columns; no existing row or column changes meaning.
--   ppm_timesheet_weeks: the state of one person × project × ISO week (Monday start). No row = 'draft' (today: every
--   week). draft | rejected → submitted → approved | rejected (decided by a person who did not enter the hours — SoD
--   enforced by services/ppm/timesheets.tsTransition). A submitted / approved week freezes its time entries. Read and
--   written only while report_config ppm_timesheet_approval_enabled = '1' (the routes answer 404 while '0' = today).
--   ppm_change_requests.task_changes_json / simulation_json / simulated_at: the task changes a request proposes and the
--   impact the W1 date engine computed BEFORE the decision (services/ppm/crSimulation). Written only while
--   ppm_cr_simulation_enabled = '1'. Every step is also a hash-chained ppm_events row (entity 'project').
-- Rollback: db/postgres_rollback/102_ppm_timesheets_cr_simulation_drop.sql (manual).
CREATE TABLE IF NOT EXISTS ppm_timesheet_weeks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  person_key      TEXT NOT NULL,                       -- 'u:<user id>' or 'l:<folded label>'
  person_user_id  INTEGER,
  person_label    TEXT,
  week_start      TEXT NOT NULL CHECK (week_start ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  total_hours     NUMERIC,                             -- snapshot at submission; NULL = not submitted yet
  submitted_by    INTEGER,
  submitted_at    TEXT,
  decided_by      INTEGER,
  decided_by_name TEXT,
  decided_at      TEXT,
  decision_note   TEXT,
  UNIQUE (project_id, person_key, week_start)
);
CREATE INDEX IF NOT EXISTS idx_ppm_timesheet_weeks_project ON ppm_timesheet_weeks(project_id, week_start);
ALTER TABLE ppm_change_requests ADD COLUMN IF NOT EXISTS task_changes_json TEXT;
ALTER TABLE ppm_change_requests ADD COLUMN IF NOT EXISTS simulation_json TEXT;
ALTER TABLE ppm_change_requests ADD COLUMN IF NOT EXISTS simulated_at TEXT;
