-- MANUAL rollback of db/postgres/reports/104_value_scoreboard_snapshots.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Set report_config value_scoreboard_enabled = '0' first (the default). Removes the stored before /
-- after snapshots for good — take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/104_value_scoreboard_snapshots.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS value_scoreboard_snapshots;
COMMIT;
