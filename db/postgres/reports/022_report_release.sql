-- G-13 / G-14 (committee review 2026-10-28) — report run release controls.
-- withdrawn_*      : a published run taken back by an admin, with the reason (shares and readers stop seeing it).
-- publish_override : JSON {by, at, reason, sources} when an admin published despite stale sources.
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS withdrawn_at TEXT;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS withdrawn_by INTEGER;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS published_by INTEGER;
ALTER TABLE report_runs ADD COLUMN IF NOT EXISTS publish_override TEXT;
