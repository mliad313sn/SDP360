-- P11 round 2 N-02 — truncation-guard anchors.
-- One row per guarded reconcile (job key, e.g. 'requests', 'change_cab/cab', 'assets_assets'):
-- the last row count the source confirmed. services/sync/truncationGuard.js compares a fetch
-- against max(stored, anchor_count), so repeated partial exports can no longer ratchet a table
-- down. A lossy run never lowers the anchor. Idempotent; no data written here.
CREATE TABLE IF NOT EXISTS sync_truncation_anchors (
  guard_key    TEXT PRIMARY KEY,
  anchor_count INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);
