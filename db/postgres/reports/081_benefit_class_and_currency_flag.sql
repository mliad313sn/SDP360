-- F1-PPM / F-PRODUCT-03 + F-DATA-09 (one implementation; gap E09 prerequisite). ADDITIVE and idempotent.
-- No row is updated: every existing benefit stays unclassified (NULL), which is never read as a class.
--   value_class            realised_cash | cost_avoidance_estimate | productivity_time | risk_reduction | other
--   basis                  observed | estimated_avoidance — how the realised value was obtained
--   baseline_period_*      the period the baseline value was measured over
--   measured_*             the period the realised value was measured over
--   method_note            how it was measured / estimated (free text)
--   source_kind/metric_key manual | metric (+ the registry key the value was read from)
--   verifier_role_required STAMPED AT VERIFICATION (never typed): the role report_config benefit_money_verifier_role
--                          required at that moment (F-PRODUCT-04); NULL = no role was required. A verification is
--                          "independent" only when this is set, the verifier is not the entrant nor the linked owner.
-- Used only while report_config benefit_value_class_enabled = '1' (the route ignores the fields while '0').
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS value_class TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS basis TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS baseline_period_from TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS baseline_period_to TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS measured_from TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS measured_to TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS method_note TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS metric_key TEXT;
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS verifier_role_required TEXT;

-- F-DATA-10 — Finance currency: no silent default. portfolio_projects.currency has DEFAULT 'USD' (018): a budget
-- written without a currency silently became US dollars. currency_defaulted: 1 = an amount was written and nobody
-- stated the currency (the views say "default, not confirmed"); 0 = a person sent the currency; NULL = rows written
-- before this migration (not known — never guessed, never back-filled).
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS currency_defaulted INTEGER;
