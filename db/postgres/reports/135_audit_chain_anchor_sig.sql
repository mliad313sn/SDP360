-- P11 round 6 R6-A2 (ADR docs/ai-decisions/ADR-P11-R5-audit-chain-anchor.md, "Round 6" section).
-- An anchor row carries an HMAC-SHA256 signature (keyed from SDP_CONFIG_KEY, computed by services/auditChain.js) so an
-- anchor INSERTed by anything other than the nightly job (the application role keeps INSERT on the table even once
-- hardened) is detectable: verify flags an unsigned row written after the first signed one, or a row whose signature
-- does not match, and takes its baseline only from correctly signed rows. Without SDP_CONFIG_KEY the column stays empty
-- and the anchors are ADVISORY (said by verify).
-- ADDITIVE and idempotent. When tools/pg/harden-audit-grants.sql has already handed the table to sdp_audit_owner the
-- application role may not alter it: the block then only says so (the hardening script adds the column itself).
-- Rollback: db/postgres_rollback/135_audit_chain_anchor_sig_drop.sql (manual).
DO $$ BEGIN
  IF to_regclass('audit_chain_anchors') IS NOT NULL THEN
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('audit_chain_anchors')) = current_user THEN
      ALTER TABLE audit_chain_anchors ADD COLUMN IF NOT EXISTS sig TEXT;
    ELSE
      RAISE NOTICE 'audit_chain_anchors is owned by another role (hardened): re-run tools/pg/harden-audit-grants.sql as the DBA to add the sig column';
    END IF;
  END IF;
END $$;
