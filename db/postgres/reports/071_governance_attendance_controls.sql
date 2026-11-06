-- E-G03 (audit G-03, catalogue A13) — proof of session: attendance recorded per participant
-- (JSON [{participant, status present|absent|excused, recorded_by, recorded_at}]; NULL = not recorded, never
-- "everyone present"), and the exception-only agenda compiled as a DRAFT by the scheduled job
-- governance.agenda_drafts (report_config agenda_cron_enabled, default '0'). Nothing is sent or published.
-- ADDITIVE and idempotent.
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS attendance TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda_for TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda_at TEXT;
