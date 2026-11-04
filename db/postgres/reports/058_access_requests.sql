-- C-18 (G39 / G40 / G50 · A02 A03 A09) — access requests, their append-only hash-chained history, and the
-- grants an approved request creates.
--   access_requests        REQUESTED → REVIEWING → APPROVED | REJECTED → ACTIVE → EXPIRED | REVOKED
--                          (services/accessRequestLifecycle.js). The approval is bound to subject × roles ×
--                          sites × dates (`approved_scope`), never to a template as a whole.
--   access_request_events  who did what, when, why (append-only + hash chain, verified by audit.chain_verify).
--   access_grants          WHY and UNTIL WHEN a role / a site is held. user_roles + user_sites stay the only
--                          thing the platform reads at request time; activation writes them through
--                          rdb.updateUser. No grant row for a role = it was given directly (legacy source).
--                          `held_before` = the role/site was already held when the grant activated, so ending
--                          the grant never removes it.
-- ADDITIVE and idempotent. Empty tables = the behaviour until now.
CREATE TABLE IF NOT EXISTS access_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'grant',       -- grant (extend / emergency: later goals)
  subject_user_id INTEGER NOT NULL,
  requested_by INTEGER NOT NULL,
  template_version_id BIGINT,               -- NULL = roles chosen one by one
  roles TEXT[] NOT NULL,
  site_ids INTEGER[] NOT NULL DEFAULT '{}',
  valid_from TEXT NOT NULL,                 -- YYYY-MM-DD
  valid_to TEXT NOT NULL,                   -- YYYY-MM-DD inclusive
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reviewed_by INTEGER, reviewed_at TEXT,
  decided_by INTEGER, decided_at TEXT, decision_reason TEXT,
  approved_scope TEXT,                      -- canonical subject×roles×sites×dates the approver saw
  activated_at TEXT, ended_by INTEGER, ended_at TEXT, end_reason TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT access_requests_status CHECK (status IN ('REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'REVOKED')));
CREATE INDEX IF NOT EXISTS idx_access_requests_subject ON access_requests(subject_user_id, status);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

CREATE TABLE IF NOT EXISTS access_request_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id BIGINT NOT NULL, action TEXT NOT NULL,
  actor_id INTEGER, at TEXT NOT NULL, details TEXT,
  prev_hash TEXT, row_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_access_request_events_req ON access_request_events(request_id, id);

CREATE TABLE IF NOT EXISTS access_grants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role TEXT,                                -- one of role / site_id is set
  site_id INTEGER,
  request_id BIGINT NOT NULL,
  template_version_id BIGINT,
  valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
  held_before BOOLEAN NOT NULL DEFAULT false,
  created_at TEXT NOT NULL,
  ended_at TEXT, ended_by INTEGER, end_reason TEXT,
  CONSTRAINT access_grants_one_target CHECK ((role IS NULL) <> (site_id IS NULL)));
CREATE INDEX IF NOT EXISTS idx_access_grants_user ON access_grants(user_id, ended_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'access_request_events_append_only') THEN
    CREATE TRIGGER access_request_events_append_only BEFORE UPDATE OR DELETE ON access_request_events FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'access_request_events_hash_chain') THEN
    CREATE TRIGGER access_request_events_hash_chain BEFORE INSERT ON access_request_events FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain();
  END IF;
END $$;
