-- V1b — Meraki WAN link availability & quality snapshots (per-link, archived weekly/monthly).
-- Separate from infra_metric_snapshots (whose PK cannot hold wan1+wan2 as two 'wan' rows).
-- availability_pct is DERIVED (calibration-gated); NULL = no data, never 0. Composite PK,
-- no surrogate id (avoids the sqlite/pg autoinc divergence). Idempotent.
CREATE TABLE IF NOT EXISTS wan_link_snapshots (
  site_id          INTEGER NOT NULL,
  uplink           TEXT NOT NULL,
  period_type      TEXT NOT NULL,
  period_start     TEXT NOT NULL,
  period_end       TEXT,
  availability_pct DOUBLE PRECISION,
  status_color     TEXT,
  loss_pct_avg     DOUBLE PRECISION,
  latency_ms_avg   DOUBLE PRECISION,
  jitter_ms_avg    DOUBLE PRECISION,
  goodput_avg      DOUBLE PRECISION,
  status_current   TEXT,
  uplink_label     TEXT,
  device_serial    TEXT,
  network_id       TEXT,
  data_through     TEXT,
  collected_at     TEXT,
  source           TEXT,
  raw_json         TEXT,
  PRIMARY KEY (site_id, uplink, period_type, period_start)
);
