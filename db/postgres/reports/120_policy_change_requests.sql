-- Policy Control Center (ADR docs/ai-decisions/ADR-POLICY-CENTER.md) — four-eyes requests for HIGH-RISK report_config
-- rules: a super_admin requests a change that moves a rule away from its best-practice default, ANOTHER super_admin
-- approves or rejects it (requester ≠ approver). Governance policies keep their own proposals table (028).
-- ADDITIVE and idempotent. Rollback: db/postgres_rollback/120_policy_change_requests_drop.sql (manual).
CREATE TABLE IF NOT EXISTS policy_change_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  requested_by INTEGER NOT NULL,
  requested_by_name TEXT,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER,
  decided_by_name TEXT,
  decided_at TEXT,
  decision_reason TEXT,
  source TEXT NOT NULL DEFAULT 'policy_center'
);
CREATE INDEX IF NOT EXISTS idx_policy_change_requests_status ON policy_change_requests(status, id);
CREATE INDEX IF NOT EXISTS idx_policy_change_requests_key ON policy_change_requests(key, id);
-- at most one pending request per rule and scope
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_change_requests_pending ON policy_change_requests(key, scope) WHERE status = 'pending';
