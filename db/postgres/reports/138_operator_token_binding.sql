-- P11 round 7 R7-A1 (ADR docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md).
-- An operator token row carries a BINDING: HMAC-SHA256, keyed from SDP_CONFIG_KEY (which is NOT in the database), over
-- the token hash, the account, the purpose and the expiry. services/operatorTokens.js writes it when the web UI issues a
-- token and verifies it when tools/ops/activate-switches.js consumes one; a row INSERTed with the application database
-- login (which the CLI needs anyway) has no valid binding and is refused. Without SDP_CONFIG_KEY the token flow is
-- refused (fail closed). Rows issued before this migration have no binding and are refused too (they expire within
-- 10 minutes anyway). ADDITIVE and idempotent.
-- Rollback: db/postgres_rollback/138_operator_token_binding_drop.sql (manual).
ALTER TABLE operator_tokens ADD COLUMN IF NOT EXISTS binding TEXT;
