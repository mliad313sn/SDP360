-- MANUAL rollback of db/postgres/reports/138_operator_token_binding.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Drops the token binding column: services/operatorTokens.js then refuses every token (it cannot verify the
-- binding), so tools/ops/activate-switches.js can no longer file four-eyes requests until the column is back. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/138_operator_token_binding.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
ALTER TABLE operator_tokens DROP COLUMN IF EXISTS binding;
COMMIT;
