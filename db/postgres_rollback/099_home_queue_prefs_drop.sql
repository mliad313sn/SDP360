-- MANUAL rollback of db/postgres/reports/099_home_queue_prefs.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config ui_home_queue = '0' and workspace_profiles_enabled = '0' first (the defaults). Removes the personal
-- Home block order and the snoozed queue lines (presentation only — no work item is touched).
-- Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/099_home_queue_prefs.sql';
ALTER TABLE user_workspace_prefs DROP COLUMN IF EXISTS queue_snoozed;
ALTER TABLE user_workspace_prefs DROP COLUMN IF EXISTS block_order;
