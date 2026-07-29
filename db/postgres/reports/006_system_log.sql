-- System Logs v1 — unified security/audit event log (reports.db pg fork).
-- Written by logEvent() (fire-and-forget). Identity id = house-rule-safe (not BIGSERIAL).
CREATE TABLE IF NOT EXISTS system_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts        TEXT NOT NULL,
  category  TEXT NOT NULL,
  action    TEXT NOT NULL,
  actor     TEXT,
  actor_id  INTEGER,
  target    TEXT,
  details   TEXT,
  ip        TEXT,
  risk      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_syslog_ts       ON system_log(ts);
CREATE INDEX IF NOT EXISTS idx_syslog_category ON system_log(category);
CREATE INDEX IF NOT EXISTS idx_syslog_action   ON system_log(action);
CREATE INDEX IF NOT EXISTS idx_syslog_actor    ON system_log(actor);
CREATE INDEX IF NOT EXISTS idx_syslog_risk     ON system_log(risk);
