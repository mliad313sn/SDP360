-- Committee review 2026-10-28 (audit P1-3, architect P2-4): the policy history is replayable "as of" a date.
-- A relaxation's end date is recorded in the history row too, so a replay knows when it stopped applying.
ALTER TABLE governance_policy_history ADD COLUMN IF NOT EXISTS expires_at TEXT;
