-- E-I06 (audit I-06, catalogue R06) — independent verification of a closed Critical / High corrective action.
-- closed_by = who closed it (recorded on every close from now on); verified_by / verified_at = a DIFFERENT person who
-- checked the fix. Read and enforced only while report_config insp_action_verify_enabled = '1' (default '0' = today:
-- closing stays a plain status change). ADDITIVE and idempotent; no existing row changes.
ALTER TABLE insp_actions ADD COLUMN IF NOT EXISTS closed_by TEXT;
ALTER TABLE insp_actions ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE insp_actions ADD COLUMN IF NOT EXISTS verified_at TEXT;
ALTER TABLE insp_actions ADD COLUMN IF NOT EXISTS verify_note TEXT;
