-- MANUAL rollback of db/postgres/reports/021_commitments.sql. Kept OUTSIDE db/postgres/ so the
-- migrator never applies it. Drops ONLY the commitment tables; no other table references them.
-- Take a dump first, and set commitments_enabled='0' before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/021_commitments.sql';
DROP TABLE IF EXISTS closure_verifications;
DROP TABLE IF EXISTS evidence_items;
DROP TABLE IF EXISTS commitment_events;
DROP TABLE IF EXISTS commitment_source_links;
DROP TABLE IF EXISTS commitments;
