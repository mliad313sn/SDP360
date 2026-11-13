-- MANUAL rollback of db/postgres/reports/101_portfolio_sensitive_roadmap_audience.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config portfolio_sensitive_projects = '0' and roadmap_audience_publication_enabled = '0' first (the defaults).
-- Removes every published roadmap snapshot AND every sensitive flag for good — take a pg_dump before. Share links that
-- point at a publication then read "no longer available". Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/101_portfolio_sensitive_roadmap_audience.sql';
DROP TABLE IF EXISTS roadmap_publications;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS sensitive;
