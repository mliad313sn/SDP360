-- P11 round 6 (data-kpi O-2 / anchor table without hardening). Migration 131 made audit_chain_anchors append-only for
-- UPDATE / DELETE only: on a database where tools/pg/harden-audit-grants.sql has not been applied yet, the application
-- role (owner) could still TRUNCATE the anchors, after which the nightly chain check compared nothing. This adds a
-- STATEMENT-level BEFORE TRUNCATE trigger running the same sdp_append_only() refusal. services/auditChain.verify also
-- reports "anchor history missing" when anchors were written before and are gone. The owner can still disable the
-- trigger: the hardening script (owner = sdp_audit_owner, app role SELECT + INSERT) stays the real protection.
-- ADDITIVE and idempotent. Rollback: db/postgres_rollback/132_audit_chain_anchor_truncate_drop.sql (manual).
DO $$ BEGIN
  IF to_regclass('audit_chain_anchors') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_chain_anchors_no_truncate') THEN
    CREATE TRIGGER audit_chain_anchors_no_truncate BEFORE TRUNCATE ON audit_chain_anchors FOR EACH STATEMENT EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
