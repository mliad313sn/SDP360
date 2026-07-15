-- Chunk 4E — reporting suite (recipients / config / schedules / sent-log).
CREATE TABLE IF NOT EXISTS report_recipients (
  site_code TEXT PRIMARY KEY, site_name TEXT,
  coordinator_name TEXT, coordinator_email TEXT, coordinator_email_confirmed INTEGER DEFAULT 0,
  fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
  cc_emails TEXT, active INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE IF NOT EXISTS report_config (
  key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE IF NOT EXISTS report_schedules (
  report_type TEXT, cadence TEXT, enabled INTEGER DEFAULT 0,
  day TEXT, time TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT,
  PRIMARY KEY (report_type, cadence)
);
CREATE TABLE IF NOT EXISTS report_sent_log (
  id SERIAL PRIMARY KEY, report_type TEXT, site_code TEXT, period TEXT,
  recipients TEXT, result TEXT, sent_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_sent_log_dedup ON report_sent_log(report_type, site_code, period);
