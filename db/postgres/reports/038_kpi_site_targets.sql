-- Committee review 2026-10-28 (#40, CIO P1-5): KPI targets per site. A target for one metric, for one site
-- (or the platform, site_id NULL), dated; ended, never deleted. The KPI definitions themselves stay
-- decisions D-01..D-03 — this table only holds the numbers the committee sets. Empty = no target shown,
-- the behaviour until now. Changes are written to governance_role_events (entity kpi_target).
CREATE TABLE IF NOT EXISTS kpi_site_targets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_key TEXT NOT NULL, site_id INTEGER, target DOUBLE PRECISION NOT NULL,
  effective_from TEXT NOT NULL, reason TEXT, created_by INTEGER, created_at TEXT NOT NULL,
  ended_by INTEGER, ended_at TEXT);
CREATE INDEX IF NOT EXISTS idx_kpi_site_targets_key ON kpi_site_targets(metric_key, site_id);
