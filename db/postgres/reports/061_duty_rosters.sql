-- C-20 (G44 G48 · A06 · PO decision R9) — duty rosters and the coverage policy they are read against.
--   duty_families          what a person can be on duty for. Seeded: site-it-support, network-oncall.
--   duty_coverage_policy   per site × family: how many eligible people, when. No row = the default of
--                          services/dutyCoverage.js (mine: 24/7, 12 h shifts; office: business hours).
--   duty_roster_shifts     who is on duty, where, from when to when (UTC — the sites are GMT). Entered by
--                          hand or imported from a CSV (no HR connector). Nothing is deleted (removed_at);
--                          the partial unique index makes a re-import of the same file a no-op.
-- ADDITIVE and idempotent. Empty roster = coverage reads "unknown", never green.
CREATE TABLE IF NOT EXISTS duty_families (
  key TEXT PRIMARY KEY,
  title_en TEXT NOT NULL, title_fr TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL);
INSERT INTO duty_families (key, title_en, title_fr, created_at) VALUES
  ('site-it-support', 'Site IT support', 'Support informatique du site', '2026-11-05T00:00:00.000Z'),
  ('network-oncall', 'Network on-call', 'Astreinte réseau', '2026-11-05T00:00:00.000Z')
  ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS duty_coverage_policy (
  site_id INTEGER NOT NULL,
  family TEXT NOT NULL REFERENCES duty_families(key),
  mode TEXT NOT NULL,                       -- 24x7 | business_hours | none
  min_people INTEGER NOT NULL DEFAULT 1,
  shift_start TEXT NOT NULL DEFAULT '06:00', shift_hours INTEGER NOT NULL DEFAULT 12,
  business_start TEXT NOT NULL DEFAULT '08:00', business_end TEXT NOT NULL DEFAULT '17:00',
  business_days TEXT NOT NULL DEFAULT '12345',   -- ISO weekdays, 1 = Monday
  updated_by INTEGER, updated_at TEXT NOT NULL,
  PRIMARY KEY (site_id, family),
  CONSTRAINT duty_coverage_policy_mode CHECK (mode IN ('24x7', 'business_hours', 'none')),
  CONSTRAINT duty_coverage_policy_min CHECK (min_people BETWEEN 1 AND 20));

CREATE TABLE IF NOT EXISTS duty_roster_shifts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id INTEGER NOT NULL,
  family TEXT NOT NULL REFERENCES duty_families(key),
  user_id INTEGER NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,   -- ISO UTC, ends_at exclusive
  source TEXT NOT NULL DEFAULT 'manual',
  imported_by INTEGER,                               -- the person who imported the CSV (NULL for manual)
  created_by INTEGER, created_at TEXT NOT NULL,
  removed_by INTEGER, removed_at TEXT,
  CONSTRAINT duty_roster_shifts_source CHECK (source IN ('manual', 'csv')),
  CONSTRAINT duty_roster_shifts_order CHECK (ends_at > starts_at));
CREATE UNIQUE INDEX IF NOT EXISTS uq_duty_roster_live ON duty_roster_shifts(site_id, family, user_id, starts_at, ends_at) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_duty_roster_window ON duty_roster_shifts(site_id, family, starts_at);
