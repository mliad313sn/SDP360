-- Committee review 2026-10-28 (CIO P2-9, audit): relaxing a PROTECTED governance rule is a two-person
-- act — one super_admin proposes, ANOTHER approves (governance.dual_approval_relaxations, default on).
-- ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS governance_policy_proposals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
  reason TEXT NOT NULL, proposed_by INTEGER NOT NULL, proposed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', decided_by INTEGER, decided_at TEXT, decision_reason TEXT);
CREATE INDEX IF NOT EXISTS idx_gov_policy_proposals_status ON governance_policy_proposals(status, id);
-- the history row names both people of a two-person change
ALTER TABLE governance_policy_history ADD COLUMN IF NOT EXISTS proposed_by INTEGER;
ALTER TABLE governance_policy_history ADD COLUMN IF NOT EXISTS approved_by INTEGER;
-- a relaxation of a protected rule is temporary: it stops applying at expires_at (resolution ignores it)
ALTER TABLE governance_policies ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE governance_policy_proposals ADD COLUMN IF NOT EXISTS expires_days INTEGER;
-- audit trail tables are append-only (committee audit P1-2): UPDATE / DELETE raise. TRUNCATE (tests,
-- restore drills) is a separate statement-level privilege and is not affected.
CREATE OR REPLACE FUNCTION sdp_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table %: % refused', TG_TABLE_NAME, TG_OP; END $$;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['governance_policy_history', 'handoff_events', 'commitment_events', 'closure_verifications'] LOOP
    IF to_regclass(t) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_append_only') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sdp_append_only()', t || '_append_only', t);
    END IF;
  END LOOP;
END $$;
