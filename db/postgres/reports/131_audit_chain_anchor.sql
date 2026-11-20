-- P11 round 5 R5-A3 + AUD-2 (ADR docs/ai-decisions/ADR-P11-R5-audit-chain-anchor.md).
-- (1) Daily anchor of the hash-chained ledgers: one row per ledger per nightly run (last id, head hash, row count).
--     services/auditChain.verify compares the live chain with the LAST anchor: the anchored row must still exist with
--     the same hash and the row count may not shrink, so a tail delete, a TRUNCATE, a rewrite or a swap for an empty
--     shadow table is a failed run. Append-only (sdp_append_only); tools/pg/harden-audit-grants.sql hands it to
--     sdp_audit_owner with SELECT + INSERT only for the application role.
-- (2) sdp_hash_chain() reads the previous hash from the SAME schema as the row being inserted (TG_TABLE_SCHEMA), so a
--     same-named table earlier on the session search_path can never feed the chain. Once the hardening script has
--     handed the function to sdp_audit_owner the application role may not replace it: the block then only says so
--     (the hardening script defines the qualified version itself).
-- ADDITIVE and idempotent. Rollback: db/postgres_rollback/131_audit_chain_anchor_drop.sql (manual).
CREATE TABLE IF NOT EXISTS audit_chain_anchors (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  last_id BIGINT,
  head TEXT,
  row_count BIGINT NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_chain_anchors_table ON audit_chain_anchors(table_name, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_chain_anchors_append_only') THEN
    CREATE TRIGGER audit_chain_anchors_append_only BEFORE UPDATE OR DELETE ON audit_chain_anchors FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
DO $$ BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure('sdp_hash_chain()')) = current_user THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION sdp_hash_chain() RETURNS trigger LANGUAGE plpgsql AS $b$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sdp_chain:' || TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME));
  EXECUTE format('SELECT row_hash FROM %I.%I ORDER BY id DESC LIMIT 1', TG_TABLE_SCHEMA, TG_TABLE_NAME) INTO prev;
  NEW.prev_hash := prev;
  NEW.row_hash := encode(sha256(convert_to(coalesce(prev, '') || sdp_chain_payload(to_jsonb(NEW)), 'UTF8')), 'hex');
  RETURN NEW;
END $b$ $f$;
  ELSE
    RAISE NOTICE 'sdp_hash_chain() is owned by another role (hardened): run tools/pg/harden-audit-grants.sql as the DBA to install the schema-qualified version';
  END IF;
END $$;
