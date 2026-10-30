-- G16 (programme 2026-10-29) — every alert rule carries a severity (info / warning / critical) and every firing
-- keeps the severity it fired with, so a later change of the rule does not rewrite what people were told.
-- ADDITIVE and idempotent; existing rules default to 'warning'.
-- The one-time correction of the seeded rules runs ONLY in the run that adds the column (a later replay of this
-- file after an edit never overwrites a severity or cool-down an admin has chosen since).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'alert_rules' AND column_name = 'severity') THEN
    ALTER TABLE alert_rules ADD COLUMN severity TEXT NOT NULL DEFAULT 'warning';
    UPDATE alert_rules SET severity = 'critical' WHERE key IN ('helpdesk.major_incident', 'inspection.critical');
    UPDATE alert_rules SET severity = 'info' WHERE key IN ('assets.completeness.low', 'assets.ghosts');
    -- one notice per event: the cool-down matches the window of the metric (only if still the old seeded value)
    UPDATE alert_rules SET cooldown_min = 10080 WHERE key = 'helpdesk.major_incident' AND cooldown_min = 720;
    UPDATE alert_rules SET cooldown_min = 43200 WHERE key = 'inspection.critical' AND cooldown_min = 1440;
    UPDATE alert_rules SET cooldown_min = 10080 WHERE key = 'wan.wan1.availability' AND cooldown_min = 1440;
    UPDATE alert_rules SET name = 'WAN1 % Time Up below 97 % (operational, not the contract)' WHERE key = 'wan.wan1.availability' AND name = 'WAN1 availability below 97 %';
  END IF;
END $$;
ALTER TABLE alert_firings ADD COLUMN IF NOT EXISTS severity TEXT;
