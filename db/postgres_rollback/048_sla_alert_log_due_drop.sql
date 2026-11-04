-- MANUAL rollback of db/postgres/reports/048_sla_alert_log_due.sql. Kept OUTSIDE db/postgres/
-- so the migrator never applies it. Set teams_sla_rules.dedup_mode back to 'once' first
-- (Admin ▸ Intégration API ▸ Alertes SLA). Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/048_sla_alert_log_due.sql';
ALTER TABLE sla_alert_log DROP COLUMN IF EXISTS due_ms;
