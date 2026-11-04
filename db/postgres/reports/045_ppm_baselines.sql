-- A-27 (2026-11) — versioned project baselines + PPM exception alert state. ADDITIVE and idempotent; no existing row
-- changes. Rows are written only when the PROPOSED switches are on (report_config ppm_baseline_versions,
-- ppm_rebaseline_enabled, ppm_alerts_enabled — all '0' by default = today: no version row, no re-baseline, no alert).
--   portfolio_baselines  one row per captured / approved baseline version of a project (dates only, never money).
--                        APPEND-ONLY (sdp_append_only, migration 039): a correction is a new version, never an edit.
--   ppm_alert_state      dedup of tools/governance/ppm-alerts.js: one row per exception item key.
CREATE TABLE IF NOT EXISTS portfolio_baselines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  captured_at TEXT,
  captured_by INTEGER,
  approved_by INTEGER,
  approved_by_name TEXT,
  reason TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE (project_id, version)
);
CREATE TABLE IF NOT EXISTS ppm_alert_state (
  item_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id BIGINT,
  first_seen TEXT,
  last_notified TEXT,
  cleared_at TEXT
);
-- Append-only: UPDATE and DELETE are refused. The trigger also fires on a cascaded delete, so a project that has
-- baseline versions cannot be deleted any more (its approved plan history is kept) — only projects that passed
-- the approval gate while ppm_baseline_versions = '1', or were re-baselined, carry versions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'portfolio_baselines_append_only') THEN
    CREATE TRIGGER portfolio_baselines_append_only BEFORE UPDATE OR DELETE ON portfolio_baselines FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
