-- MANUAL rollback of db/postgres/reports/081_benefit_class_and_currency_flag.sql. Kept OUTSIDE db/postgres/ so the migrator never applies it.
-- W1-INTEGRITY / ARCH-MIG-1 (PPM parity W0). Take a dump first (benefit classes / periods / method notes and the project currency_defaulted flag are lost; set benefit_value_class_enabled='0' before). Roll back in REVERSE migration order: a later PPM
-- migration that builds on this one must be rolled back first (the DROPs carry no CASCADE, so an out-of-order run
-- REFUSES instead of silently dropping a dependant). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/081_benefit_class_and_currency_flag.sql';
ALTER TABLE portfolio_projects DROP COLUMN IF EXISTS currency_defaulted;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS verifier_role_required;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS metric_key;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS source_kind;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS method_note;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS measured_to;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS measured_from;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS baseline_period_to;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS baseline_period_from;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS basis;
ALTER TABLE portfolio_benefits DROP COLUMN IF EXISTS value_class;
