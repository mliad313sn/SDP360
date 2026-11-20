-- MANUAL rollback of db/postgres/reports/135_audit_chain_anchor_sig.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Drops the anchor signature column: the anchors become advisory again (an anchor row inserted by the
-- application role can no longer be told from a nightly one). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/135_audit_chain_anchor_sig.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
ALTER TABLE audit_chain_anchors DROP COLUMN IF EXISTS sig;
COMMIT;
