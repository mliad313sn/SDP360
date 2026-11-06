-- E-G03 (audit G-03, catalogue A13) — proof of session: attendance recorded per participant
-- (JSON [{participant, status present|absent|excused, recorded_by, recorded_at}]; NULL = not recorded, never
-- "everyone present"), and the exception-only agenda compiled as a DRAFT by the scheduled job
-- governance.agenda_drafts (report_config agenda_cron_enabled, default '0'). Nothing is sent or published.
-- ADDITIVE and idempotent.
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS attendance TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda_for TEXT;
ALTER TABLE meeting_cadences ADD COLUMN IF NOT EXISTS draft_agenda_at TEXT;

-- E-G04 (audit G-04) — control register: risk → control → test → exception → commitment. CANDIDATES only:
-- adopting a control (status 'adopted'), its frequency and its tester are GRC decisions; the seed never adopts.
-- A period with no test row = not_run (never pass). Used only while report_config controls_register_enabled = '1'.
CREATE TABLE IF NOT EXISTS gov_controls (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,
  risk_ref          TEXT,                 -- free text (Risk Register domain, THREAT-MODEL id…)
  portfolio_risk_id BIGINT,               -- optional portfolio_risks.id (no FK: a risk can be deleted, the control stays)
  objective         TEXT NOT NULL,
  frequency         TEXT,                 -- proposed; NULL = not decided
  evidence_kind     TEXT,
  owner_role        TEXT,
  owner_id          INTEGER,              -- the named owner once GRC assigns one (a tester can never be the owner)
  status            TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'adopted', 'retired')),
  status_by         INTEGER,
  status_at         TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gov_control_tests (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  control_id              BIGINT NOT NULL REFERENCES gov_controls(id) ON DELETE CASCADE,
  period                  TEXT NOT NULL,   -- YYYY-MM or YYYY-Qn
  result                  TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'not_run')),
  evidence_url            TEXT,
  tester_id               INTEGER NOT NULL,
  note                    TEXT,
  exception_commitment_id BIGINT,
  recorded_at             TEXT NOT NULL,
  UNIQUE (control_id, period)
);
