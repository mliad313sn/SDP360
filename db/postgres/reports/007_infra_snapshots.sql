-- V1a — OPManager infra availability snapshots (automated measurement history,
-- SEPARATE from infra_kpis). Composite PK, no surrogate id (avoids the
-- sqlite-AUTOINCREMENT vs pg-IDENTITY divergence). Applied by initPgReports.
CREATE TABLE IF NOT EXISTS infra_metric_snapshots (
  site_id               INTEGER NOT NULL,
  period_type           TEXT NOT NULL,        -- 'week' | 'month'
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  kpi_family            TEXT NOT NULL,        -- 'lan' | 'wifi' | 'wan' | 'servers'
  metric_name           TEXT NOT NULL,        -- 'availability'
  metric_value          DOUBLE PRECISION,
  target_value          DOUBLE PRECISION,
  status_color          TEXT,
  trend                 TEXT,
  source                TEXT,
  source_view           TEXT,
  data_through          TEXT,
  device_count          INTEGER,
  included_device_count INTEGER,
  collected_at          TEXT NOT NULL,
  raw_json              TEXT,
  PRIMARY KEY (site_id, period_type, period_start, kpi_family, metric_name)
);
