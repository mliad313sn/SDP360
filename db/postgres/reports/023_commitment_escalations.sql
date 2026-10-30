-- G-18 (committee review 2026-10-28) — escalation ledger for the A01 / A02 commitment alerts. ADDITIVE
-- and idempotent: one new table, no change to any existing table.
-- One row per (alert, commitment[, due date]) EPISODE key. A condition that persists keeps its row
-- (last_seen_at moves, nothing new is raised); a condition that clears gets cleared_at; the same
-- condition coming back reopens the row and counts one more episode. That is the dedup rule.
CREATE TABLE IF NOT EXISTS commitment_escalations (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'A01' serious commitment without owner · 'A02' overdue serious commitment
  commitment_id BIGINT NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  site_id INTEGER,
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  cleared_at TEXT,
  episodes INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS idx_commitment_escalations_open ON commitment_escalations(cleared_at, site_id);
