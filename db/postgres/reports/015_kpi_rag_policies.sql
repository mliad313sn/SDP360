-- SDP360 — RAG policies as data (services/kpiRag.js POLICIES seeded here). Owned by the committee.
-- Applied before 016_dashboard_definitions (metric_registry.rag_policy references it). Idempotent.

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
