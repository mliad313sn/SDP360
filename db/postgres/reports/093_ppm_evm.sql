-- W1-EVM (PPM parity W0 E-EVM-1, rows E1–E7). ADDITIVE and idempotent: one NEW side table, no existing row or column
-- changes meaning. The EVM fields of a task live here and NOT on portfolio_tasks on purpose: portfolio_tasks is read
-- with SELECT * by the portfolio view, the workbook and the deck for every reader, and only the project budget/spent are
-- stripped for non-money readers — a cost column on portfolio_tasks would leak to readers without the money right.
-- Read and written only while report_config ppm_evm_enabled = '1' (the routes answer 404 while '0' = today). Amounts
-- are NOT certified (Finance certifies, a human). Every write is also a hash-chained ppm_events row (entity 'project').
-- Rollback: db/postgres_rollback/093_ppm_evm_drop.sql (manual).
CREATE TABLE IF NOT EXISTS ppm_task_evm (
  task_id       BIGINT PRIMARY KEY REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  ev_method     TEXT NOT NULL DEFAULT 'percent_complete' CHECK (ev_method IN ('percent_complete', '0_100', '50_50', 'physical_pct')),
  physical_pct  NUMERIC CHECK (physical_pct IS NULL OR (physical_pct >= 0 AND physical_pct <= 100)),
  baseline_cost NUMERIC CHECK (baseline_cost IS NULL OR baseline_cost >= 0),          -- NULL = unknown, never 0
  cost_currency TEXT CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  cost_rate     NUMERIC CHECK (cost_rate IS NULL OR cost_rate >= 0),                  -- per hour, in cost_currency; NULL = hours not costed
  capex_opex    TEXT CHECK (capex_opex IS NULL OR capex_opex IN ('capex', 'opex')),
  CHECK (baseline_cost IS NULL OR cost_currency IS NOT NULL),
  CHECK (cost_rate IS NULL OR cost_currency IS NOT NULL),
  updated_by    INTEGER,
  updated_at    TEXT
);
