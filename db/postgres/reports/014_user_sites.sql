-- Multi-site editors (2026-10-05) — EXTRA sites of a user. The primary site stays
-- users.site_id; the session carries site_ids = [primary, ...these]. Mirror of the
-- sqlite table created in reports-db.js.
CREATE TABLE IF NOT EXISTS user_sites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);
CREATE INDEX IF NOT EXISTS idx_us_user ON user_sites(user_id);
