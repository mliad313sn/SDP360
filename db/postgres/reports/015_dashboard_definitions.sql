-- SDP360 — Dynamic Dashboard definitions and the metric registry (Phase 2).
-- A dashboard references metrics by key only (services/dashboardWidgets.js refuses raw SQL).
-- Idempotent.

CREATE TABLE IF NOT EXISTS metric_registry (
  key         TEXT PRIMARY KEY,                  -- 'helpdesk.resolution_sla_pct'
  name        TEXT NOT NULL,
  module      TEXT NOT NULL,                     -- helpdesk | assets | wan | infra | meetings | inspection | tracker
  unit        TEXT,                              -- % | count | hours | USD
  formula     TEXT NOT NULL,                     -- human-readable definition (committee-approved)
  window_kind TEXT NOT NULL DEFAULT 'week',      -- week | month | rolling13w | rolling3m | ytd
  rag_policy  TEXT REFERENCES kpi_rag_policies(name),
  reader      TEXT NOT NULL,                     -- server-side reader id (services/*), never SQL text
  owner_role  TEXT,                              -- committee role accountable for the definition
  rfi_ref     TEXT,
  status      TEXT NOT NULL DEFAULT 'published', -- draft | published | deprecated
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_definitions (
  key          TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  audience     TEXT NOT NULL DEFAULT 'site',     -- site | executive | field | committee
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | review | published | retired
  definition   TEXT NOT NULL,                    -- JSON validated by validateDashboard()
  owner_id     INTEGER,
  site_id      INTEGER,                          -- NULL = fleet-wide
  rfi_ref      TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dashboard_definition_versions (
  key        TEXT NOT NULL REFERENCES dashboard_definitions(key) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  definition TEXT NOT NULL,
  note       TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (key, version)
);

-- Request for Improvement (RFI) register — the committee's intake queue (docs/sdp360/02).
CREATE TABLE IF NOT EXISTS rfi_requests (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ref          TEXT UNIQUE,                      -- 'RFI-2026-014'
  kind         TEXT NOT NULL,                    -- tracker | widget | metric | integration | ux | data-quality
  title        TEXT NOT NULL,
  problem      TEXT NOT NULL,                    -- what hurts today
  proposal     TEXT,
  site_id      INTEGER,
  requester_id INTEGER,
  impact       INTEGER NOT NULL DEFAULT 2,       -- 1-3 (rubric)
  effort       INTEGER NOT NULL DEFAULT 2,       -- 1-3 (rubric)
  data_risk    INTEGER NOT NULL DEFAULT 1,       -- 1-3 (rubric)
  status       TEXT NOT NULL DEFAULT 'submitted',-- submitted | triaged | accepted | scheduled | delivered | rejected | deferred
  decision     TEXT,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfi_status ON rfi_requests(status);
