-- MANUAL rollback of db/postgres/reports/137_audit_chain_anchor_kid.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Drops the anchor key identifier and the audit chain meta table: a key rotation then breaks the nightly
-- chain job again (every anchor signed under the old key reads "forged"), and verify falls back to current_schema() for
-- the ledger schema. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/137_audit_chain_anchor_kid.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
DROP TABLE IF EXISTS audit_chain_meta;
ALTER TABLE audit_chain_anchors DROP COLUMN IF EXISTS kid;
COMMIT;
