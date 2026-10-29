-- G19 (programme 2026-10-29) — a field envelope is applied under a CLAIM: claim_id + claimed_at in their own
-- columns (applied_at keeps meaning "applied"), and finish() only writes when it holds the claim. ADDITIVE.
ALTER TABLE field_outbox ADD COLUMN IF NOT EXISTS claim_id TEXT;
ALTER TABLE field_outbox ADD COLUMN IF NOT EXISTS claimed_at TEXT;
