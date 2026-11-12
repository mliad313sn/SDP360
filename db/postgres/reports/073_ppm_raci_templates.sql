-- W2-PPM / E-P06 (audit P-06, RACI + templates half; the Gantt exists since C-14). ADDITIVE and idempotent.
-- RACI: per project, task × person letters R / A / C / I; exactly ONE A per task (services/ppmRaci validates, the
-- store refuses otherwise). The person is free text like every PPM owner. Used only while ppm_raci_enabled = '1'.
CREATE TABLE IF NOT EXISTS ppm_raci (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  task_id    BIGINT NOT NULL REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  person     TEXT NOT NULL,
  letter     TEXT NOT NULL CHECK (letter IN ('R', 'A', 'C', 'I')),
  updated_by INTEGER,
  updated_at TEXT,
  UNIQUE (task_id, person, letter)
);
CREATE INDEX IF NOT EXISTS idx_ppm_raci_project ON ppm_raci(project_id, task_id);

-- Project templates: the STRUCTURE of a project only (task names, WBS, parent links, durations, milestone names) —
-- never people, dates or money. 'draft' until a PMO (committee) member other than its author approves it (the act is
-- a ppm_events row). Only an approved template creates a project. Used only while ppm_templates_enabled = '1'.
CREATE TABLE IF NOT EXISTS ppm_templates (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              TEXT NOT NULL,
  structure         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  source_project_id BIGINT,
  created_by        INTEGER,
  created_by_name   TEXT,
  created_at        TEXT,
  approved_by       INTEGER,
  approved_by_name  TEXT,
  approved_at       TEXT,
  approval_note     TEXT
);
