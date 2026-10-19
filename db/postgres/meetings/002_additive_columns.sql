-- Step 2 (SDP-DASH-2.0) — additive DDL formerly inline in initPgMeetings(). Idempotent.
-- 2026-09 Business Incubation form.
ALTER TABLE md_meetings ADD COLUMN IF NOT EXISTS incubation_json TEXT;
-- 2026-10-16 transfer statuses (justification + SDP ticket number).
ALTER TABLE md_issues  ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE md_issues  ADD COLUMN IF NOT EXISTS helpdesk_ticket TEXT;
ALTER TABLE md_actions ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE md_actions ADD COLUMN IF NOT EXISTS helpdesk_ticket TEXT;
