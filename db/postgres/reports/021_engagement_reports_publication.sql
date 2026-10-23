-- Step 9 (SDP-DASH-2.0) — engagement (alert rules, notifications), report generator, external publication.
-- Executed as is on SQLite by services/engagement/store.js. Dates are ISO TEXT, compared as strings on both engines.
-- Secrets (webhook URLs, signing secrets) are stored encrypted (services/configSecrets.js, SDP_CONFIG_KEY); API keys
-- are stored as a hash only — the key itself is shown once, at creation.

-- ── Engagement ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS en_rules (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL,
  config_json    TEXT NOT NULL,
  channels_json  TEXT NOT NULL DEFAULT '["inapp"]',
  recipients_json TEXT NOT NULL DEFAULT '[]',
  persistence    INTEGER NOT NULL DEFAULT 1,
  cooldown_hours INTEGER NOT NULL DEFAULT 24,
  enabled        INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_by     TEXT,
  updated_at     TEXT
);
CREATE TABLE IF NOT EXISTS en_rule_state (
  rule_id      TEXT PRIMARY KEY,
  breaches     INTEGER NOT NULL DEFAULT 0,
  last_value   DOUBLE PRECISION,
  last_eval_at TEXT,
  firing       INTEGER NOT NULL DEFAULT 0,
  fire_id      TEXT,
  last_fired_at TEXT
);
CREATE TABLE IF NOT EXISTS en_fires (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  fired_at    TEXT NOT NULL,
  value       DOUBLE PRECISION,
  message     TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_en_fires_rule ON en_fires (rule_id, fired_at);
CREATE TABLE IF NOT EXISTS en_notifications (
  id         TEXT PRIMARY KEY,
  fire_id    TEXT,
  rule_id    TEXT,
  username   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT,
  emailed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_en_notifications_user ON en_notifications (username, created_at);
CREATE TABLE IF NOT EXISTS en_comments (
  id       TEXT PRIMARY KEY,
  fire_id  TEXT NOT NULL,
  username TEXT NOT NULL,
  text     TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS en_subscriptions (
  username TEXT NOT NULL,
  rule_id  TEXT NOT NULL,
  channel  TEXT NOT NULL,
  PRIMARY KEY (username, rule_id, channel)
);
CREATE TABLE IF NOT EXISTS en_channels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  url_enc    TEXT NOT NULL,
  secret_enc TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- ── Report generator ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rp_templates (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'custom', draft_json TEXT, draft_by TEXT, draft_at TEXT,
  published_version INTEGER, retired INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rp_template_versions (
  template_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
  published_by TEXT, published_at TEXT NOT NULL, note TEXT, PRIMARY KEY (template_id, version)
);
CREATE TABLE IF NOT EXISTS rp_runs (
  id               TEXT PRIMARY KEY,
  template_id      TEXT NOT NULL,
  template_version INTEGER,
  month            TEXT NOT NULL,
  site_code        TEXT,
  status           TEXT NOT NULL DEFAULT 'draft',
  data_json        TEXT,
  analysis_json    TEXT,
  ai_json          TEXT,
  commentary       TEXT,
  html             TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  approved_by      TEXT,
  approved_at      TEXT
);
CREATE INDEX IF NOT EXISTS ix_rp_runs_template ON rp_runs (template_id, month);
CREATE TABLE IF NOT EXISTS rp_run_events (
  run_id TEXT NOT NULL,
  at     TEXT NOT NULL,
  by     TEXT,
  action TEXT NOT NULL,
  note   TEXT
);
CREATE INDEX IF NOT EXISTS ix_rp_run_events_run ON rp_run_events (run_id, at);

-- ── External publication ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pb_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  scopes_json   TEXT NOT NULL DEFAULT '["metrics"]',
  quota_per_day INTEGER NOT NULL DEFAULT 1000,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  revoked_at    TEXT
);
CREATE TABLE IF NOT EXISTS pb_calls (
  client_id TEXT NOT NULL,
  at        TEXT NOT NULL,
  path      TEXT,
  status    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_pb_calls_client ON pb_calls (client_id, at);
CREATE TABLE IF NOT EXISTS pb_publications (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  channel_id    TEXT,
  recipients    TEXT,
  what_json     TEXT NOT NULL,
  cron          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  last_run_at   TEXT,
  last_status   TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
-- Monthly values of the published indicators, computed nightly (job publication.snapshot) and read by the OData feed
-- (Power BI): the feed never recomputes on request.
CREATE TABLE IF NOT EXISTS pb_metric_values (
  metric_key  TEXT NOT NULL,
  scope       TEXT NOT NULL,
  month       TEXT NOT NULL,
  value       DOUBLE PRECISION,
  unit        TEXT,
  rag         TEXT,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (metric_key, scope, month)
);
