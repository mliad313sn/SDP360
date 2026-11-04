-- A-15 (2026-11) — extra sites of a portfolio project. The primary site stays portfolio_projects.site_id;
-- this table only ADDS sites (multi-site projects). Read by services/portfolioAccess when the PROPOSED
-- site-scoped read / editor-plan-write switches are on (report_config portfolio_site_scope_reads /
-- portfolio_editor_plan_writes, both '0' = today). ADDITIVE and idempotent; no existing row changes.
CREATE TABLE IF NOT EXISTS portfolio_project_sites (
  project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL,
  PRIMARY KEY (project_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_project_sites_site ON portfolio_project_sites(site_id);
