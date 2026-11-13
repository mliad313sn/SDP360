-- W2-ENGINE (PPM parity W2: calendars, resource pool, rates A–E, assignments with contours, levelling, baseline slots).
-- ADDITIVE and idempotent: NEW tables only, no existing row or column changes meaning. Every table is read and written
-- only while its PROPOSED report_config switch is '1' (the routes answer 404 while '0' = today):
--   ppm_calendars_enabled       ppm_calendars, ppm_calendar_exceptions, ppm_project_engine.calendar_id, ppm_task_engine.calendar_id
--   ppm_resources_enabled       ppm_resources, ppm_resource_rates (money: committee writes, money-read rule), ppm_assignments
--   ppm_leveling_enabled        ppm_task_engine.leveling_delay_days (written only by an explicit "apply" of a proposal)
--   ppm_baseline_slots_enabled  ppm_baseline_slots (Baseline, Baseline1..10, Interim1..10 — APPEND-ONLY, immutable once saved)
-- The engine fields of a task live in a SIDE table (not on portfolio_tasks, which every reader gets with SELECT *).
-- A calendar may build on a site's holiday calendar (site_calendar, migration 037): use_site_holidays = 1 adds the
-- site's (and the platform's) holidays. NULL everywhere = unknown, never 0 (a rate never defaults, a currency never
-- defaults). Every write is also a hash-chained ppm_events row. Rollback: db/postgres_rollback/105_ppm_engine_w2_drop.sql.
CREATE TABLE IF NOT EXISTS ppm_calendars (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              TEXT NOT NULL,
  site_id           INTEGER,                                    -- holidays of this site (site_calendar); NULL = platform rows only
  base_calendar_id  BIGINT REFERENCES ppm_calendars(id),         -- inherits work week / holidays / exceptions
  workdays          TEXT,                                       -- JSON [1..7] ISO weekdays (7 = Sunday); NULL = inherited / Mon–Fri
  hours_per_day     NUMERIC CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 24)),
  use_site_holidays SMALLINT NOT NULL DEFAULT 1 CHECK (use_site_holidays IN (0, 1)),
  created_by        INTEGER,
  created_at        TEXT,
  updated_at        TEXT,
  removed_at        TEXT
);
CREATE TABLE IF NOT EXISTS ppm_calendar_exceptions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calendar_id BIGINT NOT NULL REFERENCES ppm_calendars(id) ON DELETE CASCADE,
  day_from    TEXT NOT NULL CHECK (day_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  day_to      TEXT NOT NULL CHECK (day_to ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  working     SMALLINT NOT NULL CHECK (working IN (0, 1)),          -- 1 = an extra working day (e.g. a Saturday shift)
  label       TEXT,
  created_by  INTEGER,
  created_at  TEXT,
  CHECK (day_to >= day_from)
);
CREATE INDEX IF NOT EXISTS idx_ppm_calendar_exceptions_cal ON ppm_calendar_exceptions(calendar_id, day_from);
CREATE TABLE IF NOT EXISTS ppm_project_engine (
  project_id    BIGINT PRIMARY KEY REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  calendar_id   BIGINT REFERENCES ppm_calendars(id),
  updated_by    INTEGER,
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS ppm_task_engine (
  task_id                  BIGINT PRIMARY KEY REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  calendar_id              BIGINT REFERENCES ppm_calendars(id),
  priority                 INTEGER CHECK (priority IS NULL OR (priority >= 0 AND priority <= 1000)),   -- 1000 = do not level
  ignore_resource_calendar SMALLINT CHECK (ignore_resource_calendar IS NULL OR ignore_resource_calendar IN (0, 1)),
  leveling_delay_days      INTEGER CHECK (leveling_delay_days IS NULL OR leveling_delay_days >= 0),
  updated_by               INTEGER,
  updated_at               TEXT
);
CREATE TABLE IF NOT EXISTS ppm_resources (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'material', 'cost')),
  user_id        INTEGER,                                  -- a named person (NULL = generic or non-person)
  site_id        INTEGER,                                  -- site perimeter of the resource (NULL = group-wide)
  generic        SMALLINT NOT NULL DEFAULT 0 CHECK (generic IN (0, 1)),
  max_units_pct  NUMERIC CHECK (max_units_pct IS NULL OR (max_units_pct > 0 AND max_units_pct <= 10000)),
  calendar_id    BIGINT REFERENCES ppm_calendars(id),
  material_label TEXT,
  active         SMALLINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by     INTEGER,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE TABLE IF NOT EXISTS ppm_resource_rates (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id    BIGINT NOT NULL REFERENCES ppm_resources(id) ON DELETE CASCADE,
  rate_table     TEXT NOT NULL CHECK (rate_table IN ('A', 'B', 'C', 'D', 'E')),
  effective_from TEXT NOT NULL CHECK (effective_from ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  standard_rate  NUMERIC CHECK (standard_rate IS NULL OR standard_rate >= 0),   -- per hour (work) / per unit (material)
  overtime_rate  NUMERIC CHECK (overtime_rate IS NULL OR overtime_rate >= 0),
  cost_per_use   NUMERIC CHECK (cost_per_use IS NULL OR cost_per_use >= 0),
  currency       TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_by     INTEGER,
  created_at     TEXT,
  UNIQUE (resource_id, rate_table, effective_from)
);
CREATE TABLE IF NOT EXISTS ppm_assignments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id       BIGINT NOT NULL REFERENCES portfolio_tasks(id) ON DELETE CASCADE,
  resource_id   BIGINT NOT NULL REFERENCES ppm_resources(id),
  units_pct     NUMERIC CHECK (units_pct IS NULL OR (units_pct >= 0 AND units_pct <= 10000)),   -- material: quantity
  work_hours    NUMERIC CHECK (work_hours IS NULL OR work_hours >= 0),                          -- NULL = units × duration
  contour       TEXT NOT NULL DEFAULT 'flat' CHECK (contour IN ('flat', 'back_loaded', 'front_loaded', 'double_peak', 'early_peak', 'late_peak', 'bell', 'turtle')),
  rate_table    TEXT NOT NULL DEFAULT 'A' CHECK (rate_table IN ('A', 'B', 'C', 'D', 'E')),
  cost_amount   NUMERIC CHECK (cost_amount IS NULL OR cost_amount >= 0),                        -- cost resources only
  cost_currency TEXT CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  CHECK (cost_amount IS NULL OR cost_currency IS NOT NULL),
  created_by    INTEGER,
  created_at    TEXT,
  updated_at    TEXT,
  UNIQUE (task_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_ppm_assignments_resource ON ppm_assignments(resource_id);
CREATE TABLE IF NOT EXISTS ppm_baseline_slots (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('baseline', 'interim')),
  slot         SMALLINT NOT NULL CHECK ((kind = 'baseline' AND slot BETWEEN 0 AND 10) OR (kind = 'interim' AND slot BETWEEN 1 AND 10)),
  saved_at     TEXT NOT NULL,
  saved_by     INTEGER,
  saved_by_name TEXT,
  reason       TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE (project_id, kind, slot)
);
-- Immutable once saved (MS-Project "Baseline N" is overwritten in place; here a saved slot is never edited or deleted —
-- the same append-only rule as portfolio_baselines, migration 045).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ppm_baseline_slots_append_only') THEN
    CREATE TRIGGER ppm_baseline_slots_append_only BEFORE UPDATE OR DELETE ON ppm_baseline_slots FOR EACH ROW EXECUTE FUNCTION sdp_append_only();
  END IF;
END $$;
