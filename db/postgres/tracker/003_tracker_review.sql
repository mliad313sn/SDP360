-- G-23 (committee review 2026-10-28) — four-eyes publication of tracker definitions. ADDITIVE and
-- idempotent: five nullable columns on tracker_definitions. A draft is submitted by one person and
-- published by another; editing a submitted draft withdraws the submission. The live snapshot is
-- unaffected (status / tracker_definition_versions are unchanged).
ALTER TABLE tracker_definitions ADD COLUMN IF NOT EXISTS review_state TEXT;
ALTER TABLE tracker_definitions ADD COLUMN IF NOT EXISTS submitted_by INTEGER;
ALTER TABLE tracker_definitions ADD COLUMN IF NOT EXISTS submitted_at TEXT;
ALTER TABLE tracker_definitions ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE tracker_definitions ADD COLUMN IF NOT EXISTS publish_override TEXT;
