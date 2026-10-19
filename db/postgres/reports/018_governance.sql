-- Step 8 — governance: meeting cadences & sessions (cockpit), decision register, session actions,
-- portfolio (programmes → objectives → projects → milestones → deliverables, risks).
-- rfi_requests already exists (016). Idempotent. Mirror: services/governanceStore.js SQLITE_DDL.

CREATE TABLE IF NOT EXISTS meeting_cadences (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'site_weekly',
  site_id INTEGER, weekday INTEGER, time_local TEXT, duration_min INTEGER DEFAULT 60, participants TEXT, chair_id INTEGER, secretary_id INTEGER,
  agenda_template TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS meeting_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, cadence_id BIGINT NOT NULL REFERENCES meeting_cadences(id) ON DELETE CASCADE, scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', agenda TEXT, items TEXT, attendees TEXT, notes TEXT, minutes_html TEXT, started_at TEXT, closed_at TEXT,
  minutes_sent_at TEXT, created_by INTEGER, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_cadence ON meeting_sessions(cadence_id, scheduled_at);
CREATE TABLE IF NOT EXISTS decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ref TEXT UNIQUE NOT NULL, session_id BIGINT REFERENCES meeting_sessions(id) ON DELETE SET NULL, title TEXT NOT NULL, text TEXT,
  owner TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'open', source_kind TEXT, source_ref TEXT, site_id INTEGER, created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), closed_at TEXT);
CREATE TABLE IF NOT EXISTS session_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE, title TEXT NOT NULL, owner TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open', source_kind TEXT, source_ref TEXT, decision_ref TEXT, created_by INTEGER, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), closed_at TEXT);
CREATE TABLE IF NOT EXISTS portfolio_programmes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, sponsor TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS portfolio_objectives (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, programme_id BIGINT NOT NULL REFERENCES portfolio_programmes(id) ON DELETE CASCADE, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, weight NUMERIC DEFAULT 1,
  owner TEXT, target_date TEXT, status TEXT NOT NULL DEFAULT 'on_track', confidence TEXT DEFAULT 'medium', progress_pct NUMERIC, evidence_metric TEXT, evidence_target NUMERIC, evidence_hib INTEGER DEFAULT 1,
  manual_evidence TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS portfolio_projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, objective_id BIGINT NOT NULL REFERENCES portfolio_objectives(id) ON DELETE CASCADE, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, owner TEXT, site_id INTEGER,
  start_date TEXT, end_date TEXT, baseline_end TEXT, status TEXT NOT NULL DEFAULT 'planned', confidence TEXT DEFAULT 'medium', progress_pct NUMERIC, budget NUMERIC, spent NUMERIC, currency TEXT DEFAULT 'USD',
  depends_on TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS portfolio_milestones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE, name TEXT NOT NULL, due_date TEXT, baseline_date TEXT, done_at TEXT,
  status TEXT NOT NULL DEFAULT 'planned', sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS portfolio_deliverables (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE, milestone_id BIGINT, name TEXT NOT NULL, owner TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo', action_kind TEXT, action_ref TEXT, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), closed_at TEXT);
CREATE TABLE IF NOT EXISTS portfolio_risks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id BIGINT NOT NULL REFERENCES portfolio_projects(id) ON DELETE CASCADE, title TEXT NOT NULL, probability INTEGER DEFAULT 2, impact INTEGER DEFAULT 2,
  mitigation TEXT, owner TEXT, status TEXT NOT NULL DEFAULT 'open', incident_ref TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), closed_at TEXT);
