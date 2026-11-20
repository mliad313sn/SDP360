-- PORTFOLIO LOT 4 (IT portfolio reconstruction spec §14, §22) — project-linked decisions + actionable management alerts.
-- ADDITIVE and idempotent: new NULLABLE columns only, no existing row or column changes meaning, no foreign key, no
-- cascade (a decision outlives the project row it names; a project deletion never deletes a decision).
-- Read and written only while report_config ppm_decision_agenda_enabled = '1' (decision columns) and
-- ppm_alert_actions_enabled = '1' (alert columns) — both PROPOSED, default '0' = today.
-- ADR: docs/ai-decisions/ADR-PORTFOLIO-LOT4-decision-agenda-alerts.md
--   decisions.project_id        the portfolio project the decision is about (source_kind = 'project'); NULL = not linked
--   decisions.authority         who decides (free text, spec §14 "decision authority")
--   decisions.outcome           approved | rejected | deferred | approved_with_conditions | escalated (PROPOSED, app-checked)
--   decisions.decided_at        the decision date (YYYY-MM-DD)
--   ppm_alert_state.commitment_uid      the commitment a management alert was promoted to (one per alert key)
--   ppm_alert_state.severity            the alert severity at promotion (PROPOSED mapping, services/ppmAlerts.js)
--   ppm_alert_state.recommended_action  the recommended action shown at promotion (PROPOSED text)
-- Rollback: db/postgres_rollback/121_ppm_decision_agenda_alerts_drop.sql (manual).
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS project_id BIGINT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS authority TEXT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS decided_at TEXT;
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions (project_id) WHERE project_id IS NOT NULL;
ALTER TABLE ppm_alert_state ADD COLUMN IF NOT EXISTS commitment_uid TEXT;
ALTER TABLE ppm_alert_state ADD COLUMN IF NOT EXISTS severity TEXT;
ALTER TABLE ppm_alert_state ADD COLUMN IF NOT EXISTS recommended_action TEXT;
