-- E-B07 (audit B-07) — in-app product feedback, used only while report_config ui_feedback_enabled = '1'.
-- ADDITIVE and idempotent. An anonymous row stores NO user id — only the role tier and the site.
-- No outbound notification is ever sent from this table; triage is journalled in system_log.
CREATE TABLE IF NOT EXISTS product_feedback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('problem', 'idea', 'question')),
  page        TEXT,
  body        TEXT NOT NULL,
  user_id     INTEGER,                 -- NULL when anonymous
  role_tier   TEXT,
  site_id     INTEGER,
  anonymous   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'planned', 'declined', 'done')),
  response    TEXT,
  triaged_by  INTEGER,
  triaged_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_product_feedback_status ON product_feedback(status, created_at);
CREATE INDEX IF NOT EXISTS idx_product_feedback_user ON product_feedback(user_id);
