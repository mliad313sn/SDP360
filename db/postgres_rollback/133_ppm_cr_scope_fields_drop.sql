-- MANUAL rollback of db/postgres/reports/133_ppm_cr_scope_fields.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Without the column every change request names no field again: the frozen business-case text fields
-- (charter, business_need, expected_value, budget_reference, budget_approval_date) then stay locked for every request
-- (the budget stays bound by impact_budget) — roll the code back first. Take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/133_ppm_cr_scope_fields.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
ALTER TABLE ppm_change_requests DROP COLUMN IF EXISTS scope_fields;
COMMIT;
