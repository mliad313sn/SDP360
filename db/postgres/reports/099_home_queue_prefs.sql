-- P5 (A3) — Home queue: personal block order and snoozed queue lines, stored with the other workspace
-- presentation preferences (078). ADDITIVE and idempotent. PRESENTATION ONLY: nothing here is read by any
-- access check — a snoozed line is only hidden from the person's own Home, the item itself is untouched.
--   block_order    JSON array of Home block ids (queue | awaiting | owned | sites); NULL = page order
--   queue_snoozed  JSON object { "<source>:<id>": "YYYY-MM-DD" } — hidden until that day; NULL = none
-- Written only while report_config workspace_profiles_enabled = '1' (block_order) or ui_home_queue = '1'
-- (queue_snoozed); default '0' = today, no row is written.
ALTER TABLE user_workspace_prefs ADD COLUMN IF NOT EXISTS block_order TEXT;
ALTER TABLE user_workspace_prefs ADD COLUMN IF NOT EXISTS queue_snoozed TEXT;
