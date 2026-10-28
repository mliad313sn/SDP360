-- G-22 (committee review 2026-10-28) — interdepartmental business handoffs. ADDITIVE and idempotent:
-- two new tables, nothing existing changes. Feature flag handoffs_enabled (default '0').
-- Rules: services/handoffLifecycle.js (pure). handoff_events is append-only (audit).
CREATE TABLE IF NOT EXISTS handoffs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ref TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT,
  site_id INTEGER NOT NULL, from_department TEXT NOT NULL, to_department TEXT NOT NULL,
  requested_by INTEGER NOT NULL, receiver_id INTEGER NOT NULL, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'requested', escalated_from TEXT, escalated_at TEXT, last_reason TEXT,
  accepted_at TEXT, delivered_at TEXT, delivered_by INTEGER, verified_at TEXT, verified_by INTEGER,
  source_kind TEXT, source_ref TEXT, commitment_id BIGINT, idem_key TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (requested_by, idem_key));
CREATE INDEX IF NOT EXISTS idx_handoffs_site_status ON handoffs(site_id, status);
CREATE INDEX IF NOT EXISTS idx_handoffs_receiver ON handoffs(receiver_id, status);
CREATE TABLE IF NOT EXISTS handoff_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, handoff_id BIGINT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,
  at TEXT NOT NULL, actor_id INTEGER, action TEXT NOT NULL, from_status TEXT, to_status TEXT, details TEXT);
CREATE INDEX IF NOT EXISTS idx_handoff_events_h ON handoff_events(handoff_id, id);
