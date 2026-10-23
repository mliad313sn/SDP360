-- Step 8 (SDP-DASH-2.0) — meeting cockpit, requests-for-information / decisions register, portfolio.
-- Mirror of the sqlite schemas in services/defstore.js (cadences), services/cockpit/store.js and
-- services/portfolio/store.js. Dates are ISO TEXT, compared as strings on both engines.

-- Meeting cadences: versioned definitions (type, site, day, participants, preparer, agenda template).
CREATE TABLE IF NOT EXISTS ck_cadences (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'custom', draft_json TEXT, draft_by TEXT, draft_at TEXT,
  published_version INTEGER, retired INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ck_cadence_versions (
  cadence_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
  published_by TEXT, published_at TEXT NOT NULL, note TEXT, PRIMARY KEY (cadence_id, version)
);

-- One held (or planned) meeting of a cadence. The agenda is frozen at the start: the minutes quote the
-- figures as they were shown in the room.
CREATE TABLE IF NOT EXISTS ck_sessions (
  id              TEXT PRIMARY KEY,
  cadence_id      TEXT NOT NULL,
  cadence_version INTEGER,
  held_on         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned',
  agenda_json     TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  minutes_html    TEXT,
  minutes_sent_at TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ck_sessions_cadence ON ck_sessions (cadence_id, held_on);

-- One agenda point of a session: its time-stamps and the notes taken live.
CREATE TABLE IF NOT EXISTS ck_items (
  session_id TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  section    TEXT NOT NULL,
  title      TEXT,
  started_at TEXT,
  ended_at   TEXT,
  notes      TEXT,
  PRIMARY KEY (session_id, seq)
);

-- Decisions: taken in a session (session_id) or on a request for information (rfi_id).
CREATE TABLE IF NOT EXISTS ck_decisions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  item_seq    INTEGER,
  rfi_id      TEXT,
  text        TEXT NOT NULL,
  owner       TEXT,
  source_kind TEXT,
  source_ref  TEXT,
  decided_by  TEXT,
  decided_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ck_decisions_session ON ck_decisions (session_id);

-- Actions, tied to where they come from (an incident, an indicator, an issue, a request, a project, a decision).
CREATE TABLE IF NOT EXISTS ck_actions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  cadence_id  TEXT,
  item_seq    INTEGER,
  title       TEXT NOT NULL,
  owner       TEXT,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  done_at     TEXT,
  source_kind TEXT NOT NULL DEFAULT 'free',
  source_ref  TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_ck_actions_status ON ck_actions (status, due_date);
CREATE INDEX IF NOT EXISTS ix_ck_actions_source ON ck_actions (source_kind, source_ref);

-- Requests for information / for decision submitted to the committee: triage, score, decision.
CREATE TABLE IF NOT EXISTS ck_rfis (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  category     TEXT,
  requester    TEXT,
  submitted_at TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new',
  value        INTEGER,
  urgency      INTEGER,
  effort       INTEGER,
  score        DOUBLE PRECISION,
  triage_note  TEXT,
  triaged_by   TEXT,
  triaged_at   TEXT,
  decision_id  TEXT,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_ck_rfis_status ON ck_rfis (status, submitted_at);

-- Portfolio: programmes → objectives → projects → milestones → deliverables, one tree.
CREATE TABLE IF NOT EXISTS pf_nodes (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  owner           TEXT,
  status          TEXT NOT NULL DEFAULT 'not_started',
  confidence      INTEGER,
  start_date      TEXT,
  due_date        TEXT,
  baseline_due    TEXT,
  done_date       TEXT,
  budget          DOUBLE PRECISION,
  spent           DOUBLE PRECISION,
  evidence_metric TEXT,
  evidence_target DOUBLE PRECISION,
  evidence_scope  TEXT,
  depends_on      TEXT,
  risk            TEXT,
  incidents       TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  updated_by      TEXT,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pf_nodes_parent ON pf_nodes (parent_id, position);
