-- Governance policy registry (validation request 2026-10-28): every regulation behaviour that the
-- delivery team had written as a constant (four-eyes rules, freshness limits, grace periods, reason
-- lengths, escalation switches) is a PARAMETER with a default in services/governancePolicy.js.
-- A value set here overrides the default, globally (scope 'global') or for one site (scope 'site:<id>').
-- ADDITIVE and idempotent. History is append-only.
CREATE TABLE IF NOT EXISTS governance_policies (
  scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_by INTEGER, updated_at TEXT NOT NULL, reason TEXT,
  PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS governance_policy_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL,
  old_value TEXT, new_value TEXT, actor_id INTEGER, at TEXT NOT NULL, reason TEXT, relaxes INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_gov_policy_history ON governance_policy_history(key, id);
