-- Step 7 (SDP-DASH-2.0) — business trackers. Mirror of the sqlite schema in services/defstore.js (definitions) and
-- services/trackers/store.js (entries, locks). A tracker = one versioned definition + its monthly entries per unit ×
-- item; a locked month refuses every write. Dates are ISO TEXT, compared as strings on both engines.
CREATE TABLE IF NOT EXISTS trk_trackers (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL DEFAULT 'custom',
  draft_json        TEXT,
  draft_by          TEXT,
  draft_at          TEXT,
  published_version INTEGER,
  retired           INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT,
  created_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trk_tracker_versions (
  tracker_id      TEXT NOT NULL,
  version         INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  published_by    TEXT,
  published_at    TEXT NOT NULL,
  note            TEXT,
  PRIMARY KEY (tracker_id, version)
);
CREATE TABLE IF NOT EXISTS trk_entries (
  tracker_id TEXT NOT NULL,
  year       INTEGER NOT NULL,
  unit       TEXT NOT NULL,
  item       TEXT NOT NULL,
  month      INTEGER NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tracker_id, year, unit, item, month)
);
CREATE INDEX IF NOT EXISTS ix_trk_entries_tracker ON trk_entries (tracker_id, year);
CREATE TABLE IF NOT EXISTS trk_locks (
  tracker_id TEXT NOT NULL,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL,
  locked_by  TEXT,
  locked_at  TEXT NOT NULL,
  PRIMARY KEY (tracker_id, year, month)
);
