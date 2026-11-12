-- E-V08 (audit V-08) — human-entered chart annotations. A person writes a short note pinned to a date on a trend
-- ("ISP outage, ticket #312004", "CAB-2026-11 decided the new routing"); it is shown as a marker + legend entry on
-- dashboard trend widgets and listed under the chart. NEVER generated, NEVER inferred from the data: every row has a
-- human author and a mandatory source (ticket reference, decision reference or an http(s) link).
-- Behind report_config chart_annotations_enabled (default '0' = routes 404, nothing shown). ADDITIVE, idempotent.
CREATE TABLE IF NOT EXISTS chart_annotations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric_key TEXT,                           -- metric registry key; NULL = every trend of the site
  site_id INTEGER,                           -- NULL = group-wide (admin tier only)
  at TEXT NOT NULL,                          -- YYYY-MM-DD the note refers to
  label TEXT NOT NULL,                       -- ≤ 120 characters, plain text (escaped on display)
  source_kind TEXT NOT NULL,                 -- ticket | decision | url
  source_ref TEXT NOT NULL,                  -- '#312004' · 'CAB-2026-11' · 'https://…'
  author_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by INTEGER,
  CONSTRAINT chart_annotations_at CHECK (at ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT chart_annotations_label CHECK (length(trim(label)) BETWEEN 1 AND 120),
  CONSTRAINT chart_annotations_source_kind CHECK (source_kind IN ('ticket', 'decision', 'url')),
  CONSTRAINT chart_annotations_source_ref CHECK (length(trim(source_ref)) > 0));
CREATE INDEX IF NOT EXISTS idx_chart_annotations_site ON chart_annotations(site_id, at) WHERE deleted_at IS NULL;
