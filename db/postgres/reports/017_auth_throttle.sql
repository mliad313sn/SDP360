-- Step 4 (SDP-DASH-2.0) — persistent login throttle (survives a restart, shared by every
-- process). Mirror of the sqlite schema in services/authThrottle.js. One row per bucket
-- ('ip:<address>' or 'user:<login>'); window_start is epoch milliseconds.
CREATE TABLE IF NOT EXISTS auth_throttle (
  bucket        TEXT PRIMARY KEY,
  hits          INTEGER NOT NULL DEFAULT 0,
  window_start  BIGINT  NOT NULL
);
