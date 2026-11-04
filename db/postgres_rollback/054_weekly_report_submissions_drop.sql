-- MANUAL rollback of db/postgres/reports/054_weekly_report_submissions.sql. Kept OUTSIDE db/postgres/
-- so the migrator never applies it. Set report_revert_policy=site_editor, report_reassign_submitted=1,
-- report_drift_banner=0 first (they are the defaults). Removes the submission evidence for good —
-- take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/054_weekly_report_submissions.sql';
DROP TRIGGER IF EXISTS weekly_report_submissions_append_only ON weekly_report_submissions;
DROP TRIGGER IF EXISTS weekly_report_submissions_hash_chain ON weekly_report_submissions;
DROP TABLE IF EXISTS weekly_report_submissions;
