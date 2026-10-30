-- Committee review 2026-10-28 (audit rec. 4, security rec. 4): the append-only audit tables are
-- hash-chained. Each new row stores row_hash = sha256(prev_hash || canonical row); a row edited or
-- deleted behind the application (owner of the tables, restore of a doctored dump) breaks the chain,
-- which the nightly job `audit.chain_verify` and GET /api/governance/audit-chain detect.
-- ADDITIVE and idempotent; existing rows are chained once, in id order.
CREATE OR REPLACE FUNCTION sdp_chain_payload(r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (r - 'prev_hash' - 'row_hash')::text $$;
CREATE OR REPLACE FUNCTION sdp_hash_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sdp_chain:' || TG_TABLE_NAME));
  EXECUTE format('SELECT row_hash FROM %I ORDER BY id DESC LIMIT 1', TG_TABLE_NAME) INTO prev;
  NEW.prev_hash := prev;
  NEW.row_hash := encode(sha256(convert_to(coalesce(prev, '') || sdp_chain_payload(to_jsonb(NEW)), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
DO $$ DECLARE t TEXT; r RECORD; prev TEXT; h TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications', 'minutes_history'] LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS prev_hash TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS row_hash TEXT', t);
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_hash_chain') THEN
      -- chain the rows written before this migration (the append-only trigger is paused for this one pass)
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', t, t || '_append_only'); END IF;
      prev := NULL;
      FOR r IN EXECUTE format('SELECT id, to_jsonb(x) AS j FROM %I x ORDER BY id', t) LOOP
        h := encode(sha256(convert_to(coalesce(prev, '') || sdp_chain_payload(r.j), 'UTF8')), 'hex');
        EXECUTE format('UPDATE %I SET prev_hash = $1, row_hash = $2 WHERE id = $3', t) USING prev, h, r.id;
        prev := h;
      END LOOP;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', t, t || '_append_only'); END IF;
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION sdp_hash_chain()', t || '_hash_chain', t);
    END IF;
  END LOOP;
END $$;
