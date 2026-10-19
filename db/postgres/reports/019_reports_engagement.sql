-- Step 9 — report templates/runs, alert rules + state + firings, notifications (+ comments),
-- subscriptions, share links + receipts, API consumers + call log. Idempotent.
-- Mirrors: services/reportStore.js SQLITE_DDL and services/engagementStore.js SQLITE_DDL.

CREATE TABLE IF NOT EXISTS report_templates (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'site', dashboard_key TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'en',
  cadence TEXT NOT NULL DEFAULT 'monthly', sections TEXT, recipients TEXT, ai_enabled INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS report_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, template_key TEXT NOT NULL REFERENCES report_templates(key) ON DELETE CASCADE, site_id INTEGER, window_label TEXT,
  status TEXT NOT NULL DEFAULT 'draft', figures TEXT, analysis TEXT, commentary TEXT, html TEXT, provider TEXT, deviation INTEGER DEFAULT 0,
  created_by INTEGER, created_at TEXT, reviewed_by INTEGER, reviewed_at TEXT, review_note TEXT, rating INTEGER, published_at TEXT);
CREATE INDEX IF NOT EXISTS idx_report_runs_tpl ON report_runs(template_key, created_at);

CREATE TABLE IF NOT EXISTS alert_rules (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, metric TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'site', site_id INTEGER, window_label TEXT, op TEXT NOT NULL, threshold TEXT NOT NULL,
  streak INTEGER NOT NULL DEFAULT 1, cooldown_min INTEGER NOT NULL DEFAULT 1440, channels TEXT, recipients TEXT, enabled INTEGER NOT NULL DEFAULT 1, description TEXT,
  created_by INTEGER, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS alert_state (state_key TEXT PRIMARY KEY, rule_key TEXT NOT NULL, breaches INTEGER NOT NULL DEFAULT 0, last_fired_at TEXT, last_value TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS alert_firings (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, rule_key TEXT NOT NULL, site_id INTEGER, value TEXT, message TEXT, channels TEXT, fired_at TEXT, false_positive INTEGER DEFAULT 0, note TEXT);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, source_kind TEXT, source_ref TEXT,
  created_at TEXT, read_at TEXT, digested_at TEXT);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS notification_comments (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source_kind TEXT NOT NULL, source_ref TEXT NOT NULL, user_id INTEGER, user_name TEXT, body TEXT NOT NULL, created_at TEXT);
CREATE TABLE IF NOT EXISTS subscriptions (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, target_key TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'inapp', digest TEXT NOT NULL DEFAULT 'none', created_at TEXT, UNIQUE(user_id, kind, target_key, channel));
CREATE TABLE IF NOT EXISTS share_links (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, target_kind TEXT NOT NULL, target_key TEXT NOT NULL, site_id INTEGER, label TEXT, embed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL, max_views INTEGER, views INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS share_views (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, link_id BIGINT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE, viewed_at TEXT, agent TEXT, ip_hash TEXT);
CREATE TABLE IF NOT EXISTS api_consumers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, key_hint TEXT, scopes TEXT, quota_per_day INTEGER NOT NULL DEFAULT 5000, enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at TEXT, last_used_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS api_calls (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, consumer_id BIGINT NOT NULL, path TEXT, status INTEGER, ms INTEGER, called_at TEXT);
CREATE INDEX IF NOT EXISTS idx_api_calls_day ON api_calls(consumer_id, called_at);
