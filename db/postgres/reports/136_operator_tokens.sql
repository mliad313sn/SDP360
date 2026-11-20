-- P11 round 6 R6-A1 (ADR docs/ai-decisions/ADR-P11-R6-operator-tokens.md).
-- One-time, short-lived OPERATOR TOKENS: a logged-in super_admin issues one from the Policy Center page
-- (POST /api/policy-center/operator-tokens) and hands it to tools/ops/activate-switches.js, which consumes it. The CLI
-- then files four-eyes Policy Center requests AS THAT AUTHENTICATED ACCOUNT — no longer as whatever --operator name was
-- typed. Only the SHA-256 of the token is stored; a token is valid once, for 10 minutes.
-- ADDITIVE and idempotent. Rollback: db/postgres_rollback/136_operator_tokens_drop.sql (manual).
CREATE TABLE IF NOT EXISTS operator_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'activate-switches',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_operator_tokens_user ON operator_tokens(user_id, id);
