-- MANUAL rollback of db/postgres/reports/094_finance_certifications.sql. Kept OUTSIDE db/postgres/ so the
-- migrator never applies it. Set finance_certification_enabled = '0' first (the default). Removes every Finance
-- certification and its hash-chained ledger for good — take a pg_dump before, and remove
-- 'finance_certification_events' from services/auditChain.js TABLES (or the nightly verify reports it missing).
-- Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/094_finance_certifications.sql';
DROP TRIGGER IF EXISTS finance_certification_events_append_only ON finance_certification_events;
DROP TRIGGER IF EXISTS finance_certification_events_hash_chain ON finance_certification_events;
DROP TABLE IF EXISTS finance_certification_events;
DROP TABLE IF EXISTS finance_certifications;
