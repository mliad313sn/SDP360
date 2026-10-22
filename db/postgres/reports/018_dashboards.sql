-- Step 6 (SDP-DASH-2.0, lot 6.4) — composed dashboards. Mirror of the sqlite schema in
-- services/dashboards/store.js. One row per dashboard (its working draft + the version on air) and
-- one row per published version (never rewritten: a rollback republishes an old version as a new one).
-- Dates are ISO TEXT, compared as strings on both engines.
CREATE TABLE IF NOT EXISTS dashboards (
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
CREATE TABLE IF NOT EXISTS dashboard_versions (
  dashboard_id    TEXT NOT NULL,
  version         INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  published_by    TEXT,
  published_at    TEXT NOT NULL,
  note            TEXT,
  PRIMARY KEY (dashboard_id, version)
);
