-- MANUAL rollback of db/postgres/reports/054_weekly_report_submissions.sql. Kept OUTSIDE db/postgres/
-- so the migrator never applies it. Set report_revert_policy=site_editor, report_reassign_submitted=1,
-- report_drift_banner=0 first (they are the defaults). Removes the submission evidence for good —
-- take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/054_weekly_report_submissions.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TRIGGER IF EXISTS weekly_report_submissions_append_only ON weekly_report_submissions;
DROP TRIGGER IF EXISTS weekly_report_submissions_hash_chain ON weekly_report_submissions;
DROP TABLE IF EXISTS weekly_report_submissions;
COMMIT;
