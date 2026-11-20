-- MANUAL rollback of db/postgres/reports/136_operator_tokens.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Removes the operator tokens: tools/ops/activate-switches.js can then no longer file four-eyes requests
-- (it refuses without a token). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/136_operator_tokens.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
DROP TABLE IF EXISTS operator_tokens;
COMMIT;
