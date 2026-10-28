-- Committee review 2026-10-28 (field P1-4): a double tap on a slow site link recorded the same
-- decision / action twice. The cockpit now sends one idempotency key per form; a repeated key in the
-- same session returns the first row. ADDITIVE and idempotent.
ALTER TABLE decisions ADD COLUMN IF NOT EXISTS idem_key TEXT;
ALTER TABLE session_actions ADD COLUMN IF NOT EXISTS idem_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_decisions_session_idem ON decisions(session_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_actions_idem ON session_actions(session_id, idem_key) WHERE idem_key IS NOT NULL;
