-- D2 (P10) — Value scoreboard: before / after snapshots around a switch flip. ADDITIVE and idempotent.
-- One row = the scoreboard metrics as they were at taken_at, optionally tied to the config_changed journal row
-- (system_log id) the admin was preparing or reviewing. Written only through POST /api/value-scoreboard/snapshot while
-- report_config value_scoreboard_enabled = '1' (default '0' = today, nothing is written). Metrics are the FLEET figures
-- only (no per-site rows, no amounts below the admin tier — the page itself is admin-only); a metric with no source is
-- stored as null, never 0.
CREATE TABLE IF NOT EXISTS value_scoreboard_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  taken_at TEXT NOT NULL,
  config_event_id BIGINT,
  config_key TEXT,
  note TEXT,
  metrics_json TEXT NOT NULL,
  taken_by INTEGER,
  taken_by_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_vss_taken_at ON value_scoreboard_snapshots(taken_at);
