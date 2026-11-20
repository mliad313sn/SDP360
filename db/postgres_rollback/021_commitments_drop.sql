-- MANUAL rollback of db/postgres/reports/021_commitments.sql. Kept OUTSIDE db/postgres/ so the
-- migrator never applies it. Drops ONLY the commitment tables; no other table references them.
-- Take a dump first, and set commitments_enabled='0' before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/021_commitments.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS closure_verifications;
DROP TABLE IF EXISTS evidence_items;
DROP TABLE IF EXISTS commitment_events;
DROP TABLE IF EXISTS commitment_source_links;
DROP TABLE IF EXISTS commitments;
COMMIT;
