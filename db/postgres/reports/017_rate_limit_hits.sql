-- Step 4 — persistent rate-limit buckets (login attempts survive a restart). Idempotent.
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  scope        TEXT NOT NULL,
  key          TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key)
);
