-- Committee review 2026-10-28 (#40, CIO P1-6): holiday / shutdown calendars per site. A day listed here
-- (site row, or platform row with site_id NULL) is not a working day for the overdue / missed rules:
-- handoff escalation grace and days overdue, the escalation matrix levels, and a session missed on such a
-- day counts as excused. Nothing is ever deleted (removed_at). Empty = the behaviour until now.
CREATE TABLE IF NOT EXISTS site_calendar (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id INTEGER,                 -- NULL = every site (public holiday of the platform)
  day TEXT NOT NULL,               -- YYYY-MM-DD
  kind TEXT NOT NULL DEFAULT 'holiday',   -- holiday | shutdown
  label TEXT,
  created_by INTEGER, created_at TEXT NOT NULL,
  removed_by INTEGER, removed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_site_calendar_day ON site_calendar(day);
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_calendar_live ON site_calendar(COALESCE(site_id, 0), day) WHERE removed_at IS NULL;
