-- MANUAL rollback of db/postgres/reports/045_ppm_baselines.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (the APPEND-ONLY baseline versions are lost (approved plan history); set ppm_baseline_versions / ppm_rebaseline_enabled / ppm_alerts_enabled to '0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/045_ppm_baselines.sql';
DROP TABLE IF EXISTS ppm_alert_state;
DROP TABLE IF EXISTS portfolio_baselines;
