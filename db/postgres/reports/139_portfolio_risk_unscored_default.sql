-- P11 round 8 R8-1 (PPM seat) — an unscored risk is UNKNOWN, never 2 × 2.
-- 018_governance created portfolio_risks.probability / impact with DEFAULT 2, so a risk filed without a score (generic
-- writer: the columns are simply not sent) was stored as probability 2 × impact 2 = 4 ("medium"), and the project RAG
-- risk component read GREEN for a risk nobody scored. This drops the two column defaults: a new row without a score is
-- NULL (riskExposure.level → null, projectScore → null = UNKNOWN). EXISTING ROWS ARE NOT TOUCHED: a stored 2 × 2 may be a
-- real score or the old default and cannot be told apart — what to do with them is a PMO data-owner question, not a
-- migration (docs/agent-execution/FIX-34-DATA-PPM.md). ADDITIVE in effect (no data change) and idempotent.
-- Rollback: db/postgres_rollback/139_portfolio_risk_unscored_default_drop.sql (manual).
ALTER TABLE portfolio_risks ALTER COLUMN probability DROP DEFAULT;
ALTER TABLE portfolio_risks ALTER COLUMN impact DROP DEFAULT;
