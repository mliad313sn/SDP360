-- MANUAL rollback of db/postgres/reports/120_policy_change_requests.sql (never applied by the migrator).
-- Run only after policy_center_enabled = '0'. Drops the four-eyes request history of the policy center.
BEGIN;
DROP TABLE IF EXISTS policy_change_requests;
DELETE FROM schema_migrations WHERE id = 'reports/120_policy_change_requests.sql';
COMMIT;
