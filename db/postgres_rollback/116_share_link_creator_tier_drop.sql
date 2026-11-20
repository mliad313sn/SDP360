-- MANUAL rollback of db/postgres/reports/116_share_link_creator_tier.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Deploy the code before 116 first (it ignores the column). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/116_share_link_creator_tier.sql';
ALTER TABLE share_links DROP COLUMN IF EXISTS creator_admin;
