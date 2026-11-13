-- W3-GOVERNANCE (PPM parity G1 · G2 · G3 · F1 · T9-T11) — stage-gate checklists with multi-approver sign-off, RAID
-- details, the composite-RAG hysteresis memory and the simplified/expert view preference. ADDITIVE and idempotent: six
-- NEW tables, no existing row or column changes meaning. Every table is read and written only while its PROPOSED
-- switch is '1' (the routes answer 404 while '0' = today):
--   ppm_gate_checklists / ppm_gate_evidence / ppm_gate_signoffs   ppm_gate_checklist_enabled
--   ppm_raid_details                                              ppm_raid_enabled
--   ppm_project_rag_state                                         ppm_project_rag_enabled
--   ppm_user_view_prefs                                           ppm_simplified_view_enabled
-- Sign-offs and evidence are APPEND-ONLY (trigger sdp_append_only): a decision is changed by a newer row, never edited.
-- Every write is also a hash-chained ppm_events row (entity 'project'). A sign-off is a recorded approval (session
-- identity, server time) — NOT a legal or identity-based signature.
-- Rollback: db/postgres_rollback/110_ppm_governance_w3_drop.sql (manual).
CREATE TABLE IF NOT EXISTS ppm_gate_checklists (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  gate_to        TEXT NOT NULL CHECK (gate_to IN ('proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed')),
  version        INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL,                      -- {items, approvers, rule, quorum} (services/ppm/gateChecklist)
  defined_by     INTEGER,
  defined_by_name TEXT,
  defined_at     TEXT NOT NULL,
  UNIQUE (project_id, gate_to)
);
CREATE TABLE IF NOT EXISTS ppm_gate_evidence (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  gate_to        TEXT NOT NULL,
  cycle_key      TEXT NOT NULL,                      -- id of the project's latest stage ledger row ('0' = none yet)
  item_key       TEXT NOT NULL,
  link           TEXT,                               -- http(s) or /internal path; NULL for a 'check' item
  note           TEXT,
  withdrawn      SMALLINT NOT NULL DEFAULT 0,        -- a newer row with withdrawn = 1 retracts the evidence
  added_by       INTEGER,
  added_by_name  TEXT,
  added_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppm_gate_evidence ON ppm_gate_evidence(project_id, gate_to, id);
CREATE TABLE IF NOT EXISTS ppm_gate_signoffs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  gate_to        TEXT NOT NULL,
  cycle_key      TEXT NOT NULL,
  checklist_version INTEGER NOT NULL,
  slot_index     INTEGER NOT NULL,
  slot_desc      TEXT,                               -- 'user:<id>' or 'role:<role>' as defined when signing
  decision       TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason         TEXT,
  approver_id    INTEGER NOT NULL,
  approver_name  TEXT,
  at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ppm_gate_signoffs ON ppm_gate_signoffs(project_id, gate_to, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_gate_signoffs_append_only') THEN
    CREATE TRIGGER ppm_gate_signoffs_append_only BEFORE UPDATE OR DELETE ON ppm_gate_signoffs FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_gate_evidence_append_only') THEN
    CREATE TRIGGER ppm_gate_evidence_append_only BEFORE UPDATE OR DELETE ON ppm_gate_evidence FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS ppm_raid_details (
  risk_id        BIGINT PRIMARY KEY REFERENCES portfolio_risks(id) ON DELETE CASCADE,
  response       TEXT,
  review_date    TEXT,
  probability_pct NUMERIC,
  impact_amount  NUMERIC,
  impact_currency TEXT,
  dependency_ref TEXT,
  updated_by     INTEGER,
  updated_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ppm_project_rag_state (
  project_id     BIGINT PRIMARY KEY REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  rag            TEXT,                               -- green | amber | red | NULL (unknown)
  state_json     TEXT NOT NULL,                      -- per-metric colours: the hysteresis memory
  inputs_json    TEXT,
  computed_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ppm_user_view_prefs (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  project_view_mode TEXT NOT NULL CHECK (project_view_mode IN ('simplified', 'expert')),
  updated_at     TEXT NOT NULL
);
