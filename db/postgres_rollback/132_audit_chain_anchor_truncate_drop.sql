-- MANUAL rollback of db/postgres/reports/132_audit_chain_anchor_truncate.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Removes the TRUNCATE refusal on audit_chain_anchors (the anchors and their UPDATE / DELETE refusal
-- STAY): an unhardened application role can then empty the anchors again. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/132_audit_chain_anchor_truncate.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
DROP TRIGGER IF EXISTS audit_chain_anchors_no_truncate ON audit_chain_anchors;
COMMIT;
