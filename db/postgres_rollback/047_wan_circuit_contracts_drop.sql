-- MANUAL rollback of db/postgres/reports/047_wan_circuit_contracts.sql. Kept OUTSIDE
-- db/postgres/ so the migrator never applies it. Set wan_sla_require_contract_evidence='0'
-- first and take a dump (the table holds entered contract terms + review trail; the evidence
-- files under data/blobs/wan-contracts/ are not touched). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/047_wan_circuit_contracts.sql';
DROP TABLE IF EXISTS wan_circuit_contracts;
