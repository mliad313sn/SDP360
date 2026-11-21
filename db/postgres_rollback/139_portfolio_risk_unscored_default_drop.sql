-- MANUAL rollback of db/postgres/reports/139_portfolio_risk_unscored_default.sql. Kept OUTSIDE db/postgres/ so the
-- migrator never applies it. Puts back DEFAULT 2 on portfolio_risks.probability / impact: a risk filed without a score
-- through the generic writer is stored 2 × 2 again (the R8-1 behaviour). Rows written while 139 was applied keep their
-- NULL. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/139_portfolio_risk_unscored_default.sql';
-- One transaction: a failing statement rolls the whole script back.
BEGIN;
ALTER TABLE portfolio_risks ALTER COLUMN probability SET DEFAULT 2;
ALTER TABLE portfolio_risks ALTER COLUMN impact SET DEFAULT 2;
COMMIT;
