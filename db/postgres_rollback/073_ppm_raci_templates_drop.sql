-- MANUAL rollback of db/postgres/reports/073_ppm_raci_templates.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the RACI letters and the project templates are lost; set ppm_raci_enabled / ppm_templates_enabled to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/073_ppm_raci_templates.sql';
DROP TABLE IF EXISTS ppm_templates;
DROP TABLE IF EXISTS ppm_raci;
