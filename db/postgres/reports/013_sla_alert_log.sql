-- Teams SLA alerts (2026-10-03) — anti-duplicate log: one alert per (ticket, kind), ever.
-- Mirror of the sqlite schema in services/slaAlertLog.js. sent_at is TEXT-free here:
-- TIMESTAMPTZ, purged after 90 days by the poller.
CREATE TABLE IF NOT EXISTS sla_alert_log (
  request_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  group_name TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, kind)
);
CREATE INDEX IF NOT EXISTS ix_sla_alert_log_sent ON sla_alert_log (sent_at);
