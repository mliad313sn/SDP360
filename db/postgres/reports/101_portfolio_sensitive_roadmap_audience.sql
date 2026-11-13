-- P7a / goals B3 + B6. ADDITIVE and idempotent: one NEW column with a default that keeps today's meaning, one NEW table.
--   portfolio_projects.sensitive  0 (default) = today. 1 = the project is read only by the admin tier, the committee, its
--                                 owner, its named team members and the holders of one of its sites — and ONLY while
--                                 report_config portfolio_sensitive_projects = '1' (services/portfolioAccess.canReadProject).
--                                 Set by the committee / admin tier (PUT /api/governance/portfolio/project/:id/sensitive).
--   roadmap_publications          a FROZEN roadmap snapshot published to an audience (site · programme · committee · exec),
--                                 optional expiry. The snapshot is built once by services/roadmapAudience.js (perimeter of
--                                 the audience); amounts are kept only for the committee / exec audiences when the publisher
--                                 may read money, and served only to the admin tier and finance-viewer. Read and written only
--                                 while report_config roadmap_audience_publication_enabled = '1' (404 while '0' = today).
-- Rollback: db/postgres_rollback/101_portfolio_sensitive_roadmap_audience_drop.sql (manual).
ALTER TABLE portfolio_projects ADD COLUMN IF NOT EXISTS sensitive INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS roadmap_publications (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audience      TEXT NOT NULL CHECK (audience IN ('site', 'programme', 'committee', 'exec')),
  audience_ref  INTEGER,                                   -- site id (site) · programme id (programme) · NULL otherwise
  title         TEXT NOT NULL,
  payload_json  TEXT NOT NULL,                             -- the frozen snapshot (never recomputed)
  site_ids      TEXT,                                      -- JSON array: the sites of the published projects (reader check)
  has_amounts   INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER,
  created_by_name TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT,                                      -- NULL = no expiry
  revoked_at    TEXT,
  revoked_by    INTEGER,
  CHECK ((audience IN ('site', 'programme') AND audience_ref IS NOT NULL) OR (audience IN ('committee', 'exec') AND audience_ref IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_roadmap_publications_audience ON roadmap_publications(audience, audience_ref);
