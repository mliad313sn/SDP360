-- B8 (goal programme 2026-11-12) — dated FX rates, per-user display currency and the Pronto actuals FILE import.
-- ADDITIVE and idempotent. Used only while report_config actuals_import_enabled = '1' (default '0' = today).
-- No connector to Pronto exists or is allowed (.claude/rules/SDP360_BOUNDARIES.md): a CSV / Excel file is uploaded,
-- validated (dry run), reconciled against the budget periods (072), then written ONLY to ppm_budget_periods (kind
-- 'actual') through the existing hash-chained ledger (ppm_events). Nothing is ever written back anywhere.

-- Dated rate: `rate` = USD for 1 unit of `currency` (the convention of asset_currency_rates / xof_usd_rate).
-- The rate of a day = the latest non-retired row whose effective_from <= that day. A rate is never edited:
-- a correction is a new dated row (or a retirement + a new row), so a past conversion stays reproducible by rate id.
CREATE TABLE IF NOT EXISTS fx_rates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency        TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'USD'),
  effective_from  TEXT NOT NULL CHECK (effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  rate            NUMERIC NOT NULL CHECK (rate > 0),
  source          TEXT NOT NULL,
  entered_by      INTEGER,
  entered_by_name TEXT,
  entered_at      TEXT NOT NULL,
  retired_at      TEXT,
  retired_by      INTEGER,
  retire_reason   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fx_rates_active ON fx_rates (currency, effective_from) WHERE retired_at IS NULL;

-- Display currency per user (presentation only — never an access right, never a stored conversion).
CREATE TABLE IF NOT EXISTS user_finance_prefs (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_currency TEXT CHECK (display_currency IS NULL OR display_currency ~ '^[A-Z]{3}$'),
  updated_at       TEXT NOT NULL
);

-- Column mapping of a Pronto export layout, saved by name (the wizard reloads it).
CREATE TABLE IF NOT EXISTS actuals_import_templates (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  mapping     TEXT NOT NULL,
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL
);

-- One committed import: the file fingerprint, who, when, and the reconciliation report as committed.
CREATE TABLE IF NOT EXISTS actuals_import_batches (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename        TEXT,
  file_sha256     TEXT NOT NULL,
  template_name   TEXT,
  rows_total      INTEGER NOT NULL,
  rows_written    INTEGER NOT NULL,
  reason          TEXT,
  committed_by    INTEGER,
  committed_by_name TEXT,
  committed_at    TEXT NOT NULL,
  report          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actuals_import_batches_hash ON actuals_import_batches (file_sha256);
