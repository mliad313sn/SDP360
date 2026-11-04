-- A-25 Part A — when the 5-minute poller last SAW a wan_outages row still down.
-- Additive, nullable TEXT (ISO timestamp, like detected_start/restored_end — never date math
-- in SQL). Read by the stale-open guard when report_config wan_stale_close_at = 'last_seen'.
-- Manual rollback: db/postgres_rollback/046_wan_outage_last_seen_drop.sql. Idempotent.
ALTER TABLE wan_outages ADD COLUMN IF NOT EXISTS last_seen_at TEXT;
