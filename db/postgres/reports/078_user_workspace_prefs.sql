-- R1-PROFILES (REBUILD-SPEC R1 + R2) — per-user workspace presentation preferences.
-- ADDITIVE and idempotent. Used only while report_config workspace_profiles_enabled = '1'
-- (default '0' = today: no row is ever read or written, the page and the API answer 404).
-- PRESENTATION ONLY: nothing in this table is read by any access check. A preference never
-- grants a page, a role, a site or a record — the engine (public/lib/workspaceProfiles.js)
-- filters every destination through the user's real roles before showing it.
-- One row per user; the row is created on the first save and removed with the user.
CREATE TABLE IF NOT EXISTS user_workspace_prefs (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile          TEXT,                    -- one of the 11 profile ids; NULL = role default
  card_order       TEXT,                    -- JSON array of destination ids; NULL = profile order
  cards_hidden     TEXT,                    -- JSON array of destination ids; NULL = none hidden
  density          TEXT CHECK (density IS NULL OR density IN ('comfortable', 'compact')),
  default_site_id  INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  updated_at       TEXT NOT NULL
);
