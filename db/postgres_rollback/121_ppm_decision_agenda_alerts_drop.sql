-- MANUAL rollback of db/postgres/reports/121_ppm_decision_agenda_alerts.sql. Kept OUTSIDE db/postgres/ so the migrator
-- never applies it. Set report_config ppm_decision_agenda_enabled and ppm_alert_actions_enabled to '0' first (the
-- defaults). Removes the project link / authority / outcome / decision date of decisions and the alert → commitment
-- link. The decisions, the alert states and the commitments themselves STAY (a promoted commitment keeps its
-- 'ppm_alert' source link in commitment_source_links). Take a pg_dump before. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/121_ppm_decision_agenda_alerts.sql';
ALTER TABLE ppm_alert_state DROP COLUMN IF EXISTS recommended_action;
ALTER TABLE ppm_alert_state DROP COLUMN IF EXISTS severity;
ALTER TABLE ppm_alert_state DROP COLUMN IF EXISTS commitment_uid;
DROP INDEX IF EXISTS idx_decisions_project;
ALTER TABLE decisions DROP COLUMN IF EXISTS decided_at;
ALTER TABLE decisions DROP COLUMN IF EXISTS outcome;
ALTER TABLE decisions DROP COLUMN IF EXISTS authority;
ALTER TABLE decisions DROP COLUMN IF EXISTS project_id;
