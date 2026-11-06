-- W2-PPM (expert audit of 5 Nov 2026). ADDITIVE and idempotent; no existing row changes meaning.
-- E-P04 (audit P-04) — budget per period: one row per project × month × currency × kind (baseline | actual | forecast).
-- Amounts are never summed across currencies (services/ppmBudgetPeriods). Every write is also a ppm_events row
-- (hash-chained, append-only). Read only by the money-read rule (committee, admin tier, finance-viewer). The figures
-- are NOT certified until Finance says so. Used only while report_config ppm_budget_periods_enabled = '1'.
CREATE TABLE IF NOT EXISTS ppm_budget_periods (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  period     TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  currency   TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  kind       TEXT NOT NULL CHECK (kind IN ('baseline', 'actual', 'forecast')),
  amount     NUMERIC NOT NULL CHECK (amount >= 0),
  reason     TEXT,
  actor_id   INTEGER,
  actor      TEXT,
  updated_at TEXT,
  UNIQUE (project_id, period, currency, kind)
);
CREATE INDEX IF NOT EXISTS idx_ppm_budget_periods_project ON ppm_budget_periods(project_id, currency, period);

-- E-P05 (audit P-05) — optional link from a benefit to the user who owns it (the free-text owner stays). When set,
-- that user can never verify the benefit (SELF_REVIEW); with benefit_owner_link_enabled = '1' "My work" lists the
-- benefits they own whose review date is reached (in-app only, nothing is sent).
ALTER TABLE portfolio_benefits ADD COLUMN IF NOT EXISTS owner_user_id INTEGER;
