-- P11 round 3 R2-N2 — a public share link records whether its creator held the admin tier WHEN the link was minted.
-- Before, the view of a link to a group-wide report run re-checked the creator's CURRENT roles, so a link minted by an
-- editor before the P11-F1 fix (dead at view time) revived the day that editor was promoted. ADDITIVE and idempotent:
-- one nullable column; the view now requires admin at creation AND admin now. Existing rows are back-filled ONCE with
-- the creator's tier as it stands when this migration runs (the round-2 recommendation: freeze, at deploy, which
-- pre-fix links are dead) — a later promotion no longer revives them. NULL = unknown = not admin.
-- Rollback: db/postgres_rollback/116_share_link_creator_tier_drop.sql (manual).
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS creator_admin INTEGER;
UPDATE share_links l SET creator_admin = CASE WHEN EXISTS (
    SELECT 1 FROM user_roles r JOIN users u ON u.id = r.user_id
     WHERE r.user_id = l.created_by AND COALESCE(u.active, 1) <> 0 AND r.role IN ('admin', 'executive', 'super_admin')
  ) THEN 1 ELSE 0 END
 WHERE l.creator_admin IS NULL;
