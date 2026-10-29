-- ADR-006 (committee review 2026-10-28, #34 #36 #38): WHO acts is configuration data, not code.
--   role_assignments   process role held by a person, for one site or the whole platform, effective-dated;
--   deputies           a named person stands in for an absent one between two dates (acts IN THEIR NAME);
--   escalation_matrix  register × severity × scope × days overdue → the role that receives the escalation;
--   governance_role_events  append-only, hash-chained history of every change to the three tables above.
-- Empty tables = the behaviour until now (nobody named, no deputy, escalations recorded without a target).
-- ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS role_assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role TEXT NOT NULL,                       -- e.g. handoffs.escalation_target (catalogue: services/governanceRoles.js)
  site_id INTEGER,                          -- NULL = platform-wide
  user_id INTEGER NOT NULL,
  effective_from TEXT NOT NULL,             -- YYYY-MM-DD
  effective_to TEXT,                        -- YYYY-MM-DD inclusive; NULL = open-ended
  reason TEXT, created_by INTEGER, created_at TEXT NOT NULL,
  ended_by INTEGER, ended_at TEXT);
CREATE INDEX IF NOT EXISTS idx_role_assign_role ON role_assignments(role, site_id);

CREATE TABLE IF NOT EXISTS deputies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,                 -- the absent person
  deputy_id INTEGER NOT NULL,               -- who stands in
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  reason TEXT NOT NULL, approved_by INTEGER, created_at TEXT NOT NULL,
  revoked_by INTEGER, revoked_at TEXT,
  CONSTRAINT deputies_not_self CHECK (user_id <> deputy_id));
CREATE INDEX IF NOT EXISTS idx_deputies_user ON deputies(user_id);
CREATE INDEX IF NOT EXISTS idx_deputies_deputy ON deputies(deputy_id);

CREATE TABLE IF NOT EXISTS escalation_matrix (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  register TEXT NOT NULL,                   -- handoffs | commitments
  severity TEXT NOT NULL DEFAULT '*',       -- '*' or a severity of the register (commitments: low…critical)
  site_id INTEGER,                          -- NULL = platform-wide
  after_days INTEGER NOT NULL DEFAULT 0,    -- days past due before this row applies
  role TEXT NOT NULL,
  reason TEXT, created_by INTEGER, created_at TEXT NOT NULL,
  retired_by INTEGER, retired_at TEXT);
CREATE INDEX IF NOT EXISTS idx_escalation_matrix_reg ON escalation_matrix(register, site_id);

CREATE TABLE IF NOT EXISTS governance_role_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity TEXT NOT NULL, entity_id BIGINT, action TEXT NOT NULL,
  actor_id INTEGER, at TEXT NOT NULL, details TEXT);

-- account-less receivers (committee #34): the department head without an account, named on the handoff;
-- the receiver account (a coordinator) records each step on their behalf with a note — only when the
-- site policy handoffs.proxy_accept allows it.
ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS receiver_contact TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'governance_role_events_append_only') THEN
    CREATE TRIGGER governance_role_events_append_only BEFORE UPDATE OR DELETE ON governance_role_events FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  ALTER TABLE governance_role_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
  ALTER TABLE governance_role_events ADD COLUMN IF NOT EXISTS row_hash TEXT;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'governance_role_events_hash_chain') THEN
    CREATE TRIGGER governance_role_events_hash_chain BEFORE INSERT ON governance_role_events FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
