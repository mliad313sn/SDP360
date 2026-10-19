-- SDP360 — self-service Tracker Builder storage (Phase 2 "Tracker & Dashboard Engine").
-- A tracker definition is a validated JSON document (services/trackerDefinitions.js);
-- inputs are stored per unit × item × period slot. Idempotent.
-- The legacy tracker_* tables stay untouched: the 2026 programme is imported through
-- trackerDefinitions.fromLegacyInit() and lives alongside until the committee retires it.

CREATE TABLE IF NOT EXISTS tracker_definitions (
  key          TEXT PRIMARY KEY,                 -- e.g. 'it-activity-2027', 'field-dispatch'
  name         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | review | published | retired  (RFI workflow)
  definition   TEXT NOT NULL,                    -- JSON, validated before every write
  owner_id     INTEGER,                          -- users.id of the sponsor
  rfi_ref      TEXT,                             -- committee RFI number that approved it
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- Every published version is kept: a score must be reproducible against the definition that
-- was live when it was reported (same reason ADR-001 introduced tracker_years).
CREATE TABLE IF NOT EXISTS tracker_definition_versions (
  key        TEXT NOT NULL REFERENCES tracker_definitions(key) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  definition TEXT NOT NULL,
  note       TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (key, version)
);

CREATE TABLE IF NOT EXISTS tracker_entries (
  key        TEXT NOT NULL REFERENCES tracker_definitions(key) ON DELETE CASCADE,
  unit_code  TEXT NOT NULL,                      -- site / team code from definition.units
  item_code  TEXT NOT NULL,                      -- definition.groups[].items[].code
  slot       INTEGER NOT NULL,                   -- 1-based period slot (month / week / quarter)
  value      NUMERIC,
  note       TEXT,
  source     TEXT NOT NULL DEFAULT 'manual',     -- manual | import | sync:<module>
  updated_by INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (key, unit_code, item_code, slot)
);
CREATE INDEX IF NOT EXISTS idx_tracker_entries_unit ON tracker_entries(key, unit_code);

CREATE TABLE IF NOT EXISTS tracker_unit_targets (
  key        TEXT NOT NULL REFERENCES tracker_definitions(key) ON DELETE CASCADE,
  unit_code  TEXT NOT NULL,
  item_code  TEXT NOT NULL,
  target     NUMERIC,
  active     INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (key, unit_code, item_code)
);

-- RAG policies as DATA (services/kpiRag.js POLICIES seeded here). Owned by the committee.
CREATE TABLE IF NOT EXISTS kpi_rag_policies (
  name       TEXT PRIMARY KEY,
  scale      TEXT NOT NULL DEFAULT 'ratio',      -- ratio | points
  green      NUMERIC NOT NULL,
  amber      NUMERIC NOT NULL,
  source     TEXT,
  rfi_ref    TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (green > amber)
);
INSERT INTO kpi_rag_policies (name, scale, green, amber, source) VALUES
  ('tracker-activity',  'ratio',  0.90, 0.75, 'public/activity-tracker/engine.js'),
  ('tracker-executive', 'ratio',  0.70, 0.50, 'engine.js executive summary bands'),
  ('site-score',        'points', 70,   45,   'services/siteScore.js + deckGovernanceV2.js'),
  ('site-composite',    'points', 75,   55,   'services/siteComposite.js + siteScoreboard.js'),
  ('sla-percent',       'points', 90,   70,   'docs/EXEC_PPTX_CHART_AUDIT.md CSAT bands')
ON CONFLICT (name) DO NOTHING;
