-- MANUAL rollback of db/postgres/reports/085_ppm_workbench.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (project members, time entries and change requests are lost; set the ppm_project_team / ppm_time_entries / ppm_change_requests switches to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/085_ppm_workbench.sql';
DROP TABLE IF EXISTS ppm_change_requests;
DROP TABLE IF EXISTS ppm_time_entries;
DROP TABLE IF EXISTS ppm_project_members;
