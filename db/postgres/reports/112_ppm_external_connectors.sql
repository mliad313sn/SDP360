-- W4-CONNECTORS (PPM parity J4) — OPTIONAL read-only pull of work items from Jira / Azure DevOps into a native project.
-- ADDITIVE and idempotent: two NEW tables, no existing row or column changes meaning. Read and written only while the
-- PROPOSED switch of the system is '1' (ppm_jira_sync_enabled / ppm_azdo_sync_enabled; the routes answer 404 while '0'
-- = today). Nothing is ever written back to the external tool. The native tool never reads these tables to work.
--   ppm_external_sources   a project's explicit opt-in to one system (+ its query scope) and the last sync result
--   ppm_external_links     native task ↔ external work item (idempotent upsert key: project × system × external key)
-- Rollback: db/postgres_rollback/112_ppm_external_connectors_drop.sql (manual).
CREATE TABLE IF NOT EXISTS ppm_external_sources (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  system          TEXT NOT NULL CHECK (system IN ('jira', 'azdo')),
  scope           TEXT NOT NULL,                     -- Jira project key or JQL · Azure DevOps area path
  enabled_by      INTEGER,
  enabled_by_name TEXT,
  enabled_at      TEXT NOT NULL,
  last_sync_at    TEXT,
  last_sync_by    TEXT,
  last_result_json TEXT,                             -- {created, updated, unchanged, …} of the last APPLIED sync
  UNIQUE (project_id, system)
);
CREATE TABLE IF NOT EXISTS ppm_external_links (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  task_id         BIGINT NOT NULL REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  system          TEXT NOT NULL CHECK (system IN ('jira', 'azdo')),
  external_key    TEXT NOT NULL,                     -- Jira issue key (ABC-12) · Azure DevOps work item id
  external_url    TEXT,
  external_status TEXT,
  external_type   TEXT,
  first_synced_at TEXT NOT NULL,
  last_synced_at  TEXT NOT NULL,
  UNIQUE (project_id, system, external_key)
);
CREATE INDEX IF NOT EXISTS idx_ppm_external_links_task ON ppm_external_links(task_id);
