-- MANUAL rollback of db/postgres/reports/116_share_link_creator_tier.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Deploy the code before 116 first (it ignores the column). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/116_share_link_creator_tier.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
ALTER TABLE share_links DROP COLUMN IF EXISTS creator_admin;
COMMIT;
