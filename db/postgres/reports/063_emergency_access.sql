-- C-22 (G49 · PO decision R7) — emergency (break-glass) access. A super_admin who is NOT the beneficiary grants a
-- time-boxed role / site for at most 24 h with a mandatory reason. The grant itself is an ordinary access_requests
-- row (kind = 'emergency', status ACTIVE) with access_grants rows, written through the C-18 path, so revoke and
-- expiry work the same and every step lands in the hash-chained access_request_events. This table carries what is
-- specific to an emergency: the exact hour it ends and the mandatory post-review (due within 2 working days, by a
-- super_admin other than the granter). An emergency never waives a qualification prerequisite (C-19).
-- Behind report_config emergency_access_enabled (default '0'). Nothing is deleted. ADDITIVE and idempotent.
CREATE TABLE IF NOT EXISTS access_emergencies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id BIGINT NOT NULL,
  source TEXT NOT NULL DEFAULT 'emergency',   -- emergency (Emergency section) | break_glass (Admin ▸ Users direct edit)
  subject_user_id INTEGER NOT NULL,
  granted_by INTEGER NOT NULL,
  reason TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT '{}',
  site_ids INTEGER[] NOT NULL DEFAULT '{}',
  starts_at TEXT NOT NULL,                     -- ISO timestamp (UTC)
  expires_at TEXT NOT NULL,                    -- ISO timestamp (UTC), at most 24 h after starts_at
  ended_at TEXT, end_reason TEXT,
  review_due TEXT NOT NULL,                    -- YYYY-MM-DD, 2 working days (Mon–Fri) after the grant
  reviewed_by INTEGER, reviewed_at TEXT, review_outcome TEXT, review_notes TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT access_emergencies_source CHECK (source IN ('emergency', 'break_glass')),
  CONSTRAINT access_emergencies_not_self CHECK (granted_by <> subject_user_id),
  CONSTRAINT access_emergencies_reviewer CHECK (reviewed_by IS NULL OR (reviewed_by <> granted_by AND reviewed_by <> subject_user_id)),
  CONSTRAINT access_emergencies_outcome CHECK (review_outcome IS NULL OR review_outcome IN ('justified', 'not_justified')),
  CONSTRAINT access_emergencies_max_24h CHECK (expires_at > starts_at
    AND (expires_at::timestamptz - starts_at::timestamptz) <= interval '24 hours'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_access_emergencies_request ON access_emergencies(request_id);
CREATE INDEX IF NOT EXISTS idx_access_emergencies_open ON access_emergencies(ended_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_access_emergencies_review ON access_emergencies(reviewed_at, review_due);
