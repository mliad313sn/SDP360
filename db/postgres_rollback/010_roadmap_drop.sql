-- MANUAL rollback of db/postgres/reports/010_roadmap.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the Roadmap Manager rows are lost: objectives, deliverables, training log). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/010_roadmap.sql';
-- One transaction (P11 r5 N-13): a failing statement rolls the whole script back; psql -f turns the final
-- COMMIT of an aborted transaction into ROLLBACK, so a failure changes nothing.
BEGIN;
DROP TABLE IF EXISTS roadmap_training;
DROP TABLE IF EXISTS roadmap_deliverables;
DROP TABLE IF EXISTS roadmap_objectives;
COMMIT;
