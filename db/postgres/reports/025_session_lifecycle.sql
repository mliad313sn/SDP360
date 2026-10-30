-- G-21 (committee review 2026-10-28) — meeting session lifecycle planned → held → logged → accepted,
-- cancellation as an approved exception, effective-dated cadences. ADDITIVE and idempotent: nullable
-- columns only. Pure rules: services/sessionLifecycle.js.
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS closed_by INTEGER;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS minutes_accepted_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS minutes_accepted_by INTEGER;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS cancelled_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS exception_status TEXT;      -- pending | approved
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS exception_approved_by INTEGER;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS exception_approved_at TEXT;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS reopen_reason TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS effective_from TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS effective_to TEXT;
