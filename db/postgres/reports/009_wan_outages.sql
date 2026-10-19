-- WAN SLA / ISP chargeback — one row per detected WAN outage.
-- Separate from wan_link_snapshots (which archives periodic availability/quality); this
-- table records discrete outage events for SLA reporting and ISP chargeback.
-- detected_start/restored_end are TEXT timestamps; duration_s is computed in JS (never
-- date math in SQL — the pg-strict trap). Composite PK, no surrogate id (avoids the
-- sqlite/pg autoinc divergence). Idempotent.
CREATE TABLE IF NOT EXISTS wan_outages (
  site_id            INTEGER NOT NULL,
  sub_site           TEXT NOT NULL DEFAULT '',
  uplink             TEXT NOT NULL,
  isp                TEXT,
  circuit_id         TEXT,
  detected_start     TEXT NOT NULL,
  restored_end       TEXT,
  notified_at        TEXT,
  duration_s         INTEGER,
  attribution        TEXT,
  attribution_reason TEXT,
  network_id         TEXT,
  device_serial      TEXT,
  source             TEXT,
  raw_json           TEXT,
  PRIMARY KEY (site_id, sub_site, uplink, detected_start)
);
