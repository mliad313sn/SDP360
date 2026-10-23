-- Step 10 (SDP-DASH-2.0) — field application: resumable photo uploads and quick actions sent from the field.
-- Executed as is on SQLite by services/sqlStore.js. The upload chunks themselves live on disk
-- (<SDP_DATA_DIR>/field-uploads/<id>/), never in the database. Dates are ISO TEXT.
CREATE TABLE IF NOT EXISTS fd_uploads (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  chunks       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  blob_ref     TEXT
);
CREATE INDEX IF NOT EXISTS ix_fd_uploads_user ON fd_uploads (username, status);
CREATE TABLE IF NOT EXISTS fd_quick_actions (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL,
  result       TEXT,
  created_at   TEXT NOT NULL,
  processed_by TEXT,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_fd_quick_status ON fd_quick_actions (status, created_at);
-- The last save made FROM THE FIELD APP of each inspection: who, and which version it produced. A phone that never
-- received the answer of its own save resends it; the server recognises the version as that person's and does not
-- report a conflict. Any other change (the full form, another person) does.
CREATE TABLE IF NOT EXISTS fd_inspection_saves (
  inspection_id TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  updated_at    TEXT,
  saved_at      TEXT NOT NULL
);
