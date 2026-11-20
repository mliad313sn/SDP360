-- P11 round 3 F-14 — truncation-guard anchors keep a PENDING lower count.
-- The anchor (113) moved down whenever a run lost nothing against the STORED count, so alternating
-- partial exports (1000 → 810 → 820 → 660 …) still ratcheted a table down. services/sync/truncationGuard.js
-- now lowers the anchor only when two consecutive accepted exports agree on the same lower count:
-- pending_count is that candidate, pending_agree how many consecutive exports reported it.
-- Additive and idempotent; no data written here (existing anchors keep their count, no candidate).
ALTER TABLE sync_truncation_anchors ADD COLUMN IF NOT EXISTS pending_count INTEGER;
ALTER TABLE sync_truncation_anchors ADD COLUMN IF NOT EXISTS pending_agree INTEGER NOT NULL DEFAULT 0;
