-- MANUAL rollback of db/postgres/reports/131_audit_chain_anchor.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Removes the daily anchors for good (the ledgers themselves STAY); the nightly chain check then compares
-- nothing and is blind again to a tail delete or a TRUNCATE. The schema-qualified sdp_hash_chain() is kept (it is
-- equivalent for a single-schema database). Take a pg_dump first. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/131_audit_chain_anchor.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
DROP TABLE IF EXISTS audit_chain_anchors;
COMMIT;
