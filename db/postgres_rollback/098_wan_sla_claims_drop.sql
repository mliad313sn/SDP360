-- MANUAL rollback of db/postgres/reports/098_wan_sla_claims.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- Set report_config wan_sla_claims_enabled = '0' first (the default). Removes every SLA credit claim AND its hash-chained
-- history for good — export the claims (evidence packs) and take a pg_dump before. Nothing else depends on these tables.
-- Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/098_wan_sla_claims.sql';
DROP TABLE IF EXISTS wan_sla_claim_events;
DROP TABLE IF EXISTS wan_sla_claims;
