-- N-R6-2 (P11 round 6) — a change request names the frozen business-case fields it may change (comma-separated list of
-- services/ppm/reviewWorkflow FROZEN_FIELDS, without budget / currency). The budget stays bound by impact_budget;
-- charter, business_need, expected_value, budget_reference and budget_approval_date change only when the approved
-- request names them. Additive, nullable: an existing request names nothing (it still unlocks its budget impact only).
ALTER TABLE ppm_change_requests ADD COLUMN IF NOT EXISTS scope_fields TEXT;
