-- MANUAL rollback of db/postgres/reports/108_ppm_roles_comments.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_project_roles_enabled = '0' and ppm_comments_enabled = '0' first (the defaults).
-- Removes the per-project roles and every comment for good — take a pg_dump before. The team members themselves stay.
-- The shared function sdp_append_only() is NOT dropped (other append-only tables use it). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/108_ppm_roles_comments.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TRIGGER IF EXISTS ppm_comments_append_only ON ppm_comments;
DROP TABLE IF EXISTS ppm_comments;
ALTER TABLE ppm_project_members DROP COLUMN IF EXISTS ppm_role;
COMMIT;
