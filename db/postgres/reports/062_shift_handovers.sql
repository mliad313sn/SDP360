-- C-21 (G47) — shift handover with explicit acceptance. The outgoing person records what is still open at the
-- end of the shift (a snapshot, frozen at creation) and names the incoming person; ONLY the incoming person (or
-- their in-scope deputy) accepts or refuses (a refusal carries a reason). Nothing accepts by itself: a pending
-- handover older than report_config shift_handover_flag_hours is FLAGGED, never auto-accepted.
-- Behind report_config shift_handover_enabled (default '0'). Nothing is deleted. ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS shift_handovers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id INTEGER NOT NULL,
  family TEXT NOT NULL,                     -- duty family (duty_families.key)
  shift_label TEXT,                         -- free text, e.g. "night 2026-11-05"
  from_user INTEGER NOT NULL,
  to_user INTEGER NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',    -- snapshot of the open items at creation
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  refusal_reason TEXT,
  created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
  accepted_at TEXT, accepted_by INTEGER,    -- accepted_by = the incoming person or their deputy
  decided_at TEXT, decided_by INTEGER,
  acting_for INTEGER,                       -- set when a deputy decided in the name of to_user
  idem_key TEXT,
  CONSTRAINT shift_handovers_status CHECK (status IN ('pending', 'accepted', 'refused')),
  CONSTRAINT shift_handovers_not_self CHECK (from_user <> to_user));
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_handovers_idem ON shift_handovers(idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_handovers_site ON shift_handovers(site_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_shift_handovers_to ON shift_handovers(to_user, status);
