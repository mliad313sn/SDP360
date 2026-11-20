-- MANUAL rollback of db/postgres/reports/047_wan_circuit_contracts.sql. Kept OUTSIDE
-- db/postgres/ so the migrator never applies it. Set wan_sla_require_contract_evidence='0'
-- first and take a dump (the table holds entered contract terms + review trail; the evidence
-- files under data/blobs/wan-contracts/ are not touched). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/047_wan_circuit_contracts.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS wan_circuit_contracts;
COMMIT;
