-- MANUAL rollback of db/postgres/reports/046_wan_outage_last_seen.sql. Kept OUTSIDE
-- db/postgres/ so the migrator never applies it. Set wan_stale_close_at='now' first.
-- Afterwards: DELETE FROM schema_migrations WHERE id = 'reports/046_wan_outage_last_seen.sql';
ALTER TABLE wan_outages DROP COLUMN IF EXISTS last_seen_at;
