-- PORTFOLIO LOT 6 (IT portfolio reconstruction spec §12, §13, §16, §17, §29, §33) — structured dependencies, residual
-- risk, resource demand, effort scoring, project documents. ADDITIVE and idempotent: new tables + three NULLABLE columns
-- on portfolio_risks (NULL = unknown, never 0). No existing row or column changes meaning; the legacy JSON
-- portfolio_projects.depends_on stays as it is (read-compatible; tools/ppm/backfill-project-dependencies.js, dry run by
-- default, turns its entries into rows). Read and written only while the matching report_config switch is '1'
-- (PROPOSED, default '0' = today): ppm_structured_dependencies_enabled (dependencies + residual risk + exposure),
-- ppm_resource_demand_enabled, ppm_effort_scoring_enabled, ppm_documents_enabled. Every write also leaves a hash-chained
-- ppm_events row. No amount is stored in any of these tables. ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT6-phase2.md
-- Rollback: db/postgres_rollback/130_ppm_portfolio_phase2_drop.sql (manual).

-- §12 — "project A depends on" EITHER another project OR an external category (exactly one).
CREATE TABLE IF NOT EXISTS ppm_project_dependencies (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id             BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  predecessor_project_id BIGINT REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  external_category      TEXT,
  description            TEXT,
  owner                  TEXT,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'met', 'blocked', 'cancelled')),
  target_date            TEXT,
  criticality            TEXT CHECK (criticality IS NULL OR criticality IN ('low', 'medium', 'high', 'critical')),
  created_by             INTEGER,
  created_by_name        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT,
  deleted_at             TEXT,
  CHECK ((predecessor_project_id IS NULL) <> (external_category IS NULL)),
  CHECK (predecessor_project_id IS NULL OR predecessor_project_id <> project_id)
);
CREATE INDEX IF NOT EXISTS ix_ppm_project_dependencies_project ON ppm_project_dependencies (project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ppm_project_dependencies_pred ON ppm_project_dependencies (predecessor_project_id) WHERE deleted_at IS NULL;

-- §13 — residual risk and due date on the EXISTING register (no second risk register).
ALTER TABLE portfolio_risks ADD COLUMN IF NOT EXISTS residual_probability INTEGER;
ALTER TABLE portfolio_risks ADD COLUMN IF NOT EXISTS residual_impact INTEGER;
ALTER TABLE portfolio_risks ADD COLUMN IF NOT EXISTS due_date TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_risks_residual_range') THEN
    ALTER TABLE portfolio_risks ADD CONSTRAINT portfolio_risks_residual_range CHECK ((residual_probability IS NULL OR residual_probability BETWEEN 1 AND 3) AND (residual_impact IS NULL OR residual_impact BETWEEN 1 AND 3));
  END IF;
END $$;

-- §17 — one demand line per skill: numeric FTE only (categories live in delivery_effort), a window, internal / external.
CREATE TABLE IF NOT EXISTS ppm_project_demand (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  skill           TEXT NOT NULL,
  avg_fte         NUMERIC CHECK (avg_fte IS NULL OR (avg_fte >= 0 AND avg_fte <= 100)),
  peak_fte        NUMERIC CHECK (peak_fte IS NULL OR (peak_fte >= 0 AND peak_fte <= 100)),
  start_month     TEXT,
  finish_month    TEXT,
  sourcing        TEXT CHECK (sourcing IS NULL OR sourcing IN ('internal', 'external')),
  owner           TEXT,
  notes           TEXT,
  created_by      INTEGER,
  created_by_name TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  deleted_at      TEXT,
  CHECK (avg_fte IS NULL OR peak_fte IS NULL OR peak_fte >= avg_fte)
);
CREATE INDEX IF NOT EXISTS ix_ppm_project_demand_project ON ppm_project_demand (project_id) WHERE deleted_at IS NULL;

-- §16.2 — the seven effort factors (1..5 each, JSON), one row per project.
CREATE TABLE IF NOT EXISTS ppm_project_effort (
  project_id      BIGINT PRIMARY KEY REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  factors_json    TEXT NOT NULL,
  updated_by      INTEGER,
  updated_by_name TEXT,
  updated_at      TEXT NOT NULL
);

-- §29 — documents: metadata here, the file in the filesystem blob store (services/blobStore.js). Versioned, soft-deleted.
CREATE TABLE IF NOT EXISTS ppm_project_documents (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  doc_type         TEXT NOT NULL,
  title            TEXT NOT NULL,
  version          INTEGER NOT NULL CHECK (version >= 1),
  blob_ref         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256           TEXT NOT NULL,
  uploaded_by      INTEGER,
  uploaded_by_name TEXT,
  uploaded_at      TEXT NOT NULL,
  deleted_at       TEXT,
  deleted_by       INTEGER,
  UNIQUE (project_id, doc_type, title, version)
);
CREATE INDEX IF NOT EXISTS ix_ppm_project_documents_project ON ppm_project_documents (project_id) WHERE deleted_at IS NULL;
