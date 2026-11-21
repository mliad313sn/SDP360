-- P11 round 9 fix 39 (ADR docs/ai-decisions/ADR-P11-R9-signed-kid-history-anchor-events-request-origin.md).
-- (1) R9-A1 — system_log rows of the audit chain job (action LIKE 'audit_chain%') feed the anchor high-water mark: they
--     become append-only. An UPDATE that touches one (before or after) is refused; a DELETE silently KEEPS them (the
--     row-level BEFORE trigger returns NULL), so the 7-year retention purge still removes every other row and never
--     fails. TRUNCATE is not guarded (the test harness truncates system_log); the owner of an UNHARDENED database can
--     still disable this trigger — stated residual, tools/pg/harden-audit-grants.sql stays the real protection.
-- (2) R9-A2 / N-R9-1 — a Policy Center request records WHICH trusted path created it (origin 'web' | 'cli'), the
--     operator token a CLI request was filed under, and an origin signature (HMAC keyed from SDP_CONFIG_KEY, which is
--     not in the database) written by services/policyChangeStore.js. Approval refuses a request whose signature does not
--     verify: rows written straight into the table (any `source` value) and requests pending before this migration
--     must be filed again. The token row lists the requests it was used for (bound_request_ids).
-- ADDITIVE and idempotent. Rollback: db/postgres_rollback/140_audit_ops_signatures_drop.sql (manual).
CREATE OR REPLACE FUNCTION sdp_system_log_audit_chain_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.action LIKE 'audit\_chain%' OR NEW.action LIKE 'audit\_chain%' THEN
      RAISE EXCEPTION 'system_log audit_chain events are append-only (P11 r9)';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.action LIKE 'audit\_chain%' THEN RETURN NULL; END IF;
  RETURN OLD;
END $$;
DO $$ BEGIN
  IF to_regclass('system_log') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'system_log_audit_chain_guard' AND tgrelid = to_regclass('system_log')) THEN
    CREATE TRIGGER system_log_audit_chain_guard BEFORE UPDATE OR DELETE ON system_log FOR EACH ROW EXECUTE FUNCTION sdp_system_log_audit_chain_guard();
  END IF;
END $$;
ALTER TABLE policy_change_requests ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE policy_change_requests ADD COLUMN IF NOT EXISTS origin_sig TEXT;
ALTER TABLE policy_change_requests ADD COLUMN IF NOT EXISTS operator_token_id BIGINT;
ALTER TABLE operator_tokens ADD COLUMN IF NOT EXISTS bound_request_ids TEXT;
