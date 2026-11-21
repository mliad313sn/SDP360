-- P11 round 7 O-8 / F-32 / R7-A2 (ADR docs/ai-decisions/ADR-P11-R7-anchor-kid-token-binding.md).
-- (1) Each anchor row records the KEY IDENTIFIER (kid) of the SDP_CONFIG_KEY that signed it: kid = first 16 hex of
--     HMAC(SDP_CONFIG_KEY, 'sdp-audit-chain-anchor-kid-v1'), computed by services/auditChain.js (never the key itself).
--     A row signed under another key (documented key rotation, or a dump restored on a server with another key) is then
--     reported "unverifiable (key rotated)" instead of "forged", and the nightly job resumes the chain under the new key
--     (event audit_chain_key_rotated) — before, the job failed every night forever after a rotation.
-- (2) audit_chain_meta (append-only) records facts verify needs that must not depend on the session: the ledger schema
--     at migration time ('ledger_schema' — a shadow schema earlier on the search path is no longer taken as the ledger
--     schema) and that signed anchors were written ('signed_anchors' — a later missing sig column reads "unverifiable",
--     never "advisory ok").
-- The owner of an unhardened database can still disable the triggers: tools/pg/harden-audit-grants.sql (DBA / CAB step)
-- stays the real protection. ADDITIVE and idempotent.
-- Rollback: db/postgres_rollback/137_audit_chain_anchor_kid_drop.sql (manual).
DO $$ BEGIN
  IF to_regclass('audit_chain_anchors') IS NOT NULL THEN
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('audit_chain_anchors')) = current_user THEN
      ALTER TABLE audit_chain_anchors ADD COLUMN IF NOT EXISTS kid TEXT;
    ELSE
      RAISE NOTICE 'audit_chain_anchors is owned by another role (hardened): re-run tools/pg/harden-audit-grants.sql as the DBA to add the kid column';
    END IF;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS audit_chain_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO audit_chain_meta (k, v) VALUES ('ledger_schema', current_schema()) ON CONFLICT (k) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_chain_meta_append_only') THEN
    CREATE TRIGGER audit_chain_meta_append_only BEFORE UPDATE OR DELETE ON audit_chain_meta FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
