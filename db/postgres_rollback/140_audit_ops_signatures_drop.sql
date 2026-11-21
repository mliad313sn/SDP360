-- MANUAL rollback of db/postgres/reports/140_audit_ops_signatures.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Drops the system_log audit_chain guard and the Policy Center origin / token-binding columns: approval then
-- refuses every Policy Center request (it cannot verify an origin signature) until the columns are back. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/140_audit_ops_signatures.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
DROP TRIGGER IF EXISTS system_log_audit_chain_guard ON system_log;
DROP FUNCTION IF EXISTS sdp_system_log_audit_chain_guard();
ALTER TABLE policy_change_requests DROP COLUMN IF EXISTS origin;
ALTER TABLE policy_change_requests DROP COLUMN IF EXISTS origin_sig;
ALTER TABLE policy_change_requests DROP COLUMN IF EXISTS operator_token_id;
ALTER TABLE operator_tokens DROP COLUMN IF EXISTS bound_request_ids;
COMMIT;
