-- MANUAL rollback of db/postgres/reports/110_ppm_governance_w3.sql. Kept OUTSIDE db/postgres/ so the migrator never
-- applies it. Set report_config ppm_gate_checklist_enabled, ppm_raid_enabled, ppm_project_rag_enabled and
-- ppm_simplified_view_enabled to '0' first (the defaults). Removes the gate checklists, their evidence and sign-offs, the
-- RAID details (response, review date, exposure), the RAG hysteresis memory and the view preferences for good — take a
-- pg_dump before. The RAID rows themselves (portfolio_risks) and the ppm_events ledger rows stay. Afterwards:
--   DELETE FROM schema_migrations WHERE id = 'reports/110_ppm_governance_w3.sql';
DROP TABLE IF EXISTS ppm_user_view_prefs;
DROP TABLE IF EXISTS ppm_project_rag_state;
DROP TABLE IF EXISTS ppm_raid_details;
DROP TABLE IF EXISTS ppm_gate_signoffs;
DROP TABLE IF EXISTS ppm_gate_evidence;
DROP TABLE IF EXISTS ppm_gate_checklists;
