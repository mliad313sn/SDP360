-- V1b — Meraki WAN link availability & quality snapshots (per-link, archived weekly/monthly).
-- Separate from infra_metric_snapshots (whose PK cannot hold wan1+wan2 as two 'wan' rows).
-- availability_pct is DERIVED (calibration-gated); NULL = no data, never 0. Composite PK,
-- no surrogate id (avoids the sqlite/pg autoinc divergence). Idempotent.
-- V1b-E: sub_site (default '') joins the PK so the multi-location Exploration report can
-- carry per-sub-site WAN rows; normal sites use '' and are unchanged.
CREATE TABLE IF NOT EXISTS wan_link_snapshots (
  site_id          INTEGER NOT NULL,
  sub_site         TEXT NOT NULL DEFAULT '',
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
  PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start)
);

-- V1b-E — editable map of a site's sub-site tokens to Meraki networks (Exploration).
-- One fetched network fans out to multiple {site_id, sub_site} targets in the sync.
CREATE TABLE IF NOT EXISTS wan_subsite_networks (
  site_id  INTEGER NOT NULL,
  sub_site TEXT NOT NULL,
  network  TEXT NOT NULL,
  PRIMARY KEY (site_id, sub_site)
);
