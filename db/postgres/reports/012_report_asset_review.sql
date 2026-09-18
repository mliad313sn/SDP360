-- Asset engagement (2026-09-18) — the weekly report's "Parc informatique" tab.
-- One row per weekly report. counts_json is FROZEN by the server (never taken
-- from the client) at each tab save and at submission. updated_at = ISO text.
CREATE TABLE IF NOT EXISTS report_asset_review (
  report_id     INTEGER PRIMARY KEY,
  applicable    INTEGER NOT NULL DEFAULT 1,
  counts_json   TEXT,
  handled_note  TEXT,
  plan_note     TEXT,
  updated_by    TEXT,
  updated_at    TEXT
);
