-- Committee review 2026-10-28 (audit P1-6): an approved exception on an overdue serious commitment is
-- temporary (commitments.exception_max_days); when it lapses the A02 alert comes back. ADDITIVE.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS exception_expires_at TEXT;
