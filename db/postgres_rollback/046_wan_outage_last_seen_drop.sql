-- MANUAL rollback of db/postgres/reports/046_wan_outage_last_seen.sql. Kept OUTSIDE
-- db/postgres/ so the migrator never applies it. Set wan_stale_close_at='now' first.
-- Afterwards: DELETE FROM schema_migrations WHERE id = 'reports/046_wan_outage_last_seen.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
ALTER TABLE wan_outages DROP COLUMN IF EXISTS last_seen_at;
COMMIT;
