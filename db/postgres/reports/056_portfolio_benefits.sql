-- B-08 (2026-11) — minimal benefit record on portfolio projects (catalogue rule A09 "benefit review date reached").
-- ADDITIVE and idempotent; no existing row changes. One project may carry several expected benefits.
--   description / measure / unit / baseline_value / target_value   the expected benefit
--   value_kind     quantity (default) | money — money values follow the portfolio money-read rule (committee,
--                  admin tier, finance-viewer); everyone else reads the description, dates and state only
--   owner          who answers for the benefit (free text, like every PPM owner)
--   review_date    from this date the benefit shows on the Site obligations view and "My work" until verified
--   realised_*     the realised value with its evidence link (http/https), who entered it and when
--   verified_*     who verified it — never the person who entered the realised value (SELF_REVIEW);
--                  entering a new realised value, or changing the measure/unit/baseline/target, clears it
CREATE TABLE IF NOT EXISTS portfolio_benefits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  measure TEXT,
  unit TEXT,
  value_kind TEXT NOT NULL DEFAULT 'quantity',
  currency TEXT,
  baseline_value NUMERIC,
  target_value NUMERIC,
  owner TEXT,
  review_date TEXT,
  realised_value NUMERIC,
  evidence_link TEXT,
  realised_note TEXT,
  realised_by INTEGER,
  realised_by_name TEXT,
  realised_at TEXT,
  verified_by INTEGER,
  verified_by_name TEXT,
  verified_at TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portfolio_benefits_project ON portfolio_benefits(project_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_portfolio_benefits_review ON portfolio_benefits(review_date) WHERE verified_at IS NULL;
