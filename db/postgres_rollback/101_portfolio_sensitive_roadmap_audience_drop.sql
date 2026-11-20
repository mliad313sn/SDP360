-- MANUAL rollback of db/postgres/reports/101_portfolio_sensitive_roadmap_audience.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config portfolio_sensitive_projects = '0' and roadmap_audience_publication_enabled = '0' first (the defaults).
-- Removes every published roadmap snapshot AND every sensitive flag for good — take a pg_dump before. Share links that
-- point at a publication then read "no longer available". Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/101_portfolio_sensitive_roadmap_audience.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS roadmap_publications;
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS sensitive;
COMMIT;
