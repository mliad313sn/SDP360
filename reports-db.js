/**
 * Endeavour Mining — Reports Database Module
 * SQLite (WAL mode) — handles concurrent reads + sequential writes safely.
 * Tables: users, sites, sessions, weeks, weekly_reports,
 *         infra_kpis, helpdesk_data, lights, action_items,
 *         sync_metadata, change_records, cab_approvals,
 *         survey_results, survey_answers
 */
'use strict';

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

// ── DB FILE ───────────────────────────────────────────────────────
// SDP_DATA_DIR override lets tests point the module at a throwaway temp
// directory; unset in prod so the default data/ path is unchanged.
const DATA_DIR = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'reports.db'));

// Performance & safety
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ── SCHEMA ────────────────────────────────────────────────────────
// Meraki WAN link availability & quality snapshots (V1b / V1b-E). Per-LINK (wan1/wan2)
// AND per-SUB-SITE (sub_site='' for normal sites; 'FETEKRO'/'TANDA'/… for the multi-
// location Exploration report). Kept SEPARATE from infra_metric_snapshots (whose PK
// can't hold two 'wan' rows). availability_pct is DERIVED (calibration-gated); null =
// no data (never 0). Archives the vendor's numbers before Meraki purges (~60d).
// Composite PK, no surrogate id. Factored into a const so the initial CREATE and the
// one-time sub_site rebuild below use the SAME schema.
const _WAN_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS wan_link_snapshots (
  site_id          INTEGER NOT NULL,
  sub_site         TEXT NOT NULL DEFAULT '',  -- '' for normal sites; sub-site token for Exploration
  uplink           TEXT NOT NULL,        -- 'wan1' | 'wan2' | 'wan3' | 'cellular'
  period_type      TEXT NOT NULL,        -- 'week' | 'month'
  period_start     TEXT NOT NULL,
  period_end       TEXT,
  availability_pct REAL,
  status_color     TEXT,
  loss_pct_avg     REAL,
  latency_ms_avg   REAL,
  jitter_ms_avg    REAL,
  goodput_avg      REAL,
  status_current   TEXT,
  uplink_label     TEXT,
  device_serial    TEXT,
  network_id       TEXT,
  data_through     TEXT,
  collected_at     TEXT,
  source           TEXT,
  raw_json         TEXT,
  PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start)
);`;

// WAN SLA / ISP chargeback — one row per detected WAN outage. Composite PK (no surrogate
// id → sqlite/pg parity). detected_start/restored_end are TEXT timestamps; duration_s is
// computed in JS (never date math in SQL — the pg-strict trap). Mirrors _WAN_CREATE_SQL so
// the sqlite boot CREATE and initPgReports share one schema.
const _WAN_OUTAGES_CREATE_SQL = `
CREATE TABLE IF NOT EXISTS wan_outages (
  site_id            INTEGER NOT NULL,
  sub_site           TEXT NOT NULL DEFAULT '',
  uplink             TEXT NOT NULL,
  isp                TEXT,
  circuit_id         TEXT,
  detected_start     TEXT NOT NULL,
  restored_end       TEXT,
  notified_at        TEXT,
  duration_s         INTEGER,
  attribution        TEXT,
  attribution_reason TEXT,
  network_id         TEXT,
  device_serial      TEXT,
  source             TEXT,
  raw_json           TEXT,
  PRIMARY KEY (site_id, sub_site, uplink, detected_start)
);`;

db.exec(`
CREATE TABLE IF NOT EXISTS sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,
  zoho_group TEXT,             -- Zoho AP group name (e.g. "Hounde IT Agents")
  active     INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  site_id       INTEGER,          -- NULL = admin (all sites)
  role          TEXT DEFAULT 'editor',  -- admin | editor | viewer
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS weeks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  year         INTEGER NOT NULL,
  week_number  INTEGER NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  label        TEXT NOT NULL,
  UNIQUE(year, week_number)
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL,
  week_id      INTEGER NOT NULL,
  status       TEXT DEFAULT 'draft',   -- draft | submitted
  submitted_at TEXT,
  submitted_by INTEGER,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(site_id, week_id),
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (week_id) REFERENCES weeks(id)
);

CREATE TABLE IF NOT EXISTS infra_kpis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    INTEGER NOT NULL,
  service      TEXT NOT NULL,
  kpi          TEXT NOT NULL,
  target       TEXT,
  status_value TEXT,
  status_color TEXT DEFAULT 'green',   -- green | orange | red | none
  trend        TEXT DEFAULT 'stable',  -- up | down | stable | no_change
  sort_order   INTEGER DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE
);

-- OPManager infra availability snapshots (V1a). Automated measurement history,
-- SEPARATE from infra_kpis (per-report rows). Keyed by the composite PK (no
-- surrogate id → avoids the sqlite/pg autoinc divergence). status_color uses the
-- same green|orange|red|none vocabulary. metric_value null = no data (never 0).
CREATE TABLE IF NOT EXISTS infra_metric_snapshots (
  site_id               INTEGER NOT NULL,
  period_type           TEXT NOT NULL,        -- 'week' | 'month'
  period_start          TEXT NOT NULL,
  period_end            TEXT NOT NULL,
  kpi_family            TEXT NOT NULL,        -- 'lan' | 'wifi' | 'wan' | 'servers'
  metric_name           TEXT NOT NULL,        -- 'availability'
  metric_value          REAL,
  target_value          REAL,
  status_color          TEXT,
  trend                 TEXT,
  source                TEXT,
  source_view           TEXT,
  data_through          TEXT,
  device_count          INTEGER,
  included_device_count INTEGER,
  collected_at          TEXT NOT NULL,
  raw_json              TEXT,
  PRIMARY KEY (site_id, period_type, period_start, kpi_family, metric_name)
);

-- wan_link_snapshots is created below from the _WAN_CREATE_SQL const (factored so the
-- initial CREATE and the one-time sub_site rebuild share one schema).

CREATE TABLE IF NOT EXISTS helpdesk_data (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id             INTEGER NOT NULL UNIQUE,
  time_to_assign        REAL,
  time_to_assign_prev   REAL,
  first_reply           REAL,
  first_reply_prev      REAL,
  resolution_time       REAL,
  resolution_time_prev  REAL,
  closing_time          REAL,
  closing_time_prev     REAL,
  comments_metrics      TEXT,
  comments_sla          TEXT,
  tech_on_break         TEXT,
  techs_on_duty         TEXT,
  sla_violations        TEXT,   -- JSON: [{category, pct}]
  group_metrics         TEXT,   -- JSON: weekly array [{label,inbound,closed,res_ok_pct,fr_ok_pct,techs}]
  all_groups            TEXT,   -- JSON: full fetched list (all groups, unfiltered)
  selected_group        TEXT,   -- name of the currently selected group
  chart_data            TEXT,   -- JSON: full chart object {group,weeks,ageing,ageing_total,top10}
  fetched_at            TEXT,   -- ISO timestamp when live data was last fetched
  updated_at            TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL,
  type       TEXT NOT NULL,  -- low_light | high_light | change_in_progress | change_pending
  content    TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL,
  task       TEXT NOT NULL,
  priority   TEXT DEFAULT 'Medium',  -- High | Medium | Low
  due_date   TEXT,
  owner      TEXT,
  status     TEXT DEFAULT 'open',    -- open | in_progress | closed
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES weekly_reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_departments_active ON action_departments(active);

-- ── SYNC METADATA ─────────────────────────────────────────────────
-- Tracks when each background sync job last ran successfully.
-- job_name values: 'helpdesk' | 'change_cab' | 'survey'
CREATE TABLE IF NOT EXISTS sync_metadata (
  job_name        TEXT PRIMARY KEY,
  last_sync_at    TEXT,              -- ISO datetime of last SUCCESSFUL sync
  last_sync_rows  INTEGER DEFAULT 0, -- rows upserted on last run
  last_error      TEXT,              -- last error message (NULL if clean)
  last_error_at   TEXT,              -- ISO datetime of last error
  sync_count      INTEGER DEFAULT 0  -- total successful sync runs
);

-- ── CHANGE RECORDS ────────────────────────────────────────────────
-- One row per Change Request, synced from CHANGE_TABLE view every 6 hours.
CREATE TABLE IF NOT EXISTS change_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id        TEXT UNIQUE NOT NULL,  -- Zoho Change ID
  display_id       TEXT,                  -- CRQ-XXXX human-readable ref
  subject          TEXT,
  status           TEXT,
  stage            TEXT,
  risk             TEXT,
  change_type      TEXT,
  emergency        INTEGER DEFAULT 0,     -- 0 | 1
  category         TEXT,
  sub_category     TEXT,
  requester        TEXT,
  requester_id     TEXT,
  owner_id         TEXT,
  manager          TEXT,
  site_id          TEXT,                  -- maps to sites table
  group_id         TEXT,
  scheduled_start  TEXT,                  -- ISO datetime
  scheduled_end    TEXT,                  -- ISO datetime
  completed_time   TEXT,                  -- ISO datetime (nullable)
  created_time     TEXT,                  -- ISO datetime
  closure_code     TEXT,
  udf_json         TEXT,                  -- JSON blob: all UDF custom fields
  fetched_at       TEXT                   -- ISO datetime of last upsert
);
CREATE INDEX IF NOT EXISTS idx_cr_created  ON change_records(created_time);
CREATE INDEX IF NOT EXISTS idx_cr_status   ON change_records(status);
CREATE INDEX IF NOT EXISTS idx_cr_site     ON change_records(site_id);

-- ── CAB APPROVALS ─────────────────────────────────────────────────
-- One row per CAB approval record, synced alongside change_records.
CREATE TABLE IF NOT EXISTS cab_approvals (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id              TEXT UNIQUE NOT NULL, -- Zoho Approval ID
  change_id                TEXT NOT NULL,        -- FK → change_records.change_id
  approver_name            TEXT,
  approval_status          TEXT,                 -- Approved | Rejected | Pending
  approval_stage           TEXT,
  approval_level           TEXT,
  approval_level_status    TEXT,
  recommendation_requested TEXT,                 -- ISO datetime
  action_taken_on          TEXT,                 -- ISO datetime (nullable)
  turnaround_minutes       INTEGER,              -- SLA metric
  rule_type                TEXT,
  comments                 TEXT,
  fetched_at               TEXT                  -- ISO datetime of last upsert
);
CREATE INDEX IF NOT EXISTS idx_cab_change  ON cab_approvals(change_id);
CREATE INDEX IF NOT EXISTS idx_cab_status  ON cab_approvals(approval_status);

-- ── SURVEY RESULTS ────────────────────────────────────────────────
-- One row per submitted survey response, synced daily.
-- Links CSAT scores back to helpdesk tickets via request_display_id.
CREATE TABLE IF NOT EXISTS survey_results (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id             TEXT UNIQUE NOT NULL, -- Zoho Result ID
  response_id           TEXT,                 -- Zoho Response ID
  survey_id             TEXT,                 -- FK → Zoho Surveys.Survey ID
  survey_name           TEXT,                 -- denormalized
  request_id            TEXT,                 -- FK → SDP Request ID
  request_display_id    TEXT,                 -- e.g. #INC-12345
  change_id             TEXT,                 -- FK → change_records (nullable)
  user_id               TEXT,                 -- respondent
  overall_score         REAL,                 -- 0–100 percentage
  survey_sent_on        TEXT,                 -- ISO datetime
  survey_responded_on   TEXT,                 -- ISO datetime (nullable)
  fetched_at            TEXT                  -- ISO datetime of last upsert
);
CREATE INDEX IF NOT EXISTS idx_sr_request  ON survey_results(request_display_id);
CREATE INDEX IF NOT EXISTS idx_sr_change   ON survey_results(change_id);
CREATE INDEX IF NOT EXISTS idx_sr_sent     ON survey_results(survey_sent_on);

-- ── SURVEY ANSWERS ────────────────────────────────────────────────
-- One row per individual question answer, synced daily.
CREATE TABLE IF NOT EXISTS survey_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id   TEXT NOT NULL,  -- FK → survey_results.response_id
  result_id     TEXT NOT NULL,  -- FK → survey_results.result_id
  question_id   TEXT,           -- FK → Zoho Survey Questions
  question_text TEXT,           -- denormalized question text
  question_type TEXT,           -- single_choice | star_rating | textarea | etc.
  answer_text   TEXT,           -- free-text answer (nullable)
  answer_option TEXT,           -- selected option label (nullable)
  score         INTEGER,        -- numeric score (nullable)
  skipped       INTEGER DEFAULT 0,
  fetched_at    TEXT            -- ISO datetime of last upsert
);
CREATE INDEX IF NOT EXISTS idx_sa_response ON survey_answers(response_id);
CREATE INDEX IF NOT EXISTS idx_sa_result   ON survey_answers(result_id);

-- ── REQUEST RECORDS ───────────────────────────────────────────────
-- One row per helpdesk request/incident, synced from REQUEST_TABLE view.
-- Stores the raw fields used by Zoho Analytics aggregate formulas.
CREATE TABLE IF NOT EXISTS request_records (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id             TEXT UNIQUE NOT NULL,  -- Zoho RequestID (numeric string)
  display_id             TEXT,                  -- #INC-XXXX / #SR-XXXX human-readable ref
  subject                TEXT,
  request_status         TEXT,                  -- 'Open', 'Resolved', 'Closed', etc.
  pending_status         INTEGER DEFAULT 1,     -- 1=open, 0=closed  (Request Pending Status)
  overdue_status         INTEGER DEFAULT 0,     -- 1=SLA violated, 0=within SLA
  request_type           TEXT,                  -- 'Incident', 'Service Request', 'Major Incident' (raw Zoho text)
  service_request        INTEGER DEFAULT 0,     -- 1=Service Request, 0=Incident (derived)
  is_escalated           INTEGER DEFAULT 0,     -- 0 | 1
  reopen_count           INTEGER DEFAULT 0,
  due_by_time            TEXT,                  -- ISO datetime (SLA deadline)
  time_elapsed_ms        INTEGER,               -- raw milliseconds (Time Elapsed) — divide by 3_600_000 for hours
  created_time           TEXT,                  -- ISO datetime
  resolved_time          TEXT,                  -- ISO datetime (nullable)
  completed_time         TEXT,                  -- ISO datetime (nullable)
  responded_time         TEXT,                  -- ISO datetime (nullable)
  assigned_time          TEXT,                  -- ISO datetime (nullable)
  last_updated_time      TEXT,                  -- ISO datetime (nullable)
  first_response_overdue TEXT,                  -- 'true' | 'false' text string (as returned by Zoho)
  technician             TEXT,
  requester              TEXT,
  category               TEXT,
  sub_category           TEXT,
  site                   TEXT,                  -- site name (matches sites.name)
  tech_group             TEXT,                  -- Group field from Zoho
  impact                 TEXT,                  -- 'Enterprise' / 'Single department' / 'Multiple departments' / 'Individual' — for Risk Register scope filter
  fetched_at             TEXT                   -- ISO datetime of last upsert
);
CREATE INDEX IF NOT EXISTS idx_rr_created   ON request_records(created_time);
CREATE INDEX IF NOT EXISTS idx_rr_status    ON request_records(request_status);
CREATE INDEX IF NOT EXISTS idx_rr_site      ON request_records(site);
CREATE INDEX IF NOT EXISTS idx_rr_pending   ON request_records(pending_status);
CREATE INDEX IF NOT EXISTS idx_rr_overdue   ON request_records(overdue_status);
`);

// ── MIGRATIONS (add columns if upgrading existing DB) ─────────────
try { db.exec(`ALTER TABLE helpdesk_data ADD COLUMN group_metrics   TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE helpdesk_data ADD COLUMN all_groups      TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE helpdesk_data ADD COLUMN fetched_at      TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE helpdesk_data ADD COLUMN selected_group  TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE helpdesk_data ADD COLUMN chart_data      TEXT`); } catch(e) {}
// sync_metadata: extended columns for drift detection + full-sync tracking
try { db.exec(`ALTER TABLE sync_metadata ADD COLUMN last_full_sync_at TEXT`);           } catch(e) {}
try { db.exec(`ALTER TABLE sync_metadata ADD COLUMN schema_snapshot   TEXT`);           } catch(e) {}
try { db.exec(`ALTER TABLE sync_metadata ADD COLUMN deleted_count     INTEGER DEFAULT 0`); } catch(e) {}

// System Logs v1 — unified security/audit event log (auth · identity · config ·
// report). Written by logEvent() (fire-and-forget). sqlite id = rowid.
db.exec(`
  CREATE TABLE IF NOT EXISTS system_log (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
    actor TEXT, actor_id INTEGER, target TEXT, details TEXT, ip TEXT, risk INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_syslog_ts       ON system_log(ts);
  CREATE INDEX IF NOT EXISTS idx_syslog_category ON system_log(category);
  CREATE INDEX IF NOT EXISTS idx_syslog_action   ON system_log(action);
  CREATE INDEX IF NOT EXISTS idx_syslog_actor    ON system_log(actor);
  CREATE INDEX IF NOT EXISTS idx_syslog_risk     ON system_log(risk);
`);
// request_records: add request_type text column (stores "Major Incident" etc.)
try { db.exec(`ALTER TABLE request_records ADD COLUMN request_type TEXT`); } catch(e) {}
// request_records: add template column. The team marks a Major Incident via the
// SDP "Template" field ("Major Incident Report") while Request Type stays
// "Incident", so major-incident detection must also read this. Backfilled by a
// full requests sync.
try { db.exec(`ALTER TABLE request_records ADD COLUMN template TEXT`); } catch(e) {}
// request_records: add mode column (submission channel: Email, Web Portal, Phone, etc.)
try { db.exec(`ALTER TABLE request_records ADD COLUMN mode TEXT`); } catch(e) {}
// request_records: add impact column (Risk Register filter — 'Enterprise', 'Single department',
// 'Multiple departments', 'Individual'; only the first three count as operational risk)
try { db.exec(`ALTER TABLE request_records ADD COLUMN impact TEXT`); } catch(e) {}
// sessions: add last_seen column (drives the Active Sessions admin card).
// validateSession() bumps it on every authenticated request. Defaults to
// created_at for historical rows so the first read works without backfill.
try { db.exec(`ALTER TABLE sessions ADD COLUMN last_seen TEXT`); } catch(e) {}
// V1b-B — recent-vs-window label for device-availability snapshots (OpManager REST).
try { db.exec(`ALTER TABLE infra_metric_snapshots ADD COLUMN basis TEXT`); } catch(e) {}
// V1b / V1b-E — WAN link snapshots. Create (fresh DBs) from the shared const, then a
// guarded one-time rebuild adds sub_site to the PK on DBs created before V1b-E. The table
// has NO secondary indexes and NO foreign keys, so the rebuild recreates nothing else.
// The INSERT below omits sub_site so its DEFAULT '' applies (kept column-explicit and
// _WAN_SNAP_COLS-free — that const is in the temporal dead zone at module load).
try {
  db.exec(_WAN_CREATE_SQL);
  const _wanCols = db.prepare(`PRAGMA table_info(wan_link_snapshots)`).all().map(c => c.name);
  if (!_wanCols.includes('sub_site')) {
    db.exec('ALTER TABLE wan_link_snapshots RENAME TO _wan_old');
    db.exec(_WAN_CREATE_SQL);
    db.exec(`INSERT INTO wan_link_snapshots
      (site_id,uplink,period_type,period_start,period_end,availability_pct,status_color,loss_pct_avg,latency_ms_avg,jitter_ms_avg,goodput_avg,status_current,uplink_label,device_serial,network_id,data_through,collected_at,source,raw_json)
      SELECT
      site_id,uplink,period_type,period_start,period_end,availability_pct,status_color,loss_pct_avg,latency_ms_avg,jitter_ms_avg,goodput_avg,status_current,uplink_label,device_serial,network_id,data_through,collected_at,source,raw_json
      FROM _wan_old`);
    db.exec('DROP TABLE _wan_old');
  }
} catch(e) {}
// V1b-E — editable map of a site's sub-site tokens to Meraki networks (Exploration).
try { db.exec(`CREATE TABLE IF NOT EXISTS wan_subsite_networks (
  site_id  INTEGER NOT NULL,
  sub_site TEXT NOT NULL,
  network  TEXT NOT NULL,
  PRIMARY KEY (site_id, sub_site)
)`); } catch(e) {}
// WAN SLA / ISP chargeback — one row per detected WAN outage (created from _WAN_OUTAGES_CREATE_SQL).
try { db.exec(_WAN_OUTAGES_CREATE_SQL); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen)`); } catch(e) {}
// sites: add zoho_group column for group-based helpdesk filtering
try { db.exec(`ALTER TABLE sites ADD COLUMN zoho_group TEXT`); } catch(e) {}
// users: Entra ID (Azure AD) SSO — email is the pre-provisioning match key;
// entra_oid is the stable object-id linked on first successful Microsoft login.
try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN entra_oid TEXT`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_users_entra ON users(entra_oid)`); } catch(e) {}
// users profile — first/last/title/office. Auto-synced FROM Entra on each SSO
// login (given_name / family_name / jobTitle / officeLocation). full_name kept
// as the display field; site_id remains the authorization/scoping key.
try { db.exec(`ALTER TABLE users ADD COLUMN first_name TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN last_name  TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN title      TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN office     TEXT`); } catch(e) {}
// v1.10.9 — change_records: add group_name for site-based change filtering
try { db.exec(`ALTER TABLE change_records ADD COLUMN group_name TEXT`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_group_name ON change_records(group_name)`); } catch(e) {}
// v1.10.10 — change_records: add stage_status (Zoho "Stage and Status" combined column)
try { db.exec(`ALTER TABLE change_records ADD COLUMN stage_status TEXT`); } catch(e) {}
// department feature — action_items: nullable department + comment columns
try { db.exec(`ALTER TABLE action_items ADD COLUMN department TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE action_items ADD COLUMN comment    TEXT`); } catch(e) {}
// SP1b — action_items: stable uid + cross-source merge link (source/origin_id).
// The uid lets a per-row merge survive report re-saves (saveActionItems became
// an upsert-by-uid). source/origin_id are written ONLY by the merge endpoint.
try { db.exec(`ALTER TABLE action_items ADD COLUMN uid       TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE action_items ADD COLUMN source    TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE action_items ADD COLUMN origin_id INTEGER`); } catch(e) {}
// SP1b-lignée — carry-forward chain root (a carried copy stores the root's uid);
// NULL = native row (its own root). Immutable once set. No backfill needed.
try { db.exec(`ALTER TABLE action_items ADD COLUMN lineage   TEXT`); } catch(e) {}
// Backfill uids for rows that predate the column — REQUIRED before the upsert
// runs: a NULL uid never matches `uid NOT IN (…)`, so an unbackfilled row would
// escape the delete step and duplicate on the first save.
function _backfillActionUids(database) {
  const rows = database.prepare(`SELECT id FROM action_items WHERE uid IS NULL`).all();
  if (!rows.length) return 0;
  const upd = database.prepare(`UPDATE action_items SET uid=? WHERE id=?`);
  database.transaction(() => { for (const r of rows) upd.run(crypto.randomUUID(), r.id); })();
  return rows.length;
}
try { _backfillActionUids(db); } catch(e) {}
// 2026-07-09 — survey_answers duplicate purge + UNIQUE key. The writer used
// "ON CONFLICT DO NOTHING" but the table had NO unique constraint, so every
// survey sync re-INSERTed every answer row (prod audit: 70% of 16,991 rows
// were duplicates; worst respondent row repeated 88x). This inflated any
// per-comment analysis — e.g. the exec-deck TOP PAIN POINTS showed
// "14 mentions" for what was really 2 respondents. (response_id, question_id)
// is a verified natural key: zero legitimate multi-content pairs in prod.
// Dedup keeps the OLDEST row (MIN id); the unique index then makes the
// existing ON CONFLICT DO NOTHING writer actually idempotent.
try {
  const _saDup = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='index' AND name='uq_sa_response_question'`).get();
  if (_saDup.c === 0) {
    const del = db.prepare(`DELETE FROM survey_answers WHERE id NOT IN (
      SELECT MIN(id) FROM survey_answers GROUP BY response_id, question_id)`).run();
    db.exec(`CREATE UNIQUE INDEX uq_sa_response_question ON survey_answers(response_id, question_id)`);
    if (del.changes > 0) console.log(`[Reports-DB] survey_answers: purged ${del.changes} duplicate rows + added UNIQUE(response_id, question_id)`);
  }
} catch (e) { console.error('[Reports-DB] survey_answers dedup migration failed:', e.message); }
// v1.11.5 — request_records: add udf_json for major-incident UDFs
// (Root Cause Analysis, Corrective Action, Lessons Learned, Preventive Measures,
//  Workaround Details, PIR Required). The base REQUEST_TABLE Zoho view does NOT
// return UDF columns, so this column is populated only via the secondary
// MAJOR_INCIDENTS view (790842) backfill in zoho-sync.js syncRequestData.
try { db.exec(`ALTER TABLE request_records ADD COLUMN udf_json TEXT`); } catch(e) {}

// v1.10.0 — audit trail + super_admin role
db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER,                     -- weekly_reports.id (NULL for non-report actions)
  site_id    INTEGER,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,              -- created|edited_infra|edited_helpdesk|edited_lights|edited_actions|submitted|reverted|deleted|edited_monthly|edited_objectives
  details    TEXT,                        -- JSON optional extra context
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_al_report ON audit_log(report_id);
CREATE INDEX IF NOT EXISTS idx_al_site   ON audit_log(site_id);
CREATE INDEX IF NOT EXISTS idx_al_time   ON audit_log(created_at);
`);
// v1.10.0 — weekly_reports: add created_by column for creator tracking
try { db.exec(`ALTER TABLE weekly_reports ADD COLUMN created_by INTEGER`); } catch(e) {}

// v1.11.6 — multi-role support (orthogonal feature roles + hierarchical roles)
// ───────────────────────────────────────────────────────────────────────────
// Each user now has a set of roles instead of a single role string. The
// existing 5 hierarchical roles (super_admin > executive > admin > editor >
// viewer) live in this table just like the new feature roles do — they're
// just stored as discrete rows with hierarchy resolved by userHasRole() at
// check time. Backward compat: users.role column is kept as the user's
// HIGHEST tier role for legacy display/queries that haven't been refactored.
//
// Feature roles (orthogonal to the hierarchy):
//   tracker-admin   — edit Activity Tracker config (activities, weights, targets)
//   tracker-editor  — enter own-site monthly tracker actuals
//   report-author   — run AI Analyze + Export PPTX + Executive New Report
//   audit-viewer    — read audit-log + sync status (no sync trigger)
//   scorecard-viewer — READ-ONLY access to executive.html + analytics.html
//                      (pages otherwise gated executive/admin). Does NOT
//                      grant AI Analyze or PPTX export (report-author gates
//                      those server-side). Added 2026-06-12.
db.exec(`
CREATE TABLE IF NOT EXISTS user_roles (
  user_id  INTEGER NOT NULL,
  role     TEXT NOT NULL,
  granted_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ur_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_ur_role ON user_roles(role);
`);

// One-shot migration: backfill user_roles from users.role for any user that
// doesn't have a row yet. Also auto-promote admin/executive/super_admin
// users to all 4 new feature roles so existing privileged accounts keep
// working without manual re-grants.
try {
  const usersWithoutRoles = db.prepare(`
    SELECT u.id, u.role FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.user_id IS NULL
  `).all();
  if (usersWithoutRoles.length > 0) {
    const FEATURE_ROLES = ['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer'];
    const ADMIN_OR_HIGHER = new Set(['admin', 'executive', 'super_admin']);
    const insertRole = db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)`);
    const tx = db.transaction((rows) => {
      for (const r of rows) {
        // Always insert their existing hierarchy role
        insertRole.run(r.id, r.role || 'viewer');
        // Auto-promote admin+ users to all 4 feature roles (zero-disruption migration)
        if (ADMIN_OR_HIGHER.has(r.role)) {
          for (const fr of FEATURE_ROLES) insertRole.run(r.id, fr);
        }
      }
    });
    tx(usersWithoutRoles);
    console.log(`[Reports-DB] Migrated ${usersWithoutRoles.length} user(s) to multi-role schema`);
  }
} catch (e) {
  console.warn('[Reports-DB] user_roles migration warning:', e.message);
}

// v1.9.0 — monthly report system
// New tables: monthly_reports, annual_objectives
db.exec(`
CREATE TABLE IF NOT EXISTS monthly_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        INTEGER NOT NULL,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  edited_lights  TEXT,   -- JSON: [{type,content,week_label}] — user-edited merge
  edited_actions TEXT,   -- JSON: [{task,priority,due_date,owner,status,week_label}]
  notes          TEXT,   -- free-form monthly notes
  status         TEXT DEFAULT 'draft',  -- draft | finalized
  updated_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(site_id, year, month),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE IF NOT EXISTS annual_objectives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER NOT NULL,
  year       INTEGER NOT NULL,
  objective  TEXT NOT NULL,
  target     TEXT,
  status     TEXT DEFAULT 'in_progress',  -- in_progress | achieved | deferred
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);
CREATE INDEX IF NOT EXISTS idx_ao_site_year ON annual_objectives(site_id, year);
`);

// ── SEED DEFAULT SITES ────────────────────────────────────────────
// zoho_group: single group name, OR comma-separated list for multi-group sites
// (e.g. Exploration aggregates all 3 Exploration sub-groups)
const DEFAULT_SITES = [
  { name: 'Sabodala',    zoho_group: 'Sabodala IT Agents',                                                              sort_order: 0,  active: 1 },
  { name: 'MANA',        zoho_group: 'Mana IT Agent',                                                                   sort_order: 1,  active: 1 },
  { name: 'Hounde',      zoho_group: 'Hounde IT Agents',                                                                sort_order: 2,  active: 1 },
  { name: 'Ity',         zoho_group: 'ITY IT Agents',                                                                   sort_order: 3,  active: 1 },
  { name: 'Lafigue',     zoho_group: 'Lafigue IT Agents',                                                               sort_order: 4,  active: 1 },
  { name: 'Ouagadougou', zoho_group: 'Ouaga IT Agents',                                                                 sort_order: 5,  active: 1 },
  { name: 'Abidjan',     zoho_group: 'Abidjan IT Agents',                                                               sort_order: 6,  active: 1 },
  { name: 'Dakar',       zoho_group: 'Dakar IT Agents',                                                                 sort_order: 7,  active: 1 },
  { name: 'Exploration', zoho_group: 'Exploration BF Support,Exploration CI Support,Exploration IT Support',            sort_order: 8,  active: 1 },
  { name: 'Kalana',      zoho_group: 'Kalana IT Agents',                                                                sort_order: 9,  active: 1 },
  { name: 'Tanda',       zoho_group: 'Tanda IT Agents',                                                                 sort_order: 10, active: 1 }, // v1.10.9: new mining site
  { name: 'Wahgnion',    zoho_group: 'Wahgnion IT Agents',                                                              sort_order: 11, active: 0 }, // deactivated — no longer used
];
const insertSite = db.prepare(`INSERT OR IGNORE INTO sites (name, zoho_group, sort_order, active) VALUES (?, ?, ?, ?)`);
const _backfillSiteGroup  = db.prepare(`UPDATE sites SET zoho_group=? WHERE name=? AND (zoho_group IS NULL OR zoho_group='')`);
const _deactivateSite     = db.prepare(`UPDATE sites SET active=0 WHERE name=? AND active=1`);
const _forceUpdateGroup   = db.prepare(`UPDATE sites SET zoho_group=? WHERE name=?`);
DEFAULT_SITES.forEach(s => {
  insertSite.run(s.name, s.zoho_group, s.sort_order, s.active);
  _backfillSiteGroup.run(s.zoho_group, s.name);
  if (s.active === 0) _deactivateSite.run(s.name);
  // Force-update Exploration group to include all 3 sub-groups (in case it was seeded with just one)
  if (s.name === 'Exploration') _forceUpdateGroup.run(s.zoho_group, s.name);
});

// ── SEED DEFAULT ACTION DEPARTMENTS ──────────────────────────────
const deptCount = db.prepare(`SELECT COUNT(*) AS n FROM action_departments`).get().n;
if (deptCount === 0) {
  const seedDept = db.prepare(`INSERT INTO action_departments (name, sort_order) VALUES (?, ?)`);
  const defaults = [
    'Mining', 'Technical Service', 'Processing', 'Maintenance',
    'Supply Chain', 'Security', 'Finance', 'Human Resource',
    'Social performance', 'General Manager'
  ];
  defaults.forEach((name, i) => seedDept.run(name, i + 1));
  console.log(`[seed] Inserted ${defaults.length} default action_departments`);
}

// ══════════════════════════════════════════════════════════════════
//  PALIER 1 — Canonical catalogues (additive, opt-in, non-breaking)
//  Added 2026-06-05. These tables are READ-ONLY catalogues that the
//  existing code does NOT yet depend on. They expose, in queryable
//  form, structures previously trapped in JS hashmaps (SITE_MAP) or
//  free-text strings (infra KPIs). Future features can JOIN against
//  them; legacy code remains untouched.
// ══════════════════════════════════════════════════════════════════

// ── 1.A site_module_codes ─────────────────────────────────────────
// Maps each canonical site (sites.id) to its module-specific code.
// Replaces the 4 duplicate SITE_MAP hashmaps in tracker-db.js,
// inspection-db.js, meetings-db.js (via inspection), risk-register-export.js.
// Source of truth assembled from those 4 files + DATA_ARCHITECTURE.md §1.
db.exec(`
CREATE TABLE IF NOT EXISTS site_module_codes (
  site_id    INTEGER NOT NULL,
  module     TEXT    NOT NULL,            -- 'tracker' | 'inspection' | 'meetings' | 'risk_register'
  code       TEXT    NOT NULL,            -- e.g. 'MGO', 'HGO', 'KLN', 'OUAGA OFF1'
  updated_at TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, module),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smc_module ON site_module_codes(module);
CREATE INDEX IF NOT EXISTS idx_smc_code   ON site_module_codes(code);
`);

// Backfill — canonical site name → { module → code }.
// 'meetings' reuses inspection codes (per meetings-db.js _userMeetingsSite).
// Wahgnion (inactive) is intentionally omitted from per-module codes.
const _SITE_MODULE_CODES_SEED = {
  'Sabodala':    { tracker: 'SGO', inspection: 'SGO', meetings: 'SGO', risk_register: 'SGO' },
  'MANA':        { tracker: 'MGO', inspection: 'MGO', meetings: 'MGO', risk_register: 'MGO' },
  'Hounde':      { tracker: 'HGO', inspection: 'HGO', meetings: 'HGO', risk_register: 'HGO' },
  'Ity':         { tracker: 'ITY', inspection: 'SMI', meetings: 'SMI', risk_register: 'IGO' },
  'Lafigue':     { tracker: 'SML', inspection: 'SML', meetings: 'SML', risk_register: 'SML' },
  'Ouagadougou': { tracker: 'EDV', inspection: 'OUA', meetings: 'OUA', risk_register: 'OUAGA OFF1' },
  'Abidjan':     { tracker: 'ABJ', inspection: 'ABJ', meetings: 'ABJ' },
  'Dakar':       { tracker: 'DKR', inspection: 'DKR', meetings: 'DKR' },
  'Exploration': { tracker: 'EXP', risk_register: 'EXPLO' },
  'Kalana':      { tracker: 'KLN', inspection: 'KGO', meetings: 'KGO', risk_register: 'KGO' },
  'Tanda':       { tracker: 'TND' },
};
// V1a — OPManager probe names per site (the `Probe Name` column in the OPManager
// data = the code stored under module='opmanager'). Site resolved by NAME below, so
// Tanda/Abidjan (no meetings code) map cleanly. Augments the seed map in one place.
const _OPM_PROBE_CODES = {
  Sabodala: 'Sabodala', MANA: 'Mana', Hounde: 'HOUNDE', Ity: 'Ity',
  Lafigue: 'LAFIGUE', Ouagadougou: 'Ouagadougou', Abidjan: 'ABJ', Tanda: 'Tanda',
};
for (const [siteName, probe] of Object.entries(_OPM_PROBE_CODES)) {
  if (_SITE_MODULE_CODES_SEED[siteName]) _SITE_MODULE_CODES_SEED[siteName].opmanager = probe;
}
// Meraki network name per site (V1b — WAN). Resolved by site NAME. Ity/Mana confirmed
// from the dashboard; the rest follow the "<Site> Gold Operations" / office pattern and
// are corrected at calibration (Task 7). No CHECK on `code`, so names with spaces store fine.
// Real Meraki network names confirmed from the org's network selector (2026-08-16).
// Sabodala is stored as the base name; the sync's suffix-tolerant match handles the
// live "Sabodala Gold Operations - appliance" product-split network.
const _MERAKI_NETWORK_CODES = {
  Ity: 'Ity Gold Operations', MANA: 'Mana Gold Operations',
  Hounde: 'Hounde Gold Operations', Sabodala: 'Sabodala Gold Operations',
  Lafigue: 'Société des Mines de Lafigué', Ouagadougou: 'Ouaga Office',
  Abidjan: 'Abidjan Office', Tanda: 'Assafou Dibingano Temp Office',
  Dakar: 'Dakar Office', Kalana: 'Kalana Mine',
};
// One-time correction of the 3 V1b-A guessed names that changed once the real
// Meraki networks were known. Matched by the OLD string EXACTLY, so it never
// touches a value an admin set via the Site↔Meraki editor.
const _MERAKI_RENAMES = [
  ['Lafigue Gold Operations', 'Société des Mines de Lafigué'],
  ['Ouagadougou Office', 'Ouaga Office'],
  ['Tanda', 'Assafou Dibingano Temp Office'],
];
for (const [siteName, net] of Object.entries(_MERAKI_NETWORK_CODES)) {
  if (_SITE_MODULE_CODES_SEED[siteName]) _SITE_MODULE_CODES_SEED[siteName].meraki = net;
}
{
  const upsertCode = db.prepare(
    `INSERT OR IGNORE INTO site_module_codes (site_id, module, code) VALUES (?, ?, ?)`
  );
  const findSite = db.prepare(`SELECT id FROM sites WHERE name = ? COLLATE NOCASE`);
  let inserted = 0;
  for (const [siteName, modCodes] of Object.entries(_SITE_MODULE_CODES_SEED)) {
    const row = findSite.get(siteName);
    if (!row) continue;
    for (const [mod, code] of Object.entries(modCodes)) {
      const r = upsertCode.run(row.id, mod, code);
      if (r.changes > 0) inserted++;
    }
  }
  if (inserted > 0) console.log(`[seed] site_module_codes — inserted ${inserted} (site,module,code) mappings`);
  // Correct the 3 stale V1b-A guesses by exact old-string match (INSERT OR IGNORE
  // won't update). Scoped to module='meraki'; never touches an admin-edited value.
  const renameMeraki = db.prepare(`UPDATE site_module_codes SET code = ? WHERE module = 'meraki' AND code = ?`);
  for (const [oldN, newN] of _MERAKI_RENAMES) renameMeraki.run(newN, oldN);
}

// ── 1.B infra_kpi_catalog ─────────────────────────────────────────
// Reference catalogue of canonical (service, kpi) pairs. Today the
// infra_kpis table stores free-text values per report; renames silently
// break trend charts. This catalogue captures the universe of values
// in use today + lets a future admin UI manage them centrally.
db.exec(`
CREATE TABLE IF NOT EXISTS infra_kpi_catalog (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  service       TEXT    NOT NULL,         -- 'Network' | 'Email' | 'WAN1 Fetekro Explo' | ...
  kpi           TEXT    NOT NULL,         -- 'Availability' | 'Latency' | ...
  target_default TEXT,                    -- the most recently used target for this pair
  display_order INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(service, kpi)
);
CREATE INDEX IF NOT EXISTS idx_infra_kpi_cat_service ON infra_kpi_catalog(service);
`);
// Backfill from any existing infra_kpis rows. Idempotent — re-runs on
// every boot just pick up newly-seen (service, kpi) combinations.
try {
  const r = db.prepare(
    `INSERT OR IGNORE INTO infra_kpi_catalog (service, kpi, target_default)
     SELECT service, kpi, MAX(target) FROM infra_kpis
     WHERE service IS NOT NULL AND service != ''
       AND kpi     IS NOT NULL AND kpi     != ''
     GROUP BY service, kpi`
  ).run();
  if (r.changes > 0) console.log(`[seed] infra_kpi_catalog — backfilled ${r.changes} new (service, kpi) pairs from history`);
} catch (e) { /* infra_kpis may be empty on a fresh DB — no problem */ }

// ── 1.C exec_view_editorial ───────────────────────────────────────
// Exec View editorial (SharePoint executive page) — per-month highlights/focus.
// PG fork: db/postgres/reports/002_config.sql + _getExecEditorialPg/_setExecEditorialPg.
db.exec(`
CREATE TABLE IF NOT EXISTS exec_view_editorial (
  period          TEXT PRIMARY KEY,       -- 'YYYY-MM'
  highlights_json TEXT,
  focus_json      TEXT,
  updated_at      TEXT,
  updated_by      TEXT
);
`);

// Shared row→{highlights, focus} mapping (both forks).
function _mapExecEditorial(row) {
  if (!row) return { highlights: [], focus: [] };
  const parse = (s, d) => { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v : d; } catch { return d; } };
  return { highlights: parse(row.highlights_json, []), focus: parse(row.focus_json, []) };
}
// Shared input normalisation (both forks): caps (max 4 highlights, max 3 focus)
// + drops blank entries so the Executive View footprint stays predictable.
function _normExecEditorial({ highlights, focus }) {
  const H = Array.isArray(highlights) ? highlights.filter(x => String(x || '').trim()).slice(0, 4) : [];
  const F = Array.isArray(focus) ? focus.filter(x => x && String(x.title || '').trim()).slice(0, 3) : [];
  return { H, F };
}

/**
 * getExecEditorial(period) — reads the Executive View editorial blocks
 * (Monthly highlights + Current focus areas) for a given 'YYYY-MM' period.
 * Returns { highlights: [], focus: [] } when the period has never been set.
 */
function getExecEditorial(period) {
  if (REPORTS_BACKEND === 'postgres') return _getExecEditorialPg(period);
  try {
    const row = db.prepare('SELECT highlights_json, focus_json FROM exec_view_editorial WHERE period=?').get(period);
    return _mapExecEditorial(row);
  } catch { return { highlights: [], focus: [] }; }
}
async function _getExecEditorialPg(period) {
  try {
    const row = await pgHandle().prepare('SELECT highlights_json, focus_json FROM exec_view_editorial WHERE period=?').get(period);
    return _mapExecEditorial(row);
  } catch { return { highlights: [], focus: [] }; }
}

/**
 * setExecEditorial(period, {highlights, focus}, user) — upserts the
 * editorial blocks for a period. Enforces caps (max 4 highlights, max 3
 * focus areas) and drops blank entries so the Executive View footprint
 * stays predictable regardless of what an admin pastes in.
 */
function setExecEditorial(period, { highlights, focus }, user) {
  if (REPORTS_BACKEND === 'postgres') return _setExecEditorialPg(period, { highlights, focus }, user);
  const { H, F } = _normExecEditorial({ highlights, focus });
  db.prepare(`
    INSERT INTO exec_view_editorial (period, highlights_json, focus_json, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(period) DO UPDATE SET
      highlights_json = excluded.highlights_json,
      focus_json      = excluded.focus_json,
      updated_at      = excluded.updated_at,
      updated_by      = excluded.updated_by
  `).run(period, JSON.stringify(H), JSON.stringify(F), user || 'unknown');
  return { highlights: H, focus: F };
}
// PG fork — datetime('now') → now(); ON CONFLICT … DO UPDATE SET x=excluded.x is pg-valid as-is.
async function _setExecEditorialPg(period, { highlights, focus }, user) {
  const { H, F } = _normExecEditorial({ highlights, focus });
  await pgHandle().prepare(`
    INSERT INTO exec_view_editorial (period, highlights_json, focus_json, updated_at, updated_by)
    VALUES (?, ?, ?, now(), ?)
    ON CONFLICT(period) DO UPDATE SET
      highlights_json = excluded.highlights_json,
      focus_json      = excluded.focus_json,
      updated_at      = excluded.updated_at,
      updated_by      = excluded.updated_by
  `).run(period, JSON.stringify(H), JSON.stringify(F), user || 'unknown');
  return { highlights: H, focus: F };
}

// ── 1.C-bis exec_report_editorial ─────────────────────────────────
// The Group IT deck builder's monthly analysis — the Operations Summary and the
// Analyze/commentary fields, which used to live ONLY in the author's browser
// localStorage. ONE table, TWO grains discriminated by `scope`:
//   'ops'                      → the Operations Summary (keyed by month alone)
//   'commentary:<site>:<grp>'  → the commentary fields (month + site filter + group
//                                preset — the browser keyed them that way, and
//                                collapsing the grains would let one filter's text
//                                overwrite another's).
// PG fork: db/postgres/reports/002_config.sql + _getExecReportEditorialPg/_setExecReportEditorialPg.
db.exec(`
CREATE TABLE IF NOT EXISTS exec_report_editorial (
  period       TEXT NOT NULL,          -- 'YYYY-MM'
  scope        TEXT NOT NULL,          -- 'ops' | 'commentary:<site>:<grp>'
  payload_json TEXT,
  updated_at   TIMESTAMP,
  updated_by   TEXT,
  PRIMARY KEY (period, scope)
);
`);

// Shared row→payload mapping (both forks). An absent row AND an unparseable
// payload both read back as null — the caller can't tell "never saved" from
// "corrupt", and neither should ever throw on a read path.
function _mapExecReportEditorial(row) {
  if (!row) return null;
  try {
    const v = JSON.parse(row.payload_json || '');
    return (v && typeof v === 'object') ? v : null;
  } catch { return null; }
}

/**
 * getExecReportEditorial(period, scope) — reads one deck-builder analysis blob.
 * Returns the stored object, or null when the (period, scope) pair has never
 * been set (or the stored JSON is unreadable).
 */
function getExecReportEditorial(period, scope) {
  if (REPORTS_BACKEND === 'postgres') return _getExecReportEditorialPg(period, scope);
  try {
    const row = db.prepare('SELECT payload_json FROM exec_report_editorial WHERE period=? AND scope=?')
      .get(period, scope);
    return _mapExecReportEditorial(row);
  } catch { return null; }
}
async function _getExecReportEditorialPg(period, scope) {
  try {
    const row = await pgHandle().prepare('SELECT payload_json FROM exec_report_editorial WHERE period=? AND scope=?')
      .get(period, scope);
    return _mapExecReportEditorial(row);
  } catch { return null; }
}

/**
 * setExecReportEditorial(period, scope, payload, user) — upserts one analysis
 * blob. The payload is stored verbatim as JSON (no caps, no field filtering —
 * unlike the Exec View editorial, this IS the author's own prose and the shape
 * belongs to the deck builder, not to us). Returns the payload.
 */
function setExecReportEditorial(period, scope, payload, user) {
  if (REPORTS_BACKEND === 'postgres') return _setExecReportEditorialPg(period, scope, payload, user);
  db.prepare(`
    INSERT INTO exec_report_editorial (period, scope, payload_json, updated_at, updated_by)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(period, scope) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at   = excluded.updated_at,
      updated_by   = excluded.updated_by
  `).run(period, scope, JSON.stringify(payload ?? null), user || 'unknown');
  return payload;
}
// PG fork — datetime('now') → now(); ON CONFLICT … DO UPDATE SET x=excluded.x is pg-valid as-is.
async function _setExecReportEditorialPg(period, scope, payload, user) {
  await pgHandle().prepare(`
    INSERT INTO exec_report_editorial (period, scope, payload_json, updated_at, updated_by)
    VALUES (?, ?, ?, now(), ?)
    ON CONFLICT(period, scope) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at   = excluded.updated_at,
      updated_by   = excluded.updated_by
  `).run(period, scope, JSON.stringify(payload ?? null), user || 'unknown');
  return payload;
}

// ── 1.D exec_mi_summary ───────────────────────────────────────────
// AI-generated concise summaries of a Major Incident's root cause +
// corrective action, for the PUBLIC Exec View card. Cached per incident and
// keyed by src_hash (a hash of the source RCA/CA/impact/subject) so the
// summary is regenerated ONLY when the underlying text changes — the public
// endpoint never calls the model on the request path, it just reads this cache.
// PG fork: db/postgres/reports/002_config.sql + _getExecMiSummariesPg/_setExecMiSummaryPg.
db.exec(`
CREATE TABLE IF NOT EXISTS exec_mi_summary (
  request_id      TEXT PRIMARY KEY,
  src_hash        TEXT NOT NULL,
  root_cause_summary  TEXT,
  action_summary      TEXT,
  model           TEXT,
  updated_at      TEXT
);
`);

/**
 * getExecMiSummaries(ids) — batch-read cached MI summaries.
 * Returns a map { request_id: {src_hash, root_cause_summary, action_summary, model} }.
 * Missing ids are simply absent from the map.
 */
function getExecMiSummaries(ids) {
  if (REPORTS_BACKEND === 'postgres') return _getExecMiSummariesPg(ids);
  const out = {};
  const list = (ids || []).filter(Boolean).map(String);
  if (!list.length) return out;
  try {
    const ph = list.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT request_id, src_hash, root_cause_summary, action_summary, model
         FROM exec_mi_summary WHERE request_id IN (${ph})`
    ).all(...list);
    for (const r of rows) out[r.request_id] = r;
  } catch (e) { console.warn('[exec-mi-summary] read failed:', e.message); }
  return out;
}
// PG fork — sqlite's dynamic IN (?,?,…) becomes `= ANY(?)` with ONE array param:
// pgDb passes positional args straight to node-postgres, which serialises a JS
// array to a PG array literal, so no per-id placeholder building is needed.
async function _getExecMiSummariesPg(ids) {
  const out = {};
  const list = (ids || []).filter(Boolean).map(String);
  if (!list.length) return out;
  try {
    const rows = await pgHandle().prepare(
      `SELECT request_id, src_hash, root_cause_summary, action_summary, model
         FROM exec_mi_summary WHERE request_id = ANY(?)`
    ).all(list);
    for (const r of rows) out[r.request_id] = r;
  } catch (e) { console.warn('[exec-mi-summary] read failed:', e.message); }
  return out;
}

/**
 * setExecMiSummary(request_id, {src_hash, root_cause_summary, action_summary, model})
 * — upsert one incident's cached summary.
 */
function setExecMiSummary(request_id, s) {
  if (REPORTS_BACKEND === 'postgres') return _setExecMiSummaryPg(request_id, s);
  if (!request_id || !s || !s.src_hash) return;
  try {
    db.prepare(`
      INSERT INTO exec_mi_summary (request_id, src_hash, root_cause_summary, action_summary, model, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(request_id) DO UPDATE SET
        src_hash           = excluded.src_hash,
        root_cause_summary = excluded.root_cause_summary,
        action_summary     = excluded.action_summary,
        model              = excluded.model,
        updated_at         = excluded.updated_at
    `).run(String(request_id), String(s.src_hash),
           s.root_cause_summary || null, s.action_summary || null, s.model || null);
  } catch (e) { console.warn('[exec-mi-summary] write failed:', e.message); }
}
// PG fork — datetime('now') → now(); upsert syntax is pg-valid as-is.
async function _setExecMiSummaryPg(request_id, s) {
  if (!request_id || !s || !s.src_hash) return;
  try {
    await pgHandle().prepare(`
      INSERT INTO exec_mi_summary (request_id, src_hash, root_cause_summary, action_summary, model, updated_at)
      VALUES (?, ?, ?, ?, ?, now())
      ON CONFLICT(request_id) DO UPDATE SET
        src_hash           = excluded.src_hash,
        root_cause_summary = excluded.root_cause_summary,
        action_summary     = excluded.action_summary,
        model              = excluded.model,
        updated_at         = excluded.updated_at
    `).run(String(request_id), String(s.src_hash),
           s.root_cause_summary || null, s.action_summary || null, s.model || null);
  } catch (e) { console.warn('[exec-mi-summary] write failed:', e.message); }
}

// ── SEED DEFAULT ADMIN ────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function makeSession() {
  return crypto.randomBytes(32).toString('hex');
}

const adminExists = db.prepare(`SELECT id FROM users WHERE role='admin' LIMIT 1`).get();
if (!adminExists) {
  // Refuse to seed a default admin with hardcoded credentials. Operators must
  // set both DASH_USER and DASH_PASS in the .env file BEFORE first boot.
  // (Removed inline fallbacks 2026-06-05 — credentials never appear in source;
  // see the .env template file for the expected variable names.)
  if (!process.env.DASH_USER || !process.env.DASH_PASS) {
    throw new Error(
      '[Reports-DB] FATAL: cannot create default admin — DASH_USER and DASH_PASS ' +
      'must be set in .env before first boot. See DOTENV.example for the template.'
    );
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(process.env.DASH_PASS, salt);
  db.prepare(`INSERT OR IGNORE INTO users (username, full_name, password_hash, salt, site_id, role)
              VALUES (?, ?, ?, ?, NULL, 'admin')`)
    .run(process.env.DASH_USER, 'Administrator', hash, salt);
  console.log('[Reports-DB] Default admin created:', process.env.DASH_USER);
}

// ── WEEK HELPERS (Zoho Sunday-start, mirrors AP Analytics Plus convention) ────
// W01 = first Sunday of the year; weeks run Sun–Sat, same as AP.
function _zFirstSun(yr) {
  const d = new Date(Date.UTC(yr, 0, 1));
  const dow = d.getUTCDay(); // 0=Sun
  if (dow !== 0) d.setUTCDate(d.getUTCDate() + (7 - dow));
  return d;
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCHours(0, 0, 0, 0);
  let yr = d.getUTCFullYear();
  let fs = _zFirstSun(yr);
  if (d < fs) { yr--; fs = _zFirstSun(yr); }
  return {
    week: Math.floor((d - fs) / (7 * 86400000)) + 1,
    year: yr
  };
}

function getWeekRange(year, week) {
  const fs = _zFirstSun(year);
  const weekStart = new Date(fs);
  weekStart.setUTCDate(fs.getUTCDate() + (week - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return {
    start: weekStart.toISOString().slice(0, 10),
    end:   weekEnd.toISOString().slice(0, 10),
    label: `W${String(week).padStart(2,'0')} ${year}`
  };
}

function ensureWeek(year, week) {
  if (REPORTS_BACKEND === 'postgres') return _ensureWeekPg(year, week);
  const existing = db.prepare(`SELECT id FROM weeks WHERE year=? AND week_number=?`).get(year, week);
  if (existing) return existing.id;
  const range = getWeekRange(year, week);
  const r = db.prepare(`INSERT INTO weeks (year, week_number, start_date, end_date, label) VALUES (?,?,?,?,?)`)
              .run(year, week, range.start, range.end, range.label);
  return r.lastInsertRowid;
}

// Report period = PREVIOUS week (what's being filled during the current week)
function getPreviousWeek() {
  const now  = new Date();
  const prev = new Date(now);
  prev.setDate(prev.getDate() - 7);
  return getISOWeek(prev);
}

// ── AUTH HELPERS ──────────────────────────────────────────────────
// ── ROLE / RBAC HELPERS ──────────────────────────────────────────
// Hierarchical roles imply each other (super_admin grants all the lower
// tiers automatically). Feature roles are orthogonal — only granted if
// explicitly assigned. userHasRole() resolves both rules in one check.
//
// Hierarchy chain — index N implies index N..end (so super_admin implies
// everything, viewer implies only viewer).
const ROLE_HIERARCHY = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const FEATURE_ROLES_KNOWN = ['tracker-admin', 'tracker-editor', 'report-author', 'audit-viewer', 'scorecard-viewer'];

/**
 * Returns the array of role strings explicitly assigned to a user.
 * Includes both hierarchical and feature roles. Order is alphabetical for
 * stable display.
 */
function getUserRoles(userId) {
  if (REPORTS_BACKEND === 'postgres') return _getUserRolesPg(userId);
  if (!userId) return [];
  return db.prepare(`SELECT role FROM user_roles WHERE user_id=? ORDER BY role`)
           .all(userId)
           .map(r => r.role);
}
async function _getUserRolesPg(userId) {
  if (!userId) return [];
  return (await pgHandle().prepare(`SELECT role FROM user_roles WHERE user_id=? ORDER BY role`).all(userId)).map(r => r.role);
}

/**
 * Replace a user's role set. Pass an array of role strings. Roles not in
 * ROLE_HIERARCHY or FEATURE_ROLES_KNOWN are silently dropped (defensive
 * against malformed UI input).
 */
function setUserRoles(userId, roles) {
  if (REPORTS_BACKEND === 'postgres') return _setUserRolesPg(userId, roles);
  if (!userId) return;
  const allowed = new Set([...ROLE_HIERARCHY, ...FEATURE_ROLES_KNOWN]);
  const clean = (Array.isArray(roles) ? roles : []).filter(r => allowed.has(r));
  // Always ensure user has at least 'viewer' so downstream "must have ANY role"
  // checks don't lock them out by accident.
  if (clean.length === 0) clean.push('viewer');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM user_roles WHERE user_id=?`).run(userId);
    const ins = db.prepare(`INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)`);
    for (const r of clean) ins.run(userId, r);
    // Update users.role to the highest hierarchical tier present (legacy column).
    const highest = ROLE_HIERARCHY.find(h => clean.includes(h)) || 'viewer';
    db.prepare(`UPDATE users SET role=? WHERE id=?`).run(highest, userId);
  });
  tx();
}

/**
 * Does this user have the requested role? Resolves the hierarchy chain:
 *   super_admin ⇒ executive ⇒ admin ⇒ editor ⇒ viewer
 * Plus exact-match for feature roles (tracker-admin etc.). Accepts either
 * a user object (with .id or .roles) or a userId number.
 */
function userHasRole(userOrId, requiredRole) {
  if (!userOrId || !requiredRole) return false;
  // Resolve roles array: prefer pre-loaded `.roles` on session user objects
  // so we don't hit the DB on every middleware call.
  let roles = null;
  if (typeof userOrId === 'object' && Array.isArray(userOrId.roles)) {
    roles = userOrId.roles;
  } else {
    const id = (typeof userOrId === 'object') ? userOrId.id : userOrId;
    roles = getUserRoles(id);
  }
  if (roles.length === 0) return false;
  // Exact match (covers feature roles + same-tier hierarchy)
  if (roles.includes(requiredRole)) return true;
  // Hierarchy implication: any role above `requiredRole` in the chain grants it
  const reqIdx = ROLE_HIERARCHY.indexOf(requiredRole);
  if (reqIdx >= 0) {
    for (const r of roles) {
      const have = ROLE_HIERARCHY.indexOf(r);
      if (have >= 0 && have <= reqIdx) return true;   // user has same-or-higher tier
    }
  }
  return false;
}

// ── PostgreSQL backend selector (Sub-chunk A: auth/sessions) ─────────────────
// `sqlite` (default) keeps the better-sqlite3 path, byte-for-byte. `postgres`
// routes the auth/session/user functions through the async services/pgDb adapter.
// The module-level sqlite `db` stays the default handle untouched; the pg path uses
// pgHandle(). `listSites`/`createSite`/`updateSite` + `userHasRole` are NOT forked in
// A (spec §4/§5.4). Prod stays sqlite (all-or-nothing flip later).
const REPORTS_BACKEND = (process.env.REPORTS_BACKEND || 'sqlite').toLowerCase();
let _pg = null;
async function initPgReports() {            // called once at server boot
  const { makePgDb } = require('./services/pgDb');
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('REPORTS_BACKEND=postgres but PG_URL/DATABASE_URL is not set');
  _pg = makePgDb(url);
  await _pg.connect();
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '001_auth.sql'), 'utf8'));
  // Chunk 4B — config tables (action_departments / audit_log / dashboard_preset_groups).
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '002_config.sql'), 'utf8'));
  await _seedConfigPg(_pg);
  // Chunk 4C — report-editor tables (weeks / weekly_reports / kpis / lights / actions / monthly / objectives / catalogs).
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '003_reports.sql'), 'utf8'));
  // SP1b — action_items stable uid + merge columns (idempotent for existing PG DBs)
  // + backfill uids on rows that predate the column (see the sqlite note above).
  for (const c of ['uid TEXT', 'source TEXT', 'origin_id INTEGER', 'lineage TEXT']) {
    await _pg.exec(`ALTER TABLE action_items ADD COLUMN IF NOT EXISTS ${c}`);
  }
  { const nulls = await _pg.prepare('SELECT id FROM action_items WHERE uid IS NULL').all();
    for (const r of nulls) await _pg.prepare('UPDATE action_items SET uid=? WHERE id=?').run(crypto.randomUUID(), r.id); }
  await _seedReportsCatalogsPg(_pg);
  // Chunk 4D-1 — hot-path Zoho tables (request_records / change_records / cab_approvals / survey_* / sync_metadata).
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '004_hot.sql'), 'utf8'));
  await _seedSyncMetadataPg(_pg);
  // Chunk 4E — reporting suite tables.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '005_reporting.sql'), 'utf8'));
  // System Logs v1 — unified security/audit event log.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '006_system_log.sql'), 'utf8'));
  // V1a — OPManager infra availability snapshots.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '007_infra_snapshots.sql'), 'utf8'));
  // V1b — Meraki WAN link availability & quality snapshots.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '008_wan_link_snapshots.sql'), 'utf8'));
  // WAN SLA / ISP chargeback — one row per detected WAN outage.
  await _pg.exec(require('fs').readFileSync(
    require('path').join(__dirname, 'db', 'postgres', 'reports', '009_wan_outages.sql'), 'utf8'));
  // V1b-E — add sub_site to wan_link_snapshots + swap its PK to the 5-col key (guarded so
  // it runs once on DBs created before V1b-E; fresh installs get it from 008.sql directly).
  await _pg.exec(`ALTER TABLE wan_link_snapshots ADD COLUMN IF NOT EXISTS sub_site TEXT NOT NULL DEFAULT ''`);
  await _pg.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='wan_link_snapshots_pkey'
                   AND conrelid='wan_link_snapshots'::regclass
                   AND array_length(conkey,1)=5) THEN
      ALTER TABLE wan_link_snapshots DROP CONSTRAINT IF EXISTS wan_link_snapshots_pkey;
      ALTER TABLE wan_link_snapshots ADD PRIMARY KEY (site_id, sub_site, uplink, period_type, period_start);
    END IF;
  END $$;`);
  // V1b-E — editable sub-site → Meraki network map (Exploration).
  await _pg.exec(`CREATE TABLE IF NOT EXISTS wan_subsite_networks (
    site_id  INTEGER NOT NULL,
    sub_site TEXT NOT NULL,
    network  TEXT NOT NULL,
    PRIMARY KEY (site_id, sub_site)
  )`);
  // V1b-B — additive recent-vs-window label on infra_metric_snapshots (device availability).
  await _pg.exec(`ALTER TABLE infra_metric_snapshots ADD COLUMN IF NOT EXISTS basis TEXT`);
  return _pg;
}

// Seed the 4 default sync-job rows (mirrors the sqlite _seedJob gate; SYNC_JOBS below).
async function _seedSyncMetadataPg(H) {
  for (const j of ['helpdesk', 'change_cab', 'survey', 'requests']) {
    await H.prepare(`INSERT INTO sync_metadata (job_name) VALUES (?) ON CONFLICT (job_name) DO NOTHING`).run(j);
  }
}

// Catalog backfills (data-dependent; no-op on a fresh pg DB, like the sqlite boot path).
async function _seedReportsCatalogsPg(H) {
  // site_module_codes — resolve site_id by name; seeds nothing until matching sites exist in pg.
  const SEED = {  // verbatim from _SITE_MODULE_CODES_SEED below
    'Sabodala':    { tracker:'SGO', inspection:'SGO', meetings:'SGO', risk_register:'SGO' },
    'MANA':        { tracker:'MGO', inspection:'MGO', meetings:'MGO', risk_register:'MGO' },
    'Hounde':      { tracker:'HGO', inspection:'HGO', meetings:'HGO', risk_register:'HGO' },
    'Ity':         { tracker:'ITY', inspection:'SMI', meetings:'SMI', risk_register:'IGO' },
    'Lafigue':     { tracker:'SML', inspection:'SML', meetings:'SML', risk_register:'SML' },
    'Ouagadougou': { tracker:'EDV', inspection:'OUA', meetings:'OUA', risk_register:'OUAGA OFF1' },
    'Abidjan':     { tracker:'ABJ', inspection:'ABJ', meetings:'ABJ' },
    'Dakar':       { tracker:'DKR', inspection:'DKR', meetings:'DKR' },
    'Exploration': { tracker:'EXP', risk_register:'EXPLO' },
    'Kalana':      { tracker:'KLN', inspection:'KGO', meetings:'KGO', risk_register:'KGO' },
    'Tanda':       { tracker:'TND' },
  };
  // V1a — augment with OPManager probe codes (same table as the sqlite seed).
  for (const [siteName, probe] of Object.entries(_OPM_PROBE_CODES)) {
    if (SEED[siteName]) SEED[siteName].opmanager = probe;
  }
  for (const [siteName, net] of Object.entries(_MERAKI_NETWORK_CODES)) {
    if (SEED[siteName]) SEED[siteName].meraki = net;
  }
  await H.runTransaction(async () => {
    for (const [siteName, modCodes] of Object.entries(SEED)) {
      const row = await H.prepare('SELECT id FROM sites WHERE lower(name)=lower(?)').get(siteName);
      if (!row) continue;
      for (const [mod, code] of Object.entries(modCodes)) {
        await H.prepare(`INSERT INTO site_module_codes (site_id, module, code) VALUES (?, ?, ?)
          ON CONFLICT (site_id, module) DO NOTHING`).run(row.id, mod, code);
      }
    }
    // Correct the 3 stale V1b-A guesses by exact old-string match (see sqlite note);
    // scoped to module='meraki', never touches an admin-edited value.
    for (const [oldN, newN] of _MERAKI_RENAMES) {
      await H.prepare(`UPDATE site_module_codes SET code = ? WHERE module = 'meraki' AND code = ?`).run(newN, oldN);
    }
  });
  // infra_kpi_catalog — backfill from existing infra_kpis (empty on a fresh DB).
  await H.exec(`INSERT INTO infra_kpi_catalog (service, kpi, target_default)
    SELECT service, kpi, MAX(target) FROM infra_kpis
    WHERE service IS NOT NULL AND service != '' AND kpi IS NOT NULL AND kpi != ''
    GROUP BY service, kpi ON CONFLICT (service, kpi) DO NOTHING`);
}
function pgHandle() {
  if (!_pg) throw new Error('pgDb not initialised — await initPgReports() at boot');
  return _pg;
}

// Seed config tables on a fresh pg DB (idempotent — only fills empty tables,
// mirroring the sqlite seed-gates). sites is owned by the 4A copy/seed path.
async function _seedConfigPg(H) {
  // action_departments — verbatim from the sqlite seed (reports-db.js defaults).
  const dn = Number((await H.prepare('SELECT COUNT(*) AS n FROM action_departments').get()).n);
  if (dn === 0) {
    const DEFAULT_DEPTS = [
      'Mining', 'Technical Service', 'Processing', 'Maintenance',
      'Supply Chain', 'Security', 'Finance', 'Human Resource',
      'Social performance', 'General Manager',
    ];
    await H.runTransaction(async () => {
      let i = 0;
      for (const name of DEFAULT_DEPTS) {
        // sqlite seed inserts sort_order = i+1 (1-based) — match it.
        await H.prepare(`INSERT INTO action_departments (name, sort_order) VALUES (?, ?)
          ON CONFLICT (lower(name)) DO NOTHING`).run(name, i + 1);
        i++;
      }
    });
  }
  // dashboard_preset_groups — reuse groupPresets' canonical seeds (lazy require;
  // groupPresets does not require reports-db at module top, so no cycle).
  const gp = require('./services/groupPresets');
  const SEED = { tickets: gp.TICKETS_SEED, changes: gp.CHANGES_SEED };
  for (const scope of ['tickets', 'changes']) {
    const c = Number((await H.prepare('SELECT COUNT(*) AS n FROM dashboard_preset_groups WHERE scope=?').get(scope)).n);
    if (c === 0) {
      await H.runTransaction(async () => {
        for (const [preset, groups] of Object.entries(SEED[scope])) {
          let ix = 0;
          for (const g of groups) {
            await H.prepare(`INSERT INTO dashboard_preset_groups
              (scope, preset_name, group_name, display_order, updated_by)
              VALUES (?, ?, ?, ?, '_system') ON CONFLICT DO NOTHING`).run(scope, preset, g, ix);
            ix++;
          }
        }
      });
    }
  }

  // rr_site_aliases — reuse risk-register's DEFAULT_SITE_ALIASES (lazy require; rr requires
  // reports-db lazily in _h(), so the cycle resolves at call-time — same as groupPresets above).
  const rr = require('./risk-register-export');
  const rrN = Number((await H.prepare('SELECT COUNT(*) AS n FROM rr_site_aliases').get()).n);
  if (rrN === 0) {
    for (const [label, code] of Object.entries(rr.DEFAULT_SITE_ALIASES)) {
      await H.prepare('INSERT INTO rr_site_aliases (sdp_label, code, updated_by) VALUES (?, ?, ?) ON CONFLICT (sdp_label) DO NOTHING').run(label, code, '_system');
    }
  }
}

function login(username, password) {
  if (REPORTS_BACKEND === 'postgres') return _loginPg(username, password);
  const user = db.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(username);
  if (!user) return null;
  const hash = hashPassword(password, user.salt);
  if (hash !== user.password_hash) return null;
  // Create session (24h)
  const token     = makeSession();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(token, user.id, expiresAt);
  return { token, user: safeUser(user) };
}

function validateSession(token) {
  if (REPORTS_BACKEND === 'postgres') return _validateSessionPg(token);
  if (!token) return null;
  const s = db.prepare(`SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')`).get(token);
  if (!s) return null;
  const user = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(s.user_id);
  if (!user) return null;
  // Stamp last_seen — drives the "Active Sessions" admin card. Cheap
  // (~50µs on warm WAL DB) so done unconditionally on every validation.
  // Wrapped in try/catch so a transient DB write failure never blocks
  // a legitimate auth check.
  try {
    db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE token = ?`).run(token);
  } catch (_) { /* non-fatal */ }
  return safeUser(user);
}

function logout(token) {
  if (REPORTS_BACKEND === 'postgres') return _logoutPg(token);
  db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
}

// ── Async postgres forks of the auth/session path (Sub-chunk A) ──────────────
async function _loginPg(username, password) {
  const h = pgHandle();
  const user = await h.prepare(`SELECT * FROM users WHERE username=? AND active=1`).get(username);
  if (!user) return null;
  if (hashPassword(password, user.salt) !== user.password_hash) return null;
  const token = makeSession();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await h.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(token, user.id, expiresAt);
  return { token, user: await _safeUserPg(user) };
}
async function _validateSessionPg(token) {
  if (!token) return null;
  const h = pgHandle();
  const s = await h.prepare(`SELECT * FROM sessions WHERE token=? AND expires_at > now()`).get(token);
  if (!s) return null;
  const user = await h.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(s.user_id);
  if (!user) return null;
  try {                                    // 60s last_seen throttle (decided)
    await h.prepare(`UPDATE sessions SET last_seen = now()
      WHERE token = ? AND (last_seen IS NULL OR last_seen < now() - interval '60 seconds')`).run(token);
  } catch (_) { /* non-fatal */ }
  return await _safeUserPg(user);          // preloads .roles → role middlewares stay sync
}
async function _logoutPg(token) {
  return pgHandle().prepare(`DELETE FROM sessions WHERE token=?`).run(token);
}
// pg variant of safeUser — same field set, preloads roles.
async function _safeUserPg(u) {
  const roles = await _getUserRolesPg(u.id);
  return {
    id: u.id, username: u.username, full_name: u.full_name,
    site_id: u.site_id, role: u.role, roles, active: u.active,
  };
}

// ─── Active sessions (admin observability) ────────────────────────────
// Powers the "🟢 Active Sessions" card on reports.html#admin. Counts a
// session as active when last_seen falls within the supplied window
// (default 5 minutes). Returns enriched rows joined with users.
function listActiveSessions(idleMinutes) {
  if (REPORTS_BACKEND === 'postgres') return _listActiveSessionsPg(idleMinutes);
  const m = Math.max(1, Math.min(1440, Number(idleMinutes) || 5));
  // LEFT JOIN sites because users without a site_id ("All Groups" — admins)
  // still need to appear. site_name resolves to NULL for those, which the
  // UI renders as "All".
  return db.prepare(`
    SELECT s.token,
           s.created_at,
           s.expires_at,
           COALESCE(s.last_seen, s.created_at) AS last_seen,
           CAST(ROUND((julianday('now') - julianday(COALESCE(s.last_seen, s.created_at))) * 86400) AS INTEGER) AS seconds_idle,
           u.id   AS user_id,
           u.username,
           u.full_name,
           u.role,
           site.name AS site_name
    FROM sessions s
    JOIN users u    ON u.id = s.user_id
    LEFT JOIN sites site ON site.id = u.site_id
    WHERE COALESCE(s.last_seen, s.created_at) > datetime('now', '-' || ? || ' minutes')
      AND s.expires_at > datetime('now')
      AND u.active = 1
    ORDER BY last_seen DESC
  `).all(m);
}

// Force-logout a session by token. Returns the number of rows affected
// (0 if the token didn't exist or had already been deleted).
function forceLogoutByToken(token) {
  if (REPORTS_BACKEND === 'postgres') return _forceLogoutByTokenPg(token);
  const r = db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  return { deleted: r.changes };
}
async function _listActiveSessionsPg(idleMinutes) {
  const m = Math.max(1, Math.min(1440, Number(idleMinutes) || 5));
  return pgHandle().prepare(`
    SELECT s.token, s.created_at, s.expires_at,
           COALESCE(s.last_seen, s.created_at) AS last_seen,
           ROUND(EXTRACT(EPOCH FROM (now() - COALESCE(s.last_seen, s.created_at))))::int AS seconds_idle,
           u.id AS user_id, u.username, u.full_name, u.role, site.name AS site_name
    FROM sessions s
    JOIN users u    ON u.id = s.user_id
    LEFT JOIN sites site ON site.id = u.site_id
    WHERE COALESCE(s.last_seen, s.created_at) > now() - (? * interval '1 minute')
      AND s.expires_at > now()
      AND u.active = 1
    ORDER BY last_seen DESC
  `).all(m);
}
async function _forceLogoutByTokenPg(token) {
  const r = await pgHandle().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  return { deleted: r.changes };
}

function safeUser(u) {
  // Pre-load roles array so middleware doesn't hit the DB on every request.
  const roles = getUserRoles(u.id);
  return {
    id: u.id, username: u.username, full_name: u.full_name,
    first_name: u.first_name || null, last_name: u.last_name || null,
    title: u.title || null, office: u.office || null,
    site_id: u.site_id,
    email: u.email || null,       // Entra SSO match key (also shown in the admin UI)
    has_entra: !!u.entra_oid,     // linked to a Microsoft identity?
    role: u.role,           // legacy single-role field — highest hierarchical tier
    roles,                  // full role array (hierarchical + feature)
    active: u.active,
  };
}

// ── USER MANAGEMENT ───────────────────────────────────────────────
function listUsers() {
  if (REPORTS_BACKEND === 'postgres') return _listUsersPg();
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.site_id, s.name as site_name, s.zoho_group, u.role, u.active, u.created_at,
           u.email, u.entra_oid, u.first_name, u.last_name, u.title, u.office
    FROM users u LEFT JOIN sites s ON u.site_id=s.id ORDER BY u.id
  `).all();
  // Attach roles array to each user — single GROUP_CONCAT query is cheaper
  // than N+1 lookups for large user lists.
  const allRoles = db.prepare(`
    SELECT user_id, GROUP_CONCAT(role, ',') AS roles_csv FROM user_roles GROUP BY user_id
  `).all();
  const rolesByUser = {};
  for (const r of allRoles) rolesByUser[r.user_id] = r.roles_csv ? r.roles_csv.split(',').sort() : [];
  return users.map(u => ({ ...u, has_entra: !!u.entra_oid, entra_oid: undefined, roles: rolesByUser[u.id] || [] }));
}

function createUser({ username, full_name, password, site_id, role, roles, email }) {
  if (REPORTS_BACKEND === 'postgres') return _createUserPg({ username, full_name, password, site_id, role, roles, email });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  // Resolve final roles set: prefer the new `roles` array; fall back to the
  // legacy single `role` string for backward-compat callers.
  let finalRoles = Array.isArray(roles) && roles.length > 0
    ? roles
    : [role || 'editor'];
  // Ensure 'editor'/'viewer' alone gets a sensible legacy users.role value
  const ROLE_HIERARCHY_LOCAL = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  const highest = ROLE_HIERARCHY_LOCAL.find(h => finalRoles.includes(h)) || 'viewer';
  const result = db.prepare(`INSERT INTO users (username, full_name, password_hash, salt, site_id, role) VALUES (?,?,?,?,?,?)`)
           .run(username, full_name, hash, salt, site_id || null, highest);
  // Persist all roles to user_roles
  if (result.lastInsertRowid) setUserRoles(result.lastInsertRowid, finalRoles);
  // Email (Entra SSO match key) — additive so the branchy password logic above
  // stays untouched. Stored lowercase; blank → NULL.
  if (result.lastInsertRowid && email !== undefined) {
    const e = (email && String(email).trim().toLowerCase()) || null;
    db.prepare(`UPDATE users SET email=? WHERE id=?`).run(e, result.lastInsertRowid);
  }
  return result;
}

// Change own password — verifies current password before updating
function changePassword(userId, currentPassword, newPassword) {
  if (REPORTS_BACKEND === 'postgres') return _changePasswordPg(userId, currentPassword, newPassword);
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!user) return { ok: false, error: 'User not found' };
  const currentHash = hashPassword(currentPassword, user.salt);
  if (currentHash !== user.password_hash) return { ok: false, error: 'Current password is incorrect' };
  if (newPassword.length < 8) return { ok: false, error: 'New password must be at least 8 characters' };
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(hash, salt, userId);
  return { ok: true };
}

function updateUser(id, { full_name, password, site_id, role, roles, active, email }) {
  if (REPORTS_BACKEND === 'postgres') return _updateUserPg(id, { full_name, password, site_id, role, roles, active, email });
  // Resolve roles to update: prefer the new `roles` array; fall back to
  // single `role` for legacy callers. If neither is provided, leave the
  // current user_roles set alone.
  const willUpdateRoles = Array.isArray(roles) || typeof role === 'string';
  const finalRoles = Array.isArray(roles) && roles.length > 0
    ? roles
    : (typeof role === 'string' ? [role] : null);
  // The legacy users.role column gets the highest tier from finalRoles
  // (or stays untouched if we're not changing roles at all).
  const ROLE_HIERARCHY_LOCAL = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  const highest = finalRoles
    ? (ROLE_HIERARCHY_LOCAL.find(h => finalRoles.includes(h)) || 'viewer')
    : null;

  if (password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    if (willUpdateRoles && highest) {
      db.prepare(`UPDATE users SET full_name=?, password_hash=?, salt=?, site_id=?, role=?, active=? WHERE id=?`)
        .run(full_name, hash, salt, site_id ?? null, highest, active ?? 1, id);
    } else {
      db.prepare(`UPDATE users SET full_name=?, password_hash=?, salt=?, site_id=?, active=? WHERE id=?`)
        .run(full_name, hash, salt, site_id ?? null, active ?? 1, id);
    }
  } else {
    if (willUpdateRoles && highest) {
      db.prepare(`UPDATE users SET full_name=?, site_id=?, role=?, active=? WHERE id=?`)
        .run(full_name, site_id ?? null, highest, active ?? 1, id);
    } else {
      db.prepare(`UPDATE users SET full_name=?, site_id=?, active=? WHERE id=?`)
        .run(full_name, site_id ?? null, active ?? 1, id);
    }
  }
  if (willUpdateRoles && finalRoles) {
    setUserRoles(id, finalRoles);
  }
  // Email (Entra SSO match key) — additive; only touched when explicitly sent.
  if (email !== undefined) {
    const e = (email && String(email).trim().toLowerCase()) || null;
    db.prepare(`UPDATE users SET email=? WHERE id=?`).run(e, id);
  }
}

// ── Entra ID (Azure AD) SSO helpers ──────────────────────────────────────────
// findUserByEntra: resolve a Microsoft identity to a dashboard user — prefer the
// stable oid link, fall back to a case-insensitive email match (pre-provisioning).
// Returns the raw active user row, or null (→ caller denies: not provisioned).
function findUserByEntra({ oid, email } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _findUserByEntraPg({ oid, email });
  let u = null;
  if (oid)          u = db.prepare(`SELECT * FROM users WHERE entra_oid=? AND active=1`).get(oid);
  if (!u && email)  u = db.prepare(`SELECT * FROM users WHERE lower(email)=lower(?) AND active=1`).get(email);
  return u || null;
}
// linkUserEntra: on first successful SSO match, stamp the stable oid. Set the
// email too only if the row didn't already have one (don't clobber a curated value).
function linkUserEntra(userId, oid, email) {
  if (REPORTS_BACKEND === 'postgres') return _linkUserEntraPg(userId, oid, email);
  db.prepare(`UPDATE users SET entra_oid=?, email=COALESCE(email, ?) WHERE id=?`)
    .run(oid || null, (email && String(email).toLowerCase()) || null, userId);
}
// updateUserProfileFromEntra: refresh the display profile FROM Microsoft on each
// SSO login. COALESCE so a field only overwrites when Entra actually supplied it
// (jobTitle/office can be absent if the Graph call is skipped/fails).
function _nz(v) { const s = (v == null ? '' : String(v)).trim(); return s || null; }
function updateUserProfileFromEntra(userId, p = {}) {
  if (REPORTS_BACKEND === 'postgres') return _updateUserProfileFromEntraPg(userId, p);
  db.prepare(`UPDATE users SET
      first_name = COALESCE(?, first_name),
      last_name  = COALESCE(?, last_name),
      title      = COALESCE(?, title),
      office     = COALESCE(?, office),
      full_name  = COALESCE(?, full_name)
    WHERE id = ?`)
    .run(_nz(p.first_name), _nz(p.last_name), _nz(p.title), _nz(p.office), _nz(p.full_name), userId);
}
async function _updateUserProfileFromEntraPg(userId, p = {}) {
  await pgHandle().prepare(`UPDATE users SET
      first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
      title = COALESCE(?, title), office = COALESCE(?, office), full_name = COALESCE(?, full_name)
    WHERE id = ?`)
    .run(_nz(p.first_name), _nz(p.last_name), _nz(p.title), _nz(p.office), _nz(p.full_name), userId);
}

// setUserEmail: used by the bulk email-mapping screen. Lowercased; blank → NULL.
function setUserEmail(userId, email) {
  if (REPORTS_BACKEND === 'postgres') return _setUserEmailPg(userId, email);
  db.prepare(`UPDATE users SET email=? WHERE id=?`).run(_nz(email && String(email).toLowerCase()), userId);
}
async function _setUserEmailPg(userId, email) {
  await pgHandle().prepare(`UPDATE users SET email=? WHERE id=?`).run(_nz(email && String(email).toLowerCase()), userId);
}

// createSessionForUser: mint the SAME 24h session token as password login, but
// without a password (identity already proven by Entra). Mirrors login().
function createSessionForUser(userId) {
  if (REPORTS_BACKEND === 'postgres') return _createSessionForUserPg(userId);
  const user = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(userId);
  if (!user) return null;
  const token     = makeSession();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(token, user.id, expiresAt);
  return { token, user: safeUser(user) };
}

// PostgreSQL forks — reports.db may run under REPORTS_BACKEND=postgres later.
async function _findUserByEntraPg({ oid, email } = {}) {
  const h = pgHandle();
  let u = null;
  if (oid)         u = await h.prepare(`SELECT * FROM users WHERE entra_oid=? AND active=1`).get(oid);
  if (!u && email) u = await h.prepare(`SELECT * FROM users WHERE lower(email)=lower(?) AND active=1`).get(email);
  return u || null;
}
async function _linkUserEntraPg(userId, oid, email) {
  await pgHandle().prepare(`UPDATE users SET entra_oid=?, email=COALESCE(email, ?) WHERE id=?`)
    .run(oid || null, (email && String(email).toLowerCase()) || null, userId);
}
async function _createSessionForUserPg(userId) {
  const h = pgHandle();
  const user = await h.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(userId);
  if (!user) return null;
  const token     = makeSession();
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await h.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`).run(token, user.id, expiresAt);
  return { token, user: await _safeUserPg(user) };
}
async function _safeUserPg(u) {
  const roles = await getUserRoles(u.id);
  return { id: u.id, username: u.username, full_name: u.full_name, site_id: u.site_id,
           email: u.email || null, has_entra: !!u.entra_oid, role: u.role, roles, active: u.active };
}

function deleteUser(id) {
  if (REPORTS_BACKEND === 'postgres') return _deleteUserPg(id);
  db.prepare(`DELETE FROM users WHERE id=?`).run(id);
}

// ── Async postgres forks of user management (Sub-chunk A) ────────────────────
async function _setUserRolesPg(userId, roles) {
  if (!userId) return;
  const allowed = new Set([...ROLE_HIERARCHY, ...FEATURE_ROLES_KNOWN]);
  const clean = (Array.isArray(roles) ? roles : []).filter(r => allowed.has(r));
  if (clean.length === 0) clean.push('viewer');
  const h = pgHandle();
  await h.runTransaction(async () => {
    await h.prepare(`DELETE FROM user_roles WHERE user_id=?`).run(userId);
    const ins = h.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT (user_id, role) DO NOTHING`);
    for (const r of clean) await ins.run(userId, r);
    const highest = ROLE_HIERARCHY.find(x => clean.includes(x)) || 'viewer';
    await h.prepare(`UPDATE users SET role=? WHERE id=?`).run(highest, userId);
  });
}
async function _listUsersPg() {
  const h = pgHandle();
  const users = await h.prepare(`
    SELECT u.id, u.username, u.full_name, u.site_id, s.name as site_name, s.zoho_group, u.role, u.active, u.created_at
    FROM users u LEFT JOIN sites s ON u.site_id=s.id ORDER BY u.id`).all();
  const allRoles = await h.prepare(`
    SELECT user_id, string_agg(role, ',' ORDER BY role) AS roles_csv FROM user_roles GROUP BY user_id`).all();
  const rolesByUser = {};
  for (const r of allRoles) rolesByUser[r.user_id] = r.roles_csv ? r.roles_csv.split(',') : [];
  return users.map(u => ({ ...u, roles: rolesByUser[u.id] || [] }));
}
async function _createUserPg({ username, full_name, password, site_id, role, roles }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const finalRoles = Array.isArray(roles) && roles.length > 0 ? roles : [role || 'editor'];
  const ROLE_HIERARCHY_LOCAL = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  const highest = ROLE_HIERARCHY_LOCAL.find(h => finalRoles.includes(h)) || 'viewer';
  const result = await pgHandle().prepare(`INSERT INTO users (username, full_name, password_hash, salt, site_id, role) VALUES (?,?,?,?,?,?)`)
    .run(username, full_name, hash, salt, site_id || null, highest);
  if (result.lastID) await _setUserRolesPg(result.lastID, finalRoles);
  return result;
}
async function _changePasswordPg(userId, currentPassword, newPassword) {
  const h = pgHandle();
  const user = await h.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!user) return { ok: false, error: 'User not found' };
  if (hashPassword(currentPassword, user.salt) !== user.password_hash) return { ok: false, error: 'Current password is incorrect' };
  if (newPassword.length < 8) return { ok: false, error: 'New password must be at least 8 characters' };
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(newPassword, salt);
  await h.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(hash, salt, userId);
  return { ok: true };
}
async function _updateUserPg(id, { full_name, password, site_id, role, roles, active }) {
  const h = pgHandle();
  const willUpdateRoles = Array.isArray(roles) || typeof role === 'string';
  const finalRoles = Array.isArray(roles) && roles.length > 0 ? roles : (typeof role === 'string' ? [role] : null);
  const ROLE_HIERARCHY_LOCAL = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
  const highest = finalRoles ? (ROLE_HIERARCHY_LOCAL.find(x => finalRoles.includes(x)) || 'viewer') : null;
  if (password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    if (willUpdateRoles && highest) await h.prepare(`UPDATE users SET full_name=?, password_hash=?, salt=?, site_id=?, role=?, active=? WHERE id=?`).run(full_name, hash, salt, site_id ?? null, highest, active ?? 1, id);
    else await h.prepare(`UPDATE users SET full_name=?, password_hash=?, salt=?, site_id=?, active=? WHERE id=?`).run(full_name, hash, salt, site_id ?? null, active ?? 1, id);
  } else {
    if (willUpdateRoles && highest) await h.prepare(`UPDATE users SET full_name=?, site_id=?, role=?, active=? WHERE id=?`).run(full_name, site_id ?? null, highest, active ?? 1, id);
    else await h.prepare(`UPDATE users SET full_name=?, site_id=?, active=? WHERE id=?`).run(full_name, site_id ?? null, active ?? 1, id);
  }
  if (willUpdateRoles && finalRoles) await _setUserRolesPg(id, finalRoles);
}
async function _deleteUserPg(id) {
  return pgHandle().prepare(`DELETE FROM users WHERE id=?`).run(id);
}

// ── SITES ─────────────────────────────────────────────────────────
// Sites are referenced by FK from weekly_reports.site_id and users.site_id.
// Renames are NOT exposed (would change historical report labels in surprising
// ways for any external system that queries by name). Soft-delete via active=0
// hides from new dropdowns while preserving historical reports.

function listSites({ includeInactive = false } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _listSitesPg({ includeInactive });
  if (includeInactive) {
    return db.prepare(`SELECT id, name, zoho_group, active, sort_order FROM sites ORDER BY sort_order, name`).all();
  }
  return db.prepare(`SELECT id, name, zoho_group, active, sort_order FROM sites WHERE active=1 ORDER BY sort_order, name`).all();
}
async function _listSitesPg({ includeInactive = false } = {}) {
  const H = pgHandle();
  const sql = includeInactive
    ? 'SELECT id, name, zoho_group, active, sort_order FROM sites ORDER BY sort_order, name'
    : 'SELECT id, name, zoho_group, active, sort_order FROM sites WHERE active=1 ORDER BY sort_order, name';
  return H.prepare(sql).all();
}

/**
 * getSiteIdByModuleCode(module, code) — resolves a per-module site code
 * (e.g. meetings 'HGO') to { site_id, name, zoho_group }. site_module_codes is
 * written by the boot seed but was never read until now.
 * Returns null when the code is unknown (e.g. Exploration/Tanda have no
 * meetings code). Case-insensitive on the code.
 */
function getSiteIdByModuleCode(module, code) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteIdByModuleCodePg(module, code);
  if (!module || !code) return null;
  try {
    const row = db.prepare(`
      SELECT c.site_id AS site_id, s.name AS name, s.zoho_group AS zoho_group
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? AND c.code = ? COLLATE NOCASE`).get(module, code);
    return row || null;
  } catch (e) { console.warn('[site-resolve] failed:', e.message); return null; }
}
async function _getSiteIdByModuleCodePg(module, code) {
  if (!module || !code) return null;
  try {
    const row = await pgHandle().prepare(`
      SELECT c.site_id AS site_id, s.name AS name, s.zoho_group AS zoho_group
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? AND lower(c.code) = lower(?)`).get(module, code);
    return row || null;
  } catch (e) { console.warn('[site-resolve] failed:', e.message); return null; }
}

/**
 * listSiteModuleCodes(module) — every (site, code) pair in one module's
 * namespace, ordered by site name. Sites without a code for that module
 * (e.g. Exploration/Tanda have no meetings code) simply don't appear.
 */
function listSiteModuleCodes(module) {
  if (REPORTS_BACKEND === 'postgres') return _listSiteModuleCodesPg(module);
  if (!module) return [];
  try {
    return db.prepare(`
      SELECT c.site_id AS site_id, c.code AS code, s.name AS name
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? ORDER BY s.name`).all(module);
  } catch (e) { console.warn('[site-resolve] listSiteModuleCodes failed:', e.message); return []; }
}
async function _listSiteModuleCodesPg(module) {
  if (!module) return [];
  try {
    return await pgHandle().prepare(`
      SELECT c.site_id AS site_id, c.code AS code, s.name AS name
      FROM site_module_codes c JOIN sites s ON s.id = c.site_id
      WHERE c.module = ? ORDER BY s.name`).all(module);
  } catch (e) { console.warn('[site-resolve] listSiteModuleCodes failed:', e.message); return []; }
}

// V1b — the editable Site ↔ Meraki-network map for the admin UI. LEFT JOIN so
// EVERY active site shows, mapped or not (a null code = "not yet mapped"). This
// is the sync's own source (site_module_codes, module='meraki'); the seed only
// pre-fills defaults.
function listSiteMerakiMap() {
  if (REPORTS_BACKEND === 'postgres') return _listSiteMerakiMapPg();
  return db.prepare(`
    SELECT s.id AS site_id, s.name AS name, c.code AS network
    FROM sites s LEFT JOIN site_module_codes c ON c.site_id = s.id AND c.module = 'meraki'
    WHERE s.active = 1 ORDER BY s.name`).all();
}
async function _listSiteMerakiMapPg() {
  return await pgHandle().prepare(`
    SELECT s.id AS site_id, s.name AS name, c.code AS network
    FROM sites s LEFT JOIN site_module_codes c ON c.site_id = s.id AND c.module = 'meraki'
    WHERE s.active = 1 ORDER BY s.name`).all();
}
// Set (or clear, when network is blank) one site's Meraki network name.
function setSiteMerakiCode(site_id, network) {
  if (REPORTS_BACKEND === 'postgres') return _setSiteMerakiCodePg(site_id, network);
  const net = String(network == null ? '' : network).trim();
  if (!net) { db.prepare(`DELETE FROM site_module_codes WHERE site_id = ? AND module = 'meraki'`).run(site_id); return { site_id, network: null }; }
  db.prepare(`INSERT INTO site_module_codes (site_id, module, code) VALUES (?, 'meraki', ?)
    ON CONFLICT (site_id, module) DO UPDATE SET code = excluded.code`).run(site_id, net);
  return { site_id, network: net };
}
async function _setSiteMerakiCodePg(site_id, network) {
  const H = pgHandle();
  const net = String(network == null ? '' : network).trim();
  if (!net) { await H.prepare(`DELETE FROM site_module_codes WHERE site_id = ? AND module = 'meraki'`).run(site_id); return { site_id, network: null }; }
  await H.prepare(`INSERT INTO site_module_codes (site_id, module, code) VALUES (?, 'meraki', ?)
    ON CONFLICT (site_id, module) DO UPDATE SET code = EXCLUDED.code`).run(site_id, net);
  return { site_id, network: net };
}

// V1b-E — the editable sub-site → Meraki-network map (Exploration). INNER JOIN sites so
// only rows for existing sites are returned. Normal sites simply have no rows here.
function listWanSubsiteNetworks() {
  if (REPORTS_BACKEND === 'postgres') return _listWanSubsiteNetworksPg();
  return db.prepare(`
    SELECT wsn.site_id AS site_id, wsn.sub_site AS sub_site, wsn.network AS network, s.name AS site_name
    FROM wan_subsite_networks wsn JOIN sites s ON s.id = wsn.site_id
    ORDER BY s.name, wsn.sub_site`).all();
}
async function _listWanSubsiteNetworksPg() {
  return await pgHandle().prepare(`
    SELECT wsn.site_id AS site_id, wsn.sub_site AS sub_site, wsn.network AS network, s.name AS site_name
    FROM wan_subsite_networks wsn JOIN sites s ON s.id = wsn.site_id
    ORDER BY s.name, wsn.sub_site`).all();
}
// Replace-all per touched site, in a real transaction: for each site_id present in `rows`,
// DELETE its existing rows then INSERT the well-formed ones (both sub_site + network
// non-blank after trim). Re-saving a site's set drops any sub_site no longer listed.
function _wanSubsiteBySite(rows) {
  const bySite = new Map();
  for (const r of (rows || [])) {
    if (r == null || r.site_id == null) continue;
    const sub = String(r.sub_site == null ? '' : r.sub_site).trim();
    const net = String(r.network == null ? '' : r.network).trim();
    if (!bySite.has(r.site_id)) bySite.set(r.site_id, []);
    if (sub && net) bySite.get(r.site_id).push({ sub_site: sub, network: net });
  }
  return bySite;
}
function setWanSubsiteNetworks(rows) {
  if (REPORTS_BACKEND === 'postgres') return _setWanSubsiteNetworksPg(rows);
  return _setWanSubsiteNetworksSqlite(rows);
}
const _setWanSubsiteNetworksSqlite = db.transaction((rows) => {
  const bySite = _wanSubsiteBySite(rows);
  const del = db.prepare(`DELETE FROM wan_subsite_networks WHERE site_id = ?`);
  const ins = db.prepare(`INSERT INTO wan_subsite_networks (site_id, sub_site, network) VALUES (?, ?, ?)`);
  for (const [site_id, list] of bySite) {
    del.run(site_id);
    for (const r of list) ins.run(site_id, r.sub_site, r.network);
  }
});
async function _setWanSubsiteNetworksPg(rows) {
  const H = pgHandle();
  const bySite = _wanSubsiteBySite(rows);
  await H.runTransaction(async () => {
    for (const [site_id, list] of bySite) {
      await H.prepare(`DELETE FROM wan_subsite_networks WHERE site_id = ?`).run(site_id);
      for (const r of list) await H.prepare(`INSERT INTO wan_subsite_networks (site_id, sub_site, network) VALUES (?, ?, ?)`).run(site_id, r.sub_site, r.network);
    }
  });
}

// Pure aggregation core — exported for tests. `rows` are request_records rows
// already scoped to the site's groups + the calendar month.
function _computeSiteHelpdesk(rows) {
  const out = { created: 0, resolved: 0, backlog: 0, sla_overdue: 0, major_incidents: 0, top_categories: [], recurring: [] };
  if (!rows || !rows.length) return out;
  const cat = new Map(), sub = new Map();
  for (const r of rows) {
    out.created++;
    if (r.pending_status === 0) out.resolved++; else out.backlog++;
    // overdue_status is TRI-state: 1 / 0 / NULL (NULL = no SLA rule applies).
    // Keep the strict === 1 — do not "simplify" to !== 0, which counts NULLs.
    if (r.overdue_status === 1) out.sla_overdue++;
    const isMI = /major/i.test(String(r.request_type || '')) || /major incident/i.test(String(r.template || ''));
    if (isMI) out.major_incidents++;
    const c = (r.category || '').trim();
    if (c) cat.set(c, (cat.get(c) || 0) + 1);
    const s = (r.sub_category || '').trim();
    if (c && s) { const k = `${c} / ${s}`; sub.set(k, (sub.get(k) || 0) + 1); }
  }
  out.top_categories = [...cat.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([category, count]) => ({ category, count }));
  out.recurring = [...sub.entries()].filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5).map(([label, count]) => ({ label, count }));
  return out;
}

/**
 * getSiteHelpdeskMonthly(site_id, year, month) → the site-report helpdesk block.
 * Scopes by tech_group (from sites.zoho_group) — request_records.site is
 * free-form and unreliable, so every per-site reader here joins by group.
 * Returns the all-zero block when the site has no zoho_group.
 */
function getSiteHelpdeskMonthly(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteHelpdeskMonthlyPg(site_id, year, month);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND strftime('%Y-%m', created_time) = ?`).all(...groups, ym);
  return _computeSiteHelpdesk(rows);
}
// pg fork — strftime → to_char(created_time::timestamptz,'YYYY-MM').
async function _getSiteHelpdeskMonthlyPg(site_id, year, month) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND to_char(created_time::timestamptz,'YYYY-MM') = ?`).all(...groups, ym);
  return _computeSiteHelpdesk(rows);
}

/**
 * getSiteHelpdeskWindow(site_id, from, to) — the window-scoped sibling of
 * getSiteHelpdeskMonthly. `from`/`to` are INCLUSIVE 'YYYY-MM-DD' strings.
 * Same group scoping, same pure core (_computeSiteHelpdesk) — only the window
 * differs. created_time is TEXT holding ISO-with-T-and-Z ('2025-01-09T15:15:14.000Z'),
 * so a raw `created_time BETWEEN from AND to` LEXICALLY drops the last day
 * ('2026-07-03T09:12:00.000Z' > '2026-07-03'). substr(...,1,10) is correct AND
 * identical on both backends — no date() (sqlite-only), no ::date/to_char (the
 * column is TEXT in pg too, 004_hot.sql:22).
 * Known trade-off: substr() wraps the column so idx_rr_created can't be used
 * (seq scan). ~25k rows on a cold route — cheap. `created_time >= ? AND < ?`
 * with an exclusive to+1day would be correct AND sargable if this ever profiles hot.
 */
function getSiteHelpdeskWindow(site_id, from, to) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteHelpdeskWindowPg(site_id, from, to);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, from, to);
  return _computeSiteHelpdesk(rows);
}
// pg fork — SAME SQL. created_time is TEXT in pg (004_hot.sql:22), so substr
// replaces the monthly fork's to_char(created_time::timestamptz,…) cast entirely.
async function _getSiteHelpdeskWindowPg(site_id, from, to) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteHelpdesk([]);
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT pending_status, overdue_status, request_type, template, category, sub_category
    FROM request_records
    WHERE tech_group IN (${ph}) AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, from, to);
  return _computeSiteHelpdesk(rows);
}

// ── SITE IMPACT (slide 7) — per-site helpdesk counts for the report window ──
// Buckets ALL sites in ONE query (mapped in JS by tech_group→site), returning
// the counts services/deckSiteImpact.buildSiteImpact needs. Same SLA doctrine as
// _computeSiteHelpdesk: closed = pending_status===0, missed-resolution-SLA =
// overdue_status===1 (strict — NULL means no SLA rule). on_time = closed AND not
// overdue. incidents = request_type contains 'Incident' (REGULAR incidents, per
// the deck's per-site incident bars — not just major).
function _bucketSiteImpact(sites, rows) {
  const byGroup = new Map();   // tech_group → site id
  const acc = new Map();       // site id → counts
  for (const s of (sites || [])) {
    if (!acc.has(s.id)) acc.set(s.id, { code: s.name, name: s.name, tickets: 0, missed: 0, closed: 0, on_time: 0, incidents: 0 });
    String(s.zoho_group || '').split(',').map((g) => g.trim()).filter(Boolean).forEach((g) => byGroup.set(g, s.id));
  }
  for (const r of (rows || [])) {
    const id = byGroup.get(String(r.tech_group || '').trim());
    if (id == null) continue;
    const c = acc.get(id);
    c.tickets++;
    const closed = r.pending_status === 0;
    const overdue = r.overdue_status === 1;
    if (closed) { c.closed++; if (!overdue) c.on_time++; }
    if (overdue) c.missed++;
    if (/incident/i.test(String(r.request_type || ''))) c.incidents++;
  }
  return [...acc.values()].filter((s) => s.tickets > 0);
}
const _SITE_IMPACT_SITES_SQL = "SELECT id, name, zoho_group FROM sites WHERE zoho_group IS NOT NULL AND zoho_group != ''";
const _SITE_IMPACT_ROWS_SQL = 'SELECT tech_group, request_type, pending_status, overdue_status FROM request_records WHERE substr(created_time,1,10) BETWEEN ? AND ?';
function getSiteImpactCounts(from, to) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteImpactCountsPg(from, to);
  const sites = db.prepare(_SITE_IMPACT_SITES_SQL).all();
  const rows = db.prepare(_SITE_IMPACT_ROWS_SQL).all(from, to);
  return _bucketSiteImpact(sites, rows);
}
async function _getSiteImpactCountsPg(from, to) {
  const H = pgHandle();
  const sites = await H.prepare(_SITE_IMPACT_SITES_SQL).all();
  const rows = await H.prepare(_SITE_IMPACT_ROWS_SQL).all(from, to);
  return _bucketSiteImpact(sites, rows);
}

// ── CHANGE OUTCOME — a VERBATIM port of the SHIPPED classifier at
// public/executive-report.html:5053-5090 (_changeOutcome / _tallyChanges).
// DO NOT write a second classifier: its own header comment records the bug a
// naive status/closure_code reader causes — the deck builder reported a
// different success number than the live executive.html scorecard.
// The only adaptation: the shipped code reads raw Zoho keys off a row
// (r['Change Closure Code'] etc.); our DB row is a `closure_code` COLUMN + a
// `udf_json` TEXT blob, so we build the three strings first. Everything below
// that is line-for-line, same order.
// Three counter-intuitive facts, all deliberate:
//   1. the success bucket is 'success', not 'successful'          (:5066)
//   2. no signal at all → 'pending', never null                   (:5074, :5054)
//   3. UDF:Review decision short-circuits on 'rework' ONLY (:5059) — its
//      success/cancel checks sit BELOW the outcome checks, so priority is
//      per-VALUE, not per-field.
// Returns one of 9 buckets:
//   success / success_caveat / partial / failed / backed_out
//   cancelled / deferred / rework / pending
function _changeOutcome(row) {
  if (!row) return 'pending';
  // Parse udf_json in JS, not with json_extract: we need two keys, the blob is
  // already selected, and a malformed blob must degrade to 'pending', not throw.
  let u = {};
  try { u = JSON.parse(row.udf_json || '{}') || {}; } catch { u = {}; }
  const code    = String(row.closure_code || '').trim().toLowerCase();
  const outcome = String(u['UDF:Change Implementation Outcome'] || '').trim().toLowerCase();
  const review  = String(u['UDF:Review decision'] || '').trim().toLowerCase();

  if (review.indexOf('rework') >= 0)                                           return 'rework';
  if (outcome.indexOf('with issues') >= 0)                                     return 'success_caveat';
  if (outcome.indexOf('partial')     >= 0)                                     return 'partial';
  if (outcome.indexOf('failed')      >= 0)                                     return 'failed';
  if (outcome.indexOf('backed')      >= 0)                                     return 'backed_out';
  if (outcome === 'deferred')                                                  return 'deferred';
  if (outcome === 'cancelled' || outcome === 'canceled')                       return 'cancelled';
  if (outcome.indexOf('successful')  >= 0)                                     return 'success';
  if (review.indexOf('cancelled') >= 0 || review.indexOf('canceled') >= 0)     return 'cancelled';
  if (review.indexOf('approved for closure') >= 0)                             return 'success';
  if (code.indexOf('completed') >= 0)                                          return 'success';
  if (code.indexOf('approved') >= 0 && code.indexOf('cancel') < 0)             return 'success';
  if (code.indexOf('cancel') >= 0)                                             return 'cancelled';
  if (code.indexOf('reject') >= 0)                                             return 'failed';
  if (code.indexOf('deferred') >= 0)                                           return 'deferred';
  return 'pending';
}

/**
 * _computeSiteChanges(rows) — the pure core. _tallyChanges (:5082-5090) VERBATIM,
 * plus our three extras (total, emergency, success_pct). THIS IS THE CHANGES
 * CONTRACT — do not invent a completed/open pair.
 *
 * Two outputs are MERGES; the raw counts survive only in `buckets`:
 *   failed  = failed + backed_out   (:5086) — there is no separate backed_out output
 *   pending = pending + rework      (:5088) — a non-zero `pending` may be a rework
 *
 * executed INCLUDES cancelled (:5087). This DELIBERATELY diverges from CLAUDE.md's
 * denominator doctrine line (successful + failed + backed_out, cancelled excluded).
 * Measured over the 295 real rows: shipped → executed=187, 91.4%; doctrine → 175,
 * 97.7% — a 6.3pp divergence from the deck the team already reads, which is exactly
 * the failure the shipped classifier's header comment warns about. Follow the code.
 *
 * success_pct is null when nothing executed — "nothing to judge" is not "0% success".
 */
function _computeSiteChanges(rows) {
  const b = { success: 0, success_caveat: 0, partial: 0, failed: 0, backed_out: 0, cancelled: 0, deferred: 0, rework: 0, pending: 0 };
  let total = 0, emergency = 0;
  (rows || []).forEach(r => {
    total++;
    if (Number(r && r.emergency) === 1) emergency++;   // INTEGER column; tolerate '1'
    const k = _changeOutcome(r);
    b[k] = (b[k] || 0) + 1;
  });
  const successful = b.success + b.success_caveat;
  const failedTot  = b.failed  + b.backed_out;
  const executed   = successful + b.partial + failedTot + b.cancelled;
  const pendingTot = b.pending + b.rework;
  return {
    buckets: b, successful, failed: failedTot, cancelled: b.cancelled,
    deferred: b.deferred, pending: pendingTot, executed,            // ← _tallyChanges, verbatim
    total, emergency,                                               // ← ours
    success_pct: executed ? Math.round(100 * successful / executed) : null,
  };
}

/**
 * getSiteChangesWindow(site_id, from, to) → the per-site changes block.
 * Scopes by change_records.group_name (from sites.zoho_group) — exactly as the
 * helpdesk readers scope by tech_group. NEVER by change_records.site_id /
 * request_records.site: the free-form-site pitfall is documented in CLAUDE.md.
 * `from`/`to` are INCLUSIVE 'YYYY-MM-DD'. See getSiteHelpdeskWindow for why
 * substr(created_time,1,10) and not a raw BETWEEN / a cast.
 * Returns the all-zero block when the site has no zoho_group.
 */
function getSiteChangesWindow(site_id, from, to) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteChangesWindowPg(site_id, from, to);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteChanges([]);
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT status, closure_code, emergency, udf_json, completed_time, created_time
    FROM change_records
    WHERE group_name IN (${ph}) AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, from, to);
  return _computeSiteChanges(rows);
}
// pg fork — SAME SQL (created_time is TEXT in pg too); only await + pgHandle differ.
async function _getSiteChangesWindowPg(site_id, from, to) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeSiteChanges([]);
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT status, closure_code, emergency, udf_json, completed_time, created_time
    FROM change_records
    WHERE group_name IN (${ph}) AND substr(created_time,1,10) BETWEEN ? AND ?`).all(...groups, from, to);
  return _computeSiteChanges(rows);
}

/**
 * getSiteOpenChanges(site_id) → the changes that are STILL OPEN for a site.
 *
 * Deliberately has NO date window, unlike getSiteChangesWindow above. The month
 * block answers "what did we carry out in July"; this one answers "what is stuck
 * right now" — and a site can read `0 changes` for the month while carrying a
 * change that has been open since April 2025. That gap is the whole point: the
 * monthly figure alone lets stalled work stay invisible for a year.
 *
 * Same GROUP scoping as every other per-site reader (`group_name` from
 * sites.zoho_group) — NEVER change_records.site_id, which is unreliable.
 */
function getSiteOpenChanges(site_id, asOf) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteOpenChangesPg(site_id, asOf);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeOpenChanges([], asOf);
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT change_id, display_id, subject, stage, status, risk, emergency,
           manager, requester, scheduled_end, created_time
    FROM change_records
    WHERE group_name IN (${ph}) AND lower(coalesce(status,'')) NOT IN ('completed','cancelled')`).all(...groups);
  return _computeOpenChanges(rows, asOf);
}
// pg fork — SAME SQL; only await + pgHandle differ.
async function _getSiteOpenChangesPg(site_id, asOf) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return _computeOpenChanges([], asOf);
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT change_id, display_id, subject, stage, status, risk, emergency,
           manager, requester, scheduled_end, created_time
    FROM change_records
    WHERE group_name IN (${ph}) AND lower(coalesce(status,'')) NOT IN ('completed','cancelled')`).all(...groups);
  return _computeOpenChanges(rows, asOf);
}

// The ITIL lifecycle order, so the block reads as a pipeline rather than an
// alphabetical list — the reader needs to see WHERE work is piling up. Stages
// the data invents later are appended after these, never dropped.
const _CHANGE_STAGE_ORDER = ['Submission', 'Planning', 'Approval', 'Implementation', 'UAT', 'Release', 'Review', 'Close'];

/**
 * Pure core — rows already scoped to the site's groups and already filtered to
 * open. `asOf` is INJECTED ('YYYY-MM-DD'): an internal new Date() would make the
 * overdue branch untestable and re-date the report every time it is opened.
 */
function _computeOpenChanges(rows, asOf) {
  const today = String(asOf || '').slice(0, 10);
  const list = (rows || []).map((r) => {
    const end = String(r.scheduled_end || '').slice(0, 10);
    const created = String(r.created_time || '').slice(0, 10);
    return {
      change_id: r.change_id, display_id: r.display_id, subject: r.subject || '',
      stage: r.stage || '—', status: r.status || '—',
      risk: r.risk || '', emergency: r.emergency ? 1 : 0,
      manager: r.manager || '', requester: r.requester || '',
      scheduled_end: end || null, created_time: created || null,
      // Overdue needs BOTH dates present. A change with no planned end date is
      // not "on time" — it is unplanned, which the caller surfaces separately;
      // calling it overdue would flag half the register on a data gap.
      overdue: !!(end && today && end < today),
      age_days: created && today ? Math.max(0, Math.round((Date.parse(today) - Date.parse(created)) / 86400000)) : null,
    };
  });
  const byStage = new Map();
  for (const c of list) byStage.set(c.stage, (byStage.get(c.stage) || 0) + 1);
  const order = (s) => { const i = _CHANGE_STAGE_ORDER.indexOf(s); return i === -1 ? _CHANGE_STAGE_ORDER.length : i; };
  const stages = [...byStage.entries()]
    .map(([stage, n]) => ({ stage, n }))
    .sort((a, b) => order(a.stage) - order(b.stage) || a.stage.localeCompare(b.stage));

  // Worst first: overdue, then oldest. That ordering IS the worklist — a
  // creation-order list buries the 15-month-old change under this week's noise.
  list.sort((a, b) => (b.overdue - a.overdue) || ((b.age_days || 0) - (a.age_days || 0)));
  return {
    total: list.length,
    overdue: list.filter(c => c.overdue).length,
    no_planned_end: list.filter(c => !c.scheduled_end).length,
    oldest_days: list.length ? Math.max(...list.map(c => c.age_days || 0)) : null,
    by_stage: stages,
    rows: list,
  };
}

// Pure core — rows already scoped to the site's groups + month. `hours` is the
// created→resolved duration for CLOSED tickets (null otherwise).
function _computeTechStats(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const name = (r.technician || '').trim();
    if (!name) continue;                       // drop the NULL-technician bucket
    if (!by.has(name)) by.set(name, { name, assigned: 0, resolved: 0, current_load: 0, sla_overdue: 0, reopened: 0, _h: [] });
    const t = by.get(name);
    t.assigned++;
    // `r.hours != null` FIRST: +null === 0 and Number.isFinite(0) is true, so a
    // closed ticket with no resolved_time/completed_time would push a phantom
    // 0-hour resolution into the average.
    if (r.pending_status === 0) { t.resolved++; if (r.hours != null && Number.isFinite(+r.hours)) t._h.push(+r.hours); }
    else t.current_load++;
    if (r.overdue_status === 1) t.sla_overdue++;
    if ((r.reopen_count || 0) > 0) t.reopened++;
  }
  return [...by.values()].map(t => {
    const avg = t._h.length ? t._h.reduce((s, x) => s + x, 0) / t._h.length : null;
    delete t._h;
    return { ...t, avg_resolution_h: avg === null ? null : Math.round(avg * 10) / 10 };
  }).sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}

/** getSiteTechnicianStats(site_id, year, month) — group-scoped, per technician. */
function getSiteTechnicianStats(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteTechnicianStatsPg(site_id, year, month);
  const site = db.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT technician, pending_status, overdue_status, reopen_count,
           (julianday(COALESCE(resolved_time, completed_time)) - julianday(created_time)) * 24 AS hours
    FROM request_records
    WHERE tech_group IN (${ph}) AND strftime('%Y-%m', created_time) = ?`).all(...groups, ym);
  return _computeTechStats(rows);
}
// PG fork — NULLIF guards the ''::timestamptz error (same hazard the siblings at
// _getCalendarMonthlyHelpdeskPg / _getSurveyMetricsPg cover). Their WHERE-style
// `col IS NOT NULL AND col!=''` guard is WRONG here: those queries AVG over a set,
// whereas `hours` is a per-row SELECT feeding _computeTechStats, which counts every
// row (assigned/current_load). Filtering '' in the WHERE would silently drop those
// tickets from the technician's counts — sqlite's julianday('') yields NULL and
// KEEPS the row. NULLIF reproduces that: NULL hours, row retained, and
// _computeTechStats already skips `r.hours != null`. Unguarded, one '' row throws
// the whole query and _safe swallows it to [] — a silent zero under PG only.
async function _getSiteTechnicianStatsPg(site_id, year, month) {
  const H = pgHandle();
  const site = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  const groups = String(site?.zoho_group || '').split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const ph = groups.map(() => '?').join(',');
  const rows = await H.prepare(`
    SELECT technician, pending_status, overdue_status, reopen_count,
           EXTRACT(EPOCH FROM (NULLIF(COALESCE(resolved_time, completed_time),'')::timestamptz - NULLIF(created_time,'')::timestamptz))/3600 AS hours
    FROM request_records
    WHERE tech_group IN (${ph}) AND to_char(created_time::timestamptz,'YYYY-MM') = ?`).all(...groups, ym);
  return _computeTechStats(rows);
}

function updateSiteGroup(site_id, zoho_group) {
  if (REPORTS_BACKEND === 'postgres') return _updateSiteGroupPg(site_id, zoho_group);
  db.prepare(`UPDATE sites SET zoho_group=? WHERE id=?`).run(zoho_group || null, site_id);
}
async function _updateSiteGroupPg(site_id, zoho_group) {
  await pgHandle().prepare('UPDATE sites SET zoho_group=? WHERE id=?').run(zoho_group || null, site_id);
}

function createSite({ name, zoho_group, sort_order } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _createSitePg({ name, zoho_group, sort_order });
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60)');

  // If a site already exists with the same name, reactivate it instead of failing UNIQUE
  const existing = db.prepare(`SELECT id, active FROM sites WHERE name = ? COLLATE NOCASE`).get(trimmed);
  if (existing) {
    if (existing.active) throw new Error('site already exists');
    db.prepare(`UPDATE sites SET active=1, zoho_group=COALESCE(?, zoho_group) WHERE id=?`).run(zoho_group || null, existing.id);
    return { id: existing.id, name: trimmed, reactivated: true };
  }

  const order = Number.isFinite(sort_order)
    ? sort_order
    : db.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM sites`).get().n;
  const result = db.prepare(`INSERT INTO sites (name, zoho_group, sort_order, active) VALUES (?, ?, ?, 1)`)
                   .run(trimmed, zoho_group || null, order);
  return { id: result.lastInsertRowid, name: trimmed, zoho_group: zoho_group || null, sort_order: order, active: 1 };
}
// read-then-UPDATE reactivation (NOT INSERT OR REPLACE); .lastID not .lastInsertRowid
async function _createSitePg({ name, zoho_group, sort_order } = {}) {
  const H = pgHandle();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60)');
  const existing = await H.prepare('SELECT id, active FROM sites WHERE lower(name)=lower(?)').get(trimmed);
  if (existing) {
    if (existing.active) throw new Error('site already exists');
    await H.prepare('UPDATE sites SET active=1, zoho_group=COALESCE(?, zoho_group) WHERE id=?').run(zoho_group || null, existing.id);
    return { id: existing.id, name: trimmed, reactivated: true };
  }
  const order = Number.isFinite(sort_order) ? sort_order
    : Number((await H.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM sites').get()).n);
  const result = await H.prepare('INSERT INTO sites (name, zoho_group, sort_order, active) VALUES (?, ?, ?, 1)')
                        .run(trimmed, zoho_group || null, order);
  return { id: result.lastID, name: trimmed, zoho_group: zoho_group || null, sort_order: order, active: 1 };
}

function updateSite(id, { zoho_group, sort_order, active } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _updateSitePg(id, { zoho_group, sort_order, active });
  // Note: `name` is intentionally NOT in the partial-update fields — sites cannot be
  // renamed via this API (Q2 design decision: external integrations may reference by name).
  const cur = db.prepare(`SELECT * FROM sites WHERE id=?`).get(id);
  if (!cur) throw new Error('site not found');

  const updates = [];
  const params  = [];
  if (zoho_group !== undefined) { updates.push('zoho_group=?'); params.push(zoho_group || null); }
  if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
  if (active     !== undefined) { updates.push('active=?');     params.push(active ? 1 : 0); }
  if (!updates.length) return cur;

  params.push(id);
  db.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id=?`).run(...params);
  return db.prepare(`SELECT * FROM sites WHERE id=?`).get(id);
}
async function _updateSitePg(id, { zoho_group, sort_order, active } = {}) {
  const H = pgHandle();
  const cur = await H.prepare('SELECT * FROM sites WHERE id=?').get(id);
  if (!cur) throw new Error('site not found');
  const updates = [], params = [];
  if (zoho_group !== undefined) { updates.push('zoho_group=?'); params.push(zoho_group || null); }
  if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
  if (active     !== undefined) { updates.push('active=?');     params.push(active ? 1 : 0); }
  if (!updates.length) return cur;
  params.push(id);
  await H.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id=?`).run(...params);
  return H.prepare('SELECT * FROM sites WHERE id=?').get(id);
}

function setSiteActive(id, active) {
  if (REPORTS_BACKEND === 'postgres') return _updateSitePg(id, { active: active ? 1 : 0 });
  return updateSite(id, { active: active ? 1 : 0 });
}

// ── REPORT CRUD ───────────────────────────────────────────────────
function ensureReport(site_id, year, week) {
  if (REPORTS_BACKEND === 'postgres') return _ensureReportPg(site_id, year, week);
  const week_id = ensureWeek(year, week);
  const existing = db.prepare(`SELECT * FROM weekly_reports WHERE site_id=? AND week_id=?`).get(site_id, week_id);
  if (existing) return existing;
  const r = db.prepare(`INSERT INTO weekly_reports (site_id, week_id) VALUES (?,?)`).run(site_id, week_id);
  return db.prepare(`SELECT * FROM weekly_reports WHERE id=?`).get(r.lastInsertRowid);
}

function getReport(report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getReportPg(report_id);
  const report = db.prepare(`
    SELECT wr.*, w.year, w.week_number, w.start_date, w.end_date, w.label as week_label,
           s.name as site_name, s.zoho_group
    FROM weekly_reports wr
    JOIN weeks w ON w.id=wr.week_id
    JOIN sites s ON s.id=wr.site_id
    WHERE wr.id=?
  `).get(report_id);
  if (!report) return null;
  report.infra_kpis    = db.prepare(`SELECT * FROM infra_kpis WHERE report_id=? ORDER BY sort_order`).all(report_id);
  report.helpdesk      = db.prepare(`SELECT * FROM helpdesk_data WHERE report_id=?`).get(report_id) || {};
  report.lights        = db.prepare(`SELECT * FROM lights WHERE report_id=? ORDER BY type, sort_order`).all(report_id);
  report.action_items  = db.prepare(`SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order`).all(report_id);
  if (report.helpdesk.sla_violations) {
    try { report.helpdesk.sla_violations = JSON.parse(report.helpdesk.sla_violations); } catch(e) {}
  }
  if (report.helpdesk.group_metrics) {
    try { report.helpdesk.group_metrics = JSON.parse(report.helpdesk.group_metrics); } catch(e) {}
  }
  if (report.helpdesk.all_groups) {
    try { report.helpdesk.all_groups = JSON.parse(report.helpdesk.all_groups); } catch(e) {}
  }
  if (report.helpdesk.chart_data) {
    try { report.helpdesk.chart_data = JSON.parse(report.helpdesk.chart_data); } catch(e) {}
  }
  return report;
}

function listReports(site_id, year, week) {
  if (REPORTS_BACKEND === 'postgres') return _listReportsPg(site_id, year, week);
  let sql = `SELECT wr.id, wr.status, wr.updated_at, wr.submitted_at, w.label as week_label,
             w.year, w.week_number, w.start_date, w.end_date, s.name as site_name, s.zoho_group
             FROM weekly_reports wr
             JOIN weeks w ON w.id=wr.week_id
             JOIN sites s ON s.id=wr.site_id WHERE 1=1`;
  const params = [];
  if (site_id) { sql += ` AND wr.site_id=?`; params.push(site_id); }
  if (year)    { sql += ` AND w.year=?`;     params.push(year); }
  if (week)    { sql += ` AND w.week_number=?`; params.push(week); }
  sql += ` ORDER BY w.year DESC, w.week_number DESC`;
  return db.prepare(sql).all(...params);
}

function saveInfraKpis(report_id, kpis) {
  if (REPORTS_BACKEND === 'postgres') return _saveInfraKpisPg(report_id, kpis);
  return _saveInfraKpisSqlite(report_id, kpis);
}
const _saveInfraKpisSqlite = db.transaction((report_id, kpis) => {
  db.prepare(`DELETE FROM infra_kpis WHERE report_id=?`).run(report_id);
  const ins = db.prepare(`INSERT INTO infra_kpis (report_id,service,kpi,target,status_value,status_color,trend,sort_order) VALUES (?,?,?,?,?,?,?,?)`);
  kpis.forEach((k, i) => ins.run(report_id, k.service, k.kpi, k.target, k.status_value, k.status_color||'green', k.trend||'stable', i));
});
async function _saveInfraKpisPg(report_id, kpis) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    await H.prepare('DELETE FROM infra_kpis WHERE report_id=?').run(report_id);
    let i = 0;
    for (const k of (kpis || [])) {
      await H.prepare('INSERT INTO infra_kpis (report_id,service,kpi,target,status_value,status_color,trend,sort_order) VALUES (?,?,?,?,?,?,?,?)')
        .run(report_id, k.service, k.kpi, k.target, k.status_value, k.status_color||'green', k.trend||'stable', i); i++;
    }
  });
}

// ── OPManager infra availability snapshots (V1a) — dual-backend upsert/read ──
const _INFRA_SNAP_COLS = ['site_id','period_type','period_start','period_end','kpi_family','metric_name',
  'metric_value','target_value','status_color','trend','source','source_view','data_through',
  'device_count','included_device_count','collected_at','raw_json','basis'];
const _INFRA_SNAP_UPSERT =
  `INSERT INTO infra_metric_snapshots (${_INFRA_SNAP_COLS.join(',')}) VALUES (${_INFRA_SNAP_COLS.map(() => '?').join(',')})
   ON CONFLICT(site_id,period_type,period_start,kpi_family,metric_name) DO UPDATE SET
     period_end=excluded.period_end, metric_value=excluded.metric_value, target_value=excluded.target_value,
     status_color=excluded.status_color, trend=excluded.trend, source=excluded.source, source_view=excluded.source_view,
     data_through=excluded.data_through, device_count=excluded.device_count, included_device_count=excluded.included_device_count,
     collected_at=excluded.collected_at, raw_json=excluded.raw_json, basis=excluded.basis`;
const _snapVals = (r) => _INFRA_SNAP_COLS.map(c => (r[c] === undefined ? null : r[c]));
function _snapWhere(f) {
  const w = [], p = [];
  if (f && f.site_id != null)   { w.push('site_id=?');      p.push(f.site_id); }
  if (f && f.period_type)       { w.push('period_type=?');  p.push(f.period_type); }
  if (f && f.kpi_family)        { w.push('kpi_family=?');   p.push(f.kpi_family); }
  if (f && f.period_start)      { w.push('period_start=?'); p.push(f.period_start); }
  if (f && f.metric_name)       { w.push('metric_name=?');  p.push(f.metric_name); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', params: p };
}
function upsertInfraSnapshots(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertInfraSnapshotsPg(rows);
  return _upsertInfraSnapshotsSqlite(rows);
}
const _upsertInfraSnapshotsSqlite = db.transaction((rows) => {
  const st = db.prepare(_INFRA_SNAP_UPSERT);
  for (const r of (rows || [])) st.run(..._snapVals(r));
});
async function _upsertInfraSnapshotsPg(rows) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    for (const r of (rows || [])) await H.prepare(_INFRA_SNAP_UPSERT).run(..._snapVals(r));
  });
}
function getInfraSnapshots(f) {
  if (REPORTS_BACKEND === 'postgres') return _getInfraSnapshotsPg(f);
  return _getInfraSnapshotsSqlite(f);
}
function _getInfraSnapshotsSqlite(f) {
  const { where, params } = _snapWhere(f);
  return db.prepare(`SELECT * FROM infra_metric_snapshots${where} ORDER BY period_start DESC, kpi_family`).all(...params);
}
async function _getInfraSnapshotsPg(f) {
  const { where, params } = _snapWhere(f);
  return pgHandle().prepare(`SELECT * FROM infra_metric_snapshots${where} ORDER BY period_start DESC, kpi_family`).all(...params);
}

// ── Meraki WAN link snapshots (V1b) — per-link (wan1/wan2), archived weekly/monthly.
//    Mirrors the infra_metric_snapshots pattern: composite PK, one shared upsert SQL for
//    both backends (can't desync), dual dispatcher.
const _WAN_SNAP_COLS = ['site_id','sub_site','uplink','period_type','period_start','period_end',
  'availability_pct','status_color','loss_pct_avg','latency_ms_avg','jitter_ms_avg','goodput_avg',
  'status_current','uplink_label','device_serial','network_id','data_through','collected_at','source','raw_json'];
const _WAN_SNAP_UPSERT =
  `INSERT INTO wan_link_snapshots (${_WAN_SNAP_COLS.join(',')}) VALUES (${_WAN_SNAP_COLS.map(() => '?').join(',')})
   ON CONFLICT(site_id,sub_site,uplink,period_type,period_start) DO UPDATE SET
     period_end=excluded.period_end, availability_pct=excluded.availability_pct, status_color=excluded.status_color,
     loss_pct_avg=excluded.loss_pct_avg, latency_ms_avg=excluded.latency_ms_avg, jitter_ms_avg=excluded.jitter_ms_avg,
     goodput_avg=excluded.goodput_avg, status_current=excluded.status_current, uplink_label=excluded.uplink_label,
     device_serial=excluded.device_serial, network_id=excluded.network_id, data_through=excluded.data_through,
     collected_at=excluded.collected_at, source=excluded.source, raw_json=excluded.raw_json`;
const _wanVals = (r) => _WAN_SNAP_COLS.map(c =>
  c === 'sub_site' ? (r.sub_site == null ? '' : r.sub_site) : (r[c] === undefined ? null : r[c]));
function _wanWhere(f) {
  const w = [], p = [];
  if (f && f.site_id != null)  { w.push('site_id=?');      p.push(f.site_id); }
  if (f && f.uplink)           { w.push('uplink=?');       p.push(f.uplink); }
  if (f && f.period_type)      { w.push('period_type=?');  p.push(f.period_type); }
  if (f && f.period_start)     { w.push('period_start=?'); p.push(f.period_start); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', params: p };
}
function upsertWanSnapshots(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertWanSnapshotsPg(rows);
  return _upsertWanSnapshotsSqlite(rows);
}
const _upsertWanSnapshotsSqlite = db.transaction((rows) => {
  const st = db.prepare(_WAN_SNAP_UPSERT);
  for (const r of (rows || [])) st.run(..._wanVals(r));
});
async function _upsertWanSnapshotsPg(rows) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    for (const r of (rows || [])) await H.prepare(_WAN_SNAP_UPSERT).run(..._wanVals(r));
  });
}
function getWanSnapshots(f) {
  if (REPORTS_BACKEND === 'postgres') return _getWanSnapshotsPg(f);
  return _getWanSnapshotsSqlite(f);
}
function _getWanSnapshotsSqlite(f) {
  const { where, params } = _wanWhere(f);
  return db.prepare(`SELECT * FROM wan_link_snapshots${where} ORDER BY period_start DESC, uplink`).all(...params);
}
async function _getWanSnapshotsPg(f) {
  const { where, params } = _wanWhere(f);
  return pgHandle().prepare(`SELECT * FROM wan_link_snapshots${where} ORDER BY period_start DESC, uplink`).all(...params);
}

// ── WAN outages (WAN SLA / ISP chargeback) — one row per detected outage. Composite PK
//    (site_id, sub_site, uplink, detected_start), no surrogate id. Same dual-backend shape
//    as wan_link_snapshots: one shared upsert SQL for both backends, dual dispatcher.
const _WAN_OUTAGE_COLS = ['site_id','sub_site','uplink','isp','circuit_id','detected_start','restored_end',
  'notified_at','duration_s','attribution','attribution_reason','network_id','device_serial','source','raw_json'];
const _WAN_OUTAGE_UPSERT =
  `INSERT INTO wan_outages (${_WAN_OUTAGE_COLS.join(',')}) VALUES (${_WAN_OUTAGE_COLS.map(() => '?').join(',')})
   ON CONFLICT(site_id,sub_site,uplink,detected_start) DO UPDATE SET
     isp=excluded.isp, circuit_id=excluded.circuit_id, restored_end=excluded.restored_end,
     notified_at=excluded.notified_at, duration_s=excluded.duration_s, attribution=excluded.attribution,
     attribution_reason=excluded.attribution_reason, network_id=excluded.network_id,
     device_serial=excluded.device_serial, source=excluded.source, raw_json=excluded.raw_json`;
const _wanOutageVals = (r) => _WAN_OUTAGE_COLS.map(c =>
  c === 'sub_site' ? (r.sub_site == null ? '' : r.sub_site) : (r[c] === undefined ? null : r[c]));
function _wanOutageWhere(f) {
  const w = [], p = [];
  if (f && f.site_id != null) { w.push('site_id=?'); p.push(f.site_id); }
  if (f && f.uplink)          { w.push('uplink=?');  p.push(f.uplink); }
  if (f && f.from)            { w.push('detected_start>=?'); p.push(f.from); }
  if (f && f.to)              { w.push('detected_start<=?'); p.push(f.to); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', params: p };
}
function upsertWanOutage(row) {
  if (REPORTS_BACKEND === 'postgres') return _upsertWanOutagePg(row);
  return _upsertWanOutageSqlite(row);
}
function _upsertWanOutageSqlite(row) {
  return db.prepare(_WAN_OUTAGE_UPSERT).run(..._wanOutageVals(row));
}
async function _upsertWanOutagePg(row) {
  return pgHandle().prepare(_WAN_OUTAGE_UPSERT).run(..._wanOutageVals(row));
}
function getWanOutages(f) {
  if (REPORTS_BACKEND === 'postgres') return _getWanOutagesPg(f);
  return _getWanOutagesSqlite(f);
}
function _getWanOutagesSqlite(f) {
  const { where, params } = _wanOutageWhere(f);
  return db.prepare(`SELECT * FROM wan_outages${where} ORDER BY detected_start`).all(...params);
}
async function _getWanOutagesPg(f) {
  const { where, params } = _wanOutageWhere(f);
  return pgHandle().prepare(`SELECT * FROM wan_outages${where} ORDER BY detected_start`).all(...params);
}
function listOpenWanOutages() {
  if (REPORTS_BACKEND === 'postgres') return _listOpenWanOutagesPg();
  return _listOpenWanOutagesSqlite();
}
function _listOpenWanOutagesSqlite() {
  return db.prepare(`SELECT * FROM wan_outages WHERE restored_end IS NULL ORDER BY detected_start`).all();
}
async function _listOpenWanOutagesPg() {
  return pgHandle().prepare(`SELECT * FROM wan_outages WHERE restored_end IS NULL ORDER BY detected_start`).all();
}
// duration_s is computed in JS (never date math in SQL — the pg-strict trap).
const _WAN_OUTAGE_CLOSE_SQL =
  `UPDATE wan_outages SET restored_end=?, duration_s=?
   WHERE site_id=? AND sub_site=? AND uplink=? AND detected_start=?`;
function _wanOutageCloseArgs(o) {
  const sub = o.sub_site == null ? '' : o.sub_site;
  let dur = null;
  const t0 = Date.parse(o.detected_start), t1 = Date.parse(o.restored_end);
  if (Number.isFinite(t0) && Number.isFinite(t1)) dur = Math.round((t1 - t0) / 1000);
  return [o.restored_end, dur, o.site_id, sub, o.uplink, o.detected_start];
}
function closeWanOutage(o) {
  if (REPORTS_BACKEND === 'postgres') return _closeWanOutagePg(o);
  return _closeWanOutageSqlite(o);
}
function _closeWanOutageSqlite(o) {
  return db.prepare(_WAN_OUTAGE_CLOSE_SQL).run(..._wanOutageCloseArgs(o));
}
async function _closeWanOutagePg(o) {
  return pgHandle().prepare(_WAN_OUTAGE_CLOSE_SQL).run(..._wanOutageCloseArgs(o));
}

// Reconcile a poller-created PROVISIONAL open row (source='meraki_status', restored_end
// IS NULL) up to AUTHORITATIVE event-log values, in place — a targeted UPDATE by a non-PK
// predicate. This legitimately mutates the detected_start PK column via a non-PK WHERE
// (valid on both backends — no FK references it). notified_at is DELIBERATELY not in the
// SET: the poller owns it, so a reconcile must preserve it. Returns the number of rows
// updated (0 → the caller inserts a fresh authoritative row instead). Nightly ingester only.
const _WAN_OUTAGE_RECONCILE_SQL =
  `UPDATE wan_outages SET detected_start=?, restored_end=?, duration_s=?, attribution=?, attribution_reason=?,
       isp=?, circuit_id=?, network_id=?, device_serial=?, source=?
   WHERE site_id=? AND sub_site=? AND uplink=? AND restored_end IS NULL AND source='meraki_status'`;
function _wanOutageReconcileArgs(key, a) {
  const sub = key.sub_site == null ? '' : key.sub_site;
  const g = (v) => (v === undefined ? null : v);
  return [
    g(a.detected_start), g(a.restored_end), g(a.duration_s), g(a.attribution), g(a.attribution_reason),
    g(a.isp), g(a.circuit_id), g(a.network_id), g(a.device_serial), g(a.source),
    key.site_id, sub, key.uplink,
  ];
}
function reconcileProvisionalOutage(key, a) {
  if (REPORTS_BACKEND === 'postgres') return _reconcileProvisionalOutagePg(key, a);
  return _reconcileProvisionalOutageSqlite(key, a);
}
function _reconcileProvisionalOutageSqlite(key, a) {
  return db.prepare(_WAN_OUTAGE_RECONCILE_SQL).run(..._wanOutageReconcileArgs(key, a)).changes;
}
async function _reconcileProvisionalOutagePg(key, a) {
  return (await pgHandle().prepare(_WAN_OUTAGE_RECONCILE_SQL).run(..._wanOutageReconcileArgs(key, a))).changes;
}

function saveHelpdeskData(report_id, data) {
  if (REPORTS_BACKEND === 'postgres') return _saveHelpdeskDataPg(report_id, data);
  const sla = data.sla_violations ? JSON.stringify(data.sla_violations) : null;
  const gm  = data.group_metrics  ? JSON.stringify(data.group_metrics)  : null;
  const ag  = data.all_groups     ? JSON.stringify(data.all_groups)     : null;
  const cd  = data.chart_data     ? JSON.stringify(data.chart_data)     : null;
  db.prepare(`INSERT INTO helpdesk_data
    (report_id,time_to_assign,time_to_assign_prev,first_reply,first_reply_prev,
     resolution_time,resolution_time_prev,closing_time,closing_time_prev,
     comments_metrics,comments_sla,tech_on_break,techs_on_duty,sla_violations,
     group_metrics,all_groups,fetched_at,selected_group,chart_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
    time_to_assign=excluded.time_to_assign, time_to_assign_prev=excluded.time_to_assign_prev,
    first_reply=excluded.first_reply, first_reply_prev=excluded.first_reply_prev,
    resolution_time=excluded.resolution_time, resolution_time_prev=excluded.resolution_time_prev,
    closing_time=excluded.closing_time, closing_time_prev=excluded.closing_time_prev,
    comments_metrics=excluded.comments_metrics, comments_sla=excluded.comments_sla,
    tech_on_break=excluded.tech_on_break, techs_on_duty=excluded.techs_on_duty,
    sla_violations=excluded.sla_violations,
    group_metrics=excluded.group_metrics, all_groups=excluded.all_groups,
    fetched_at=excluded.fetched_at, selected_group=excluded.selected_group,
    chart_data=excluded.chart_data,
    updated_at=datetime('now')`)
  .run(report_id, data.time_to_assign||null, data.time_to_assign_prev||null,
       data.first_reply||null, data.first_reply_prev||null,
       data.resolution_time||null, data.resolution_time_prev||null,
       data.closing_time||null, data.closing_time_prev||null,
       data.comments_metrics||null, data.comments_sla||null,
       data.tech_on_break||null, data.techs_on_duty||null, sla, gm, ag,
       data.fetched_at||null, data.selected_group||null, cd);
}
// Full-column ON CONFLICT replace (no COALESCE) — identical semantics to sqlite.
async function _saveHelpdeskDataPg(report_id, data) {
  const H = pgHandle();
  const sla = data.sla_violations ? JSON.stringify(data.sla_violations) : null;
  const gm  = data.group_metrics  ? JSON.stringify(data.group_metrics)  : null;
  const ag  = data.all_groups     ? JSON.stringify(data.all_groups)     : null;
  const cd  = data.chart_data     ? JSON.stringify(data.chart_data)     : null;
  await H.prepare(`INSERT INTO helpdesk_data
    (report_id,time_to_assign,time_to_assign_prev,first_reply,first_reply_prev,
     resolution_time,resolution_time_prev,closing_time,closing_time_prev,
     comments_metrics,comments_sla,tech_on_break,techs_on_duty,sla_violations,
     group_metrics,all_groups,fetched_at,selected_group,chart_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
    time_to_assign=EXCLUDED.time_to_assign, time_to_assign_prev=EXCLUDED.time_to_assign_prev,
    first_reply=EXCLUDED.first_reply, first_reply_prev=EXCLUDED.first_reply_prev,
    resolution_time=EXCLUDED.resolution_time, resolution_time_prev=EXCLUDED.resolution_time_prev,
    closing_time=EXCLUDED.closing_time, closing_time_prev=EXCLUDED.closing_time_prev,
    comments_metrics=EXCLUDED.comments_metrics, comments_sla=EXCLUDED.comments_sla,
    tech_on_break=EXCLUDED.tech_on_break, techs_on_duty=EXCLUDED.techs_on_duty,
    sla_violations=EXCLUDED.sla_violations,
    group_metrics=EXCLUDED.group_metrics, all_groups=EXCLUDED.all_groups,
    fetched_at=EXCLUDED.fetched_at, selected_group=EXCLUDED.selected_group,
    chart_data=EXCLUDED.chart_data,
    updated_at=now()`)
  .run(report_id, data.time_to_assign||null, data.time_to_assign_prev||null,
       data.first_reply||null, data.first_reply_prev||null,
       data.resolution_time||null, data.resolution_time_prev||null,
       data.closing_time||null, data.closing_time_prev||null,
       data.comments_metrics||null, data.comments_sla||null,
       data.tech_on_break||null, data.techs_on_duty||null, sla, gm, ag,
       data.fetched_at||null, data.selected_group||null, cd);
}

function saveLights(report_id, lights) {
  if (REPORTS_BACKEND === 'postgres') return _saveLightsPg(report_id, lights);
  return _saveLightsSqlite(report_id, lights);
}
const _saveLightsSqlite = db.transaction((report_id, lights) => {
  db.prepare(`DELETE FROM lights WHERE report_id=?`).run(report_id);
  const ins = db.prepare(`INSERT INTO lights (report_id,type,content,sort_order) VALUES (?,?,?,?)`);
  lights.forEach((l, i) => ins.run(report_id, l.type, l.content, i));
});
async function _saveLightsPg(report_id, lights) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    await H.prepare('DELETE FROM lights WHERE report_id=?').run(report_id);
    let i = 0;
    for (const l of (lights || [])) {
      await H.prepare('INSERT INTO lights (report_id,type,content,sort_order) VALUES (?,?,?,?)').run(report_id, l.type, l.content, i); i++;
    }
  });
}

// Returns all non-closed actions from the most recent previous report
// for the same site. Used by the "carry over" button in the weekly report UI.
// Imports: open, in_progress, on_hold, cancelled — excludes: closed only.
function getPreviousWeekOpenActions(site_id, current_report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getPreviousWeekOpenActionsPg(site_id, current_report_id);
  const prev = db.prepare(`
    SELECT wr.id, w.label as week_label
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    WHERE wr.site_id = ? AND wr.id != ?
    ORDER BY w.year DESC, w.week_number DESC
    LIMIT 1
  `).get(site_id, current_report_id);
  if (!prev) return { week_label: null, actions: [] };
  const actions = db.prepare(`
    SELECT task, priority, due_date, owner, status, department, comment, sort_order, uid, source, origin_id, lineage
    FROM action_items
    WHERE report_id = ? AND status != 'closed'
    ORDER BY sort_order
  `).all(prev.id);
  return { week_label: prev.week_label, actions };
}

// Returns a list of all past weeks for the site (excluding current report),
// each with their non-closed action count. Used to populate the week-picker modal.
function listAllWeeksWithActions(site_id, current_report_id) {
  if (REPORTS_BACKEND === 'postgres') return _listAllWeeksWithActionsPg(site_id, current_report_id);
  const weeks = db.prepare(`
    SELECT wr.id as report_id, w.label as week_label, w.year, w.week_number,
           w.start_date, w.end_date,
           COUNT(ai.id) as action_count
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    LEFT JOIN action_items ai ON ai.report_id = wr.id AND ai.status != 'closed'
    WHERE wr.site_id = ? AND wr.id != ?
    GROUP BY wr.id
    ORDER BY w.year DESC, w.week_number DESC
  `).all(site_id, current_report_id);
  return weeks;
}

// Returns all non-closed actions from a specific report_id.
// Used when the user picks a specific week in the week-picker modal.
function getActionsForReport(report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getActionsForReportPg(report_id);
  const meta = db.prepare(`
    SELECT wr.id, w.label as week_label
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    WHERE wr.id = ?
  `).get(report_id);
  if (!meta) return { week_label: null, actions: [] };
  const actions = db.prepare(`
    SELECT task, priority, due_date, owner, status, department, comment, sort_order, uid, source, origin_id, lineage
    FROM action_items
    WHERE report_id = ? AND status != 'closed'
    ORDER BY sort_order
  `).all(report_id);
  return { week_label: meta.week_label, actions };
}

// ── ACTION DEPARTMENTS (action item categories) ──────────────────
// Editable list of department names used by the action items dropdown.
// Soft-delete via active=0; renames don't propagate to historical action_items
// (department is stored as TEXT snapshot, not FK). See spec §3-§4.

function listDepartments({ includeInactive = false } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _listDepartmentsPg({ includeInactive });
  if (includeInactive) {
    return db.prepare(`SELECT id, name, sort_order, active FROM action_departments ORDER BY sort_order, name`).all();
  }
  return db.prepare(`SELECT id, name, sort_order, active FROM action_departments WHERE active=1 ORDER BY sort_order, name`).all();
}
async function _listDepartmentsPg({ includeInactive = false } = {}) {
  const H = pgHandle();
  const sql = includeInactive
    ? 'SELECT id, name, sort_order, active FROM action_departments ORDER BY sort_order, name'
    : 'SELECT id, name, sort_order, active FROM action_departments WHERE active=1 ORDER BY sort_order, name';
  return H.prepare(sql).all();
}

function createDepartment({ name, sort_order } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _createDepartmentPg({ name, sort_order });
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60)');

  // If a row already exists with the same name (case-insensitive), reactivate it instead of failing UNIQUE
  const existing = db.prepare(`SELECT id, active FROM action_departments WHERE name = ? COLLATE NOCASE`).get(trimmed);
  if (existing) {
    if (existing.active) throw new Error('department already exists');
    db.prepare(`UPDATE action_departments SET active=1, updated_at=datetime('now') WHERE id=?`).run(existing.id);
    return { id: existing.id, name: trimmed, reactivated: true };
  }

  const order = Number.isFinite(sort_order)
    ? sort_order
    : db.prepare(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM action_departments`).get().n;
  const result = db.prepare(`INSERT INTO action_departments (name, sort_order) VALUES (?, ?)`).run(trimmed, order);
  return { id: result.lastInsertRowid, name: trimmed, sort_order: order, active: 1 };
}
async function _createDepartmentPg({ name, sort_order } = {}) {
  const H = pgHandle();
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  if (trimmed.length > 60) throw new Error('name too long (max 60)');
  const existing = await H.prepare('SELECT id, active FROM action_departments WHERE lower(name)=lower(?)').get(trimmed);
  if (existing) {
    if (existing.active) throw new Error('department already exists');
    await H.prepare(`UPDATE action_departments SET active=1, updated_at=now() WHERE id=?`).run(existing.id);
    return { id: existing.id, name: trimmed, reactivated: true };
  }
  const order = Number.isFinite(sort_order) ? sort_order
    : Number((await H.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM action_departments').get()).n);
  const result = await H.prepare('INSERT INTO action_departments (name, sort_order) VALUES (?, ?)').run(trimmed, order);
  return { id: result.lastID, name: trimmed, sort_order: order, active: 1 };
}

function updateDepartment(id, { name, sort_order, active } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _updateDepartmentPg(id, { name, sort_order, active });
  const cur = db.prepare(`SELECT * FROM action_departments WHERE id=?`).get(id);
  if (!cur) throw new Error('department not found');

  const updates = [];
  const params  = [];
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('name cannot be empty');
    if (trimmed.length > 60) throw new Error('name too long (max 60)');
    const dup = db.prepare(`SELECT id FROM action_departments WHERE name=? COLLATE NOCASE AND id<>?`).get(trimmed, id);
    if (dup) throw new Error('another department already has this name');
    updates.push('name=?'); params.push(trimmed);
  }
  if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
  if (active     !== undefined) { updates.push('active=?');     params.push(active ? 1 : 0); }
  if (!updates.length) return cur;

  updates.push(`updated_at=datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE action_departments SET ${updates.join(', ')} WHERE id=?`).run(...params);
  return db.prepare(`SELECT * FROM action_departments WHERE id=?`).get(id);
}
async function _updateDepartmentPg(id, { name, sort_order, active } = {}) {
  const H = pgHandle();
  const cur = await H.prepare('SELECT * FROM action_departments WHERE id=?').get(id);
  if (!cur) throw new Error('department not found');
  const updates = [], params = [];
  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('name cannot be empty');
    if (trimmed.length > 60) throw new Error('name too long (max 60)');
    const dup = await H.prepare('SELECT id FROM action_departments WHERE lower(name)=lower(?) AND id<>?').get(trimmed, id);
    if (dup) throw new Error('another department already has this name');
    updates.push('name=?'); params.push(trimmed);
  }
  if (sort_order !== undefined) { updates.push('sort_order=?'); params.push(sort_order); }
  if (active     !== undefined) { updates.push('active=?');     params.push(active ? 1 : 0); }
  if (!updates.length) return cur;
  updates.push('updated_at=now()');
  params.push(id);
  await H.prepare(`UPDATE action_departments SET ${updates.join(', ')} WHERE id=?`).run(...params);
  return H.prepare('SELECT * FROM action_departments WHERE id=?').get(id);
}

function setDepartmentActive(id, active) {
  if (REPORTS_BACKEND === 'postgres') return _updateDepartmentPg(id, { active: active ? 1 : 0 });
  return updateDepartment(id, { active: active ? 1 : 0 });
}

// Returns a list of all past weeks for the site with their lights counts per type.
// Used to populate the week-picker modal for Low/High Lights carry-over.
function listAllWeeksWithLights(site_id, current_report_id) {
  if (REPORTS_BACKEND === 'postgres') return _listAllWeeksWithLightsPg(site_id, current_report_id);
  const weeks = db.prepare(`
    SELECT wr.id as report_id, w.label as week_label, w.year, w.week_number,
           w.start_date, w.end_date,
           COUNT(l.id) as light_count
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    LEFT JOIN lights l ON l.report_id = wr.id
    WHERE wr.site_id = ? AND wr.id != ?
    GROUP BY wr.id
    ORDER BY w.year DESC, w.week_number DESC
  `).all(site_id, current_report_id);
  return weeks;
}

// Returns all lights (low_light + high_light) from a specific report_id.
// Used when the user picks a specific week in the lights week-picker modal.
function getLightsForReport(report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getLightsForReportPg(report_id);
  const meta = db.prepare(`
    SELECT wr.id, w.label as week_label
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    WHERE wr.id = ?
  `).get(report_id);
  if (!meta) return { week_label: null, lights: [] };
  const lights = db.prepare(`
    SELECT type, content, sort_order
    FROM lights
    WHERE report_id = ?
    ORDER BY sort_order
  `).all(report_id);
  return { week_label: meta.week_label, lights };
}

function getPreviousWeekInfraKpis(site_id, current_report_id) {
  if (REPORTS_BACKEND === 'postgres') return _getPreviousWeekInfraKpisPg(site_id, current_report_id);
  const prev = db.prepare(`
    SELECT wr.id, w.label as week_label
    FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id
    WHERE wr.site_id = ? AND wr.id != ?
    ORDER BY w.year DESC, w.week_number DESC
    LIMIT 1
  `).get(site_id, current_report_id);
  if (!prev) return { week_label: null, kpis: [] };
  const kpis = db.prepare(`
    SELECT service, kpi, target, status_value, status_color, trend, sort_order
    FROM infra_kpis
    WHERE report_id = ?
    ORDER BY sort_order
  `).all(prev.id);
  return { week_label: prev.week_label, kpis };
}

// SP1b-lignée — every open, NON-merged report follow-up for a site across ALL
// its reports, deduped by carry-forward lineage (latest week wins), each row
// carrying its own report_id + week_label. Feeds the Site Actions hub so an
// open follow-up on an OLD report never carried forward still surfaces, once.
function _dedupLineage(rows) {
  const best = new Map();
  for (const r of rows) {
    const key = r.lineage || r.uid;
    const cur = best.get(key);
    if (!cur || r._y > cur._y || (r._y === cur._y && r._w > cur._w)) best.set(key, r);
  }
  return [...best.values()].map(r => { const { _y, _w, ...rest } = r; return rest; });
}
// Newest-wins semantics: for each lineage keep only its MOST RECENT row (across
// weeks), then treat the group as open iff that latest row is not terminal. This
// is why the SQL does NOT pre-filter by status — a lineage whose latest entry was
// closed must drop entirely, so an older still-open copy can never resurface.
const _TERMINAL_STATUS = new Set(['closed', 'cancelled']);
function _dedupLineageNewestOpen(rows) {
  const best = new Map();    // lineage -> most-recent row (open-check + canonical)
  const first = new Map();   // lineage -> {y, w} of the EARLIEST week it appeared
  for (const r of rows) {
    const key = r.lineage || r.uid;
    const cur = best.get(key);
    if (!cur || r._y > cur._y || (r._y === cur._y && r._w > cur._w)) best.set(key, r);
    const f = first.get(key);
    if (!f || r._y < f.y || (r._y === f.y && r._w < f.w)) first.set(key, { y: r._y, w: r._w });
  }
  return [...best.entries()]
    .filter(([, r]) => !_TERMINAL_STATUS.has(r.status))
    // keep year/week_number so callers (the merge-cleanup window) can pick the
    // most-recent as canonical without re-parsing week_label. first_logged = the
    // ISO start date of the EARLIEST week in the lineage — the honest "open since"
    // date for age (action_items has no created_at); measured from first appearance,
    // not the latest carry-forward.
    .map(([key, r]) => {
      const { _y, _w, ...rest } = r;
      const f = first.get(key);
      const first_logged = (f && f.y && f.w) ? getWeekRange(f.y, f.w).start : null;
      return { ...rest, year: _y, week_number: _w, first_logged };
    });
}
const _SORA_SQL = `
  SELECT ai.uid, ai.lineage, ai.task, ai.priority, ai.due_date, ai.owner, ai.status,
         ai.department, ai.comment, ai.source, ai.origin_id,
         wr.id AS report_id, w.label AS week_label, w.year AS _y, w.week_number AS _w
  FROM action_items ai
  JOIN weekly_reports wr ON wr.id = ai.report_id
  JOIN weeks w ON w.id = wr.week_id
  WHERE wr.site_id = ? AND ai.source IS NULL`;
function getSiteOpenReportActions(site_id) {
  if (REPORTS_BACKEND === 'postgres') return _getSiteOpenReportActionsPg(site_id);
  return { actions: _dedupLineageNewestOpen(db.prepare(_SORA_SQL).all(site_id)) };
}
async function _getSiteOpenReportActionsPg(site_id) {
  const rows = await pgHandle().prepare(_SORA_SQL).all(site_id);
  return { actions: _dedupLineageNewestOpen(rows) };
}

function saveActionItems(report_id, items) {
  if (REPORTS_BACKEND === 'postgres') return _saveActionItemsPg(report_id, items);
  return _saveActionItemsSqlite(report_id, items);
}
// SP1b — upsert-by-uid (was DELETE-all+INSERT-all). Matches incoming rows to
// existing ones by `uid`: UPDATE the EDITABLE fields in place, INSERT new rows
// (minting a uid), DELETE rows whose uid isn't in the incoming set. It NEVER
// writes `source`/`origin_id` — those are owned by setActionMerge — so a report
// re-save (even from a stale client) can never wipe a merge. Empty incoming →
// delete all. `uid NOT IN (…)` is guarded against the empty list (invalid SQL).
const _saveActionItemsSqlite = db.transaction((report_id, items) => {
  items = items || [];
  const keep = items.filter(a => a.uid).map(a => a.uid);
  if (keep.length) {
    db.prepare(`DELETE FROM action_items WHERE report_id=? AND uid NOT IN (${keep.map(() => '?').join(',')})`).run(report_id, ...keep);
  } else {
    db.prepare(`DELETE FROM action_items WHERE report_id=?`).run(report_id);
  }
  const exists = db.prepare(`SELECT 1 FROM action_items WHERE report_id=? AND uid=?`);
  const upd = db.prepare(`UPDATE action_items SET task=?,priority=?,due_date=?,owner=?,status=?,department=?,comment=?,sort_order=? WHERE report_id=? AND uid=?`);
  // SP3: source/origin_id are written HERE on INSERT (client-set from the import
  // picker) — the UPDATE branch never writes them, so a re-save can't wipe an
  // existing merge/reference (SP1b durability holds).
  const ins = db.prepare(`INSERT INTO action_items (report_id,task,priority,due_date,owner,status,department,comment,sort_order,uid,lineage,source,origin_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  items.forEach((a, i) => {
    if (a.uid && exists.get(report_id, a.uid)) {
      upd.run(a.task, a.priority||'Medium', a.due_date||null, a.owner||null, a.status||'open', a.department||null, a.comment||null, i, report_id, a.uid);
    } else {
      ins.run(report_id, a.task, a.priority||'Medium', a.due_date||null, a.owner||null, a.status||'open', a.department||null, a.comment||null, i, a.uid || crypto.randomUUID(), a.lineage || null, a.source || null, a.origin_id || null);
    }
  });
});
async function _saveActionItemsPg(report_id, items) {
  items = items || [];
  const H = pgHandle();
  await H.runTransaction(async () => {
    const keep = items.filter(a => a.uid).map(a => a.uid);
    if (keep.length) {
      await H.prepare(`DELETE FROM action_items WHERE report_id=? AND uid NOT IN (${keep.map(() => '?').join(',')})`).run(report_id, ...keep);
    } else {
      await H.prepare('DELETE FROM action_items WHERE report_id=?').run(report_id);
    }
    let i = 0;
    for (const a of items) {
      const has = a.uid ? await H.prepare('SELECT 1 FROM action_items WHERE report_id=? AND uid=?').get(report_id, a.uid) : null;
      if (has) {
        await H.prepare('UPDATE action_items SET task=?,priority=?,due_date=?,owner=?,status=?,department=?,comment=?,sort_order=? WHERE report_id=? AND uid=?')
          .run(a.task, a.priority||'Medium', a.due_date||null, a.owner||null, a.status||'open', a.department||null, a.comment||null, i, report_id, a.uid);
      } else {
        await H.prepare('INSERT INTO action_items (report_id,task,priority,due_date,owner,status,department,comment,sort_order,uid,lineage,source,origin_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(report_id, a.task, a.priority||'Medium', a.due_date||null, a.owner||null, a.status||'open', a.department||null, a.comment||null, i, a.uid || crypto.randomUUID(), a.lineage || null, a.source || null, a.origin_id || null);
      }
      i++;
    }
  });
}

// SP1b — merge link writers (the ONLY writers of source/origin_id). A merged
// report follow-up references its Meetings/Inspection twin; the hub folds it
// under the origin. Both dual-backend, keyed by the stable uid.
function setActionMerge(uid, opts) {
  if (REPORTS_BACKEND === 'postgres') return _setActionMergePg(uid, opts);
  const info = db.prepare(`UPDATE action_items SET source=?, origin_id=? WHERE uid=?`).run(opts.source, opts.origin_id, uid);
  return { ok: info.changes > 0 };
}
async function _setActionMergePg(uid, opts) {
  const H = pgHandle();
  const info = await H.prepare('UPDATE action_items SET source=?, origin_id=? WHERE uid=?').run(opts.source, opts.origin_id, uid);
  return { ok: (info.changes || info.rowCount || 0) > 0 };
}
function clearActionMerge(uid) {
  if (REPORTS_BACKEND === 'postgres') return _clearActionMergePg(uid);
  const info = db.prepare(`UPDATE action_items SET source=NULL, origin_id=NULL WHERE uid=?`).run(uid);
  return { ok: info.changes > 0 };
}
async function _clearActionMergePg(uid) {
  const H = pgHandle();
  const info = await H.prepare('UPDATE action_items SET source=NULL, origin_id=NULL WHERE uid=?').run(uid);
  return { ok: (info.changes || info.rowCount || 0) > 0 };
}

// Per-row status change for a report follow-up, keyed by the stable uid — the
// hub's inline status control for the Report section (Meetings/Inspection have
// their own /update endpoints). An UPDATE by uid: it never touches
// source/origin_id/lineage, so a merge/reference/carry-lineage stays intact.
function setActionStatus(uid, status) {
  if (REPORTS_BACKEND === 'postgres') return _setActionStatusPg(uid, status);
  const info = db.prepare(`UPDATE action_items SET status=? WHERE uid=?`).run(status, uid);
  return { ok: info.changes > 0 };
}
// Deliberate merge of an ALREADY-SAVED follow-up into another's carry-forward
// lineage (the per-row "Fusionner avec…" button). Unlike a report re-save (which
// leaves lineage immutable to protect a merge), this is an explicit, editor-driven
// re-lineage. New/unsaved rows set lineage client-side at INSERT and don't need it.
// Optionally also rename the task, so the merge-cleanup window can unify a
// group's divergent labels onto the most-recent (winning) one. `task`
// undefined/null → lineage only (leaves the label untouched).
function setActionLineage(uid, lineage, task) {
  if (REPORTS_BACKEND === 'postgres') return _setActionLineagePg(uid, lineage, task);
  const info = (task == null)
    ? db.prepare(`UPDATE action_items SET lineage=? WHERE uid=?`).run(lineage, uid)
    : db.prepare(`UPDATE action_items SET lineage=?, task=? WHERE uid=?`).run(lineage, task, uid);
  return { ok: info.changes > 0 };
}
async function _setActionLineagePg(uid, lineage, task) {
  const H = pgHandle();
  const info = (task == null)
    ? await H.prepare('UPDATE action_items SET lineage=? WHERE uid=?').run(lineage, uid)
    : await H.prepare('UPDATE action_items SET lineage=?, task=? WHERE uid=?').run(lineage, task, uid);
  return { ok: (info.changes || info.rowCount || 0) > 0 };
}
async function _setActionStatusPg(uid, status) {
  const H = pgHandle();
  const info = await H.prepare('UPDATE action_items SET status=? WHERE uid=?').run(status, uid);
  return { ok: (info.changes || info.rowCount || 0) > 0 };
}

function updateReportStatus(report_id, status, user_id) {
  if (REPORTS_BACKEND === 'postgres') return _updateReportStatusPg(report_id, status, user_id);
  const now = new Date().toISOString();
  const submitted_at = status === 'submitted' ? now : null;
  const submitted_by = status === 'submitted' ? user_id : null;
  db.prepare(`UPDATE weekly_reports SET status=?, submitted_at=?, submitted_by=?, updated_at=? WHERE id=?`)
    .run(status, submitted_at, submitted_by, now, report_id);
}

function deleteReport(id) {
  if (REPORTS_BACKEND === 'postgres') return _deleteReportPg(id);
  return _deleteReportSqlite(id);
}
const _deleteReportSqlite = db.transaction((id) => {
  db.prepare(`DELETE FROM infra_kpis    WHERE report_id=?`).run(id);
  db.prepare(`DELETE FROM helpdesk_data WHERE report_id=?`).run(id);
  db.prepare(`DELETE FROM lights        WHERE report_id=?`).run(id);
  db.prepare(`DELETE FROM action_items  WHERE report_id=?`).run(id);
  db.prepare(`DELETE FROM weekly_reports WHERE id=?`).run(id);
});
// Explicit child deletes inside a tx (mirrors sqlite; not relying on FK CASCADE).
async function _deleteReportPg(id) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    await H.prepare('DELETE FROM infra_kpis    WHERE report_id=?').run(id);
    await H.prepare('DELETE FROM helpdesk_data WHERE report_id=?').run(id);
    await H.prepare('DELETE FROM lights        WHERE report_id=?').run(id);
    await H.prepare('DELETE FROM action_items  WHERE report_id=?').run(id);
    await H.prepare('DELETE FROM weekly_reports WHERE id=?').run(id);
  });
}

// 4D-wiring-2: reassign a report to a new week — tx conflict-check then UPDATE. Returns
// {duplicateReportId} (the occupying report id, or null if reassigned). updated_at is TIMESTAMPTZ
// → now() in pg (matching touchReport/updateReportStatus), datetime('now') in sqlite.
function reassignReportWeek({ reportId, siteId, newWeekId } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _reassignReportWeekPg({ reportId, siteId, newWeekId });
  return _reassignReportWeekSqlite({ reportId, siteId, newWeekId });
}
const _reassignReportWeekSqlite = db.transaction(({ reportId, siteId, newWeekId }) => {
  const dup = db.prepare('SELECT id FROM weekly_reports WHERE site_id=? AND week_id=? AND id!=?').get(siteId, newWeekId, reportId);
  if (dup) return { duplicateReportId: dup.id };
  db.prepare("UPDATE weekly_reports SET week_id=?, updated_at=datetime('now') WHERE id=?").run(newWeekId, reportId);
  return { duplicateReportId: null };
});
async function _reassignReportWeekPg({ reportId, siteId, newWeekId }) {
  const H = pgHandle();
  return await H.runTransaction(async () => {
    const dup = await H.prepare('SELECT id FROM weekly_reports WHERE site_id=? AND week_id=? AND id!=?').get(siteId, newWeekId, reportId);
    if (dup) return { duplicateReportId: dup.id };
    await H.prepare('UPDATE weekly_reports SET week_id=?, updated_at=now() WHERE id=?').run(newWeekId, reportId);
    return { duplicateReportId: null };
  });
}

// 4D-wiring-2: existence check for the refresh-major-incident-udfs diagnostic.
function requestRecordExists(requestId) {
  if (REPORTS_BACKEND === 'postgres') return _requestRecordExistsPg(requestId);
  return !!db.prepare('SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1').get(requestId);
}
async function _requestRecordExistsPg(requestId) {
  return !!(await pgHandle().prepare('SELECT 1 FROM request_records WHERE request_id = ? LIMIT 1').get(requestId));
}

function touchReport(report_id) {
  if (REPORTS_BACKEND === 'postgres') return _touchReportPg(report_id);
  db.prepare(`UPDATE weekly_reports SET updated_at=datetime('now') WHERE id=?`).run(report_id);
}

// ══ Chunk 4C — PostgreSQL forks (REPORTS_BACKEND=postgres) ══════════════════
// sqlite path stays synchronous (returns value); only the pg branch is async.
// getWeekRange/getISOWeek/getPreviousWeek are PURE (no DB) and used as-is.
async function _ensureWeekPg(year, week) {
  const H = pgHandle();
  const existing = await H.prepare('SELECT id FROM weeks WHERE year=? AND week_number=?').get(year, week);
  if (existing) return existing.id;
  const range = getWeekRange(year, week);   // pure, sync
  const r = await H.prepare('INSERT INTO weeks (year, week_number, start_date, end_date, label) VALUES (?,?,?,?,?)')
                   .run(year, week, range.start, range.end, range.label);
  return r.lastID;
}
async function _ensureReportPg(site_id, year, week) {
  const H = pgHandle();
  const week_id = await _ensureWeekPg(year, week);
  const existing = await H.prepare('SELECT * FROM weekly_reports WHERE site_id=? AND week_id=?').get(site_id, week_id);
  if (existing) return existing;
  const r = await H.prepare('INSERT INTO weekly_reports (site_id, week_id) VALUES (?,?)').run(site_id, week_id);
  return H.prepare('SELECT * FROM weekly_reports WHERE id=?').get(r.lastID);
}
async function _getReportPg(report_id) {
  const H = pgHandle();
  const report = await H.prepare(`
    SELECT wr.*, w.year, w.week_number, w.start_date, w.end_date, w.label as week_label,
           s.name as site_name, s.zoho_group
    FROM weekly_reports wr JOIN weeks w ON w.id=wr.week_id JOIN sites s ON s.id=wr.site_id
    WHERE wr.id=?`).get(report_id);
  if (!report) return null;
  report.infra_kpis   = await H.prepare('SELECT * FROM infra_kpis WHERE report_id=? ORDER BY sort_order').all(report_id);
  report.helpdesk     = (await H.prepare('SELECT * FROM helpdesk_data WHERE report_id=?').get(report_id)) || {};
  report.lights       = await H.prepare('SELECT * FROM lights WHERE report_id=? ORDER BY type, sort_order').all(report_id);
  report.action_items = await H.prepare('SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order').all(report_id);
  for (const k of ['sla_violations', 'group_metrics', 'all_groups', 'chart_data']) {
    if (report.helpdesk[k]) { try { report.helpdesk[k] = JSON.parse(report.helpdesk[k]); } catch (e) {} }
  }
  return report;
}
async function _listReportsPg(site_id, year, week) {
  const H = pgHandle();
  let sql = `SELECT wr.id, wr.status, wr.updated_at, wr.submitted_at, w.label as week_label,
             w.year, w.week_number, w.start_date, w.end_date, s.name as site_name, s.zoho_group
             FROM weekly_reports wr JOIN weeks w ON w.id=wr.week_id JOIN sites s ON s.id=wr.site_id WHERE 1=1`;
  const params = [];
  if (site_id) { sql += ' AND wr.site_id=?'; params.push(site_id); }
  if (year)    { sql += ' AND w.year=?';     params.push(year); }
  if (week)    { sql += ' AND w.week_number=?'; params.push(week); }
  sql += ' ORDER BY w.year DESC, w.week_number DESC';
  return H.prepare(sql).all(...params);
}
async function _updateReportStatusPg(report_id, status, user_id) {
  const now = new Date().toISOString();
  const submitted_at = status === 'submitted' ? now : null;
  const submitted_by = status === 'submitted' ? user_id : null;
  await pgHandle().prepare('UPDATE weekly_reports SET status=?, submitted_at=?, submitted_by=?, updated_at=now() WHERE id=?')
    .run(status, submitted_at, submitted_by, report_id);
}
async function _touchReportPg(report_id) {
  await pgHandle().prepare('UPDATE weekly_reports SET updated_at=now() WHERE id=?').run(report_id);
}
async function _getPreviousWeekOpenActionsPg(site_id, current_report_id) {
  const H = pgHandle();
  const prev = await H.prepare(`SELECT wr.id, w.label as week_label FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id WHERE wr.site_id = ? AND wr.id != ?
    ORDER BY w.year DESC, w.week_number DESC LIMIT 1`).get(site_id, current_report_id);
  if (!prev) return { week_label: null, actions: [] };
  const actions = await H.prepare(`SELECT task, priority, due_date, owner, status, department, comment, sort_order, uid, source, origin_id, lineage
    FROM action_items WHERE report_id = ? AND status != 'closed' ORDER BY sort_order`).all(prev.id);
  return { week_label: prev.week_label, actions };
}
async function _listAllWeeksWithActionsPg(site_id, current_report_id) {
  return pgHandle().prepare(`SELECT wr.id as report_id, w.label as week_label, w.year, w.week_number,
    w.start_date, w.end_date, COUNT(ai.id) as action_count
    FROM weekly_reports wr JOIN weeks w ON w.id = wr.week_id
    LEFT JOIN action_items ai ON ai.report_id = wr.id AND ai.status != 'closed'
    WHERE wr.site_id = ? AND wr.id != ? GROUP BY wr.id, w.label, w.year, w.week_number, w.start_date, w.end_date
    ORDER BY w.year DESC, w.week_number DESC`).all(site_id, current_report_id);
}
async function _getActionsForReportPg(report_id) {
  const H = pgHandle();
  const meta = await H.prepare(`SELECT wr.id, w.label as week_label FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id WHERE wr.id = ?`).get(report_id);
  if (!meta) return { week_label: null, actions: [] };
  const actions = await H.prepare(`SELECT task, priority, due_date, owner, status, department, comment, sort_order, uid, source, origin_id, lineage
    FROM action_items WHERE report_id = ? ORDER BY sort_order`).all(report_id);
  return { week_label: meta.week_label, actions };
}
async function _listAllWeeksWithLightsPg(site_id, current_report_id) {
  return pgHandle().prepare(`SELECT wr.id as report_id, w.label as week_label, w.year, w.week_number,
    w.start_date, w.end_date, COUNT(l.id) as light_count
    FROM weekly_reports wr JOIN weeks w ON w.id = wr.week_id
    LEFT JOIN lights l ON l.report_id = wr.id
    WHERE wr.site_id = ? AND wr.id != ? GROUP BY wr.id, w.label, w.year, w.week_number, w.start_date, w.end_date
    ORDER BY w.year DESC, w.week_number DESC`).all(site_id, current_report_id);
}
async function _getLightsForReportPg(report_id) {
  const H = pgHandle();
  const meta = await H.prepare(`SELECT wr.id, w.label as week_label FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id WHERE wr.id = ?`).get(report_id);
  if (!meta) return { week_label: null, lights: [] };
  const lights = await H.prepare('SELECT type, content, sort_order FROM lights WHERE report_id = ? ORDER BY sort_order').all(report_id);
  return { week_label: meta.week_label, lights };
}
async function _getPreviousWeekInfraKpisPg(site_id, current_report_id) {
  const H = pgHandle();
  const prev = await H.prepare(`SELECT wr.id, w.label as week_label FROM weekly_reports wr
    JOIN weeks w ON w.id = wr.week_id WHERE wr.site_id = ? AND wr.id != ?
    ORDER BY w.year DESC, w.week_number DESC LIMIT 1`).get(site_id, current_report_id);
  if (!prev) return { week_label: null, kpis: [] };
  const kpis = await H.prepare(`SELECT service, kpi, target, status_value, status_color, trend, sort_order
    FROM infra_kpis WHERE report_id = ? ORDER BY sort_order`).all(prev.id);
  return { week_label: prev.week_label, kpis };
}

// ── MONTHLY DATA ──────────────────────────────────────────────────
function getMonthlyData(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getMonthlyDataPg(site_id, year, month);
  // Get all weeks that fall within the month
  const weeks = db.prepare(`
    SELECT w.*, wr.id as report_id, wr.status
    FROM weeks w
    LEFT JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
    WHERE (substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?)
    ORDER BY w.week_number
  `).all(site_id, `${year}-${String(month).padStart(2,'0')}`, `${year}-${String(month).padStart(2,'0')}`);

  const reports = weeks
    .filter(w => w.report_id)
    .map(w => getReport(w.report_id));

  // Past months KPI averages (last 6 months)
  const pastMonths = [];
  for (let m = 0; m < 6; m++) {
    const d  = new Date(year, month - 1 - m, 1);
    const py = d.getFullYear();
    const pm = d.getMonth() + 1;
    const pmStr = `${py}-${String(pm).padStart(2,'0')}`;
    const pmWeeks = db.prepare(`
      SELECT wr.id as report_id FROM weeks w
      JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?
    `).all(site_id, pmStr, pmStr);
    if (pmWeeks.length) {
      const pmReports = pmWeeks.map(w => getReport(w.report_id)).filter(Boolean);
      pastMonths.push({ year: py, month: pm, label: d.toLocaleString('en',{month:'short',year:'numeric'}), reports: pmReports });
    }
  }
  // Previous month — for month-over-month timing delta in PPTX Row 2
  const prevD     = new Date(year, month - 2, 1);  // month is 1-based; month-2 gives JS 0-based prev
  const prevYear  = prevD.getFullYear();
  const prevMonth = prevD.getMonth() + 1;

  return {
    weeks,
    reports,
    pastMonths,
    calendar_hd:      getCalendarMonthlyHelpdesk(site_id, year, month),
    prev_calendar_hd: getCalendarMonthlyHelpdesk(site_id, prevYear, prevMonth),
    monthly_top10:    getCalendarMonthlyTop10(site_id, year, month),
    history6m:        getHelpdesk6MonthHistory(site_id, year, month),
  };
}
async function _getMonthlyDataPg(site_id, year, month) {
  const H = pgHandle();
  const mStr = `${year}-${String(month).padStart(2,'0')}`;
  const weeks = await H.prepare(`
    SELECT w.*, wr.id as report_id, wr.status FROM weeks w
    LEFT JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
    WHERE (substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?) ORDER BY w.week_number`).all(site_id, mStr, mStr);
  const reports = (await Promise.all(weeks.filter(w => w.report_id).map(w => getReport(w.report_id)))).filter(Boolean);
  const pastMonths = [];
  for (let m = 0; m < 6; m++) {
    const d = new Date(year, month - 1 - m, 1);
    const py = d.getFullYear(), pm = d.getMonth() + 1;
    const pmStr = `${py}-${String(pm).padStart(2,'0')}`;
    const pmWeeks = await H.prepare(`SELECT wr.id as report_id FROM weeks w
      JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?`).all(site_id, pmStr, pmStr);
    if (pmWeeks.length) {
      const pmReports = (await Promise.all(pmWeeks.map(w => getReport(w.report_id)))).filter(Boolean);
      pastMonths.push({ year: py, month: pm, label: d.toLocaleString('en',{month:'short',year:'numeric'}), reports: pmReports });
    }
  }
  const prevD = new Date(year, month - 2, 1);
  const prevYear = prevD.getFullYear(), prevMonth = prevD.getMonth() + 1;
  return {
    weeks, reports, pastMonths,
    calendar_hd:      await _getCalendarMonthlyHelpdeskPg(site_id, year, month),
    prev_calendar_hd: await _getCalendarMonthlyHelpdeskPg(site_id, prevYear, prevMonth),
    monthly_top10:    await _getCalendarMonthlyTop10Pg(site_id, year, month),
    history6m:        await _getHelpdesk6MonthHistoryPg(site_id, year, month),
  };
}

// ── CALENDAR-BASED MONTHLY HELPDESK (matches Analytics Plus formula) ──────
/**
 * Counts tickets created between day 1 and last day of the month (inclusive)
 * from request_records — the same source Zoho Analytics Plus uses.
 * AP formula: Inbound = COUNT(*), Closed = countif(pending_status=0),
 *             Res SLA OK = countif(overdue_status=0),
 *             1st Reply OK = countif(first_response_overdue='false')
 * Returns null when request_records is empty for this site (data not yet synced).
 */
function getCalendarMonthlyHelpdesk(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getCalendarMonthlyHelpdeskPg(site_id, year, month);
  // zoho_group may be a comma-separated list of Zoho group names (e.g. Exploration has 3).
  // Split and query all groups together using IN (?, ?, ...) — matches server.js behaviour.
  const siteRow = db.prepare(`SELECT zoho_group FROM sites WHERE id=?`).get(site_id);
  if (!siteRow || !siteRow.zoho_group) return null;
  const groups = siteRow.zoho_group.split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return null;

  // Build IN clause placeholders: (?, ?, ...)
  const inClause = groups.map(() => '?').join(',');

  // First and last day of the month
  const from  = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastD = new Date(year, month, 0);   // day 0 of next month = last day of this month
  const to    = `${lastD.getFullYear()}-${String(lastD.getMonth()+1).padStart(2,'0')}-${String(lastD.getDate()).padStart(2,'0')}`;

  // All queries: [...groups, from, to] as params
  const gft = [...groups, from, to];

  const total  = db.prepare(`SELECT COUNT(*) as n FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=?`).get(...gft).n;
  if (!total) return { inbound:0, closed:0, close_pct:0, sla_res_pct:null, sla_reply_pct:null, source:'calendar' };

  const closed         = db.prepare(`SELECT COUNT(*) as n FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND pending_status=0`).get(...gft).n;
  // 2026-06-02 ITSM-alignment (FORMULA_RECONCILIATION.md §6 D2): SLA% denominator
  // is closed (verdict rendered), not all incoming. Numerator is closed AND not
  // overdue. AP `(overdue_status=0)/total` previously here was inflated by
  // open-not-yet-due tickets counted as "compliant".
  const slaResOkClosed = db.prepare(`SELECT COUNT(*) as n FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND pending_status=0 AND overdue_status=0`).get(...gft).n;
  // FRT (§6 D3): denominator is responded (responded_time set). Already mostly
  // correct via rplyTotal (counts rows where first_response_overdue is set
  // which closely tracks responded_time) — tighten numerator to also gate on
  // responded_time being present so any row with field='false' but no actual
  // response (rare edge case) doesn't inflate numerator.
  const rplyOk    = db.prepare(`SELECT COUNT(*) as n FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND responded_time IS NOT NULL AND responded_time!='' AND LOWER(first_response_overdue)='false'`).get(...gft).n;
  const rplyTotal = db.prepare(`SELECT COUNT(*) as n FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND responded_time IS NOT NULL AND responded_time!=''`).get(...gft).n;

  // Timing averages — computed from same date range so they match the monthly totals
  // avg_tta_h:           hours from created_time → assigned_time  (tickets with assigned_time set)
  // avg_first_reply_h:   hours from created_time → responded_time (tickets with responded_time set)
  // avg_resolution_d:    days  from created_time → resolved/completed (closed tickets)
  const avgTtaRow  = db.prepare(`SELECT AVG((julianday(assigned_time)-julianday(created_time))*24) as v FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND assigned_time IS NOT NULL AND assigned_time!=''`).get(...gft);
  const avgFrRow   = db.prepare(`SELECT AVG((julianday(responded_time)-julianday(created_time))*24) as v FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND responded_time IS NOT NULL AND responded_time!=''`).get(...gft);
  const avgRtRow   = db.prepare(`SELECT AVG((julianday(COALESCE(resolved_time,completed_time))-julianday(created_time))) as v FROM request_records WHERE tech_group IN (${inClause}) AND date(created_time)>=? AND date(created_time)<=? AND COALESCE(resolved_time,completed_time) IS NOT NULL`).get(...gft);

  return {
    inbound:           total,
    closed,
    close_pct:         Math.round(closed / total * 100),
    // 2026-06-02 ITSM: SLA% = closed-and-not-overdue / closed. NULL when no
    // tickets in the period have a verdict yet (pure open backlog or empty).
    sla_res_pct:       closed > 0 ? Math.round(slaResOkClosed / closed * 100) : null,
    sla_reply_pct:     rplyTotal > 0 ? Math.round(rplyOk / rplyTotal * 100) : null,
    avg_tta_h:         avgTtaRow.v  != null ? Math.round(avgTtaRow.v)  : null,
    avg_first_reply_h: avgFrRow.v   != null ? Math.round(avgFrRow.v)   : null,
    avg_resolution_d:  avgRtRow.v   != null ? Math.round(avgRtRow.v)   : null,
    source:            'calendar',
    from,
    to,
  };
}

// ── MONTHLY SLA VIOLATION TOP-10 (full month, by category) ──────
/**
 * Returns top violation categories for the full calendar month,
 * using the same date range and group filter as getCalendarMonthlyHelpdesk.
 * Each entry: { category, violations, pct }
 *   violations = count of tickets with overdue_status=1
 *   pct        = violations / total tickets in that category × 100
 */
function getCalendarMonthlyTop10(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getCalendarMonthlyTop10Pg(site_id, year, month);
  const siteRow = db.prepare(`SELECT zoho_group FROM sites WHERE id=?`).get(site_id);
  if (!siteRow || !siteRow.zoho_group) return [];
  const groups = siteRow.zoho_group.split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const inClause = groups.map(() => '?').join(',');

  const from  = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastD = new Date(year, month, 0);
  const to    = `${lastD.getFullYear()}-${String(lastD.getMonth()+1).padStart(2,'0')}-${String(lastD.getDate()).padStart(2,'0')}`;
  const gft   = [...groups, from, to];

  // Per-category: count all tickets and violated tickets in the month
  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(category),''), 'Uncategorised') AS category,
      COUNT(*) AS total,
      SUM(CASE WHEN overdue_status=1 THEN 1 ELSE 0 END) AS violations
    FROM request_records
    WHERE tech_group IN (${inClause})
      AND date(created_time)>=?
      AND date(created_time)<=?
    GROUP BY category
    HAVING violations > 0
    ORDER BY violations DESC, total DESC
    LIMIT 10
  `).all(...gft);

  return rows.map(r => ({
    category:   r.category,
    violations: r.violations,
    pct:        Math.round(r.violations / r.total * 100),
  }));
}

// ── Chunk 4D-2a pg forks (calendar) ─────────────────────────────────────────
// Dialect: date(x)>=? → x::date>=?::date; julianday duration → EXTRACT(EPOCH …)/3600|/86400;
// GROUP BY category → GROUP BY 1 (sqlite binds the COALESCE alias; pg the raw col).
async function _getCalendarMonthlyHelpdeskPg(site_id, year, month) {
  const H = pgHandle();
  const siteRow = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  if (!siteRow || !siteRow.zoho_group) return null;
  const groups = siteRow.zoho_group.split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return null;
  const inClause = groups.map(() => '?').join(',');
  const from  = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastD = new Date(year, month, 0);
  const to    = `${lastD.getFullYear()}-${String(lastD.getMonth()+1).padStart(2,'0')}-${String(lastD.getDate()).padStart(2,'0')}`;
  const gft = [...groups, from, to];
  const DR = `tech_group IN (${inClause}) AND created_time::date>=?::date AND created_time::date<=?::date`;
  const total = (await H.prepare(`SELECT COUNT(*) as n FROM request_records WHERE ${DR}`).get(...gft)).n;
  if (!total) return { inbound:0, closed:0, close_pct:0, sla_res_pct:null, sla_reply_pct:null, source:'calendar' };
  const closed         = (await H.prepare(`SELECT COUNT(*) as n FROM request_records WHERE ${DR} AND pending_status=0`).get(...gft)).n;
  const slaResOkClosed = (await H.prepare(`SELECT COUNT(*) as n FROM request_records WHERE ${DR} AND pending_status=0 AND overdue_status=0`).get(...gft)).n;
  const rplyOk    = (await H.prepare(`SELECT COUNT(*) as n FROM request_records WHERE ${DR} AND responded_time IS NOT NULL AND responded_time!='' AND LOWER(first_response_overdue)='false'`).get(...gft)).n;
  const rplyTotal = (await H.prepare(`SELECT COUNT(*) as n FROM request_records WHERE ${DR} AND responded_time IS NOT NULL AND responded_time!=''`).get(...gft)).n;
  const avgTtaRow = await H.prepare(`SELECT AVG(EXTRACT(EPOCH FROM (assigned_time::timestamptz - created_time::timestamptz))/3600) as v FROM request_records WHERE ${DR} AND assigned_time IS NOT NULL AND assigned_time!=''`).get(...gft);
  const avgFrRow  = await H.prepare(`SELECT AVG(EXTRACT(EPOCH FROM (responded_time::timestamptz - created_time::timestamptz))/3600) as v FROM request_records WHERE ${DR} AND responded_time IS NOT NULL AND responded_time!=''`).get(...gft);
  const avgRtRow  = await H.prepare(`SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_time,completed_time)::timestamptz - created_time::timestamptz))/86400) as v FROM request_records WHERE ${DR} AND COALESCE(resolved_time,completed_time) IS NOT NULL`).get(...gft);
  return {
    inbound: total, closed,
    close_pct: Math.round(closed / total * 100),
    sla_res_pct:   closed > 0 ? Math.round(slaResOkClosed / closed * 100) : null,
    sla_reply_pct: rplyTotal > 0 ? Math.round(rplyOk / rplyTotal * 100) : null,
    avg_tta_h:         avgTtaRow.v  != null ? Math.round(avgTtaRow.v)  : null,
    avg_first_reply_h: avgFrRow.v   != null ? Math.round(avgFrRow.v)   : null,
    avg_resolution_d:  avgRtRow.v   != null ? Math.round(avgRtRow.v)   : null,
    source: 'calendar', from, to,
  };
}
async function _getCalendarMonthlyTop10Pg(site_id, year, month) {
  const H = pgHandle();
  const siteRow = await H.prepare('SELECT zoho_group FROM sites WHERE id=?').get(site_id);
  if (!siteRow || !siteRow.zoho_group) return [];
  const groups = siteRow.zoho_group.split(',').map(g => g.trim()).filter(Boolean);
  if (!groups.length) return [];
  const inClause = groups.map(() => '?').join(',');
  const from  = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastD = new Date(year, month, 0);
  const to    = `${lastD.getFullYear()}-${String(lastD.getMonth()+1).padStart(2,'0')}-${String(lastD.getDate()).padStart(2,'0')}`;
  const gft   = [...groups, from, to];
  const rows = await H.prepare(`
    SELECT COALESCE(NULLIF(TRIM(category),''), 'Uncategorised') AS category,
           COUNT(*) AS total, SUM(CASE WHEN overdue_status=1 THEN 1 ELSE 0 END) AS violations
    FROM request_records
    WHERE tech_group IN (${inClause}) AND created_time::date>=?::date AND created_time::date<=?::date
    GROUP BY 1 HAVING SUM(CASE WHEN overdue_status=1 THEN 1 ELSE 0 END) > 0
    ORDER BY violations DESC, total DESC LIMIT 10`).all(...gft);
  return rows.map(r => ({ category: r.category, violations: r.violations, pct: Math.round(r.violations / r.total * 100) }));
}

// ── 6-MONTH HELPDESK HISTORY (for monthly PPTX combo chart) ─────
/**
 * Returns an array of up to 6 monthly helpdesk aggregates ordered oldest → newest,
 * ending with the given (year, month).  Each entry:
 *   { label, inbound, closed, res_sla_pct, reply_sla_pct }
 *
 * Primary source: getCalendarMonthlyHelpdesk (request_records — matches Zoho AP).
 * Fallback: sum weekly chart_data rows stored in helpdesk_data.
 */
// ── ALL-GROUPS / ALL-SITES MONTHLY HELPDESK HISTORY ───────────────────────
/**
 * Returns the last N calendar months of helpdesk metrics aggregated across
 * every group + every site in request_records. Used by the org-wide
 * /api/data/monthly-summary endpoint that feeds the executive dashboard
 * "Tickets This Month" KPI + monthly trend chart.
 *
 * Why this exists: that endpoint used to call Zoho's prebuilt view 644288
 * live on every page load. The view's date-label format drifted, breaking
 * the prev-month label match in executive.html. Sourcing from request_records
 * gives a stable shape we control end-to-end.
 *
 * Months are returned chronologically (oldest first → newest last) so the
 * caller can simply read the last entry as "current month".
 *
 * Shape of each row matches the Zoho prebuilt view 644288 columns the
 * frontend already knows how to parse:
 *   { 'Created Time': 'Mar 2026',
 *     'Requests':                            <inbound count>,
 *     'Closed Requests Count':               <closed count>,
 *     '% of SLA Violated':                   <0..100 number>,
 *     '% of First Responses SLA Violated':   <0..100 number> }
 */
function getMonthlyHelpdeskHistory(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getMonthlyHelpdeskHistoryPg(monthsBack);
  const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const today = new Date();
  const rows = [];
  for (let ago = monthsBack - 1; ago >= 0; ago--) {
    const d  = new Date(today.getFullYear(), today.getMonth() - ago, 1);
    const yr = d.getFullYear();
    const mo = d.getMonth() + 1;       // 1-12
    const start = `${yr}-${String(mo).padStart(2, '0')}-01`;
    // Last day of month: day 0 of next month
    const last  = new Date(yr, mo, 0).getDate();
    const end   = `${yr}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;

    const params = [start, end];
    // ALL groups, ALL sites — no filtering. Per user spec (Q2 = b).
    const total       = db.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE date(created_time) >= ? AND date(created_time) <= ?`).get(...params).n;
    const closed      = db.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE date(created_time) >= ? AND date(created_time) <= ? AND pending_status = 0`).get(...params).n;
    // 2026-06-02 ITSM-alignment (FORMULA_RECONCILIATION.md §6 D2):
    // SLA violation rate denominator = closed (verdict-rendered), not all
    // incoming. Open-but-not-yet-due tickets shouldn't dilute the ratio.
    const slaViolClosed = db.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE date(created_time) >= ? AND date(created_time) <= ? AND pending_status = 0 AND overdue_status = 1`).get(...params).n;
    // 1st reply violated: count rows where first_response_overdue='true' AND responded.
    // Denominator (replyTotal) tightened to responded_time present — was looser before
    // (checked first_response_overdue IS NOT NULL which silently included open-without-reply).
    const replyViol   = db.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE date(created_time) >= ? AND date(created_time) <= ? AND responded_time IS NOT NULL AND responded_time != '' AND LOWER(first_response_overdue) = 'true'`).get(...params).n;
    const replyTotal  = db.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE date(created_time) >= ? AND date(created_time) <= ? AND responded_time IS NOT NULL AND responded_time != ''`).get(...params).n;

    rows.push({
      'Created Time':                       `${MN[mo]} ${yr}`,        // "Mar 2026"
      'Requests':                            total,
      'Closed Requests Count':               closed,
      // ITSM-aligned: SLA violations % is computed against the closed (verdict)
      // population and FRT against the responded population. Column names
      // preserved for executive.html consumer compatibility.
      '% of SLA Violated':                   closed     > 0 ? Math.round(slaViolClosed / closed     * 1000) / 10 : 0,
      '% of First Responses SLA Violated':   replyTotal > 0 ? Math.round(replyViol     / replyTotal * 1000) / 10 : 0,
    });
  }
  return rows;
}
async function _getMonthlyHelpdeskHistoryPg(monthsBack = 12) {
  const H = pgHandle();
  const MN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const today = new Date();
  const rows = [];
  const DR = `created_time::date >= ?::date AND created_time::date <= ?::date`;
  for (let ago = monthsBack - 1; ago >= 0; ago--) {
    const d  = new Date(today.getFullYear(), today.getMonth() - ago, 1);
    const yr = d.getFullYear(), mo = d.getMonth() + 1;
    const start = `${yr}-${String(mo).padStart(2,'0')}-01`;
    const last  = new Date(yr, mo, 0).getDate();
    const end   = `${yr}-${String(mo).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    const params = [start, end];
    const total       = (await H.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE ${DR}`).get(...params)).n;
    const closed      = (await H.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE ${DR} AND pending_status = 0`).get(...params)).n;
    const slaViolClosed = (await H.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE ${DR} AND pending_status = 0 AND overdue_status = 1`).get(...params)).n;
    const replyViol   = (await H.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE ${DR} AND responded_time IS NOT NULL AND responded_time != '' AND LOWER(first_response_overdue) = 'true'`).get(...params)).n;
    const replyTotal  = (await H.prepare(`SELECT COUNT(*) AS n FROM request_records WHERE ${DR} AND responded_time IS NOT NULL AND responded_time != ''`).get(...params)).n;
    rows.push({
      'Created Time': `${MN[mo]} ${yr}`,
      'Requests': total,
      'Closed Requests Count': closed,
      '% of SLA Violated':                 closed     > 0 ? Math.round(slaViolClosed / closed     * 1000) / 10 : 0,
      '% of First Responses SLA Violated': replyTotal > 0 ? Math.round(replyViol     / replyTotal * 1000) / 10 : 0,
    });
  }
  return rows;
}

// ── MAJOR INCIDENTS HISTORY (DB-sourced) ──────────────────────────────────
/**
 * Returns the last N calendar months of MAJOR incidents from request_records.
 * Filter: request_type contains 'Major' (case-insensitive). Replaces a live
 * call to Zoho prebuilt view 790842 (/api/data/major-incidents). The basic
 * fields the executive page consumes (counts, status, dates, site, group,
 * subject, time-to-resolve) are all present.
 *
 * UDF fields (Root Cause Analysis, Corrective Action, Lessons Learned,
 * Preventive Measures, Workaround Details, PIR Required) are populated from
 * the udf_json column, which is filled by the secondary MAJOR_INCIDENTS
 * (790842) backfill step in zoho-sync.js — the base REQUEST_TABLE view
 * doesn't return UDF columns. UDF keys preserve their exact Zoho naming
 * (including the "UDF:" prefix and trailing-space quirks) so the executive
 * page client code can read them directly.
 *
 * Row shape matches the columns the existing client code reads (see
 * executive.html line ~2958).
 */
// ── Downtime formatter — server-side mirror of public/lib/dashboard-shared.js
// ── Rules (keep in sync with the JSDoc in dashboard-shared.js):
//      null/NaN     → '—'
//      0            → '0h'
//      0 <  h <  1  → 'Nm'        (sub-hour, minutes)
//      1 <= h <  48 → 'N.Nh'/'Nh' (one decimal, dropped when whole)
//      h >= 48      → 'Nd Mh'/'Nd' (days + remainder, hours omitted when 0)
function fmtDowntime(hours) {
  if (hours == null) return '—';
  const h = parseFloat(hours);
  if (isNaN(h)) return '—';
  if (h === 0) return '0h';
  if (h < 0)  return '—';
  if (h < 1)  return Math.round(h * 60) + 'm';
  if (h < 48) {
    const rounded = Math.round(h * 10) / 10;
    return (Math.round(h) === rounded ? Math.round(h) : rounded) + 'h';
  }
  const days = Math.floor(h / 24);
  const remH = Math.round(h - days * 24);
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

// ──────────────────────────────────────────────────────────────────────
// EXECUTIVE SCORECARD HELPERS (DB-direct, replaces live Zoho proxy)
// ──────────────────────────────────────────────────────────────────────
// These four helpers feed the executive.html sections that were stuck
// on "Loading from Analytics Plus…" because the live Zoho proxy was
// slow / empty / 400-ing. Each computes the same shape the legacy
// endpoint returned, so the frontend chart code doesn't need changes.
// Source data is already-synced request_records / survey_results.
//
// Pattern matches getMajorIncidentsHistory (line ~1400) and
// getChangeRecordsHistory (line ~1450) — both DB-direct since branch
// busy-kirch-2a4176.
//
// Added 2026-05-26 to land Phase 1+2 of the executive.html rewrite
// for the four specifically-broken sections the field user flagged:
//   1. Ageing Backlog by Site         → getAgeingBySiteDB()
//   2. Ageing Backlog by IT Group     → getAgeingByGroupDB()
//   3. First Reply Time Trend         → getFirstResponseTrendDB()
//   4. Customer Voice (CSAT/NPS)      → getCustomerVoiceDB()

/**
 * Ageing buckets by site — open tickets grouped by how long they've
 * been waiting. Used by executive.html "Ageing Backlog by Site" table.
 *
 * Returns rows shaped like the legacy /api/data/ageing-by-site response:
 *   [{ site, d0, d31, d46, d60, total }, …]
 *
 * Buckets in DAYS from created_time to now (today's date):
 *   d0   = 0-30 days
 *   d31  = 31-45 days
 *   d46  = 46-60 days
 *   d60  = over 60 days
 *
 * Only counts OPEN tickets (pending_status = 1). Skips empty / "-no
 * value-" sites that the source data sometimes carries through. Sorted
 * by total descending so the biggest backlog sites appear first.
 */
function getAgeingBySiteDB() {
  if (REPORTS_BACKEND === 'postgres') return _getAgeingBySiteDBPg();
  const rows = db.prepare(`
    SELECT site,
           SUM(CASE WHEN age_days <=  30                  THEN 1 ELSE 0 END) AS d0,
           SUM(CASE WHEN age_days >   30 AND age_days<=45 THEN 1 ELSE 0 END) AS d31,
           SUM(CASE WHEN age_days >   45 AND age_days<=60 THEN 1 ELSE 0 END) AS d46,
           SUM(CASE WHEN age_days >   60                  THEN 1 ELSE 0 END) AS d60,
           COUNT(*) AS total
    FROM (
      SELECT site,
             CAST((julianday('now') - julianday(created_time)) AS INTEGER) AS age_days
      FROM request_records
      WHERE pending_status = 1
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND site IS NOT NULL
        AND TRIM(site) != ''
        AND LOWER(TRIM(site)) NOT IN ('-no value-', '-no value', 'no value', '(blank)')
        AND created_time IS NOT NULL
    )
    GROUP BY site
    HAVING total > 0
    ORDER BY total DESC, site ASC
  `).all();
  return _mapAgeingSite(rows);
}
// PG fork — CAST(julianday-days AS INTEGER) → TRUNC(EXTRACT-EPOCH/86400)::integer (sqlite
// CAST truncates; pg CAST rounds). HAVING output-alias → HAVING COUNT(*) (pg forbids alias).
// Derived table aliased `q` (pg requires it).
async function _getAgeingBySiteDBPg() {
  const rows = await pgHandle().prepare(`
    SELECT site,
           SUM(CASE WHEN age_days <=  30                  THEN 1 ELSE 0 END) AS d0,
           SUM(CASE WHEN age_days >   30 AND age_days<=45 THEN 1 ELSE 0 END) AS d31,
           SUM(CASE WHEN age_days >   45 AND age_days<=60 THEN 1 ELSE 0 END) AS d46,
           SUM(CASE WHEN age_days >   60                  THEN 1 ELSE 0 END) AS d60,
           COUNT(*) AS total
    FROM (
      SELECT site,
             TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer AS age_days
      FROM request_records
      WHERE pending_status = 1
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND site IS NOT NULL
        AND TRIM(site) != ''
        AND LOWER(TRIM(site)) NOT IN ('-no value-', '-no value', 'no value', '(blank)')
        AND created_time IS NOT NULL
    ) q
    GROUP BY site
    HAVING COUNT(*) > 0
    ORDER BY total DESC, site COLLATE "C" ASC
  `).all();
  return _mapAgeingSite(rows);
}
function _mapAgeingSite(rows) {
  return rows.map(r => ({
    site:  r.site,
    d0:    r.d0   || 0,
    d31:   r.d31  || 0,
    d46:   r.d46  || 0,
    d60:   r.d60  || 0,
    total: r.total || 0,
  }));
}

/**
 * Ageing buckets by IT group — same as getAgeingBySiteDB but grouped on
 * tech_group, and additionally surfaces FRT SLA % per group (the
 * fraction of open tickets whose first response wasn't overdue).
 *
 * Used by executive.html "Ageing Backlog by IT Group" table.
 *
 * Returns rows shaped like the legacy /api/data/ageing-by-group:
 *   [{ group, t0_30, t31_45, t46_60, tOver60, total, slaPct }, …]
 *
 * slaPct = % of OPEN tickets where first_response_overdue != 'true'.
 * Rendered next to the group name in the executive.html table.
 */
function getAgeingByGroupDB() {
  if (REPORTS_BACKEND === 'postgres') return _getAgeingByGroupDBPg();
  const rows = db.prepare(`
    SELECT tech_group AS grp,
           SUM(CASE WHEN age_days <=  30                  THEN 1 ELSE 0 END) AS t0_30,
           SUM(CASE WHEN age_days >   30 AND age_days<=45 THEN 1 ELSE 0 END) AS t31_45,
           SUM(CASE WHEN age_days >   45 AND age_days<=60 THEN 1 ELSE 0 END) AS t46_60,
           SUM(CASE WHEN age_days >   60                  THEN 1 ELSE 0 END) AS tOver60,
           COUNT(*) AS total,
           SUM(CASE WHEN frt_ok = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0) AS sla_pct
    FROM (
      SELECT tech_group,
             CAST((julianday('now') - julianday(created_time)) AS INTEGER) AS age_days,
             CASE WHEN LOWER(TRIM(COALESCE(first_response_overdue,''))) IN ('true','yes','1')
                  THEN 0 ELSE 1 END AS frt_ok
      FROM request_records
      WHERE pending_status = 1
        -- defence-in-depth: a ticket is open only if its Request Status is not
        -- terminal (mirrors the browser isClosed). Guards against a stale/corrupt
        -- pending_status marking closed tickets as open (July-2026 PG diagnosis).
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND tech_group IS NOT NULL
        AND TRIM(tech_group) != ''
        AND created_time IS NOT NULL
    )
    GROUP BY grp
    HAVING total > 0
    ORDER BY total DESC, grp ASC
  `).all();
  return _mapAgeingGroup(rows);
}
// PG fork — same TRUNC-days + HAVING COUNT(*) rewrites; `sla_pct` 100.0 literal is numeric
// so the division resolves natively; derived table aliased `q`.
async function _getAgeingByGroupDBPg() {
  const rows = await pgHandle().prepare(`
    SELECT tech_group AS grp,
           SUM(CASE WHEN age_days <=  30                  THEN 1 ELSE 0 END) AS t0_30,
           SUM(CASE WHEN age_days >   30 AND age_days<=45 THEN 1 ELSE 0 END) AS t31_45,
           SUM(CASE WHEN age_days >   45 AND age_days<=60 THEN 1 ELSE 0 END) AS t46_60,
           SUM(CASE WHEN age_days >   60                  THEN 1 ELSE 0 END) AS "tOver60",
           COUNT(*) AS total,
           SUM(CASE WHEN frt_ok = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0) AS sla_pct
    FROM (
      SELECT tech_group,
             TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer AS age_days,
             CASE WHEN LOWER(TRIM(COALESCE(first_response_overdue,''))) IN ('true','yes','1')
                  THEN 0 ELSE 1 END AS frt_ok
      FROM request_records
      WHERE pending_status = 1
        -- defence-in-depth: a ticket is open only if its Request Status is not
        -- terminal (mirrors the browser isClosed). Guards against a stale/corrupt
        -- pending_status marking closed tickets as open (July-2026 PG diagnosis).
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND tech_group IS NOT NULL
        AND TRIM(tech_group) != ''
        AND created_time IS NOT NULL
    ) q
    GROUP BY grp
    HAVING COUNT(*) > 0
    ORDER BY total DESC, tech_group COLLATE "C" ASC
  `).all();
  return _mapAgeingGroup(rows);
}
function _mapAgeingGroup(rows) {
  return rows.map(r => ({
    group:    r.grp,
    t0_30:    r.t0_30   || 0,
    t31_45:   r.t31_45  || 0,
    t46_60:   r.t46_60  || 0,
    tOver60:  r.tOver60 || 0,
    total:    r.total   || 0,
    slaPct:   r.sla_pct == null ? null : Math.round(r.sla_pct * 10) / 10,
  }));
}

/**
 * First-response (and resolution) trend over the last N months.
 * Used by executive.html "First Reply Time Trend" chart.
 *
 * Returns rows: [{ month, avgFRT, avgRT, n }, …] sorted by month asc.
 *   month   — "Apr 2026" style label
 *   avgFRT  — mean first-response time in HOURS, rounded to 1 decimal
 *   avgRT   — mean resolution time in DAYS, rounded to 1 decimal
 *   n       — number of tickets that contributed (responded + resolved)
 *
 * Uses created_time → responded_time for FRT, created_time → resolved_time
 * for RT. Caps single-ticket RT at 365 days defensively to keep one
 * stuck ticket from blowing the monthly mean.
 */
function getFirstResponseTrendDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getFirstResponseTrendDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_time) AS yyyymm,
           AVG(CASE WHEN responded_time IS NOT NULL AND responded_time > created_time
                    THEN (julianday(responded_time) - julianday(created_time)) * 24
                    END) AS avg_frt_hrs,
           AVG(CASE WHEN resolved_time IS NOT NULL AND resolved_time > created_time
                         AND (julianday(resolved_time) - julianday(created_time)) <= 365
                    THEN (julianday(resolved_time) - julianday(created_time))
                    END) AS avg_rt_days,
           COUNT(*) AS n
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapFrtTrend(rows);
}
// PG fork — strftime→to_char; julianday-hours `*24` → EXTRACT-EPOCH/3600; julianday-days →
// /86400 (incl the 365-day RT cap); raw ISO cutoff UNCHANGED; GROUP BY yyyymm safe. AVG keeps
// the float (no TRUNC). String compares `responded_time > created_time` are lexical (same in
// both engines on these ISO-ish TEXT values), left unchanged.
async function _getFirstResponseTrendDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT to_char(created_time::timestamptz, 'YYYY-MM') AS yyyymm,
           AVG(CASE WHEN responded_time IS NOT NULL AND responded_time > created_time
                    THEN EXTRACT(EPOCH FROM (responded_time::timestamptz - created_time::timestamptz)) / 3600
                    END) AS avg_frt_hrs,
           AVG(CASE WHEN resolved_time IS NOT NULL AND resolved_time > created_time
                         AND EXTRACT(EPOCH FROM (resolved_time::timestamptz - created_time::timestamptz)) / 86400 <= 365
                    THEN EXTRACT(EPOCH FROM (resolved_time::timestamptz - created_time::timestamptz)) / 86400
                    END) AS avg_rt_days,
           COUNT(*) AS n
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapFrtTrend(rows);
}
function _mapFrtTrend(rows) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return rows.map(r => {
    // yyyymm is "2026-04" — convert to "Apr 2026"
    const [yr, mo] = (r.yyyymm || '').split('-').map(Number);
    const monthLbl = isNaN(mo) ? r.yyyymm : MON[mo - 1] + ' ' + yr;
    return {
      month:  monthLbl,
      avgFRT: r.avg_frt_hrs == null ? null : Math.round(r.avg_frt_hrs * 10) / 10,
      avgRT:  r.avg_rt_days == null ? null : Math.round(r.avg_rt_days * 10) / 10,
      n:      r.n || 0,
    };
  });
}

/**
 * Customer Voice — CSAT / NPS rollups from survey_results.
 * Used by executive.html Customer Voice tab + /api/survey/summary.
 *
 * Returns the same shape /api/survey/summary used to return from Zoho:
 *   {
 *     totalResponses, avgRating, csatPct, nps,
 *     promoters, passives, detractors,
 *     byMonth: [{ month, responses, avgRating, csatPct, nps }, …]
 *   }
 *
 * Definitions (kept identical to the live-Zoho-proxy version):
 *   CSAT  = % of responses with overall_score >= 80
 *   NPS   = (promoters - detractors) / total × 100, where
 *             promoter  = overall_score >= 90
 *             passive   = 70 <= overall_score < 90
 *             detractor = overall_score <  70
 */
function getCustomerVoiceDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getCustomerVoiceDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  // ── Sent vs responded counts (response-rate inputs) ──────────────────
  // Zoho's "Survey Results" view (the source of survey_results) stores
  // BOTH sent-only and sent-and-responded rows. `survey_responded_on` is
  // NULL for the former. This is what makes a meaningful response rate
  // possible without joining back to request_records.
  //
  // Rate = responded / sent. Per the SDP Survey Settings ("Send Survey:
  // When a request is closed"), every closed ticket triggers one row,
  // so `survey_results` row count ≈ closed-ticket count in period.
  const sendCounts = db.prepare(`
    SELECT
      COUNT(*)                                                       AS total_sent,
      SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END) AS total_responded
    FROM survey_results
    WHERE COALESCE(survey_sent_on, survey_responded_on) >= ?
  `).get(cutoffISO);

  // ── Roll up scored totals (for CSAT / NPS / avgRating) ───────────────
  const tot = db.prepare(`
    SELECT COUNT(*) AS total_responses,
           AVG(overall_score) AS avg_score,
           SUM(CASE WHEN overall_score >= 80 THEN 1 ELSE 0 END) AS satisfied,
           SUM(CASE WHEN overall_score >= 90 THEN 1 ELSE 0 END) AS promoters,
           SUM(CASE WHEN overall_score >= 70 AND overall_score < 90 THEN 1 ELSE 0 END) AS passives,
           SUM(CASE WHEN overall_score <  70 THEN 1 ELSE 0 END) AS detractors,
           SUM(CASE WHEN overall_score IS NOT NULL THEN 1 ELSE 0 END) AS scored
    FROM survey_results
    WHERE overall_score IS NOT NULL
  `).get();

  // ── Monthly breakdown (with per-month sent + responded counts) ───────
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', COALESCE(survey_sent_on, survey_responded_on)) AS yyyymm,
           COUNT(*)                                                          AS sent,
           SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END)  AS responses,
           AVG(overall_score) AS avg_score,
           SUM(CASE WHEN overall_score >= 80 THEN 1 ELSE 0 END) AS satisfied,
           SUM(CASE WHEN overall_score >= 90 THEN 1 ELSE 0 END) AS promoters,
           SUM(CASE WHEN overall_score >= 70 AND overall_score < 90 THEN 1 ELSE 0 END) AS passives,
           SUM(CASE WHEN overall_score <  70 THEN 1 ELSE 0 END) AS detractors,
           SUM(CASE WHEN overall_score IS NOT NULL THEN 1 ELSE 0 END) AS scored
    FROM survey_results
    WHERE COALESCE(survey_sent_on, survey_responded_on) >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _assembleCustomerVoice({ sendCounts, tot, monthlyRows });
}
// PG fork — 3 queries awaited. Raw ISO cutoff (COALESCE(...) >= ?) UNCHANGED (sendCounts +
// monthlyRows). monthly bucket `strftime('%Y-%m', COALESCE(...))` → direct
// `to_char(COALESCE(...)::timestamptz,'YYYY-MM')` (NO NULLIF — the WHERE `COALESCE(...) >= ?`
// guarantees a valid non-null timestamp in grouped rows). NO SQL ROUND (all averaging is JS
// Math.round over raw AVG(overall_score)), so no `::numeric` cast here.
async function _getCustomerVoiceDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();
  const H = pgHandle();

  const sendCounts = await H.prepare(`
    SELECT
      COUNT(*)                                                       AS total_sent,
      SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END) AS total_responded
    FROM survey_results
    WHERE COALESCE(survey_sent_on, survey_responded_on) >= ?
  `).get(cutoffISO);

  const tot = await H.prepare(`
    SELECT COUNT(*) AS total_responses,
           AVG(overall_score) AS avg_score,
           SUM(CASE WHEN overall_score >= 80 THEN 1 ELSE 0 END) AS satisfied,
           SUM(CASE WHEN overall_score >= 90 THEN 1 ELSE 0 END) AS promoters,
           SUM(CASE WHEN overall_score >= 70 AND overall_score < 90 THEN 1 ELSE 0 END) AS passives,
           SUM(CASE WHEN overall_score <  70 THEN 1 ELSE 0 END) AS detractors,
           SUM(CASE WHEN overall_score IS NOT NULL THEN 1 ELSE 0 END) AS scored
    FROM survey_results
    WHERE overall_score IS NOT NULL
  `).get();

  const monthlyRows = await H.prepare(`
    SELECT to_char(COALESCE(survey_sent_on, survey_responded_on)::timestamptz, 'YYYY-MM') AS yyyymm,
           COUNT(*)                                                          AS sent,
           SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END)  AS responses,
           AVG(overall_score) AS avg_score,
           SUM(CASE WHEN overall_score >= 80 THEN 1 ELSE 0 END) AS satisfied,
           SUM(CASE WHEN overall_score >= 90 THEN 1 ELSE 0 END) AS promoters,
           SUM(CASE WHEN overall_score >= 70 AND overall_score < 90 THEN 1 ELSE 0 END) AS passives,
           SUM(CASE WHEN overall_score <  70 THEN 1 ELSE 0 END) AS detractors,
           SUM(CASE WHEN overall_score IS NOT NULL THEN 1 ELSE 0 END) AS scored
    FROM survey_results
    WHERE COALESCE(survey_sent_on, survey_responded_on) >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _assembleCustomerVoice({ sendCounts, tot, monthlyRows });
}
function _assembleCustomerVoice({ sendCounts, tot, monthlyRows }) {
  const totalSent      = sendCounts.total_sent      || 0;
  const totalResponded = sendCounts.total_responded || 0;
  const responseRate   = totalSent > 0
                          ? Math.round((totalResponded / totalSent) * 100)
                          : null;

  const scored    = tot && tot.scored ? tot.scored : 0;
  const npsBase   = (tot.promoters || 0) + (tot.passives || 0) + (tot.detractors || 0);
  const csatPct   = scored  ? Math.round((tot.satisfied || 0) / scored * 100) : null;
  const avgScore  = scored  ? Math.round((tot.avg_score || 0) * 10) / 10      : null;
  const nps       = npsBase ? Math.round(((tot.promoters / npsBase) - (tot.detractors / npsBase)) * 100) : null;

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const byMonth = monthlyRows.map(r => {
    const [yr, mo] = (r.yyyymm || '').split('-').map(Number);
    const lbl       = isNaN(mo) ? r.yyyymm : MON[mo - 1] + ' ' + yr;
    const sc        = r.scored || 0;
    const npsB      = (r.promoters || 0) + (r.passives || 0) + (r.detractors || 0);
    const sentN     = r.sent      || 0;
    const respN     = r.responses || 0;
    const ratePct   = sentN > 0 ? Math.round((respN / sentN) * 100) : null;
    return {
      month:        lbl,
      sent:         sentN,                 // new
      responses:    respN,                 // unchanged semantics (responded count)
      responseRate: ratePct,               // new — per-month rate
      avgRating:    sc ? Math.round((r.avg_score || 0) * 10) / 10 : null,
      csatPct:      sc ? Math.round((r.satisfied || 0) / sc * 100) : null,
      nps:          npsB ? Math.round(((r.promoters / npsB) - (r.detractors / npsB)) * 100) : null,
    };
  });

  return {
    totalResponses: tot.total_responses || 0,   // scored responses (legacy semantics — CSAT/NPS source)
    totalSent,                                  // new — all survey rows in period
    totalResponded,                             // new — rows with non-null responded_on
    responseRate,                               // new — server-computed; client falls back to this
    avgRating:      avgScore,
    csatPct,
    nps,
    promoters:      tot.promoters  || 0,
    passives:       tot.passives   || 0,
    detractors:     tot.detractors || 0,
    byMonth,
  };
}

/**
 * SLA trend by month — replaces /api/data/sla-trend (Zoho view
 * SLA_COMPLIANCE_TREND). Returns rows shaped like the legacy view so
 * the executive.html consumer at line ~8022 (slaViol mapping) reads
 * them unchanged.
 *
 * Output shape (Zoho-column names preserved):
 *   [{ 'Created Date': 'Apr 2026',
 *      '% of SLA Violated': 12.3,
 *      '% of First Responses SLA Violated': 8.7,
 *      n: 1635 }, …]
 *
 * Both percentages are VIOLATION % (matches the legacy field semantics).
 * The compliance flip on the executive.html chart inverts these at
 * render time (see line ~8054), so we don't pre-invert here.
 */
function getSlaTrendDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getSlaTrendDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  // 2026-06-02 ITSM-alignment (FORMULA_RECONCILIATION.md §6 D2/D3):
  // The percentages below are violation rates. ITSM convention:
  //   SLA violated %  = (overdue AND closed) / closed                    — verdict-rendered
  //   FRT violated %  = (FR overdue AND responded) / responded            — verdict-rendered
  // The single SQL aggregates all the building blocks per month; we divide
  // in the JS pass to keep null-safe handling.
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_time) AS yyyymm,
           COUNT(*) AS total,
           SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN pending_status = 0 AND overdue_status = 1 THEN 1 ELSE 0 END) AS sla_viol_closed,
           SUM(CASE WHEN responded_time IS NOT NULL AND responded_time != '' THEN 1 ELSE 0 END) AS responded,
           SUM(CASE WHEN responded_time IS NOT NULL AND responded_time != ''
                     AND LOWER(TRIM(COALESCE(first_response_overdue,''))) IN ('true','yes','1')
                    THEN 1 ELSE 0 END) AS frt_viol_responded
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapSlaTrend(rows);
}
// PG fork — strftime→to_char; closed-only / responded-only denominators preserved; the raw
// ISO cutoff (`created_time >= ?`) is a lexical TEXT compare, left UNCHANGED. GROUP BY yyyymm
// (alias doesn't shadow a column) is safe.
async function _getSlaTrendDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT to_char(created_time::timestamptz, 'YYYY-MM') AS yyyymm,
           COUNT(*) AS total,
           SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN pending_status = 0 AND overdue_status = 1 THEN 1 ELSE 0 END) AS sla_viol_closed,
           SUM(CASE WHEN responded_time IS NOT NULL AND responded_time != '' THEN 1 ELSE 0 END) AS responded,
           SUM(CASE WHEN responded_time IS NOT NULL AND responded_time != ''
                     AND LOWER(TRIM(COALESCE(first_response_overdue,''))) IN ('true','yes','1')
                    THEN 1 ELSE 0 END) AS frt_viol_responded
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapSlaTrend(rows);
}
function _mapSlaTrend(rows) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return rows.map(r => {
    const [yr, mo] = (r.yyyymm || '').split('-').map(Number);
    const monthLbl = isNaN(mo) ? r.yyyymm : MON[mo - 1] + ' ' + yr;
    const slaViol = r.closed    > 0 ? Math.round((r.sla_viol_closed   / r.closed)    * 1000) / 10 : 0;
    const frtViol = r.responded > 0 ? Math.round((r.frt_viol_responded / r.responded) * 1000) / 10 : 0;
    return {
      'Created Date':                       monthLbl,
      '% of SLA Violated':                  slaViol,
      '% of First Responses SLA Violated':  frtViol,
      n:                                    r.total,
    };
  });
}

/**
 * SLA violations by category — replaces /api/data/sla-by-category (Zoho
 * view SLA_BY_CATEGORY). Returns top 20 categories ranked by violation
 * volume, then by violation %.
 *
 * Output shape (Zoho-column names preserved):
 *   [{ Category: 'Network', '% of SLA Violated': 23.4, n: 412 }, …]
 *
 * Consumer at executive.html:8643 reads r['Category'] + r['% of SLA Violated'].
 */
function getSlaByCategoryDB() {
  if (REPORTS_BACKEND === 'postgres') return _getSlaByCategoryDBPg();
  // 2026-06-02 ITSM-alignment (FORMULA_RECONCILIATION.md §6 D2):
  // SLA violation % per category uses the closed-only denominator. AP
  // `/total` previously inflated open-heavy categories' apparent SLA
  // performance because their open tickets weren't yet in violation.
  // Sort still ranks by violation volume so the per-category list is
  // stable across refreshes.
  const rows = db.prepare(`
    SELECT TRIM(COALESCE(category, '(Uncategorised)')) AS cat,
           COUNT(*) AS total,
           SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN pending_status = 0 AND overdue_status = 1 THEN 1 ELSE 0 END) AS violated_closed
    FROM request_records
    WHERE created_time >= datetime('now', '-12 months')
      AND category IS NOT NULL
      AND TRIM(category) != ''
      AND LOWER(TRIM(category)) NOT IN ('-no value-', '-no value', 'no value', '(blank)')
    GROUP BY cat
    HAVING total >= 5            -- ignore long-tail categories with too few tickets
    ORDER BY violated_closed DESC, total DESC, cat ASC
    LIMIT 20
  `).all();

  return _mapSlaByCategory(rows);
}
// PG fork — the 12-month cutoff MUST mirror sqlite's LEXICAL text compare, not a typed
// timestamptz compare. sqlite compares the ISO 'YYYY-MM-DDTHH:MM:SSZ' column against a
// 'YYYY-MM-DD HH:MM:SS' cutoff string: on the boundary DAY, 'T' (0x54) > ' ' (0x20), so
// sqlite includes the ENTIRE boundary day. A typed `::timestamptz >= now() - interval`
// cut at the exact instant instead — 30-row divergence on real prod data (2026-07-10
// reconciliation). to_char(now() at UTC) reproduces sqlite's datetime('now') string
// byte-for-byte, so both engines run the same lexical window (dialect contract:
// "raw ISO-string TEXT compares LEFT UNCHANGED").
// HAVING output-alias → HAVING COUNT(*) >= 5; GROUP BY cat (alias ≠ the `category`
// column, so no shadowing) safe; closed-only denominator preserved.
async function _getSlaByCategoryDBPg() {
  const rows = await pgHandle().prepare(`
    SELECT TRIM(COALESCE(category, '(Uncategorised)')) AS cat,
           COUNT(*) AS total,
           SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN pending_status = 0 AND overdue_status = 1 THEN 1 ELSE 0 END) AS violated_closed
    FROM request_records
    WHERE created_time >= to_char((now() at time zone 'UTC') - interval '12 months', 'YYYY-MM-DD HH24:MI:SS')
      AND category IS NOT NULL
      AND TRIM(category) != ''
      AND LOWER(TRIM(category)) NOT IN ('-no value-', '-no value', 'no value', '(blank)')
    GROUP BY cat
    HAVING COUNT(*) >= 5
    ORDER BY violated_closed DESC, total DESC, TRIM(COALESCE(category, '(Uncategorised)')) COLLATE "C" ASC
    LIMIT 20
  `).all();

  return _mapSlaByCategory(rows);
}
function _mapSlaByCategory(rows) {
  return rows.map(r => {
    // Per-category ITSM violation %. Denominator = closed-in-category, NULL when
    // a category has no closed tickets in the rolling window (rare — but emit
    // "0%" since the consumer at executive.html:8643 calls .replace('%','')).
    const pct = r.closed > 0 ? Math.round((r.violated_closed / r.closed) * 1000) / 10 : 0;
    return {
      'Category':           r.cat,
      // STRING with '%' — matches Zoho's view shape exactly so consumer
      // code at executive.html:8643 that calls
      //   (r['% of SLA Violated']||'0').replace('%','')
      // works unchanged. Returning a number broke the page with
      // "Error: (r.% of SLA Violated || '0').replace is not a function"
      // → JS error halted the data-flow cascade → all KPI tiles stuck
      // on "Computing…". 2026-05-26.
      '% of SLA Violated':  pct + '%',
      n:                    r.total,
    };
  });
}

/**
 * Group request counts — replaces /api/data/group-requests (Zoho view
 * GROUP_REQUEST_COUNT). Returns one row per IT group with the count of
 * tickets created in the last N months.
 *
 * Output shape (Zoho-column names preserved for frontend compat):
 *   [{ Group: 'MANA IT Agent', 'Request Count': 412 }, …]
 */
function getGroupRequestsDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getGroupRequestsDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = db.prepare(`
    SELECT tech_group AS grp, COUNT(*) AS cnt
    FROM request_records
    WHERE created_time >= ?
      AND tech_group IS NOT NULL
      AND TRIM(tech_group) != ''
    GROUP BY grp
    ORDER BY cnt DESC, grp ASC
  `).all(cutoffISO);
  return rows.map(r => ({ 'Group': r.grp, 'Request Count': r.cnt }));
}
// PG fork — no strftime/julianday; raw ISO cutoff UNCHANGED; GROUP BY grp safe.
async function _getGroupRequestsDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT tech_group AS grp, COUNT(*) AS cnt
    FROM request_records
    WHERE created_time >= ?
      AND tech_group IS NOT NULL
      AND TRIM(tech_group) != ''
    GROUP BY grp
    ORDER BY cnt DESC, tech_group COLLATE "C" ASC
  `).all(cutoffISO);
  return rows.map(r => ({ 'Group': r.grp, 'Request Count': r.cnt }));
}

/**
 * Emergency changes — replaces /api/data/emergency-changes (Zoho view
 * EMERGENCY_CHANGES). Returns the list of RFCs whose Change Type
 * contains "emergency" in the last N months, shaped like the change-
 * records view rows the executive page already consumes for non-
 * emergency changes.
 *
 * Output shape: same keys executive.html reads from change-table rows
 * (Subject, Site, Change Type, Status, Created Time, etc.).
 */
function getEmergencyChangesDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getEmergencyChangesDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = db.prepare(`
    SELECT * FROM change_records
    WHERE LOWER(COALESCE(change_type, '')) LIKE '%emergency%'
      AND created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);

  return _mapEmergencyChanges(rows);
}
// PG fork — raw ISO cutoff (created_time>=?) UNCHANGED; LIKE/LOWER/COALESCE valid as-is.
async function _getEmergencyChangesDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT * FROM change_records
    WHERE LOWER(COALESCE(change_type, '')) LIKE '%emergency%'
      AND created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);

  return _mapEmergencyChanges(rows);
}
// NOTE: r.change_status + r.planned_start_time are non-existent columns (table has `status` +
// `scheduled_start`) → 'Status' undefined, 'Planned Start Time' null in BOTH engines. Pre-existing
// latent bug, preserved verbatim (a separate task fixes it). r.site also non-existent → undefined.
function _mapEmergencyChanges(rows) {
  return rows.map(r => ({
    'Change ID':         r.change_id,
    'Change Display ID': r.display_id,
    'Subject':           r.subject,
    'Site':              r.site,
    'Change Type':       r.change_type,
    'Status':            r.status,            // was r.change_status — non-existent col → always undefined
    'Stage':             r.stage,
    'Stage and Status':  r.stage,
    'Created Time':      isoToZohoStr(r.created_time),
    'Planned Start Time':isoToZohoStr(r.scheduled_start),  // was r.planned_start_time — non-existent col → always null
  }));
}

/**
 * Ageing summary — simple aggregate replacing /api/data/ageing (Zoho
 * view AGEING_SUMMARY). Returns one row per (Group, Tier) — the same
 * pivot shape Zoho ships. Executive page uses ageing-by-site /
 * ageing-by-group for the visible tables; this endpoint is consumed
 * by upstream code that wants the raw pivot, so we preserve it.
 */
function getAgeingSummaryDB() {
  if (REPORTS_BACKEND === 'postgres') return _getAgeingSummaryDBPg();
  const rows = db.prepare(`
    SELECT tech_group AS grp,
           SUM(CASE WHEN age_days <= 30                  THEN 1 ELSE 0 END) AS d0_30,
           SUM(CASE WHEN age_days > 30 AND age_days<=45  THEN 1 ELSE 0 END) AS d31_45,
           SUM(CASE WHEN age_days > 45 AND age_days<=60  THEN 1 ELSE 0 END) AS d46_60,
           SUM(CASE WHEN age_days > 60                   THEN 1 ELSE 0 END) AS d_over_60
    FROM (
      SELECT tech_group,
             CAST((julianday('now') - julianday(created_time)) AS INTEGER) AS age_days
      FROM request_records
      WHERE pending_status = 1
        -- defence-in-depth: a ticket is open only if its Request Status is not
        -- terminal (mirrors the browser isClosed). Guards against a stale/corrupt
        -- pending_status marking closed tickets as open (July-2026 PG diagnosis).
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND tech_group IS NOT NULL
        AND TRIM(tech_group) != ''
        AND created_time IS NOT NULL
    )
    GROUP BY grp
    ORDER BY (d0_30 + d31_45 + d46_60 + d_over_60) DESC, grp ASC
  `).all();
  return _mapAgeingSummary(rows);
}
// PG fork — TRUNC-days; NO HAVING (matches source). ORDER BY is an EXPRESSION over output
// aliases (pg forbids that) → repeat the four SUM(CASE …) expressions. Derived table aliased `q`.
async function _getAgeingSummaryDBPg() {
  const rows = await pgHandle().prepare(`
    SELECT tech_group AS grp,
           SUM(CASE WHEN age_days <= 30                  THEN 1 ELSE 0 END) AS d0_30,
           SUM(CASE WHEN age_days > 30 AND age_days<=45  THEN 1 ELSE 0 END) AS d31_45,
           SUM(CASE WHEN age_days > 45 AND age_days<=60  THEN 1 ELSE 0 END) AS d46_60,
           SUM(CASE WHEN age_days > 60                   THEN 1 ELSE 0 END) AS d_over_60
    FROM (
      SELECT tech_group,
             TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer AS age_days
      FROM request_records
      WHERE pending_status = 1
        -- defence-in-depth: a ticket is open only if its Request Status is not
        -- terminal (mirrors the browser isClosed). Guards against a stale/corrupt
        -- pending_status marking closed tickets as open (July-2026 PG diagnosis).
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND tech_group IS NOT NULL
        AND TRIM(tech_group) != ''
        AND created_time IS NOT NULL
    ) q
    GROUP BY grp
    ORDER BY (
        SUM(CASE WHEN age_days <= 30                  THEN 1 ELSE 0 END)
      + SUM(CASE WHEN age_days > 30 AND age_days<=45  THEN 1 ELSE 0 END)
      + SUM(CASE WHEN age_days > 45 AND age_days<=60  THEN 1 ELSE 0 END)
      + SUM(CASE WHEN age_days > 60                   THEN 1 ELSE 0 END)
    ) DESC, tech_group COLLATE "C" ASC
  `).all();
  return _mapAgeingSummary(rows);
}
function _mapAgeingSummary(rows) {
  // Zoho ships a pivoted shape — one row per (Group, Tier). Emit the same
  // for max consumer-side compatibility, but ALSO include the wide-form
  // fields so callers that want a single row per group can use them too.
  const TIERS = ['0 - 30 Days','31 - 45 Days','46 - 60 Days','Over 60 Days'];
  const out = [];
  rows.forEach(r => {
    const counts = [r.d0_30, r.d31_45, r.d46_60, r.d_over_60];
    TIERS.forEach((tier, i) => {
      if (counts[i] > 0) {
        out.push({
          'Group':            r.grp,
          'Request Age Tier': tier,
          'Total Requests':   counts[i],
        });
      }
    });
  });
  return out;
}

/**
 * Incidents vs Service Requests trend — replaces /api/data/incident-vs-sr
 * (Zoho view INCIDENT_VS_SR). Monthly count of each type for the last
 * N months. Used by executive.html for the "Incident vs SR adoption"
 * trend chart.
 *
 * Output shape (column names preserved):
 *   [{ 'Created Time': 'Apr 2026', 'Incidents': 432, 'Service Requests': 1203 }, …]
 */
function getIncidentVsSrDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getIncidentVsSrDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = db.prepare(`
    SELECT strftime('%Y-%m', created_time) AS yyyymm,
           SUM(CASE WHEN service_request = 0 THEN 1 ELSE 0 END) AS incidents,
           SUM(CASE WHEN service_request = 1 THEN 1 ELSE 0 END) AS srs
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapIncidentVsSr(rows);
}
// PG fork — strftime→to_char; raw ISO cutoff UNCHANGED; GROUP BY yyyymm safe;
// service_request is INTEGER so the = 0/1 compares are unchanged.
async function _getIncidentVsSrDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT to_char(created_time::timestamptz, 'YYYY-MM') AS yyyymm,
           SUM(CASE WHEN service_request = 0 THEN 1 ELSE 0 END) AS incidents,
           SUM(CASE WHEN service_request = 1 THEN 1 ELSE 0 END) AS srs
    FROM request_records
    WHERE created_time >= ?
    GROUP BY yyyymm
    ORDER BY yyyymm
  `).all(cutoffISO);

  return _mapIncidentVsSr(rows);
}
function _mapIncidentVsSr(rows) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return rows.map(r => {
    const [yr, mo] = (r.yyyymm || '').split('-').map(Number);
    const monthLbl = isNaN(mo) ? r.yyyymm : MON[mo - 1] + ' ' + yr;
    return {
      'Created Time':     monthLbl,
      'Incidents':        r.incidents || 0,
      'Service Requests': r.srs       || 0,
    };
  });
}

/**
 * CAB Approval Details — replaces /api/data/cab-approvals (Zoho view
 * CAB_APPROVAL_DETAILS). Returns one row per approval record.
 *
 * Consumer in executive.html (lines ~4421-4436) reads:
 *   'Change Approver', 'Approval Status', 'Stage and Status',
 *   'Change ID', 'Subject'
 *
 * cab_approvals doesn't have Subject — we LEFT JOIN change_records for it.
 */
function getCabApprovalsDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getCabApprovalsDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  // NOTE: `c.site` was dropped here (and in the pg fork) — change_records has NO `site` column
  // (only site_id), so the original query threw `no such column: c.site` on EVERY call. The JS
  // map's `'Site': r.site || ''` now yields '' (matching "Site is empty upstream"). See spec.
  const rows = db.prepare(`
    SELECT
      a.approver_name           AS approver,
      a.approval_status         AS status,
      a.approval_stage          AS stage,
      a.approval_level          AS level,
      a.approval_level_status   AS level_status,
      a.recommendation_requested AS req_at,
      a.action_taken_on         AS taken_at,
      a.turnaround_minutes      AS turnaround,
      a.rule_type               AS rule_type,
      a.comments                AS comments,
      a.change_id               AS change_id,
      c.display_id              AS change_display_id,
      c.subject                 AS subject
    FROM cab_approvals a
    LEFT JOIN change_records c ON c.change_id = a.change_id
    WHERE a.recommendation_requested >= ?
       OR a.recommendation_requested IS NULL
    ORDER BY a.recommendation_requested DESC NULLS LAST
    LIMIT 500
  `).all(cutoffISO);

  return _mapCabApprovals(rows);
}
// PG fork — raw ISO bound (recommendation_requested>=?) UNCHANGED; LEFT JOIN + NULLS LAST valid.
// `c.site` dropped (non-existent column — see sqlite body note).
async function _getCabApprovalsDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT
      a.approver_name           AS approver,
      a.approval_status         AS status,
      a.approval_stage          AS stage,
      a.approval_level          AS level,
      a.approval_level_status   AS level_status,
      a.recommendation_requested AS req_at,
      a.action_taken_on         AS taken_at,
      a.turnaround_minutes      AS turnaround,
      a.rule_type               AS rule_type,
      a.comments                AS comments,
      a.change_id               AS change_id,
      c.display_id              AS change_display_id,
      c.subject                 AS subject
    FROM cab_approvals a
    LEFT JOIN change_records c ON c.change_id = a.change_id
    WHERE a.recommendation_requested >= ?
       OR a.recommendation_requested IS NULL
    ORDER BY a.recommendation_requested DESC NULLS LAST
    LIMIT 500
  `).all(cutoffISO);

  return _mapCabApprovals(rows);
}
function _mapCabApprovals(rows) {
  return rows.map(r => ({
    'Change Approver':                          r.approver || '',
    'Approval Status':                          r.status || '',
    'Stage and Status':                         r.stage || '',
    'Approval Stage':                           r.stage || '',
    'Approval Level':                           r.level || '',
    'Approval Level Status':                    r.level_status || '',
    'Change ID':                                r.change_id || '',
    'Change Display ID':                        r.change_display_id || '',
    'Subject':                                  r.subject || '',
    'Site':                                     r.site || '',
    'Recommendation Requested On':              isoToZohoStr(r.req_at),
    'Action Taken On':                          isoToZohoStr(r.taken_at),
    'Recommendation Turnaround Time (Minutes)': r.turnaround == null ? '' : String(r.turnaround),
    'Rule Type':                                r.rule_type || '',
    'Comments':                                 r.comments || '',
  }));
}

/**
 * CAB Recommendations — replaces /api/data/cab-recommendations (Zoho
 * view CAB_RECOMMENDATIONS). This view is conceptually the same source
 * data as CAB_APPROVAL_DETAILS, filtered to approvals where the
 * turnaround / recommendation phase is the interesting metric.
 *
 * Consumer at executive.html:4440 reads:
 *   'Recommendation Turnaround Time (Minutes)', 'Approval Stage',
 *   'Change Display ID', 'Change Approver'
 *
 * Same join as getCabApprovalsDB, just scoped to rows with a
 * turnaround value set (= the row represents a recommendation that
 * actually happened, not pending).
 */
function getCabRecommendationsDB(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getCabRecommendationsDBPg(monthsBack);
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  // `c.site` dropped (non-existent column) — see getCabApprovalsDB note.
  const rows = db.prepare(`
    SELECT
      a.approver_name           AS approver,
      a.approval_status         AS status,
      a.approval_stage          AS stage,
      a.approval_level          AS level,
      a.recommendation_requested AS req_at,
      a.action_taken_on         AS taken_at,
      a.turnaround_minutes      AS turnaround,
      a.change_id               AS change_id,
      c.display_id              AS change_display_id,
      c.subject                 AS subject
    FROM cab_approvals a
    LEFT JOIN change_records c ON c.change_id = a.change_id
    WHERE a.turnaround_minutes IS NOT NULL
      AND a.recommendation_requested >= ?
    ORDER BY a.recommendation_requested DESC
    LIMIT 500
  `).all(cutoffISO);

  return _mapCabRecommendations(rows);
}
// PG fork — raw ISO bound (recommendation_requested>=?) UNCHANGED; `c.site` dropped.
async function _getCabRecommendationsDBPg(monthsBack = 12) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack + 1);
  cutoff.setDate(1); cutoff.setHours(0,0,0,0);
  const cutoffISO = cutoff.toISOString();

  const rows = await pgHandle().prepare(`
    SELECT
      a.approver_name           AS approver,
      a.approval_status         AS status,
      a.approval_stage          AS stage,
      a.approval_level          AS level,
      a.recommendation_requested AS req_at,
      a.action_taken_on         AS taken_at,
      a.turnaround_minutes      AS turnaround,
      a.change_id               AS change_id,
      c.display_id              AS change_display_id,
      c.subject                 AS subject
    FROM cab_approvals a
    LEFT JOIN change_records c ON c.change_id = a.change_id
    WHERE a.turnaround_minutes IS NOT NULL
      AND a.recommendation_requested >= ?
    ORDER BY a.recommendation_requested DESC
    LIMIT 500
  `).all(cutoffISO);

  return _mapCabRecommendations(rows);
}
function _mapCabRecommendations(rows) {
  return rows.map(r => ({
    'Change Approver':                          r.approver || '',
    'Approval Status':                          r.status || '',
    'Approval Stage':                           r.stage || '',
    'Approval Level':                           r.level || '',
    'Change ID':                                r.change_id || '',
    'Change Display ID':                        r.change_display_id || '',
    'Subject':                                  r.subject || '',
    'Site':                                     r.site || '',
    'Recommendation Requested On':              isoToZohoStr(r.req_at),
    'Action Taken On':                          isoToZohoStr(r.taken_at),
    'Recommendation Turnaround Time (Minutes)': r.turnaround == null ? '' : String(r.turnaround),
  }));
}

/**
 * Customer Voice by dimension — replaces /api/survey/by-dimension.
 * The live-Zoho version fetches the survey view + the full REQUEST_TABLE
 * view (30k rows) and joins them in memory; both calls were 500'ing under
 * the current Zoho rate limit.
 *
 * DB equivalent: JOIN survey_results to request_records on display_id
 * and aggregate by Technician / Site / Group.
 *
 * Output shape matches the legacy /api/survey/by-dimension response:
 *   {
 *     byTech:  [{ name, responses, satisfied, csatPct, promoters,
 *                 passives, detractors, nps, byMonth: {…} }, …],
 *     bySite:  [{ site, … }, …],
 *     byGroup: [{ group, … }, …],
 *     totalSurvey, totalJoined, joinRate, closedCount,
 *   }
 */
function getCustomerVoiceByDimensionDB() {
  if (REPORTS_BACKEND === 'postgres') return _getCustomerVoiceByDimensionDBPg();
  // Pull surveys + ticket metadata in ONE query (instead of two Zoho views).
  const rows = db.prepare(`
    SELECT
      s.overall_score                                                AS score,
      s.request_display_id                                           AS display_id,
      COALESCE(s.survey_responded_on, s.survey_sent_on)              AS month_src,
      r.technician                                                   AS tech,
      r.site                                                         AS site,
      r.tech_group                                                   AS grp
    FROM survey_results s
    LEFT JOIN request_records r ON r.display_id = s.request_display_id
    WHERE s.overall_score IS NOT NULL
  `).all();

  // Closed-ticket denominator (for response-rate sub-metric)
  const closedRow = db.prepare(`
    SELECT COUNT(*) AS n
    FROM request_records
    WHERE pending_status = 0
  `).get();

  return _assembleCustomerVoiceByDimension(rows, closedRow);
}
// PG fork — awaits the survey⨝request LEFT JOIN + the closed-ticket count. NO dialect rewrite in
// the SQL (no strftime/julianday/datetime/ROUND); ALL aggregation is engine-agnostic JS reused via
// the shared assembler.
async function _getCustomerVoiceByDimensionDBPg() {
  const H = pgHandle();
  const rows = await H.prepare(`
    SELECT
      s.overall_score                                                AS score,
      s.request_display_id                                           AS display_id,
      COALESCE(s.survey_responded_on, s.survey_sent_on)              AS month_src,
      r.technician                                                   AS tech,
      r.site                                                         AS site,
      r.tech_group                                                   AS grp
    FROM survey_results s
    LEFT JOIN request_records r ON r.display_id = s.request_display_id
    WHERE s.overall_score IS NOT NULL
  `).all();

  const closedRow = await H.prepare(`
    SELECT COUNT(*) AS n
    FROM request_records
    WHERE pending_status = 0
  `).get();

  return _assembleCustomerVoiceByDimension(rows, closedRow);
}
function _assembleCustomerVoiceByDimension(rows, closedRow) {
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLbl = iso => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return MON[d.getMonth()] + ' ' + d.getFullYear();
  };

  const techMap = {}, siteMap = {}, groupMap = {};
  let joined = 0;
  const _acc = (map, key, score, monthKey) => {
    if (!key) return;
    if (!map[key]) map[key] = { sum:0, n:0, satisfied:0, promoters:0, passives:0, detractors:0, byMonth:{} };
    const b = map[key];
    b.sum += score; b.n++;
    if (score >= 80) b.satisfied++;
    if      (score >= 90) b.promoters++;
    else if (score >= 70) b.passives++;
    else                  b.detractors++;
    if (monthKey) {
      if (!b.byMonth[monthKey]) b.byMonth[monthKey] = { n:0, satisfied:0 };
      b.byMonth[monthKey].n++;
      if (score >= 80) b.byMonth[monthKey].satisfied++;
    }
  };

  rows.forEach(r => {
    const score = parseFloat(r.score);
    if (isNaN(score)) return;
    const mKey  = monthLbl(r.month_src);
    if (r.tech || r.site || r.grp) joined++;
    if (r.tech)  _acc(techMap,  r.tech,  score, mKey);
    if (r.site)  _acc(siteMap,  r.site,  score, mKey);
    if (r.grp)   _acc(groupMap, r.grp,   score, mKey);
  });

  const toArr = (map, nameKey) =>
    Object.entries(map).map(([k, v]) => {
      const csatPct  = v.n > 0 ? Math.round(v.satisfied / v.n * 100) : null;
      const avgScore = v.n > 0 ? Math.round(v.sum / v.n * 10) / 10 : null;
      const npsBase  = v.promoters + v.passives + v.detractors;
      const byMonth  = Object.entries(v.byMonth).map(([m, x]) => ({
        month: m, responses: x.n, csatPct: x.n > 0 ? Math.round(x.satisfied / x.n * 100) : null,
      }));
      return {
        [nameKey]:    k,
        responses:    v.n,
        satisfied:    v.satisfied,
        csatPct,
        avgScore,
        promoters:    v.promoters,
        passives:     v.passives,
        detractors:   v.detractors,
        nps:          npsBase > 0 ? Math.round((v.promoters - v.detractors) / npsBase * 100) : null,
        byMonth,
      };
    }).sort((a, b) => b.responses - a.responses);

  return {
    byTech:      toArr(techMap,  'name'),
    bySite:      toArr(siteMap,  'site'),
    byGroup:     toArr(groupMap, 'group'),
    totalSurvey: rows.length,
    totalJoined: joined,
    joinRate:    rows.length > 0 ? Math.round(joined / rows.length * 100) : 0,
    closedCount: closedRow ? closedRow.n : 0,
  };
}

function getMajorIncidentsHistory(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getMajorIncidentsHistoryPg(monthsBack);
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const cutoffISO = cutoff.toISOString();

  const rows = db.prepare(`
    SELECT * FROM request_records
    WHERE (LOWER(COALESCE(request_type, '')) LIKE '%major%' OR LOWER(COALESCE(template, '')) LIKE '%major incident%')
      AND created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);

  return _mapMajorIncidentRows(rows);
}

// PG fork — same raw-TEXT cutoff comparison (created_time >= ISO bound is a
// lexical string compare on a TEXT col in BOTH engines; do NOT add a cast).
// Awaits the query, reuses the shared JS row mapper.
async function _getMajorIncidentsHistoryPg(monthsBack = 12) {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const cutoffISO = cutoff.toISOString();
  const rows = await pgHandle().prepare(`
    SELECT * FROM request_records
    WHERE (LOWER(COALESCE(request_type, '')) LIKE '%major%' OR LOWER(COALESCE(template, '')) LIKE '%major incident%')
      AND created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);
  return _mapMajorIncidentRows(rows);
}

// Shared major-incident row transform (engine-agnostic, pure JS over fetched
// rows): UDF defaults, udf_json unpack, priority-fallback chain + canonical
// P-Label, downtime parse. Used by both the sqlite and pg paths.
function _mapMajorIncidentRows(rows) {
  // Default UDF keys (empty) so client code can call .trim() without a
  // null check on rows where udf_json hasn't been backfilled yet.
  const UDF_DEFAULTS = {
    'UDF:Root Cause Analysis :':               '',
    'UDF:Corrective action:':                  '',
    'UDF:Lessons Learned:':                    '',
    'UDF:Preventive Measures:':                '',
    'UDF:Workaround Details (if applicable):': '',
    'UDF:PIR Required:':                       '',
  };

  return rows.map(r => {
    const out = {
      'Request ID':                       r.request_id,
      'Request Display ID':               r.display_id,
      'Subject':                          r.subject,
      'Request Status':                   r.request_status,
      'Request Pending Status':           r.pending_status === 0 ? 'No' : 'Yes',
      'Request Type':                     r.request_type,
      'Reopen Count':                     String(r.reopen_count || 0),
      'Created Time':                     isoToZohoStr(r.created_time),
      'Resolved Time':                    isoToZohoStr(r.resolved_time),
      'Completed Time':                   isoToZohoStr(r.completed_time),
      'Time to Resolve (in Days)':        r.resolved_time && r.created_time
                                            ? ((new Date(r.resolved_time) - new Date(r.created_time)) / 86400000).toFixed(2)
                                            : null,
      'Technician':                       r.technician,
      'Requester':                        r.requester,
      'Category':                         r.category,
      'Sub Category':                     r.sub_category,
      'Site':                             r.site,
      'Group':                            r.tech_group,
      ...UDF_DEFAULTS,
    };
    // Unpack UDFs from udf_json blob — overrides defaults where present.
    // Same pattern as getChangeRecordsHistory above.
    if (r.udf_json) {
      try {
        const udfs = JSON.parse(r.udf_json);
        if (udfs && typeof udfs === 'object') Object.assign(out, udfs);
      } catch(e) { /* malformed JSON — keep defaults */ }
    }

    // ── Priority resolution + canonical label (2026-06-04 fix) ──────
    // request_records doesn't store an explicit priority column for
    // major incidents — it lives in udf_json under varying keys
    // (Priority / priority / Severity). Mirror the logic from
    // services/reportPayload.js _majorIncidents() so the dashboard's
    // /api/data/major-incidents endpoint surfaces the same Priority
    // the render.py PPTX path resolves. Without this the browser's
    // P1/P2 counters silently returned 0 even when udf_json carried
    // the field — and where Priority is truly absent, we apply the
    // same default (impact=Enterprise → Critical/P1, else High/P2).
    //
    // The canonical mapping (CLAUDE.md §"Incident SLA Configuration"):
    //   Critical | P1 | Critical SLA for Incident
    //   High     | P2 | High SLA for Incidents
    //   Medium   | P3 | Medium SLA for Incidents
    //   Low      | P4 | Low SLA for Incidents
    let priRaw = out['Priority'] || out['priority']
              || out['Severity'] || out['severity']
              || out['UDF:Priority'] || out['UDF:Severity']
              || '';
    if (!priRaw) {
      // Same fallback as _majorIncidents() — Enterprise impact → Critical
      priRaw = (r.impact === 'Enterprise') ? 'Critical' : 'High';
    }
    const _priLow = String(priRaw).toLowerCase();
    let pLabel = '';
    if (_priLow.includes('critical') || _priLow === 'p1' || _priLow === '1') pLabel = 'P1';
    else if (_priLow.includes('high') || _priLow === 'p2' || _priLow === '2') pLabel = 'P2';
    else if (_priLow.includes('medium') || _priLow.includes('normal')
          || _priLow === 'p3' || _priLow === '3') pLabel = 'P3';
    else if (_priLow.includes('low') || _priLow === 'p4' || _priLow === '4') pLabel = 'P4';
    // Overwrite Priority + add P-Label so both consumers (browser tile
    // + render.py slide 9) see a populated, normalised value.
    out['Priority']    = priRaw;
    out['P-Label']     = pLabel;   // 'P1'/'P2'/'P3'/'P4' — easy for the browser

    // Compute display fields the executive page needs but Zoho doesn't
    // ship pre-formatted:
    //   - downtime_h     : numeric hours, parsed from "UDF:Total Downtime:"
    //                      (the Zoho UDF is a free-text field that holds
    //                      hours as a number; parsed defensively)
    //   - downtime_label : human-readable form via fmtDowntime — "72.5h"
    //                      becomes "3d 1h", "0.5h" becomes "30m", etc.
    // Both attached at the top level (alongside the Zoho-shape keys) so
    // the new /api/exec/incidents endpoint can pass them straight through
    // and the PIR table can render `downtime_label` directly.
    const dtRaw = out['UDF:Total Downtime:'] || '';
    const dtNum = parseFloat(String(dtRaw).trim());
    out.downtime_h     = isNaN(dtNum) ? null : dtNum;
    out.downtime_label = fmtDowntime(out.downtime_h);
    return out;
  });
}

// ── CHANGE RECORDS HISTORY (DB-sourced) ───────────────────────────────────
/**
 * Returns the last N calendar months of ALL change records from change_records.
 * Replaces the live call to Zoho view 002044 (/api/data/change-table). The
 * client filters by Change Type='Emergency' for the Emergency Changes tile,
 * so we return everything (matches the original endpoint's behaviour).
 *
 * change_records DOES store udf_json — UDFs are unpacked back into row keys
 * matching the Zoho field naming, so the client code reads them transparently.
 */
function getChangeRecordsHistory(monthsBack = 12) {
  if (REPORTS_BACKEND === 'postgres') return _getChangeRecordsHistoryPg(monthsBack);
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const cutoffISO = cutoff.toISOString();

  // Build a Zoho-group-name → site-name lookup from the sites table.
  // sites.zoho_group can be a comma-separated list (e.g. Exploration has 3
  // groups). Splitting + lower-casing both sides for case-insensitive match.
  const siteRows = db.prepare(`SELECT name, zoho_group FROM sites WHERE active = 1`).all();
  const groupToSite = _buildGroupToSite(siteRows);

  const rows = db.prepare(`
    SELECT * FROM change_records
    WHERE created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);

  return _mapChangeRecordsHistory(rows, groupToSite);
}
// PG fork — awaits BOTH the sites lookup AND the change_records query; raw ISO cutoff
// (created_time>=?) UNCHANGED. JS map (group→site derivation + udf_json unpack) reused.
async function _getChangeRecordsHistoryPg(monthsBack = 12) {
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth() - monthsBack + 1, 1);
  const cutoffISO = cutoff.toISOString();
  const H = pgHandle();

  const siteRows = await H.prepare(`SELECT name, zoho_group FROM sites WHERE active = 1`).all();
  const groupToSite = _buildGroupToSite(siteRows);

  const rows = await H.prepare(`
    SELECT * FROM change_records
    WHERE created_time >= ?
    ORDER BY created_time DESC
  `).all(cutoffISO);

  return _mapChangeRecordsHistory(rows, groupToSite);
}
function _buildGroupToSite(siteRows) {
  const groupToSite = {};
  for (const s of siteRows) {
    if (!s.zoho_group) continue;
    s.zoho_group.split(',').map(g => g.trim().toLowerCase()).filter(Boolean)
      .forEach(g => { groupToSite[g] = s.name; });
  }
  return groupToSite;
}
function _mapChangeRecordsHistory(rows, groupToSite) {
  return rows.map(r => {
    // The Zoho change-table view ships Site as an empty string (per
    // executive.html line ~8261 — the field is unpopulated upstream). We
    // derive the site name from the group_name via the sites table mapping
    // so the Recent Changes table on the executive page shows readable
    // names ("Sabodala", "Mana") instead of raw Zoho numeric IDs.
    const groupKey = (r.group_name || '').trim().toLowerCase();
    const siteName = groupToSite[groupKey] || '';

    const out = {
      'Change ID':              r.change_id,
      'Change Display ID':      r.display_id,
      'Subject':                r.subject,
      'Status':                 r.status,
      'Stage':                  r.stage,
      'Stage and Status':       r.stage_status,
      'Risk':                   r.risk,
      'Change Type':            r.change_type,
      'Emergency':              r.emergency ? 'Yes' : 'No',
      'Category':               r.category,
      'Sub Category':           r.sub_category,
      'Requester':              r.requester,
      'Site':                   siteName,        // human-readable, derived from group
      'Site ID':                r.site_id,       // raw Zoho ID kept available for any caller that needs it
      'Group':                  r.group_name || r.group_id,
      'Scheduled Start Time':   isoToZohoStr(r.scheduled_start),
      'Scheduled End Time':     isoToZohoStr(r.scheduled_end),
      'Completed Time':         isoToZohoStr(r.completed_time),
      'Created Time':           isoToZohoStr(r.created_time),
      'Change Closure Code':    r.closure_code,
    };
    // Unpack UDFs from udf_json blob into top-level keys
    if (r.udf_json) {
      try {
        const udfs = JSON.parse(r.udf_json);
        if (udfs && typeof udfs === 'object') Object.assign(out, udfs);
      } catch(e) { /* malformed JSON — skip */ }
    }
    return out;
  });
}

// Local helper — convert ISO datetime to Zoho's display format
// "2026-03-15T14:30:00Z" → "15 Mar, 2026 02:30:00 PM"
// Matches Zoho prebuilt view formatting so client-side parsers (parseZohoDT)
// process DB-sourced data identically to live Zoho data.
function isoToZohoStr(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day = d.getDate();
    const mo  = MN[d.getMonth()];
    const yr  = d.getFullYear();
    let hr = d.getHours();
    const mi = String(d.getMinutes()).padStart(2,'0');
    const sc = String(d.getSeconds()).padStart(2,'0');
    const suf = hr >= 12 ? 'PM' : 'AM';
    if (hr === 0) hr = 12;
    else if (hr > 12) hr -= 12;
    return `${day} ${mo}, ${yr} ${String(hr).padStart(2,'0')}:${mi}:${sc} ${suf}`;
  } catch(e) { return null; }
}

// Aggregate 6-month helpdesk history directly from request_records, scoped
// to a specific site + group subset. Used by getHelpdesk6MonthHistory when a
// group filter is active (the calendar fast-path doesn't carry group-level
// breakdown). 2026-06-02 — ITSM-aligned: SLA% uses closed-only denominator
// (FORMULA_RECONCILIATION.md §6 D2); FRT% uses responded-only denominator
// (§6 D3). Returns the same shape as the calendar path.
function _aggregateHelpdesk6MoFromRaw(siteName, py, pm, groups) {
  if (REPORTS_BACKEND === 'postgres') return _aggregateHelpdesk6MoFromRawPg(siteName, py, pm, groups);
  const mStr = `${py}-${String(pm).padStart(2, '0')}`;
  const gParams = Array.isArray(groups) ? groups : [];
  const groupWhere = gParams.length > 0
    ? `AND tech_group IN (${gParams.map(() => '?').join(',')})`
    : '';
  const siteClause = siteName ? `AND site=?` : '';
  const siteParam  = siteName ? [siteName] : [];

  // One single aggregate query — much faster than the per-week fan-out
  // the fallback path does. SQLite's CASE expressions compute all four
  // counters in a single full scan of the month's rows.
  const row = db.prepare(`
    SELECT
      COUNT(*) as inbound,
      SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN pending_status = 0
                AND LOWER(COALESCE(overdue_status,'')) NOT IN ('1','true','yes')
               THEN 1 ELSE 0 END) as sla_ok_closed,
      SUM(CASE WHEN responded_time IS NOT NULL
                AND TRIM(responded_time) != ''
               THEN 1 ELSE 0 END) as responded,
      SUM(CASE WHEN responded_time IS NOT NULL
                AND TRIM(responded_time) != ''
                AND LOWER(COALESCE(first_response_overdue,'')) NOT IN ('1','true','yes')
               THEN 1 ELSE 0 END) as frt_ok_responded
    FROM request_records
    WHERE strftime('%Y-%m', created_time) = ?
      ${siteClause}
      ${groupWhere}
  `).get(mStr, ...siteParam, ...gParams);

  return {
    inbound:        row.inbound        || 0,
    closed:         row.closed         || 0,
    res_sla_pct:    row.closed    > 0  ? Math.round(row.sla_ok_closed   / row.closed    * 100) : null,
    reply_sla_pct:  row.responded > 0  ? Math.round(row.frt_ok_responded / row.responded * 100) : null,
  };
}

// Resolve a sites-table id to the canonical site name used in request_records.
// Returns null when site_id is unset (= All Sites filter).
function _siteIdToName(site_id) {
  if (REPORTS_BACKEND === 'postgres') return _siteIdToNamePg(site_id);
  if (!site_id) return null;
  try {
    const row = db.prepare('SELECT name FROM sites WHERE id = ?').get(site_id);
    return row ? row.name : null;
  } catch (_) { return null; }
}
async function _siteIdToNamePg(site_id) {
  if (!site_id) return null;
  try {
    const row = await pgHandle().prepare('SELECT name FROM sites WHERE id = ?').get(site_id);
    return row ? row.name : null;
  } catch (_) { return null; }
}
// pg fork: single aggregate query — strftime('%Y-%m',created_time)=? → to_char(...,'YYYY-MM')=?.
async function _aggregateHelpdesk6MoFromRawPg(siteName, py, pm, groups) {
  const H = pgHandle();
  const mStr = `${py}-${String(pm).padStart(2, '0')}`;
  const gParams = Array.isArray(groups) ? groups : [];
  const groupWhere = gParams.length > 0 ? `AND tech_group IN (${gParams.map(() => '?').join(',')})` : '';
  const siteClause = siteName ? `AND site=?` : '';
  const siteParam  = siteName ? [siteName] : [];
  const row = await H.prepare(`
    SELECT COUNT(*) as inbound,
      SUM(CASE WHEN pending_status = 0 THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN pending_status = 0 AND LOWER(COALESCE(overdue_status::text,'')) NOT IN ('1','true','yes') THEN 1 ELSE 0 END) as sla_ok_closed,
      SUM(CASE WHEN responded_time IS NOT NULL AND TRIM(responded_time) != '' THEN 1 ELSE 0 END) as responded,
      SUM(CASE WHEN responded_time IS NOT NULL AND TRIM(responded_time) != '' AND LOWER(COALESCE(first_response_overdue,'')) NOT IN ('1','true','yes') THEN 1 ELSE 0 END) as frt_ok_responded
    FROM request_records
    WHERE to_char(created_time::timestamptz,'YYYY-MM') = ? ${siteClause} ${groupWhere}
  `).get(mStr, ...siteParam, ...gParams);
  return {
    inbound: row.inbound || 0, closed: row.closed || 0,
    res_sla_pct:   row.closed    > 0 ? Math.round(row.sla_ok_closed   / row.closed    * 100) : null,
    reply_sla_pct: row.responded > 0 ? Math.round(row.frt_ok_responded / row.responded * 100) : null,
  };
}

function getHelpdesk6MonthHistory(site_id, year, month, groups) {
  if (REPORTS_BACKEND === 'postgres') return _getHelpdesk6MonthHistoryPg(site_id, year, month, groups);
  // 2026-06-02: added `groups` param. When set, the calendar fast-path can't
  // satisfy the request (it's site-wide / group-wide aggregate) — fall through
  // to _aggregateHelpdesk6MoFromRaw which scans request_records with the group
  // filter. The KPI card on slide 2 reads h.total from buildAiSnapshot
  // (group-scoped); the 6-month bar chart on slide 3 used to read the
  // calendar fast-path (all-groups), producing a 4× scale difference on the
  // same slide. Now they match.
  const groupList = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const useRaw    = groupList.length > 0;
  const siteName  = useRaw ? _siteIdToName(site_id) : null;

  const history = [];
  for (let ago = 5; ago >= 0; ago--) {
    const d   = new Date(year, month - 1 - ago, 1);   // JS months are 0-indexed
    const py  = d.getFullYear();
    const pm  = d.getMonth() + 1;
    const lbl = d.toLocaleString('en', { month: 'short', year: 'numeric' }); // "Nov 2025"

    if (useRaw) {
      const agg = _aggregateHelpdesk6MoFromRaw(siteName, py, pm, groupList);
      history.push({
        label:         lbl,
        inbound:       agg.inbound       || null,
        closed:        agg.closed        || null,
        res_sla_pct:   agg.res_sla_pct,
        reply_sla_pct: agg.reply_sla_pct,
      });
      continue;
    }

    // ── Try calendar-based totals first (most accurate, matches Zoho AP) ──
    const cal = getCalendarMonthlyHelpdesk(site_id, py, pm);
    if (cal && cal.inbound > 0) {
      history.push({
        label:         lbl,
        inbound:       cal.inbound,
        closed:        cal.closed,
        res_sla_pct:   cal.sla_res_pct,
        reply_sla_pct: cal.sla_reply_pct,
      });
      continue;
    }

    // ── Fallback: aggregate from weekly chart_data stored in helpdesk_data ──
    const pmStr  = `${py}-${String(pm).padStart(2, '0')}`;
    const rptRows = db.prepare(`
      SELECT wr.id as report_id, w.label as week_label
      FROM weeks w
      JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?
    `).all(site_id, pmStr, pmStr);

    if (!rptRows.length) {
      history.push({ label: lbl, inbound: null, closed: null, res_sla_pct: null, reply_sla_pct: null });
      continue;
    }

    let mIn = 0, mCl = 0, resSum = 0, resN = 0, frSum = 0, frN = 0;
    for (const row of rptRows) {
      const hdRow = db.prepare(`SELECT chart_data FROM helpdesk_data WHERE report_id=?`).get(row.report_id);
      if (!hdRow || !hdRow.chart_data) continue;
      let cd;
      try { cd = JSON.parse(hdRow.chart_data); } catch(e) { continue; }
      const wks = Array.isArray(cd.weeks) ? cd.weeks : [];
      // Match week label; fall back to last entry
      const wk = wks.find(w => (w.label||'').trim().toLowerCase() === (row.week_label||'').trim().toLowerCase())
              || (wks.length ? wks[wks.length - 1] : null);
      if (!wk) continue;
      mIn += wk.inbound || 0;
      mCl += wk.closed  || 0;
      if (wk.res_ok_pct != null) { resSum += wk.res_ok_pct; resN++; }
      if (wk.fr_ok_pct  != null) { frSum  += wk.fr_ok_pct;  frN++;  }
    }

    history.push({
      label:         lbl,
      inbound:       mIn  || null,
      closed:        mCl  || null,
      res_sla_pct:   resN > 0 ? Math.round(resSum / resN) : null,
      reply_sla_pct: frN  > 0 ? Math.round(frSum  / frN)  : null,
    });
  }
  return history;
}
async function _getHelpdesk6MonthHistoryPg(site_id, year, month, groups) {
  const H = pgHandle();
  const groupList = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const useRaw = groupList.length > 0;
  const siteName = useRaw ? await _siteIdToNamePg(site_id) : null;
  const history = [];
  for (let ago = 5; ago >= 0; ago--) {
    const d = new Date(year, month - 1 - ago, 1);
    const py = d.getFullYear(), pm = d.getMonth() + 1;
    const lbl = d.toLocaleString('en', { month: 'short', year: 'numeric' });
    if (useRaw) {
      const agg = await _aggregateHelpdesk6MoFromRawPg(siteName, py, pm, groupList);
      history.push({ label: lbl, inbound: agg.inbound || null, closed: agg.closed || null, res_sla_pct: agg.res_sla_pct, reply_sla_pct: agg.reply_sla_pct });
      continue;
    }
    const cal = await _getCalendarMonthlyHelpdeskPg(site_id, py, pm);
    if (cal && cal.inbound > 0) {
      history.push({ label: lbl, inbound: cal.inbound, closed: cal.closed, res_sla_pct: cal.sla_res_pct, reply_sla_pct: cal.sla_reply_pct });
      continue;
    }
    // weekly fallback (substr dialect-safe)
    const pmStr = `${py}-${String(pm).padStart(2, '0')}`;
    const rptRows = await H.prepare(`SELECT wr.id as report_id, w.label as week_label
      FROM weeks w JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=? OR substr(w.end_date,1,7)=?`).all(site_id, pmStr, pmStr);
    if (!rptRows.length) { history.push({ label: lbl, inbound: null, closed: null, res_sla_pct: null, reply_sla_pct: null }); continue; }
    let mIn = 0, mCl = 0, resSum = 0, resN = 0, frSum = 0, frN = 0;
    for (const row of rptRows) {
      const hdRow = await H.prepare('SELECT chart_data FROM helpdesk_data WHERE report_id=?').get(row.report_id);
      if (!hdRow || !hdRow.chart_data) continue;
      let cd; try { cd = JSON.parse(hdRow.chart_data); } catch (e) { continue; }
      const wks = Array.isArray(cd.weeks) ? cd.weeks : [];
      const wk = wks.find(w => (w.label||'').trim().toLowerCase() === (row.week_label||'').trim().toLowerCase()) || (wks.length ? wks[wks.length - 1] : null);
      if (!wk) continue;
      mIn += wk.inbound || 0; mCl += wk.closed || 0;
      if (wk.res_ok_pct != null) { resSum += wk.res_ok_pct; resN++; }
      if (wk.fr_ok_pct  != null) { frSum  += wk.fr_ok_pct;  frN++;  }
    }
    history.push({ label: lbl, inbound: mIn || null, closed: mCl || null,
      res_sla_pct: resN > 0 ? Math.round(resSum / resN) : null, reply_sla_pct: frN > 0 ? Math.round(frSum / frN) : null });
  }
  return history;
}

// ── WEEKLY SUMMARY DATA (all active sites for a given week) ──────

/**
 * Returns { year, week, week_label, start_date, end_date, reports[] }
 * where reports[] contains every submitted report across active sites for that week.
 */
function getWeekSummaryData(year, week) {
  if (REPORTS_BACKEND === 'postgres') return _getWeekSummaryDataPg(year, week);
  const rows = db.prepare(`
    SELECT wr.id as report_id
    FROM weekly_reports wr
    JOIN weeks w ON w.id=wr.week_id
    JOIN sites s ON s.id=wr.site_id
    WHERE w.year=? AND w.week_number=? AND wr.status='submitted' AND s.active=1
    ORDER BY s.sort_order, s.name
  `).all(year, week);

  const weekRange = getWeekRange(year, week);
  return {
    year, week,
    week_label: weekRange.label,
    start_date: weekRange.start,
    end_date:   weekRange.end,
    reports:    rows.map(r => getReport(r.report_id)).filter(Boolean)
  };
}
async function _getWeekSummaryDataPg(year, week) {
  const H = pgHandle();
  const rows = await H.prepare(`
    SELECT wr.id as report_id FROM weekly_reports wr
    JOIN weeks w ON w.id=wr.week_id JOIN sites s ON s.id=wr.site_id
    WHERE w.year=? AND w.week_number=? AND wr.status='submitted' AND s.active=1
    ORDER BY s.sort_order, s.name`).all(year, week);
  const weekRange = getWeekRange(year, week);   // pure, sync
  const reports = (await Promise.all(rows.map(r => getReport(r.report_id)))).filter(Boolean);
  return { year, week, week_label: weekRange.label, start_date: weekRange.start, end_date: weekRange.end, reports };
}

// ── SYNC METADATA HELPERS ─────────────────────────────────────────

/** Seed default job rows so the status endpoint always has something to return */
const SYNC_JOBS = ['helpdesk', 'change_cab', 'survey', 'requests'];
const _seedJob = db.prepare(`INSERT OR IGNORE INTO sync_metadata (job_name) VALUES (?)`);
SYNC_JOBS.forEach(j => _seedJob.run(j));

/** Get the sync status for all jobs (used by /api/sync/status) */
function getSyncStatus() {
  if (REPORTS_BACKEND === 'postgres') return pgHandle().prepare(`SELECT * FROM sync_metadata ORDER BY job_name`).all();
  return db.prepare(`SELECT * FROM sync_metadata ORDER BY job_name`).all();
}

/** Get last_sync_at for a single job (used by zoho-sync.js as the incremental cursor) */
function getLastSyncAt(jobName) {
  if (REPORTS_BACKEND === 'postgres') return _getLastSyncAtPg(jobName);
  const row = db.prepare(`SELECT last_sync_at FROM sync_metadata WHERE job_name=?`).get(jobName);
  return row ? row.last_sync_at : null;
}
async function _getLastSyncAtPg(jobName) {
  const row = await pgHandle().prepare(`SELECT last_sync_at FROM sync_metadata WHERE job_name=?`).get(jobName);
  return row ? row.last_sync_at : null;
}

/** Mark a sync job as successfully completed.
 *  @param {string} jobName
 *  @param {number} rowsUpserted  - rows inserted/updated this run
 *  @param {object} [opts]
 *  @param {number} [opts.deleted]         - rows deleted (reconciliation)
 *  @param {string} [opts.schemaSnapshot]  - JSON string of column names seen
 *  @param {boolean} [opts.fullSync]       - true if this was a full reconciliation run
 */
function markSyncSuccess(jobName, rowsUpserted, opts = {}) {
  if (REPORTS_BACKEND === 'postgres') return _markSyncSuccessPg(jobName, rowsUpserted, opts);
  const { deleted = 0, schemaSnapshot = null, fullSync = false } = opts;
  db.prepare(`
    INSERT INTO sync_metadata (job_name, last_sync_at, last_sync_rows, last_error, sync_count, deleted_count, schema_snapshot, last_full_sync_at)
    VALUES (?, datetime('now'), ?, NULL, 1, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)
    ON CONFLICT(job_name) DO UPDATE SET
      last_sync_at      = datetime('now'),
      last_sync_rows    = excluded.last_sync_rows,
      last_error        = NULL,
      sync_count        = sync_count + 1,
      deleted_count     = excluded.deleted_count,
      schema_snapshot   = COALESCE(excluded.schema_snapshot, schema_snapshot),
      last_full_sync_at = CASE WHEN excluded.last_full_sync_at IS NOT NULL THEN excluded.last_full_sync_at ELSE last_full_sync_at END
  `).run(jobName, rowsUpserted, deleted, schemaSnapshot, fullSync ? 1 : 0);
}
// pg: qualify every DO-UPDATE existing-row column ref with the table name (pg requirement).
async function _markSyncSuccessPg(jobName, rowsUpserted, { deleted = 0, schemaSnapshot = null, fullSync = false } = {}) {
  await pgHandle().prepare(`
    INSERT INTO sync_metadata (job_name, last_sync_at, last_sync_rows, last_error, sync_count, deleted_count, schema_snapshot, last_full_sync_at)
    VALUES (?, now(), ?, NULL, 1, ?, ?, CASE WHEN ?::int = 1 THEN now() ELSE NULL END)
    ON CONFLICT(job_name) DO UPDATE SET
      last_sync_at      = now(),
      last_sync_rows    = EXCLUDED.last_sync_rows,
      last_error        = NULL,
      sync_count        = sync_metadata.sync_count + 1,
      deleted_count     = EXCLUDED.deleted_count,
      schema_snapshot   = COALESCE(EXCLUDED.schema_snapshot, sync_metadata.schema_snapshot),
      last_full_sync_at = CASE WHEN EXCLUDED.last_full_sync_at IS NOT NULL THEN EXCLUDED.last_full_sync_at ELSE sync_metadata.last_full_sync_at END
  `).run(jobName, rowsUpserted, deleted, schemaSnapshot, fullSync ? 1 : 0);
}

/** Record a sync error without clearing the last successful timestamp */
function markSyncError(jobName, errorMessage) {
  if (REPORTS_BACKEND === 'postgres') return _markSyncErrorPg(jobName, errorMessage);
  db.prepare(`
    INSERT INTO sync_metadata (job_name, last_error, last_error_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(job_name) DO UPDATE SET
      last_error    = excluded.last_error,
      last_error_at = datetime('now')
  `).run(jobName, String(errorMessage).slice(0, 500));
}
async function _markSyncErrorPg(jobName, errorMessage) {
  await pgHandle().prepare(`
    INSERT INTO sync_metadata (job_name, last_error, last_error_at)
    VALUES (?, ?, now())
    ON CONFLICT(job_name) DO UPDATE SET
      last_error    = EXCLUDED.last_error,
      last_error_at = now()
  `).run(jobName, String(errorMessage).slice(0, 500));
}

// ── CHANGE / CAB UPSERT HELPERS ───────────────────────────────────

const _upsertChange = db.prepare(`
  INSERT INTO change_records
    (change_id, display_id, subject, status, stage, stage_status, risk, change_type, emergency,
     category, sub_category, requester, requester_id, owner_id, manager, site_id,
     group_id, group_name, scheduled_start, scheduled_end, completed_time, created_time,
     closure_code, udf_json, fetched_at)
  VALUES
    (@change_id, @display_id, @subject, @status, @stage, @stage_status, @risk, @change_type, @emergency,
     @category, @sub_category, @requester, @requester_id, @owner_id, @manager, @site_id,
     @group_id, @group_name, @scheduled_start, @scheduled_end, @completed_time, @created_time,
     @closure_code, @udf_json, datetime('now'))
  ON CONFLICT(change_id) DO UPDATE SET
    display_id       = excluded.display_id,
    subject          = excluded.subject,
    status           = excluded.status,
    stage            = excluded.stage,
    stage_status     = excluded.stage_status,
    risk             = excluded.risk,
    change_type      = excluded.change_type,
    emergency        = excluded.emergency,
    category         = excluded.category,
    sub_category     = excluded.sub_category,
    requester        = excluded.requester,
    requester_id     = excluded.requester_id,
    owner_id         = excluded.owner_id,
    manager          = excluded.manager,
    site_id          = excluded.site_id,
    group_id         = excluded.group_id,
    group_name       = excluded.group_name,
    scheduled_start  = excluded.scheduled_start,
    scheduled_end    = excluded.scheduled_end,
    completed_time   = excluded.completed_time,
    created_time     = excluded.created_time,
    closure_code     = excluded.closure_code,
    udf_json         = excluded.udf_json,
    fetched_at       = datetime('now')
`);

const _upsertCAB = db.prepare(`
  INSERT INTO cab_approvals
    (approval_id, change_id, approver_name, approval_status, approval_stage,
     approval_level, approval_level_status, recommendation_requested, action_taken_on,
     turnaround_minutes, rule_type, comments, fetched_at)
  VALUES
    (@approval_id, @change_id, @approver_name, @approval_status, @approval_stage,
     @approval_level, @approval_level_status, @recommendation_requested, @action_taken_on,
     @turnaround_minutes, @rule_type, @comments, datetime('now'))
  ON CONFLICT(approval_id) DO UPDATE SET
    change_id                = excluded.change_id,
    approver_name            = excluded.approver_name,
    approval_status          = excluded.approval_status,
    approval_stage           = excluded.approval_stage,
    approval_level           = excluded.approval_level,
    approval_level_status    = excluded.approval_level_status,
    recommendation_requested = excluded.recommendation_requested,
    action_taken_on          = excluded.action_taken_on,
    turnaround_minutes       = excluded.turnaround_minutes,
    rule_type                = excluded.rule_type,
    comments                 = excluded.comments,
    fetched_at               = datetime('now')
`);

function upsertChangeBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertChangeBatchPg(rows);
  return _upsertChangeBatchSqlite(rows);
}
const _upsertChangeBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) { _upsertChange.run(r); n++; }
  return n;
});

function upsertCABBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertCABBatchPg(rows);
  return _upsertCABBatchSqlite(rows);
}
const _upsertCABBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) { _upsertCAB.run(r); n++; }
  return n;
});

// ── Chunk 4D-1 pg writer forks ──────────────────────────────────────────────
// Same INSERT…ON CONFLICT bodies as the sqlite prepared statements, with
// datetime('now')→now() and excluded.→EXCLUDED. Named-object binding via pgDb.
const _CHANGE_UPSERT_PG = `
  INSERT INTO change_records
    (change_id, display_id, subject, status, stage, stage_status, risk, change_type, emergency,
     category, sub_category, requester, requester_id, owner_id, manager, site_id,
     group_id, group_name, scheduled_start, scheduled_end, completed_time, created_time,
     closure_code, udf_json, fetched_at)
  VALUES
    (@change_id, @display_id, @subject, @status, @stage, @stage_status, @risk, @change_type, @emergency,
     @category, @sub_category, @requester, @requester_id, @owner_id, @manager, @site_id,
     @group_id, @group_name, @scheduled_start, @scheduled_end, @completed_time, @created_time,
     @closure_code, @udf_json, now())
  ON CONFLICT(change_id) DO UPDATE SET
    display_id = EXCLUDED.display_id, subject = EXCLUDED.subject, status = EXCLUDED.status,
    stage = EXCLUDED.stage, stage_status = EXCLUDED.stage_status, risk = EXCLUDED.risk,
    change_type = EXCLUDED.change_type, emergency = EXCLUDED.emergency, category = EXCLUDED.category,
    sub_category = EXCLUDED.sub_category, requester = EXCLUDED.requester, requester_id = EXCLUDED.requester_id,
    owner_id = EXCLUDED.owner_id, manager = EXCLUDED.manager, site_id = EXCLUDED.site_id,
    group_id = EXCLUDED.group_id, group_name = EXCLUDED.group_name, scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end, completed_time = EXCLUDED.completed_time, created_time = EXCLUDED.created_time,
    closure_code = EXCLUDED.closure_code, udf_json = EXCLUDED.udf_json, fetched_at = now()`;
async function _upsertChangeBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => { for (const r of (rows || [])) { await H.prepare(_CHANGE_UPSERT_PG).run(r); n++; } });
  return n;
}
const _CAB_UPSERT_PG = `
  INSERT INTO cab_approvals
    (approval_id, change_id, approver_name, approval_status, approval_stage,
     approval_level, approval_level_status, recommendation_requested, action_taken_on,
     turnaround_minutes, rule_type, comments, fetched_at)
  VALUES
    (@approval_id, @change_id, @approver_name, @approval_status, @approval_stage,
     @approval_level, @approval_level_status, @recommendation_requested, @action_taken_on,
     @turnaround_minutes, @rule_type, @comments, now())
  ON CONFLICT(approval_id) DO UPDATE SET
    change_id = EXCLUDED.change_id, approver_name = EXCLUDED.approver_name,
    approval_status = EXCLUDED.approval_status, approval_stage = EXCLUDED.approval_stage,
    approval_level = EXCLUDED.approval_level, approval_level_status = EXCLUDED.approval_level_status,
    recommendation_requested = EXCLUDED.recommendation_requested, action_taken_on = EXCLUDED.action_taken_on,
    turnaround_minutes = EXCLUDED.turnaround_minutes, rule_type = EXCLUDED.rule_type,
    comments = EXCLUDED.comments, fetched_at = now()`;
async function _upsertCABBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => { for (const r of (rows || [])) { await H.prepare(_CAB_UPSERT_PG).run(r); n++; } });
  return n;
}

// ── SURVEY UPSERT HELPERS ─────────────────────────────────────────

const _upsertSurveyResult = db.prepare(`
  INSERT INTO survey_results
    (result_id, response_id, survey_id, survey_name, request_id,
     request_display_id, change_id, user_id, overall_score,
     survey_sent_on, survey_responded_on, fetched_at)
  VALUES
    (@result_id, @response_id, @survey_id, @survey_name, @request_id,
     @request_display_id, @change_id, @user_id, @overall_score,
     @survey_sent_on, @survey_responded_on, datetime('now'))
  ON CONFLICT(result_id) DO UPDATE SET
    response_id         = excluded.response_id,
    survey_id           = excluded.survey_id,
    survey_name         = excluded.survey_name,
    request_id          = excluded.request_id,
    request_display_id  = excluded.request_display_id,
    change_id           = excluded.change_id,
    user_id             = excluded.user_id,
    overall_score       = excluded.overall_score,
    survey_sent_on      = excluded.survey_sent_on,
    survey_responded_on = excluded.survey_responded_on,
    fetched_at          = datetime('now')
`);

const _upsertSurveyAnswer = db.prepare(`
  INSERT INTO survey_answers
    (response_id, result_id, question_id, question_text, question_type,
     answer_text, answer_option, score, skipped, fetched_at)
  VALUES
    (@response_id, @result_id, @question_id, @question_text, @question_type,
     @answer_text, @answer_option, @score, @skipped, datetime('now'))
  ON CONFLICT DO NOTHING
`);

function upsertSurveyResultBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertSurveyResultBatchPg(rows);
  return _upsertSurveyResultBatchSqlite(rows);
}
const _upsertSurveyResultBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) { _upsertSurveyResult.run(r); n++; }
  return n;
});

function upsertSurveyAnswerBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertSurveyAnswerBatchPg(rows);
  return _upsertSurveyAnswerBatchSqlite(rows);
}
const _upsertSurveyAnswerBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) { _upsertSurveyAnswer.run(r); n++; }
  return n;
});

const _SURVEY_RESULT_UPSERT_PG = `
  INSERT INTO survey_results
    (result_id, response_id, survey_id, survey_name, request_id,
     request_display_id, change_id, user_id, overall_score,
     survey_sent_on, survey_responded_on, fetched_at)
  VALUES
    (@result_id, @response_id, @survey_id, @survey_name, @request_id,
     @request_display_id, @change_id, @user_id, @overall_score,
     @survey_sent_on, @survey_responded_on, now())
  ON CONFLICT(result_id) DO UPDATE SET
    response_id = EXCLUDED.response_id, survey_id = EXCLUDED.survey_id, survey_name = EXCLUDED.survey_name,
    request_id = EXCLUDED.request_id, request_display_id = EXCLUDED.request_display_id,
    change_id = EXCLUDED.change_id, user_id = EXCLUDED.user_id, overall_score = EXCLUDED.overall_score,
    survey_sent_on = EXCLUDED.survey_sent_on, survey_responded_on = EXCLUDED.survey_responded_on,
    fetched_at = now()`;
async function _upsertSurveyResultBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => { for (const r of (rows || [])) { await H.prepare(_SURVEY_RESULT_UPSERT_PG).run(r); n++; } });
  return n;
}
// Append-only: bare ON CONFLICT DO NOTHING, no conflict target (survey_answers has no UNIQUE).
const _SURVEY_ANSWER_INSERT_PG = `
  INSERT INTO survey_answers
    (response_id, result_id, question_id, question_text, question_type,
     answer_text, answer_option, score, skipped, fetched_at)
  VALUES
    (@response_id, @result_id, @question_id, @question_text, @question_type,
     @answer_text, @answer_option, @score, @skipped, now())
  ON CONFLICT DO NOTHING`;
async function _upsertSurveyAnswerBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => { for (const r of (rows || [])) { await H.prepare(_SURVEY_ANSWER_INSERT_PG).run(r); n++; } });
  return n;
}

// ── REQUEST UPSERT HELPERS ────────────────────────────────────────

const _upsertRequest = db.prepare(`
  INSERT INTO request_records
    (request_id, display_id, subject, request_status, pending_status, overdue_status,
     request_type, template, service_request, is_escalated, reopen_count, due_by_time, time_elapsed_ms,
     created_time, resolved_time, completed_time, responded_time, assigned_time,
     last_updated_time, first_response_overdue, technician, requester,
     category, sub_category, site, tech_group, mode, impact, fetched_at)
  VALUES
    (@request_id, @display_id, @subject, @request_status, @pending_status, @overdue_status,
     @request_type, @template, @service_request, @is_escalated, @reopen_count, @due_by_time, @time_elapsed_ms,
     @created_time, @resolved_time, @completed_time, @responded_time, @assigned_time,
     @last_updated_time, @first_response_overdue, @technician, @requester,
     @category, @sub_category, @site, @tech_group, @mode, @impact, datetime('now'))
  ON CONFLICT(request_id) DO UPDATE SET
    display_id             = excluded.display_id,
    subject                = excluded.subject,
    request_status         = excluded.request_status,
    pending_status         = excluded.pending_status,
    overdue_status         = excluded.overdue_status,
    request_type           = excluded.request_type,
    template               = excluded.template,
    service_request        = excluded.service_request,
    is_escalated           = excluded.is_escalated,
    reopen_count           = excluded.reopen_count,
    due_by_time            = excluded.due_by_time,
    time_elapsed_ms        = excluded.time_elapsed_ms,
    created_time           = excluded.created_time,
    resolved_time          = excluded.resolved_time,
    completed_time         = excluded.completed_time,
    responded_time         = excluded.responded_time,
    assigned_time          = excluded.assigned_time,
    last_updated_time      = excluded.last_updated_time,
    first_response_overdue = excluded.first_response_overdue,
    technician             = excluded.technician,
    requester              = excluded.requester,
    category               = excluded.category,
    sub_category           = excluded.sub_category,
    site                   = excluded.site,
    tech_group             = excluded.tech_group,
    mode                   = excluded.mode,
    impact                 = excluded.impact,
    fetched_at             = datetime('now')
`);

function upsertRequestBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertRequestBatchPg(rows);
  return _upsertRequestBatchSqlite(rows);
}
const _upsertRequestBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) { _upsertRequest.run(r); n++; }
  return n;
});
// NOTE: no udf_json here — udf_json is written ONLY by upsertRequestUdfBatch.
const _REQUEST_UPSERT_PG = `
  INSERT INTO request_records
    (request_id, display_id, subject, request_status, pending_status, overdue_status,
     request_type, template, service_request, is_escalated, reopen_count, due_by_time, time_elapsed_ms,
     created_time, resolved_time, completed_time, responded_time, assigned_time,
     last_updated_time, first_response_overdue, technician, requester,
     category, sub_category, site, tech_group, mode, impact, fetched_at)
  VALUES
    (@request_id, @display_id, @subject, @request_status, @pending_status, @overdue_status,
     @request_type, @template, @service_request, @is_escalated, @reopen_count, @due_by_time, @time_elapsed_ms,
     @created_time, @resolved_time, @completed_time, @responded_time, @assigned_time,
     @last_updated_time, @first_response_overdue, @technician, @requester,
     @category, @sub_category, @site, @tech_group, @mode, @impact, now())
  ON CONFLICT(request_id) DO UPDATE SET
    display_id = EXCLUDED.display_id, subject = EXCLUDED.subject, request_status = EXCLUDED.request_status,
    pending_status = EXCLUDED.pending_status, overdue_status = EXCLUDED.overdue_status,
    request_type = EXCLUDED.request_type, template = EXCLUDED.template, service_request = EXCLUDED.service_request,
    is_escalated = EXCLUDED.is_escalated, reopen_count = EXCLUDED.reopen_count,
    due_by_time = EXCLUDED.due_by_time, time_elapsed_ms = EXCLUDED.time_elapsed_ms,
    created_time = EXCLUDED.created_time, resolved_time = EXCLUDED.resolved_time,
    completed_time = EXCLUDED.completed_time, responded_time = EXCLUDED.responded_time,
    assigned_time = EXCLUDED.assigned_time, last_updated_time = EXCLUDED.last_updated_time,
    first_response_overdue = EXCLUDED.first_response_overdue, technician = EXCLUDED.technician,
    requester = EXCLUDED.requester, category = EXCLUDED.category, sub_category = EXCLUDED.sub_category,
    site = EXCLUDED.site, tech_group = EXCLUDED.tech_group, mode = EXCLUDED.mode, impact = EXCLUDED.impact,
    fetched_at = now()`;
async function _upsertRequestBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => { for (const r of (rows || [])) { await H.prepare(_REQUEST_UPSERT_PG).run(r); n++; } });
  return n;
}

// UDF-only updater. Used by the MAJOR_INCIDENTS backfill step in zoho-sync —
// the MAJOR_INCIDENTS Zoho view (790842) is the only place that exposes
// UDF columns (Root Cause Analysis, Corrective Action, Lessons Learned, …).
// We never INSERT here: if the request_id isn't already in request_records
// (because the regular REQUEST sync hasn't run yet, or the row was deleted),
// we silently skip rather than create a phantom row missing all the base
// fields. Returns count of rows actually updated (changes > 0).
const _upsertRequestUdf = db.prepare(`
  UPDATE request_records
     SET udf_json = ?,
         fetched_at = datetime('now')
   WHERE request_id = ?
`);

// 2026-06-02 fallback: when the long Zoho request_id doesn't match (typically
// because the MAJOR_INCIDENTS view exposes only the short display_id), try
// matching on display_id instead. This is safe because display_id is also a
// unique identifier in request_records (PRIMARY KEY-like in practice — Zoho
// allocates them monotonically per workspace).
const _upsertRequestUdfByDisplayId = db.prepare(`
  UPDATE request_records
     SET udf_json = ?,
         fetched_at = datetime('now')
   WHERE display_id = ?
`);

function upsertRequestUdfBatch(rows) {
  if (REPORTS_BACKEND === 'postgres') return _upsertRequestUdfBatchPg(rows);
  return _upsertRequestUdfBatchSqlite(rows);
}
const _upsertRequestUdfBatchSqlite = db.transaction((rows) => {
  let n = 0;
  for (const r of rows) {
    // Primary path: match on the long Zoho id.
    let result = _upsertRequestUdf.run(r.udf_json, r.request_id);
    if (result.changes === 0) {
      // Fallback: match on display id. zoho-sync.js sets _ridKind='display'
      // when it had to fall back to the display-id column on the source row;
      // even when it set 'long', the value MAY accidentally be a display id
      // if the view's "Request ID" column was misconfigured, so we try the
      // display-id path unconditionally on miss.
      result = _upsertRequestUdfByDisplayId.run(r.udf_json, r.request_id);
    }
    if (result.changes > 0) n++;
  }
  return n;
});
// Two-step UPDATE (positional ?): by request_id, fallback by display_id on miss.
async function _upsertRequestUdfBatchPg(rows) {
  const H = pgHandle(); let n = 0;
  await H.runTransaction(async () => {
    for (const r of (rows || [])) {
      let result = await H.prepare(`UPDATE request_records SET udf_json = ?, fetched_at = now() WHERE request_id = ?`).run(r.udf_json, r.request_id);
      if (result.changes === 0) {
        result = await H.prepare(`UPDATE request_records SET udf_json = ?, fetched_at = now() WHERE display_id = ?`).run(r.udf_json, r.request_id);
      }
      if (result.changes > 0) n++;
    }
  });
  return n;
}

// ── RECONCILIATION HELPERS ────────────────────────────────────────
// Used during full syncs to remove records deleted in Zoho.

/**
 * Delete change_records whose change_id is NOT in the provided set.
 * Returns number of rows deleted.
 */
function reconcileChangeRecords(liveIds) {
  if (REPORTS_BACKEND === 'postgres') return _reconcilePg('change_records', 'change_id', liveIds);
  if (!liveIds || liveIds.size === 0) return 0;
  // SQLite doesn't support NOT IN with very large arrays well,
  // so we get all local IDs and delete the diff in a transaction.
  const localIds = db.prepare(`SELECT change_id FROM change_records`).all().map(r => r.change_id);
  const toDelete = localIds.filter(id => !liveIds.has(id));
  if (toDelete.length === 0) return 0;
  const del = db.prepare(`DELETE FROM change_records WHERE change_id = ?`);
  const runAll = db.transaction(ids => { ids.forEach(id => del.run(id)); });
  runAll(toDelete);
  console.log(`[DB] reconcileChangeRecords — deleted ${toDelete.length} stale records`);
  return toDelete.length;
}

/**
 * Delete cab_approvals whose approval_id is NOT in the provided set.
 */
function reconcileCABApprovals(liveIds) {
  if (REPORTS_BACKEND === 'postgres') return _reconcilePg('cab_approvals', 'approval_id', liveIds);
  if (!liveIds || liveIds.size === 0) return 0;
  const localIds = db.prepare(`SELECT approval_id FROM cab_approvals`).all().map(r => r.approval_id);
  const toDelete = localIds.filter(id => !liveIds.has(id));
  if (toDelete.length === 0) return 0;
  const del = db.prepare(`DELETE FROM cab_approvals WHERE approval_id = ?`);
  const runAll = db.transaction(ids => { ids.forEach(id => del.run(id)); });
  runAll(toDelete);
  console.log(`[DB] reconcileCABApprovals — deleted ${toDelete.length} stale records`);
  return toDelete.length;
}

/**
 * Delete survey_results whose result_id is NOT in the provided set.
 * Also cascades: survey_answers with those response_ids are removed.
 */
function reconcileSurveyResults(liveIds) {
  if (REPORTS_BACKEND === 'postgres') return _reconcileSurveyResultsPg(liveIds);
  if (!liveIds || liveIds.size === 0) return 0;
  const localRows = db.prepare(`SELECT result_id, response_id FROM survey_results`).all();
  const toDelete  = localRows.filter(r => !liveIds.has(r.result_id));
  if (toDelete.length === 0) return 0;
  const delResult  = db.prepare(`DELETE FROM survey_results  WHERE result_id   = ?`);
  const delAnswers = db.prepare(`DELETE FROM survey_answers  WHERE response_id = ?`);
  const runAll = db.transaction(rows => {
    rows.forEach(r => { delResult.run(r.result_id); delAnswers.run(r.response_id); });
  });
  runAll(toDelete);
  console.log(`[DB] reconcileSurveyResults — deleted ${toDelete.length} stale results (+answers)`);
  return toDelete.length;
}

/**
 * Delete request_records whose request_id is NOT in the provided set.
 */
function reconcileRequestRecords(liveIds) {
  if (REPORTS_BACKEND === 'postgres') return _reconcilePg('request_records', 'request_id', liveIds);
  if (!liveIds || liveIds.size === 0) return 0;
  const localIds = db.prepare(`SELECT request_id FROM request_records`).all().map(r => r.request_id);
  const toDelete = localIds.filter(id => !liveIds.has(id));
  if (toDelete.length === 0) return 0;
  const del = db.prepare(`DELETE FROM request_records WHERE request_id = ?`);
  const runAll = db.transaction(ids => { ids.forEach(id => del.run(id)); });
  runAll(toDelete);
  console.log(`[DB] reconcileRequestRecords — deleted ${toDelete.length} stale records`);
  return toDelete.length;
}

// ── Chunk 4D-1 pg reconcilers ───────────────────────────────────────────────
// Generic single-id-column reconciler (change/CAB/request). Reads local ids,
// diffs vs the liveIds Set, deletes the stale ones in a transaction.
async function _reconcilePg(table, idCol, liveIds) {
  if (!liveIds || liveIds.size === 0) return 0;
  const H = pgHandle();
  const localIds = (await H.prepare(`SELECT ${idCol} FROM ${table}`).all()).map(r => r[idCol]);
  const toDelete = localIds.filter(id => !liveIds.has(id));
  if (toDelete.length === 0) return 0;
  await H.runTransaction(async () => { for (const id of toDelete) await H.prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(id); });
  console.log(`[DB] reconcile ${table} (pg) — deleted ${toDelete.length} stale records`);
  return toDelete.length;
}
// survey_results reconciler also cascades to survey_answers (by response_id).
async function _reconcileSurveyResultsPg(liveIds) {
  if (!liveIds || liveIds.size === 0) return 0;
  const H = pgHandle();
  const localRows = await H.prepare(`SELECT result_id, response_id FROM survey_results`).all();
  const toDelete = localRows.filter(r => !liveIds.has(r.result_id));
  if (toDelete.length === 0) return 0;
  await H.runTransaction(async () => {
    for (const r of toDelete) {
      await H.prepare(`DELETE FROM survey_results WHERE result_id = ?`).run(r.result_id);
      await H.prepare(`DELETE FROM survey_answers WHERE response_id = ?`).run(r.response_id);
    }
  });
  console.log(`[DB] reconcileSurveyResults (pg) — deleted ${toDelete.length} stale results (+answers)`);
  return toDelete.length;
}

// ── QUERY HELPERS FOR API ENDPOINTS ──────────────────────────────

function getChangeRecords({ limit = 200, offset = 0, status, site_id, since } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getChangeRecordsPg({ limit, offset, status, site_id, since });
  let sql = `SELECT * FROM change_records WHERE 1=1`;
  const p = [];
  if (status)  { sql += ` AND status=?`;       p.push(status); }
  if (site_id) { sql += ` AND site_id=?`;      p.push(site_id); }
  if (since)   { sql += ` AND created_time>=?`; p.push(since); }
  sql += ` ORDER BY created_time DESC LIMIT ? OFFSET ?`;
  p.push(limit, offset);
  return db.prepare(sql).all(...p);
}
async function _getChangeRecordsPg({ limit = 200, offset = 0, status, site_id, since } = {}) {
  let sql = `SELECT * FROM change_records WHERE 1=1`; const p = [];
  if (status)  { sql += ` AND status=?`;        p.push(status); }
  if (site_id) { sql += ` AND site_id=?`;       p.push(site_id); }
  if (since)   { sql += ` AND created_time>=?`; p.push(since); }
  sql += ` ORDER BY created_time DESC LIMIT ? OFFSET ?`; p.push(limit, offset);
  return pgHandle().prepare(sql).all(...p);
}

function getCABApprovals({ change_id, status, limit = 500 } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getCABApprovalsPg({ change_id, status, limit });
  let sql = `SELECT * FROM cab_approvals WHERE 1=1`;
  const p = [];
  if (change_id) { sql += ` AND change_id=?`;       p.push(change_id); }
  if (status)    { sql += ` AND approval_status=?`; p.push(status); }
  sql += ` ORDER BY recommendation_requested DESC LIMIT ?`;
  p.push(limit);
  return db.prepare(sql).all(...p);
}
async function _getCABApprovalsPg({ change_id, status, limit = 500 } = {}) {
  let sql = `SELECT * FROM cab_approvals WHERE 1=1`; const p = [];
  if (change_id) { sql += ` AND change_id=?`;       p.push(change_id); }
  if (status)    { sql += ` AND approval_status=?`; p.push(status); }
  sql += ` ORDER BY recommendation_requested DESC LIMIT ?`; p.push(limit);
  return pgHandle().prepare(sql).all(...p);
}

function getSurveyResults({ limit = 500, offset = 0, since } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSurveyResultsPg({ limit, offset, since });
  let sql = `SELECT * FROM survey_results WHERE 1=1`;
  const p = [];
  if (since) { sql += ` AND survey_sent_on>=?`; p.push(since); }
  sql += ` ORDER BY survey_sent_on DESC LIMIT ? OFFSET ?`;
  p.push(limit, offset);
  return db.prepare(sql).all(...p);
}
async function _getSurveyResultsPg({ limit = 500, offset = 0, since } = {}) {
  let sql = `SELECT * FROM survey_results WHERE 1=1`; const p = [];
  if (since) { sql += ` AND survey_sent_on>=?`; p.push(since); }
  sql += ` ORDER BY survey_sent_on DESC LIMIT ? OFFSET ?`; p.push(limit, offset);
  return pgHandle().prepare(sql).all(...p);
}

function getSurveyAnswers(response_id) {
  if (REPORTS_BACKEND === 'postgres') return pgHandle().prepare(`SELECT * FROM survey_answers WHERE response_id=? ORDER BY id`).all(response_id);
  return db.prepare(`SELECT * FROM survey_answers WHERE response_id=? ORDER BY id`).all(response_id);
}

// ── /api/survey/voice readers (replace the route's raw rdb.db.prepare reads) ──
// Per-response context (full table, voice columns) — feeds the voice cache's resultMap.
const _VOICE_RESULTS_SQL = `SELECT response_id, request_id, request_display_id, overall_score, survey_responded_on, survey_sent_on FROM survey_results`;
function getSurveyResultsForVoice() {
  if (REPORTS_BACKEND === 'postgres') return pgHandle().prepare(_VOICE_RESULTS_SQL).all();
  return db.prepare(_VOICE_RESULTS_SQL).all();
}
// Candidate free-text answers — skipped=0 with non-empty text OR a long option (>25 chars).
// No dialect rewrite: skipped is INTEGER; TRIM/LENGTH/IS NOT NULL are pg-valid. (The route's
// extra text.length<5 floor stays in the route's JS extraction loop.)
const _VOICE_ANSWERS_SQL = `
  SELECT response_id, answer_text, answer_option
  FROM survey_answers
  WHERE skipped = 0
    AND ( (answer_text   IS NOT NULL AND TRIM(answer_text)   != '')
       OR (answer_option IS NOT NULL AND LENGTH(answer_option) > 25) )`;
function getSurveyVoiceAnswers() {
  if (REPORTS_BACKEND === 'postgres') return pgHandle().prepare(_VOICE_ANSWERS_SQL).all();
  return db.prepare(_VOICE_ANSWERS_SQL).all();
}

function getRequestRecords({ limit = 200, offset = 0, status, site, since, pending_only, overdue_only } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getRequestRecordsPg({ limit, offset, status, site, since, pending_only, overdue_only });
  let sql = `SELECT * FROM request_records WHERE 1=1`;
  const p = [];
  if (status)       { sql += ` AND request_status=?`;   p.push(status); }
  if (site)         { sql += ` AND site=?`;              p.push(site); }
  if (since)        { sql += ` AND created_time>=?`;     p.push(since); }
  if (pending_only) { sql += ` AND pending_status=1`; }
  if (overdue_only) { sql += ` AND overdue_status=1`; }
  sql += ` ORDER BY created_time DESC LIMIT ? OFFSET ?`;
  p.push(limit, offset);
  return db.prepare(sql).all(...p);
}
async function _getRequestRecordsPg({ limit = 200, offset = 0, status, site, since, pending_only, overdue_only } = {}) {
  let sql = `SELECT * FROM request_records WHERE 1=1`; const p = [];
  if (status)       { sql += ` AND request_status=?`;   p.push(status); }
  if (site)         { sql += ` AND site=?`;              p.push(site); }
  if (since)        { sql += ` AND created_time>=?`;     p.push(since); }
  if (pending_only) { sql += ` AND pending_status=1`; }
  if (overdue_only) { sql += ` AND overdue_status=1`; }
  sql += ` ORDER BY created_time DESC LIMIT ? OFFSET ?`; p.push(limit, offset);
  return pgHandle().prepare(sql).all(...p);
}

// ── 4D-wiring-1: readers that replace raw-sqlite-handle reads in server.js ──

// ALL request_records since a cutoff, ASC — feeds server.js _rebuildCacheFromSQLite (_rawCache).
// Unpaginated (vs the paginated getRequestRecords above). Raw-ISO cutoff on TEXT created_time → no cast.
function getRequestRecordsSince(cutoffISO) {
  if (REPORTS_BACKEND === 'postgres') return _getRequestRecordsSincePg(cutoffISO);
  return db.prepare(`SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC`).all(cutoffISO);
}
async function _getRequestRecordsSincePg(cutoffISO) {
  return await pgHandle().prepare(`SELECT * FROM request_records WHERE created_time >= ? ORDER BY created_time ASC`).all(cutoffISO);
}

// Submission-channels counts — feeds server.js /api/data/submission-channels. strftime→to_char;
// GROUP BY channel (alias ≠ the `mode` column it transforms → no shadowing). Returns {channel, cnt}.
function getSubmissionChannelsDB({ yr, mo, site, groups } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSubmissionChannelsDBPg({ yr, mo, site, groups });
  const { where, p } = _submChWhere({ yr, mo, site, groups }, 'sqlite');
  return db.prepare(`SELECT CASE WHEN mode IS NULL OR mode='' OR lower(mode)='unknown' THEN NULL ELSE mode END AS channel, COUNT(*) AS cnt FROM request_records WHERE 1=1 ${where} GROUP BY channel ORDER BY cnt DESC`).all(...p);
}
async function _getSubmissionChannelsDBPg({ yr, mo, site, groups } = {}) {
  const { where, p } = _submChWhere({ yr, mo, site, groups }, 'pg');
  return await pgHandle().prepare(`SELECT CASE WHEN mode IS NULL OR mode='' OR lower(mode)='unknown' THEN NULL ELSE mode END AS channel, COUNT(*) AS cnt FROM request_records WHERE 1=1 ${where} GROUP BY channel ORDER BY cnt DESC`).all(...p);
}
// Shared WHERE builder — clause + param order kept CONSISTENT (date → site → groups) so the
// positional binding aligns even when site AND groups are both passed (the inline route this
// replaces had a latent misalignment). Only the strftime→to_char differs by dialect.
function _submChWhere({ yr, mo, site, groups }, dialect) {
  const p = []; let where = '';
  const ym = dialect === 'pg'
    ? { m: `to_char(created_time::timestamptz,'YYYY-MM')`, y: `to_char(created_time::timestamptz,'YYYY')` }
    : { m: `strftime('%Y-%m', created_time)`, y: `strftime('%Y', created_time)` };
  if (yr && mo) { where += ` AND ${ym.m} = ?`; p.push(`${yr}-${String(mo).padStart(2,'0')}`); }
  else if (yr)  { where += ` AND ${ym.y} = ?`; p.push(String(yr)); }
  if (site && site !== 'all') { where += ` AND site = ?`; p.push(site); }
  const gl = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (gl.length) { where += ` AND tech_group IN (${gl.map(()=>'?').join(',')})`; p.push(...gl); }
  return { where, p };
}

// Survey KPI source rows — feeds server.js /api/survey/kpis. Returns { rows1, rows2 } (the handler
// keeps its JS reductions). q1 = period+group-filtered scores; q2 = 12-mo trend (lexical cutoff,
// computed here from yr/mo — mirrors the route's old inline block). strftime→to_char on q1; the
// q2 COALESCE(...) >= ? cutoff is a lexical TEXT compare → UNCHANGED. JOIN sr.request_id=rr.request_id.
function getSurveyKpisDB({ yr, mo, groups } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSurveyKpisDBPg({ yr, mo, groups });
  const q = _surveyKpiQueries({ yr, mo, groups }, 'sqlite');
  return { rows1: db.prepare(q.q1).all(...q.p1), rows2: db.prepare(q.q2).all(...q.p2) };
}
async function _getSurveyKpisDBPg({ yr, mo, groups } = {}) {
  const H = pgHandle();
  const q = _surveyKpiQueries({ yr, mo, groups }, 'pg');
  return { rows1: await H.prepare(q.q1).all(...q.p1), rows2: await H.prepare(q.q2).all(...q.p2) };
}
function _surveyKpiQueries({ yr, mo, groups }, dialect) {
  const gl = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const ym = dialect === 'pg'
    ? { m: `to_char(COALESCE(sr.survey_responded_on, sr.survey_sent_on)::timestamptz,'YYYY-MM')`,
        y: `to_char(COALESCE(sr.survey_responded_on, sr.survey_sent_on)::timestamptz,'YYYY')` }
    : { m: `strftime('%Y-%m', COALESCE(sr.survey_responded_on, sr.survey_sent_on))`,
        y: `strftime('%Y', COALESCE(sr.survey_responded_on, sr.survey_sent_on))` };
  // q1 — period + group filtered scores
  let dWhere = '', p1 = [];
  if (yr && mo) { dWhere = ` AND ${ym.m} = ?`; p1.push(`${yr}-${String(mo).padStart(2,'0')}`); }
  else if (yr)  { dWhere = ` AND ${ym.y} = ?`; p1.push(String(yr)); }
  let gWhere = '';
  if (gl.length) { gWhere = ` AND rr.tech_group IN (${gl.map(()=>'?').join(',')})`; p1.push(...gl); }
  const q1 = `SELECT sr.overall_score FROM survey_results sr LEFT JOIN request_records rr ON sr.request_id = rr.request_id WHERE sr.overall_score IS NOT NULL ${dWhere} ${gWhere}`;
  // q2 — 12-mo trend; cutoff computed here (mirrors server.js old inline block)
  let cut;
  if (yr && mo) { const d = new Date(parseInt(yr), parseInt(mo)-1, 1); d.setMonth(d.getMonth()-11); cut = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
  else { const d = new Date(); d.setMonth(d.getMonth()-11); d.setDate(1); cut = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }
  const p2 = [cut]; let g2 = '';
  if (gl.length) { g2 = ` AND rr.tech_group IN (${gl.map(()=>'?').join(',')})`; p2.push(...gl); }
  const q2 = `SELECT sr.overall_score, COALESCE(sr.survey_responded_on, sr.survey_sent_on) as responded_on FROM survey_results sr LEFT JOIN request_records rr ON sr.request_id = rr.request_id WHERE sr.overall_score IS NOT NULL AND COALESCE(sr.survey_responded_on, sr.survey_sent_on) >= ? ${g2}`;
  return { q1, p1, q2, p2 };
}

// ── COMPUTED METRICS (replicate Zoho Analytics aggregate formulas) ─

/**
 * Change KPIs from change_records.
 * Replicates: Completed_Change_Count, All_Introduced_Change_Finalized_Count,
 *             Change Success Rate, In Progress, emergency count, avg days, breakdown by status/risk/type.
 * Optional filters: site_id, since (ISO date string for created_time).
 */
function getChangeMetrics({ site_id, since } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getChangeMetricsPg({ site_id, since });
  let where = 'WHERE 1=1';
  const p = [];
  if (site_id) { where += ' AND site_id=?';      p.push(site_id); }
  if (since)   { where += ' AND created_time>=?'; p.push(since);   }

  const total    = db.prepare(`SELECT COUNT(*) as n FROM change_records ${where}`).get(...p).n;
  const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM change_records ${where} GROUP BY status ORDER BY count DESC`).all(...p);

  const failedCount = db.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where}
     AND (status='Failed' OR (stage='Close' AND status='Backout'))`
  ).get(...p).n;

  const byRisk  = db.prepare(`SELECT risk, COUNT(*) as count FROM change_records ${where} GROUP BY risk ORDER BY count DESC`).all(...p);
  const byType  = db.prepare(`SELECT change_type, COUNT(*) as count FROM change_records ${where} GROUP BY change_type ORDER BY count DESC`).all(...p);
  const bySite  = db.prepare(`SELECT site_id, COUNT(*) as count FROM change_records ${where} GROUP BY site_id ORDER BY count DESC`).all(...p);

  // Emergency changes — field stored as INTEGER 1/0 or text 'true'/'false'
  const emergCount = db.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where} AND (emergency=1 OR emergency='true' OR emergency='1')`
  ).get(...p).n;

  // In Progress: scheduled_start is in the past AND not yet closed
  // Mirrors Zoho formula: Days Left Until Scheduled Start <= 0 AND Stage+Status != 'Close - Completed'/'Close - Cancelled'
  const inProgress = db.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where}
     AND scheduled_start <= datetime('now')
     AND (stage || ' - ' || status) NOT IN ('Close - Completed','Close - Cancelled')`
  ).get(...p).n;

  // Avg completion time: scheduled_start → completed_time (for Completed records only)
  const avgDaysRow = db.prepare(
    `SELECT ROUND(AVG(JULIANDAY(completed_time) - JULIANDAY(scheduled_start)), 1) as avg_days
     FROM change_records ${where}
     AND status='Completed' AND completed_time IS NOT NULL AND scheduled_start IS NOT NULL`
  ).get(...p);

  return _assembleChangeMetrics({ total, byStatus, failedCount, byRisk, byType, bySite, emergCount, inProgress, avgDaysRow });
}
// PG fork — dynamic ${where} with `?` placeholders (adapter translates ?→$N per-statement).
// Rewrites: emergency INTEGER→`emergency::text IN ('1','true')`; `scheduled_start <= datetime('now')`
// →`NULLIF(scheduled_start,'')::timestamptz <= now()`; JULIANDAY day-diff→`EXTRACT(EPOCH …)/86400`
// fed to `ROUND(AVG(...)::numeric, 1)`. `since` bound (created_time>=?) UNCHANGED. `||` concat OK.
async function _getChangeMetricsPg({ site_id, since } = {}) {
  const H = pgHandle();
  let where = 'WHERE 1=1';
  const p = [];
  if (site_id) { where += ' AND site_id=?';      p.push(site_id); }
  if (since)   { where += ' AND created_time>=?'; p.push(since);   }

  const total    = (await H.prepare(`SELECT COUNT(*) as n FROM change_records ${where}`).get(...p)).n;
  const byStatus = await H.prepare(`SELECT status, COUNT(*) as count FROM change_records ${where} GROUP BY status ORDER BY count DESC`).all(...p);
  const failedCount = (await H.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where}
     AND (status='Failed' OR (stage='Close' AND status='Backout'))`
  ).get(...p)).n;
  const byRisk  = await H.prepare(`SELECT risk, COUNT(*) as count FROM change_records ${where} GROUP BY risk ORDER BY count DESC`).all(...p);
  const byType  = await H.prepare(`SELECT change_type, COUNT(*) as count FROM change_records ${where} GROUP BY change_type ORDER BY count DESC`).all(...p);
  const bySite  = await H.prepare(`SELECT site_id, COUNT(*) as count FROM change_records ${where} GROUP BY site_id ORDER BY count DESC`).all(...p);
  const emergCount = (await H.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where} AND emergency::text IN ('1','true')`
  ).get(...p)).n;
  const inProgress = (await H.prepare(
    `SELECT COUNT(*) as n FROM change_records ${where}
     AND NULLIF(scheduled_start,'')::timestamptz <= now()
     AND (stage || ' - ' || status) NOT IN ('Close - Completed','Close - Cancelled')`
  ).get(...p)).n;
  const avgDaysRow = await H.prepare(
    `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (NULLIF(completed_time,'')::timestamptz - NULLIF(scheduled_start,'')::timestamptz)) / 86400)::numeric, 1) as avg_days
     FROM change_records ${where}
     AND status='Completed' AND completed_time IS NOT NULL AND scheduled_start IS NOT NULL`
  ).get(...p);

  return _assembleChangeMetrics({ total, byStatus, failedCount, byRisk, byType, bySite, emergCount, inProgress, avgDaysRow });
}
// Deterministic ordering for grouped-breakdown rows: count DESC, then label ASC (NULL label
// first, code-unit compare). Applied in the shared assemblers so BOTH the sqlite and pg forks
// emit identical row order — sqlite (BINARY) and pg (locale collation) tie-break count-equal
// groups differently, which made the reconcile harness flag positional diffs on equal data.
function _sortBreakdown(rows, key) {
  return rows.slice().sort((a, b) => {
    const d = (b.count || 0) - (a.count || 0);
    if (d) return d;
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return -1;
    if (y == null) return 1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// Shared assembly — engine-agnostic JS over resolved query outputs (derives completed/cancelled/
// rejected/finalized/executed/changeSuccessRate; ITSM success = completed/executed).
function _assembleChangeMetrics({ total, byStatus, failedCount, byRisk, byType, bySite, emergCount, inProgress, avgDaysRow }) {
  const completed = byStatus.find(r => r.status === 'Completed')?.count  || 0;
  const cancelled = byStatus.find(r => r.status === 'Cancelled')?.count  || 0;
  const rejected  = byStatus.find(r => r.status === 'Rejected')?.count   || 0;
  const finalized = completed + cancelled + rejected;            // AP "All_Introduced_Change_Finalized_Count"
  const executed  = completed + failedCount;                     // ITSM denominator (success + failed + backed_out)
  const changeSuccessRate = executed > 0 ? +(completed / executed * 100).toFixed(1) : null;
  return {
    total,
    completed_count:     completed,
    cancelled_count:     cancelled,
    rejected_count:      rejected,
    failed_count:        failedCount,                 // status='Failed' OR (stage='Close' AND status='Backout')
    finalized_count:     finalized,                   // AP: completed + cancelled + rejected
    executed_count:      executed,                    // ITSM: completed + failed (denominator)
    change_success_rate: changeSuccessRate,           // % — ITSM (successful / executed). Was AP completed/finalized before 2026-06-02.
    in_progress_count:   inProgress,
    emergency_count:     emergCount,
    avg_completion_days: avgDaysRow?.avg_days ?? null,
    by_status: _sortBreakdown(byStatus, 'status'),
    by_risk:   _sortBreakdown(byRisk,   'risk'),
    by_type:   _sortBreakdown(byType,   'change_type'),
    by_site:   _sortBreakdown(bySite,   'site_id'),
  };
}

/**
 * CAB KPIs from cab_approvals.
 * Replicates: CAB Compliance (Major) = distinctcount(IF Approved, change_id) / distinctcount(change_id) * 100
 * Optional filter: since (ISO date for recommendation_requested).
 */
function getCABMetrics({ since } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getCABMetricsPg({ since });
  let where = 'WHERE 1=1';
  const p = [];
  if (since) { where += ' AND recommendation_requested>=?'; p.push(since); }

  const total    = db.prepare(`SELECT COUNT(*) as n FROM cab_approvals ${where}`).get(...p).n;
  const byStatus = db.prepare(
    `SELECT approval_status, COUNT(*) as count FROM cab_approvals ${where} GROUP BY approval_status ORDER BY count DESC`
  ).all(...p);

  const distinctChanges   = db.prepare(`SELECT COUNT(DISTINCT change_id) as n FROM cab_approvals ${where}`).get(...p).n;
  const approvedChanges   = db.prepare(
    `SELECT COUNT(DISTINCT change_id) as n FROM cab_approvals ${where} AND approval_status='Approved'`
  ).get(...p).n;

  const avgTurnaround = db.prepare(
    `SELECT ROUND(AVG(turnaround_minutes), 1) as avg FROM cab_approvals ${where}
     AND turnaround_minutes IS NOT NULL AND turnaround_minutes > 0`
  ).get(...p).avg;

  const byRuleType = db.prepare(
    `SELECT rule_type, COUNT(*) as count FROM cab_approvals ${where} GROUP BY rule_type ORDER BY count DESC`
  ).all(...p);
  const byStage = db.prepare(
    `SELECT approval_stage, COUNT(*) as count FROM cab_approvals ${where} GROUP BY approval_stage ORDER BY count DESC`
  ).all(...p);

  return _assembleCABMetrics({ total, byStatus, distinctChanges, approvedChanges, avgTurnaround, byRuleType, byStage });
}
// PG fork — dynamic ${where}; `since` bound (recommendation_requested>=?) UNCHANGED; no julianday/
// strftime/datetime. `ROUND(AVG(turnaround_minutes),1)` stays as-is (INTEGER → AVG = numeric, no cast).
async function _getCABMetricsPg({ since } = {}) {
  const H = pgHandle();
  let where = 'WHERE 1=1';
  const p = [];
  if (since) { where += ' AND recommendation_requested>=?'; p.push(since); }

  const total    = (await H.prepare(`SELECT COUNT(*) as n FROM cab_approvals ${where}`).get(...p)).n;
  const byStatus = await H.prepare(
    `SELECT approval_status, COUNT(*) as count FROM cab_approvals ${where} GROUP BY approval_status ORDER BY count DESC`
  ).all(...p);
  const distinctChanges = (await H.prepare(`SELECT COUNT(DISTINCT change_id) as n FROM cab_approvals ${where}`).get(...p)).n;
  const approvedChanges = (await H.prepare(
    `SELECT COUNT(DISTINCT change_id) as n FROM cab_approvals ${where} AND approval_status='Approved'`
  ).get(...p)).n;
  const avgTurnaround = (await H.prepare(
    `SELECT ROUND(AVG(turnaround_minutes), 1) as avg FROM cab_approvals ${where}
     AND turnaround_minutes IS NOT NULL AND turnaround_minutes > 0`
  ).get(...p)).avg;
  const byRuleType = await H.prepare(
    `SELECT rule_type, COUNT(*) as count FROM cab_approvals ${where} GROUP BY rule_type ORDER BY count DESC`
  ).all(...p);
  const byStage = await H.prepare(
    `SELECT approval_stage, COUNT(*) as count FROM cab_approvals ${where} GROUP BY approval_stage ORDER BY count DESC`
  ).all(...p);

  return _assembleCABMetrics({ total, byStatus, distinctChanges, approvedChanges, avgTurnaround, byRuleType, byStage });
}
function _assembleCABMetrics({ total, byStatus, distinctChanges, approvedChanges, avgTurnaround, byRuleType, byStage }) {
  const approved = byStatus.find(r => r.approval_status === 'Approved')?.count || 0;
  const cabCompliancePct = distinctChanges > 0 ? +(approvedChanges / distinctChanges * 100).toFixed(1) : null;
  return {
    total_approvals:       total,
    approved_count:        approved,
    distinct_changes:      distinctChanges,
    changes_with_approval: approvedChanges,
    cab_compliance_pct:    cabCompliancePct,  // %  — Zoho "CAB Compliance (Major)"
    avg_turnaround_minutes: avgTurnaround,
    by_status:    _sortBreakdown(byStatus,   'approval_status'),
    by_rule_type: _sortBreakdown(byRuleType, 'rule_type'),
    by_stage:     _sortBreakdown(byStage,    'approval_stage'),
  };
}

/**
 * Survey / CSAT KPIs from survey_results.
 * Includes: avg score, response rate, CSAT buckets (<60 bad / 60-80 neutral / ≥80 good),
 *           and monthly trend (last 12 months).
 * Optional filter: since (ISO date for survey_sent_on).
 */
function getSurveyMetrics({ since } = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getSurveyMetricsPg({ since });
  let where = 'WHERE 1=1';
  const p = [];
  if (since) { where += ' AND survey_sent_on>=?'; p.push(since); }

  const total     = db.prepare(`SELECT COUNT(*) as n FROM survey_results ${where}`).get(...p).n;
  const responded = db.prepare(
    `SELECT COUNT(*) as n FROM survey_results ${where} AND survey_responded_on IS NOT NULL`
  ).get(...p).n;
  const avgScore  = db.prepare(
    `SELECT ROUND(AVG(overall_score), 1) as avg FROM survey_results ${where} AND overall_score IS NOT NULL`
  ).get(...p).avg;

  // CSAT score buckets: <60 = dissatisfied, 60–80 = neutral, ≥80 = satisfied
  const buckets = db.prepare(`
    SELECT
      SUM(CASE WHEN overall_score < 60                          THEN 1 ELSE 0 END) as dissatisfied,
      SUM(CASE WHEN overall_score >= 60 AND overall_score < 80  THEN 1 ELSE 0 END) as neutral,
      SUM(CASE WHEN overall_score >= 80                         THEN 1 ELSE 0 END) as satisfied
    FROM survey_results ${where} AND overall_score IS NOT NULL
  `).get(...p);

  // Monthly trend — last 12 responded months
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', survey_sent_on) as month,
           COUNT(*) as sent_count,
           SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END) as responded_count,
           ROUND(AVG(CASE WHEN overall_score IS NOT NULL THEN overall_score END), 1) as avg_score
    FROM survey_results ${where}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...p);

  return _assembleSurveyMetrics({ total, responded, avgScore, buckets, monthly });
}
// PG fork — `since` bound (survey_sent_on>=?) UNCHANGED; overall_score is double precision →
// `ROUND(AVG(...),1)` needs `::numeric` (×2: top avgScore + monthly avg_score). monthly bucket
// `strftime('%Y-%m', survey_sent_on)` → `to_char(NULLIF(survey_sent_on,'')::timestamptz,'YYYY-MM')`
// (NULLIF guards the ''::timestamptz error — the WHERE doesn't filter NULL/'' when `since` absent).
async function _getSurveyMetricsPg({ since } = {}) {
  const H = pgHandle();
  let where = 'WHERE 1=1';
  const p = [];
  if (since) { where += ' AND survey_sent_on>=?'; p.push(since); }

  const total     = (await H.prepare(`SELECT COUNT(*) as n FROM survey_results ${where}`).get(...p)).n;
  const responded = (await H.prepare(
    `SELECT COUNT(*) as n FROM survey_results ${where} AND survey_responded_on IS NOT NULL`
  ).get(...p)).n;
  const avgScore  = (await H.prepare(
    `SELECT ROUND(AVG(overall_score)::numeric, 1) as avg FROM survey_results ${where} AND overall_score IS NOT NULL`
  ).get(...p)).avg;
  const buckets = await H.prepare(`
    SELECT
      SUM(CASE WHEN overall_score < 60                          THEN 1 ELSE 0 END) as dissatisfied,
      SUM(CASE WHEN overall_score >= 60 AND overall_score < 80  THEN 1 ELSE 0 END) as neutral,
      SUM(CASE WHEN overall_score >= 80                         THEN 1 ELSE 0 END) as satisfied
    FROM survey_results ${where} AND overall_score IS NOT NULL
  `).get(...p);
  const monthly = await H.prepare(`
    SELECT to_char(NULLIF(survey_sent_on,'')::timestamptz, 'YYYY-MM') as month,
           COUNT(*) as sent_count,
           SUM(CASE WHEN survey_responded_on IS NOT NULL THEN 1 ELSE 0 END) as responded_count,
           ROUND(AVG(CASE WHEN overall_score IS NOT NULL THEN overall_score END)::numeric, 1) as avg_score
    FROM survey_results ${where}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...p);

  return _assembleSurveyMetrics({ total, responded, avgScore, buckets, monthly });
}
function _assembleSurveyMetrics({ total, responded, avgScore, buckets, monthly }) {
  const responseRatePct = total > 0 ? +(responded / total * 100).toFixed(1) : null;
  return {
    total_sent:          total,
    responded_count:     responded,
    response_rate_pct:   responseRatePct,
    avg_score:           avgScore,
    satisfied_count:     buckets?.satisfied    || 0,
    neutral_count:       buckets?.neutral      || 0,
    dissatisfied_count:  buckets?.dissatisfied || 0,
    monthly_trend:       monthly.reverse(),    // chronological order
  };
}

/**
 * Request / Helpdesk KPIs from request_records.
 *
 * Returns counts that match the Zoho Analytics aggregate counters
 * verbatim (Open / Closed / Backlog / etc.) AND percentages aligned with
 * the dashboard's ITSM-standard editorial convention (see
 * FORMULA_RECONCILIATION.md §6 D1/D2/D3 — verdict-only denominators).
 *
 * Important: the raw counts (within_sla_count, sla_violated_count,
 * reopen_count, first_resp_violated_count) match Zoho AP exactly.
 * Only the *_pct derived fields use ITSM denominators, so consumers
 * who want the AP-canonical "% over all incoming" can recompute from
 * the counts if needed.
 *
 * Optional filters: site (site name), since (ISO date for created_time).
 */
function getRequestMetrics(opts = {}) {
  if (REPORTS_BACKEND === 'postgres') return _getRequestMetricsPg(opts);
  const { site, since, statuses, rtypes, impacts, modes } = opts;
  // AP formula: Inbound = count(RequestID) — ALL tickets, no filter (AP chart has Filters: 0).
  // Closed = countif(pending_status = 0). No SLA exclusion needed.
  let where = 'WHERE 1=1';
  const p = [];
  if (site)  { where += ' AND site=?';          p.push(site); }
  if (since) { where += ' AND created_time>=?'; p.push(since); }
  // ── Multi-value filters (2026-06-11, analytics.html Status/Type/Impact/Mode) ──
  // Each is an optional array of allowed values → SQL IN clause. Because every
  // sub-query below reuses the same `${where}` + `...p`, these filters apply
  // uniformly to ALL the KPIs this function computes. Empty/absent = no filter.
  const addIn = (col, vals) => {
    if (Array.isArray(vals) && vals.length > 0) {
      where += ` AND ${col} IN (${vals.map(() => '?').join(',')})`;
      p.push(...vals);
    }
  };
  addIn('request_status', statuses);
  addIn('request_type',   rtypes);
  addIn('impact',         impacts);
  addIn('mode',           modes);

  const total           = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where}`).get(...p).n;
  const openCount       = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND pending_status=1`).get(...p).n;
  const closedCount     = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND pending_status=0`).get(...p).n;
  const backlogCount    = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND pending_status=1 AND overdue_status=1`).get(...p).n;
  const withinSlaCount  = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND overdue_status=0`).get(...p).n;
  const slaViolated     = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND overdue_status=1`).get(...p).n;
  // 2026-06-02 ITSM-alignment (§6 D2): SLA% denominator = closed (verdict-rendered);
  // numerator = closed AND not overdue. AP `/total` was diluted by open-not-yet-due.
  const withinSlaClosed = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND pending_status=0 AND overdue_status=0`).get(...p).n;
  const slaOkPct        = closedCount > 0 ? +(withinSlaClosed / closedCount * 100).toFixed(1) : null;

  const reopenCount     = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND reopen_count > 0`).get(...p).n;
  // 2026-06-02 ITSM-alignment (§6 D1): Reopen Rate = reopened-of-closed / closed.
  // An open ticket cannot have been reopened, so it doesn't belong in the denominator.
  const reopenedClosed  = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND pending_status=0 AND reopen_count > 0`).get(...p).n;
  const reopenPct       = closedCount > 0 ? +(reopenedClosed / closedCount * 100).toFixed(1) : null;

  const resolvedCount   = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND request_status='Resolved'`).get(...p).n;
  const resolvedSameWeek = db.prepare(
    `SELECT COUNT(*) as n FROM request_records ${where}
     AND request_status='Resolved'
     AND resolved_time IS NOT NULL AND created_time IS NOT NULL
     AND (JULIANDAY(resolved_time) - JULIANDAY(created_time)) <= 7`
  ).get(...p).n;

  const serviceReqCount = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND service_request=1`).get(...p).n;
  const incidentCount   = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND service_request=0`).get(...p).n;
  const escalatedCount  = db.prepare(
    `SELECT COUNT(*) as n FROM request_records ${where} AND (is_escalated=1 OR is_escalated='true' OR is_escalated='1')`
  ).get(...p).n;

  // First Response SLA: field stored as 'true'/'false', '1'/'0', or 'Yes'/'No' depending on Zoho version
  const firstRespViolated    = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND (LOWER(first_response_overdue) IN ('true','1','yes'))`).get(...p).n;
  // 2026-06-02 ITSM-alignment (§6 D3): FRT % denominator = responded
  // (responded_time set); numerator = responded AND first-response overdue.
  const respondedCount       = db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND responded_time IS NOT NULL AND responded_time != ''`).get(...p).n;
  const firstRespViolatedResp= db.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND responded_time IS NOT NULL AND responded_time != '' AND (LOWER(first_response_overdue) IN ('true','1','yes'))`).get(...p).n;
  const firstRespViolatedPct = respondedCount > 0 ? +(firstRespViolatedResp / respondedCount * 100).toFixed(1) : null;

  // Avg resolution time in hours for closed tickets (Time Elapsed stored in ms)
  const avgHrsRow = db.prepare(
    `SELECT ROUND(AVG(time_elapsed_ms) / 3600000.0, 2) as avg_hrs
     FROM request_records ${where}
     AND pending_status=0 AND time_elapsed_ms IS NOT NULL AND time_elapsed_ms > 0`
  ).get(...p);

  // Breakdowns
  // Deterministic tiebreak on the grouped label (sqlite ASC = NULLs first, BINARY collation —
  // pg forks mirror with NULLS FIRST + COLLATE "C"). Matters ON the LIMITed breakdowns too:
  // count-ties at the LIMIT boundary must pick the same rows under both engines.
  const byStatus   = db.prepare(`SELECT request_status as status, COUNT(*) as count FROM request_records ${where} GROUP BY request_status ORDER BY count DESC, request_status ASC`).all(...p);
  const bySite     = db.prepare(`SELECT site, COUNT(*) as count FROM request_records ${where} GROUP BY site ORDER BY count DESC, site ASC`).all(...p);
  const byCategory = db.prepare(`SELECT category, COUNT(*) as count FROM request_records ${where} GROUP BY category ORDER BY count DESC, category ASC LIMIT 10`).all(...p);
  const byTech     = db.prepare(`SELECT technician, COUNT(*) as count FROM request_records ${where} GROUP BY technician ORDER BY count DESC, technician ASC LIMIT 10`).all(...p);
  const byGroup    = db.prepare(`SELECT tech_group, COUNT(*) as count FROM request_records ${where} GROUP BY tech_group ORDER BY count DESC, tech_group ASC LIMIT 10`).all(...p);

  // Monthly incoming trend (last 12 months) — chronological order.
  // 2026-06-02 ITSM-aligned sla_ok_pct: closed-and-not-overdue / closed
  // (rather than AP `/total`). NULL when a month has no closed tickets yet.
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_time) as month,
           COUNT(*) as total_count,
           SUM(CASE WHEN pending_status=0  THEN 1 ELSE 0 END) as closed_count,
           SUM(CASE WHEN overdue_status=1  THEN 1 ELSE 0 END) as sla_violated_count,
           SUM(CASE WHEN pending_status=0 AND overdue_status=0 THEN 1 ELSE 0 END) as within_sla_closed,
           CASE WHEN SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END) > 0
                THEN ROUND(100.0 * SUM(CASE WHEN pending_status=0 AND overdue_status=0 THEN 1 ELSE 0 END)
                                  / SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END), 1)
                ELSE NULL END as sla_ok_pct
    FROM request_records ${where}
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(...p);

  return {
    total,
    open_count:                openCount,         // Zoho "Open Requests Count"
    closed_count:              closedCount,        // Zoho "Closed Requests Count"
    backlog_count:             backlogCount,       // Zoho "Backlog Requests Count"
    within_sla_count:          withinSlaCount,     // Zoho "Requests within SLA"
    sla_violated_count:        slaViolated,        // Zoho "SLA Violated Requests"
    sla_ok_pct:                slaOkPct,           // Zoho "% of Requests within SLA"
    reopen_count:              reopenCount,        // Zoho "Reopen Requests Count"
    reopen_pct:                reopenPct,          // Zoho "% ReOpened Vs Incoming Tickets"
    resolved_count:            resolvedCount,      // Zoho "Resolved Request Count"
    resolved_same_week:        resolvedSameWeek,   // Zoho "Resolved the same week"
    service_request_count:     serviceReqCount,    // Zoho "Service Request Count"
    incident_count:            incidentCount,      // Zoho "Incident Request Count"
    escalated_count:           escalatedCount,
    first_resp_violated_count: firstRespViolated,
    first_resp_violated_pct:   firstRespViolatedPct, // Zoho "% of First Responses SLA Violated"
    avg_resolution_hrs:        avgHrsRow?.avg_hrs ?? null,
    by_status:     byStatus,
    by_site:       bySite,
    by_category:   byCategory,
    by_technician: byTech,
    by_group:      byGroup,
    monthly_trend: monthly.reverse(),
  };
}
async function _getRequestMetricsPg({ site, since, statuses, rtypes, impacts, modes } = {}) {
  const H = pgHandle();
  let where = 'WHERE 1=1';
  const p = [];
  if (site)  { where += ' AND site=?';          p.push(site); }
  if (since) { where += ' AND created_time>=?'; p.push(since); }
  const addIn = (col, vals) => { if (Array.isArray(vals) && vals.length > 0) { where += ` AND ${col} IN (${vals.map(()=>'?').join(',')})`; p.push(...vals); } };
  addIn('request_status', statuses); addIn('request_type', rtypes); addIn('impact', impacts); addIn('mode', modes);
  const cnt = async (extra) => (await H.prepare(`SELECT COUNT(*) as n FROM request_records ${where}${extra}`).get(...p)).n;
  const total           = await cnt('');
  const openCount       = await cnt(' AND pending_status=1');
  const closedCount     = await cnt(' AND pending_status=0');
  const backlogCount    = await cnt(' AND pending_status=1 AND overdue_status=1');
  const withinSlaCount  = await cnt(' AND overdue_status=0');
  const slaViolated     = await cnt(' AND overdue_status=1');
  const withinSlaClosed = await cnt(' AND pending_status=0 AND overdue_status=0');
  const slaOkPct        = closedCount > 0 ? +(withinSlaClosed / closedCount * 100).toFixed(1) : null;
  const reopenCount     = await cnt(' AND reopen_count > 0');
  const reopenedClosed  = await cnt(' AND pending_status=0 AND reopen_count > 0');
  const reopenPct       = closedCount > 0 ? +(reopenedClosed / closedCount * 100).toFixed(1) : null;
  const resolvedCount   = await cnt(` AND request_status='Resolved'`);
  const resolvedSameWeek= (await H.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND request_status='Resolved' AND resolved_time IS NOT NULL AND created_time IS NOT NULL AND EXTRACT(EPOCH FROM (resolved_time::timestamptz - created_time::timestamptz))/86400 <= 7`).get(...p)).n;
  const serviceReqCount = await cnt(' AND service_request=1');
  const incidentCount   = await cnt(' AND service_request=0');
  const escalatedCount  = (await H.prepare(`SELECT COUNT(*) as n FROM request_records ${where} AND (is_escalated::text IN ('1','true'))`).get(...p)).n;
  const firstRespViolated     = await cnt(` AND (LOWER(first_response_overdue) IN ('true','1','yes'))`);
  const respondedCount        = await cnt(` AND responded_time IS NOT NULL AND responded_time != ''`);
  const firstRespViolatedResp = await cnt(` AND responded_time IS NOT NULL AND responded_time != '' AND (LOWER(first_response_overdue) IN ('true','1','yes'))`);
  const firstRespViolatedPct  = respondedCount > 0 ? +(firstRespViolatedResp / respondedCount * 100).toFixed(1) : null;
  const avgHrsRow = await H.prepare(`SELECT ROUND(AVG(time_elapsed_ms)/3600000.0, 2) as avg_hrs FROM request_records ${where} AND pending_status=0 AND time_elapsed_ms IS NOT NULL AND time_elapsed_ms > 0`).get(...p);
  // Tiebreak mirrors the sqlite fork: COLLATE "C" = byte order (sqlite BINARY), NULLS FIRST =
  // sqlite's ASC NULL placement. Keeps LIMITed breakdowns picking identical rows on count-ties.
  const byStatus   = await H.prepare(`SELECT request_status as status, COUNT(*) as count FROM request_records ${where} GROUP BY request_status ORDER BY count DESC, request_status COLLATE "C" ASC NULLS FIRST`).all(...p);
  const bySite     = await H.prepare(`SELECT site, COUNT(*) as count FROM request_records ${where} GROUP BY site ORDER BY count DESC, site COLLATE "C" ASC NULLS FIRST`).all(...p);
  const byCategory = await H.prepare(`SELECT category, COUNT(*) as count FROM request_records ${where} GROUP BY category ORDER BY count DESC, category COLLATE "C" ASC NULLS FIRST LIMIT 10`).all(...p);
  const byTech     = await H.prepare(`SELECT technician, COUNT(*) as count FROM request_records ${where} GROUP BY technician ORDER BY count DESC, technician COLLATE "C" ASC NULLS FIRST LIMIT 10`).all(...p);
  const byGroup    = await H.prepare(`SELECT tech_group, COUNT(*) as count FROM request_records ${where} GROUP BY tech_group ORDER BY count DESC, tech_group COLLATE "C" ASC NULLS FIRST LIMIT 10`).all(...p);
  const monthly = await H.prepare(`
    SELECT to_char(created_time::timestamptz,'YYYY-MM') as month,
           COUNT(*) as total_count,
           SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END) as closed_count,
           SUM(CASE WHEN overdue_status=1 THEN 1 ELSE 0 END) as sla_violated_count,
           SUM(CASE WHEN pending_status=0 AND overdue_status=0 THEN 1 ELSE 0 END) as within_sla_closed,
           CASE WHEN SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END) > 0
                THEN ROUND(100.0 * SUM(CASE WHEN pending_status=0 AND overdue_status=0 THEN 1 ELSE 0 END)
                                  / SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END), 1)
                ELSE NULL END as sla_ok_pct
    FROM request_records ${where}
    GROUP BY to_char(created_time::timestamptz,'YYYY-MM') ORDER BY month DESC LIMIT 12`).all(...p);
  return {
    total, open_count: openCount, closed_count: closedCount, backlog_count: backlogCount,
    within_sla_count: withinSlaCount, sla_violated_count: slaViolated, sla_ok_pct: slaOkPct,
    reopen_count: reopenCount, reopen_pct: reopenPct, resolved_count: resolvedCount,
    resolved_same_week: resolvedSameWeek, service_request_count: serviceReqCount,
    incident_count: incidentCount, escalated_count: escalatedCount,
    first_resp_violated_count: firstRespViolated, first_resp_violated_pct: firstRespViolatedPct,
    avg_resolution_hrs: avgHrsRow?.avg_hrs ?? null,
    by_status: byStatus, by_site: bySite, by_category: byCategory, by_technician: byTech,
    by_group: byGroup, monthly_trend: monthly.reverse(),
  };
}

// ── MONTHLY REPORT HELPERS ────────────────────────────────────────

/**
 * Return the stored monthly_reports row for a site/year/month, or null.
 */
function getMonthlyReport(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getMonthlyReportPg(site_id, year, month);
  return db.prepare(`SELECT * FROM monthly_reports WHERE site_id=? AND year=? AND month=?`)
           .get(site_id, year, month) || null;
}
async function _getMonthlyReportPg(site_id, year, month) {
  return (await pgHandle().prepare('SELECT * FROM monthly_reports WHERE site_id=? AND year=? AND month=?')
           .get(site_id, year, month)) || null;
}

/**
 * Return the merged lights+actions for a monthly report, with week labels.
 * If the user has saved edits (monthly_reports row exists), return those.
 * Otherwise auto-merge from the weekly_reports for that month.
 */
function getMonthlyEdits(site_id, year, month) {
  if (REPORTS_BACKEND === 'postgres') return _getMonthlyEditsPg(site_id, year, month);
  const saved = getMonthlyReport(site_id, year, month);
  if (saved && (saved.edited_lights || saved.edited_actions)) {
    return {
      edited_lights:  saved.edited_lights  ? JSON.parse(saved.edited_lights)  : [],
      edited_actions: saved.edited_actions ? JSON.parse(saved.edited_actions) : [],
      notes:  saved.notes || '',
      status: saved.status,
      source: 'saved'
    };
  }

  // Auto-merge from weekly_reports for this month
  const mStr = `${year}-${String(month).padStart(2,'0')}`;
  const weekRows = db.prepare(`
    SELECT wr.id as report_id, w.label as week_label
    FROM weeks w
    JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
    WHERE substr(w.start_date,1,7)=?
    ORDER BY w.year, w.week_number
  `).all(site_id, mStr);

  const lightsRaw  = [];
  const actionsRaw = [];

  for (const wk of weekRows) {
    const ls = db.prepare(`SELECT * FROM lights WHERE report_id=? ORDER BY type, sort_order`).all(wk.report_id);
    ls.forEach(l => lightsRaw.push({ type: l.type, content: l.content, week_label: wk.week_label }));

    const as = db.prepare(`SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order`).all(wk.report_id);
    as.forEach(a => actionsRaw.push({
      task:       a.task,
      priority:   a.priority,
      due_date:   a.due_date,
      owner:      a.owner,
      status:     a.status,
      department: a.department,
      comment:    a.comment,
      week_label: wk.week_label
    }));
  }

  // ── Deduplicate lights ────────────────────────────────────────────
  // Low/High lights: keep EARLIEST week (first occurrence of each unique item)
  // Changes (in_progress/pending): keep LATEST week (most recent status of each change)
  const lightsMap = new Map();
  for (const l of lightsRaw) {
    const key = l.type + '||' + (l.content || '').trim().toLowerCase();
    const isChange = l.type === 'change_in_progress' || l.type === 'change_pending';
    if (!lightsMap.has(key)) {
      lightsMap.set(key, l);
    } else if (isChange) {
      // Changes: overwrite with latest week (weekRows is ordered ASC so later = higher index)
      lightsMap.set(key, l);
    }
    // Low/High lights: keep first occurrence — do nothing if key already exists
  }
  const lights = Array.from(lightsMap.values());

  // ── Deduplicate actions ───────────────────────────────────────────
  // Key: task text + owner — keep LATEST week entry (most recent status)
  const actionsMap = new Map();
  for (const a of actionsRaw) {
    const key = (a.task || '').trim().toLowerCase() + '||' + (a.owner || '').trim().toLowerCase();
    // weekRows ordered ASC — each later entry overwrites the earlier one
    actionsMap.set(key, a);
  }
  // Sort: open / in_progress first → closed / completed / cancelled last
  const _actionOrder = s => ['open','in_progress'].includes((s||'open').toLowerCase()) ? 0 : 1;
  const actions = Array.from(actionsMap.values())
    .sort((a, b) => _actionOrder(a.status) - _actionOrder(b.status));

  return { edited_lights: lights, edited_actions: actions, notes: '', status: 'draft', source: 'auto' };
}

/**
 * Save user edits to monthly_reports (upsert).
 */
// pg fork of getMonthlyEdits — awaits the reads; the dedup/sort JS is identical to sqlite.
async function _getMonthlyEditsPg(site_id, year, month) {
  const H = pgHandle();
  const saved = await _getMonthlyReportPg(site_id, year, month);
  if (saved && (saved.edited_lights || saved.edited_actions)) {
    return {
      edited_lights:  saved.edited_lights  ? JSON.parse(saved.edited_lights)  : [],
      edited_actions: saved.edited_actions ? JSON.parse(saved.edited_actions) : [],
      notes:  saved.notes || '', status: saved.status, source: 'saved',
    };
  }
  const mStr = `${year}-${String(month).padStart(2,'0')}`;
  const weekRows = await H.prepare(`
    SELECT wr.id as report_id, w.label as week_label
    FROM weeks w JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
    WHERE substr(w.start_date,1,7)=? ORDER BY w.year, w.week_number`).all(site_id, mStr);
  const lightsRaw = [], actionsRaw = [];
  for (const wk of weekRows) {
    const ls = await H.prepare('SELECT * FROM lights WHERE report_id=? ORDER BY type, sort_order').all(wk.report_id);
    ls.forEach(l => lightsRaw.push({ type: l.type, content: l.content, week_label: wk.week_label }));
    const as = await H.prepare('SELECT * FROM action_items WHERE report_id=? ORDER BY sort_order').all(wk.report_id);
    as.forEach(a => actionsRaw.push({ task: a.task, priority: a.priority, due_date: a.due_date, owner: a.owner,
      status: a.status, department: a.department, comment: a.comment, week_label: wk.week_label }));
  }
  const lightsMap = new Map();
  for (const l of lightsRaw) {
    const key = l.type + '||' + (l.content || '').trim().toLowerCase();
    const isChange = l.type === 'change_in_progress' || l.type === 'change_pending';
    if (!lightsMap.has(key)) lightsMap.set(key, l);
    else if (isChange) lightsMap.set(key, l);
  }
  const lights = Array.from(lightsMap.values());
  const actionsMap = new Map();
  for (const a of actionsRaw) {
    const key = (a.task || '').trim().toLowerCase() + '||' + (a.owner || '').trim().toLowerCase();
    actionsMap.set(key, a);
  }
  const _actionOrder = s => ['open','in_progress'].includes((s||'open').toLowerCase()) ? 0 : 1;
  const actions = Array.from(actionsMap.values()).sort((a, b) => _actionOrder(a.status) - _actionOrder(b.status));
  return { edited_lights: lights, edited_actions: actions, notes: '', status: 'draft', source: 'auto' };
}

function saveMonthlyEdits(site_id, year, month, { edited_lights, edited_actions, notes, status }) {
  if (REPORTS_BACKEND === 'postgres') return _saveMonthlyEditsPg(site_id, year, month, { edited_lights, edited_actions, notes, status });
  const el = edited_lights  != null ? JSON.stringify(edited_lights)  : null;
  const ea = edited_actions != null ? JSON.stringify(edited_actions) : null;
  db.prepare(`
    INSERT INTO monthly_reports (site_id, year, month, edited_lights, edited_actions, notes, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(site_id, year, month) DO UPDATE SET
      edited_lights  = COALESCE(excluded.edited_lights,  edited_lights),
      edited_actions = COALESCE(excluded.edited_actions, edited_actions),
      notes          = COALESCE(excluded.notes,          notes),
      status         = COALESCE(excluded.status,         status),
      updated_at     = datetime('now')
  `).run(site_id, year, month, el, ea, notes || null, status || 'draft');
}
async function _saveMonthlyEditsPg(site_id, year, month, { edited_lights, edited_actions, notes, status }) {
  const el = edited_lights  != null ? JSON.stringify(edited_lights)  : null;
  const ea = edited_actions != null ? JSON.stringify(edited_actions) : null;
  await pgHandle().prepare(`
    INSERT INTO monthly_reports (site_id, year, month, edited_lights, edited_actions, notes, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, now())
    ON CONFLICT(site_id, year, month) DO UPDATE SET
      edited_lights  = COALESCE(EXCLUDED.edited_lights,  monthly_reports.edited_lights),
      edited_actions = COALESCE(EXCLUDED.edited_actions, monthly_reports.edited_actions),
      notes          = COALESCE(EXCLUDED.notes,          monthly_reports.notes),
      status         = COALESCE(EXCLUDED.status,         monthly_reports.status),
      updated_at     = now()
  `).run(site_id, year, month, el, ea, notes || null, status || 'draft');
}

/**
 * Get annual objectives for a site+year, sorted by sort_order.
 */
function getAnnualObjectives(site_id, year) {
  if (REPORTS_BACKEND === 'postgres') return _getAnnualObjectivesPg(site_id, year);
  return db.prepare(`
    SELECT id, objective, target, status, sort_order
    FROM annual_objectives
    WHERE site_id=? AND year=?
    ORDER BY sort_order, id
  `).all(site_id, year);
}
async function _getAnnualObjectivesPg(site_id, year) {
  return pgHandle().prepare(`SELECT id, objective, target, status, sort_order
    FROM annual_objectives WHERE site_id=? AND year=? ORDER BY sort_order, id`).all(site_id, year);
}

/**
 * Replace all annual objectives for a site+year in a single transaction.
 * objectives: [{objective, target, status}]
 */
function saveAnnualObjectives(site_id, year, objectives) {
  if (REPORTS_BACKEND === 'postgres') return _saveAnnualObjectivesPg(site_id, year, objectives);
  return _saveAnnualObjectivesSqlite(site_id, year, objectives);
}
const _saveAnnualObjectivesSqlite = db.transaction((site_id, year, objectives) => {
  db.prepare(`DELETE FROM annual_objectives WHERE site_id=? AND year=?`).run(site_id, year);
  const ins = db.prepare(`
    INSERT INTO annual_objectives (site_id, year, objective, target, status, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  (objectives || []).forEach((o, i) => {
    ins.run(site_id, year, o.objective || '', o.target || null, o.status || 'in_progress', i);
  });
});
async function _saveAnnualObjectivesPg(site_id, year, objectives) {
  const H = pgHandle();
  await H.runTransaction(async () => {
    await H.prepare('DELETE FROM annual_objectives WHERE site_id=? AND year=?').run(site_id, year);
    let i = 0;
    for (const o of (objectives || [])) {
      await H.prepare(`INSERT INTO annual_objectives (site_id, year, objective, target, status, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, now())`).run(site_id, year, o.objective||'', o.target||null, o.status||'in_progress', i); i++;
    }
  });
}

// ── YEARLY SUMMARY (for monthly page trend tables) ────────────────
/**
 * Returns an array of 12 entries (one per month Jan–Dec) for a given site+year.
 * Each entry has:
 *   { month, label, has_data, kpis[], hd: {inbound, closed, close_pct, sla_res_pct, sla_reply_pct} }
 *
 * - kpis[] come from the LAST weekly report of the month (status snapshot)
 * - hd figures are SUMMED/AVERAGED across all weekly reports of the month
 */
function getYearlySummary(site_id, year) {
  if (REPORTS_BACKEND === 'postgres') return _getYearlySummaryPg(site_id, year);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const result = [];

  for (let m = 1; m <= 12; m++) {
    const mStr = `${year}-${String(m).padStart(2,'0')}`;

    // All report IDs for this month (de-duped by distinct report id)
    const reportRows = db.prepare(`
      SELECT DISTINCT wr.id as report_id, w.week_number
      FROM weeks w
      JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=?
      ORDER BY w.week_number
    `).all(site_id, mStr);

    if (!reportRows.length) {
      // Still try calendar helpdesk even without weekly reports (tickets may exist)
      const hd = getCalendarMonthlyHelpdesk(site_id, year, m) || null;
      result.push({ month: m, label: monthNames[m-1], has_data: false, kpis: [], hd });
      continue;
    }

    // Infra KPIs from last week of the month
    const lastRid = reportRows[reportRows.length - 1].report_id;
    const kpis = db.prepare(
      `SELECT service, kpi, target, status_value, status_color, trend FROM infra_kpis WHERE report_id=? ORDER BY sort_order`
    ).all(lastRid);

    // Use calendar-based helpdesk totals (matches Analytics Plus: tickets by created_time)
    const hd = getCalendarMonthlyHelpdesk(site_id, year, m)
              || { inbound:0, closed:0, close_pct:0, sla_res_pct:null, sla_reply_pct:null };

    result.push({ month: m, label: monthNames[m-1], has_data: true, kpis, hd });
  }
  return result;
}
async function _getYearlySummaryPg(site_id, year) {
  const H = pgHandle();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const result = [];
  for (let m = 1; m <= 12; m++) {
    const mStr = `${year}-${String(m).padStart(2,'0')}`;
    const reportRows = await H.prepare(`SELECT DISTINCT wr.id as report_id, w.week_number
      FROM weeks w JOIN weekly_reports wr ON wr.week_id=w.id AND wr.site_id=?
      WHERE substr(w.start_date,1,7)=? ORDER BY w.week_number`).all(site_id, mStr);
    if (!reportRows.length) {
      const hd = (await _getCalendarMonthlyHelpdeskPg(site_id, year, m)) || null;
      result.push({ month: m, label: monthNames[m-1], has_data: false, kpis: [], hd });
      continue;
    }
    const lastRid = reportRows[reportRows.length - 1].report_id;
    const kpis = await H.prepare(`SELECT service, kpi, target, status_value, status_color, trend FROM infra_kpis WHERE report_id=? ORDER BY sort_order`).all(lastRid);
    const hd = (await _getCalendarMonthlyHelpdeskPg(site_id, year, m)) || { inbound:0, closed:0, close_pct:0, sla_res_pct:null, sla_reply_pct:null };
    result.push({ month: m, label: monthNames[m-1], has_data: true, kpis, hd });
  }
  return result;
}

// ── AUDIT LOG ─────────────────────────────────────────────────────
/**
 * Record a user action against a report.
 * action: 'created' | 'edited_infra' | 'edited_helpdesk' | 'edited_lights' |
 *         'edited_actions' | 'submitted' | 'reverted' | 'deleted' |
 *         'edited_monthly' | 'edited_objectives'
 */
function logAudit({ report_id, site_id, user_id, username, action, details } = {}) {
  // System Logs v1 — mirror this report event into the unified system_log
  // (fire-and-forget; covers both backends since logEvent branches internally).
  logEvent({ category: 'report', action: /^report_/.test(action) ? action : 'report_' + action,
    actor: username, actor_id: user_id, target: report_id != null ? String(report_id) : null,
    details, risk: action === 'deleted' ? 1 : undefined });
  if (REPORTS_BACKEND === 'postgres') return _logAuditPg({ report_id, site_id, user_id, username, action, details });
  try {
    db.prepare(
      `INSERT INTO audit_log (report_id, site_id, user_id, username, action, details)
       VALUES (?,?,?,?,?,?)`
    ).run(
      report_id || null, site_id || null, user_id || null,
      username  || null, action,
      details   ? JSON.stringify(details) : null
    );
  } catch(e) {
    console.error('[audit_log] write error:', e.message);
  }
}
// async under pg. logAudit is fire-and-forget on the sqlite path (callers don't
// await); the returned Promise resolves later — callers that ignore it still work.
async function _logAuditPg({ report_id, site_id, user_id, username, action, details } = {}) {
  try {
    await pgHandle().prepare(
      `INSERT INTO audit_log (report_id, site_id, user_id, username, action, details)
       VALUES (?,?,?,?,?,?)`
    ).run(report_id || null, site_id || null, user_id || null, username || null, action,
          details ? JSON.stringify(details) : null);
  } catch (e) { console.error('[audit_log] write error:', e.message); }
}

/**
 * Return the last N audit entries for a specific report (most recent first).
 */
function getReportAuditLog(report_id, limit = 30) {
  if (REPORTS_BACKEND === 'postgres') return _getReportAuditLogPg(report_id, limit);
  return db.prepare(
    `SELECT id, user_id, username, action, details, created_at
     FROM audit_log WHERE report_id=?
     ORDER BY created_at DESC LIMIT ?`
  ).all(report_id, limit);
}
async function _getReportAuditLogPg(report_id, limit = 30) {
  return pgHandle().prepare(
    `SELECT id, user_id, username, action, details, created_at
     FROM audit_log WHERE report_id=? ORDER BY created_at DESC LIMIT ?`
  ).all(report_id, limit);
}

// ── CLEANUP EXPIRED SESSIONS ──────────────────────────────────────
setInterval(() => {
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
}, 3600000); // every hour

console.log('[Reports-DB] ✅ SQLite ready — reports.db');

// ── OPEN CHANGES FOR SITE ─────────────────────────────────────────
// Returns all non-closed change records for a site's group(s).
// groups: string[] matching sites.zoho_group (e.g. ['Mana IT Agent']
//         or ['Exploration BF Support','Exploration CI Support','Exploration IT Support'])
function getOpenChangesForSite(groups) {
  if (REPORTS_BACKEND === 'postgres') return _getOpenChangesForSitePg(groups);
  if (!groups || !groups.length) return [];
  const ph = groups.map(() => '?').join(',');
  return db.prepare(`
    SELECT display_id, subject, status, stage, stage_status, risk, emergency, requester,
           scheduled_start, scheduled_end, created_time
    FROM change_records
    WHERE stage != 'Close'
      AND group_name IN (${ph})
    ORDER BY scheduled_end ASC, created_time DESC
    LIMIT 25
  `).all(...groups);
}
// PG fork — no dialect hazard (string ORDER BY, IN list). Empty-groups guard preserved.
async function _getOpenChangesForSitePg(groups) {
  if (!groups || !groups.length) return [];
  const ph = groups.map(() => '?').join(',');
  return await pgHandle().prepare(`
    SELECT display_id, subject, status, stage, stage_status, risk, emergency, requester,
           scheduled_start, scheduled_end, created_time
    FROM change_records
    WHERE stage != 'Close'
      AND group_name IN (${ph})
    ORDER BY scheduled_end ASC, created_time DESC
    LIMIT 25
  `).all(...groups);
}

// ── ACTIVE MAJOR INCIDENTS FOR SITE ───────────────────────────────
// Returns Major Incident tickets that are still OPEN (pending_status=1)
// AND belong to one of the report's site groups. Used by the weekly
// report editor's "Active Major Incidents" panel — mirrors the
// getOpenChangesForSite() pattern so the UI feels consistent.
//
// Includes a slice of UDF context (RCA / CA / LL / PIR) so the panel
// can show whether RCA is missing/partial/done at a glance — same
// completeness scoring the executive Incident Register uses.
//
// Cap of 25 matches the changes panel — sites rarely have more than a
// handful of *open* major incidents at any one time, but the LIMIT is
// defensive in case a backlog has built up.
function getActiveMajorIncidentsForSite(groups) {
  if (REPORTS_BACKEND === 'postgres') return _getActiveMajorIncidentsForSitePg(groups);
  if (!groups || !groups.length) return [];
  const ph = groups.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT request_id, display_id, subject, request_status, pending_status,
           overdue_status, request_type, technician, requester, site,
           tech_group, category, sub_category, created_time, due_by_time,
           resolved_time, last_updated_time, impact, udf_json
    FROM request_records
    WHERE pending_status = 1
      AND (LOWER(COALESCE(request_type, '')) LIKE '%major%' OR LOWER(COALESCE(template, '')) LIKE '%major incident%')
      -- request_status is the FRESH truth for the always-re-upserted MI rows;
      -- pending_status can be stale (=1 on a closed MI). Drop terminal states
      -- so closed / resolved / cancelled incidents never show as "active".
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%closed%'
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%resolved%'
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%cancel%'
      AND tech_group IN (${ph})
    ORDER BY
      overdue_status DESC,             -- breached SLAs first
      datetime(created_time) ASC       -- then oldest open
    LIMIT 25
  `).all(...groups);

  return _mapActiveMajorIncidentRows(rows);
}

// PG fork — only dialect hazard is the datetime() in the ORDER BY →
// created_time::timestamptz. WHERE has no date/now expression.
async function _getActiveMajorIncidentsForSitePg(groups) {
  if (!groups || !groups.length) return [];
  const ph = groups.map(() => '?').join(',');
  const rows = await pgHandle().prepare(`
    SELECT request_id, display_id, subject, request_status, pending_status,
           overdue_status, request_type, technician, requester, site,
           tech_group, category, sub_category, created_time, due_by_time,
           resolved_time, last_updated_time, impact, udf_json
    FROM request_records
    WHERE pending_status = 1
      AND (LOWER(COALESCE(request_type, '')) LIKE '%major%' OR LOWER(COALESCE(template, '')) LIKE '%major incident%')
      -- see sqlite fork: exclude terminal states (stale pending_status guard)
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%closed%'
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%resolved%'
      AND LOWER(COALESCE(request_status, '')) NOT LIKE '%cancel%'
      AND tech_group IN (${ph})
    ORDER BY
      overdue_status DESC,
      created_time::timestamptz ASC
    LIMIT 25
  `).all(...groups);

  return _mapActiveMajorIncidentRows(rows);
}

// Shared transform for active major-incident rows (engine-agnostic JS):
// curated UDF subset + completeness/PIR heuristics.
function _mapActiveMajorIncidentRows(rows) {
  // Surface a curated subset of UDFs the panel cares about, plus a
  // pre-computed completeness flag (missing/partial/done) for each so
  // the client doesn't have to re-implement the dashboard's heuristic.
  const completeness = (s) => {
    const t = (s || '').trim();
    if (!t || t.length < 3)  return 'missing';
    if (t.length < 20)       return 'partial';
    return 'done';
  };
  const pirStatus = (s) => {
    const t = (s || '').trim().toLowerCase();
    if (!t || t === 'no')                  return 'missing';
    if (t === 'yes' || t === 'complete')   return 'done';
    return 'partial';
  };

  return rows.map(r => {
    let udf = {};
    try { udf = r.udf_json ? JSON.parse(r.udf_json) : {}; } catch(e) {}
    const rca = udf['UDF:Root Cause Analysis :'] || '';
    const ca  = udf['UDF:Corrective action:']     || '';
    const ll  = udf['UDF:Lessons Learned:']       || '';
    const pir = udf['UDF:PIR Required:']          || '';
    const downtime = udf['UDF:Total Downtime:'] || udf['UDF:Total Downtime'] || '';
    return {
      request_id:        r.request_id,
      display_id:        r.display_id,
      subject:           r.subject,
      status:            r.request_status,
      overdue:           !!r.overdue_status,
      impact:            r.impact || null,
      downtime:          downtime,
      technician:        r.technician,
      requester:         r.requester,
      site:              r.site,
      group_name:        r.tech_group,
      category:          r.category,
      sub_category:      r.sub_category,
      created_time:      r.created_time,
      due_by_time:       r.due_by_time,
      last_updated_time: r.last_updated_time,
      // UDF text + completeness flags
      rca, ca, ll, pir,
      rca_status: completeness(rca),
      ca_status:  completeness(ca),
      ll_status:  completeness(ll),
      pir_status: pirStatus(pir),
    };
  });
}

// ── UPCOMING PLANNED CHANGES (Executive View — planned maintenance) ─────────
/**
 * getUpcomingChanges(days) — changes still open (stage != 'Close') whose
 * scheduled_start falls within the next `days` days. Returns ONLY the five
 * operationally-safe, PII-free fields the public Executive View renders:
 *   { date, title, window, impact, scope }
 *   - date   = scheduled_start (date portion)
 *   - title  = change subject (operational text — no requester/technician)
 *   - window = scheduled_start → scheduled_end (HH:MM–HH:MM)
 *   - impact = risk band
 *   - scope  = site_id
 * Deliberately selects ONLY those columns (never requester/owner/manager).
 */
function getUpcomingChanges(days = 7) {
  if (REPORTS_BACKEND === 'postgres') return _getUpcomingChangesPg(days);
  const n = Number(days) > 0 ? Number(days) : 7;
  const rows = db.prepare(`
    SELECT subject, risk, site_id, scheduled_start, scheduled_end
    FROM change_records
    WHERE stage != 'Close'
      AND scheduled_start IS NOT NULL AND scheduled_start != ''
      AND datetime(scheduled_start) >= datetime('now')
      AND datetime(scheduled_start) <= datetime('now', '+' || ? || ' days')
    ORDER BY datetime(scheduled_start) ASC
    LIMIT 25
  `).all(n);
  return _mapUpcomingChanges(rows);
}
// PG fork — scheduled_start/_end are TEXT ISO columns: sqlite's
// datetime(col) >= datetime('now', '+N days') window becomes a typed
// NULLIF(col,'')::timestamptz compare against now() + (N * interval '1 day').
// The `?::int` cast keeps the day count an integer for interval multiplication.
async function _getUpcomingChangesPg(days = 7) {
  const n = Number(days) > 0 ? Number(days) : 7;
  const rows = await pgHandle().prepare(`
    SELECT subject, risk, site_id, scheduled_start, scheduled_end
    FROM change_records
    WHERE stage != 'Close'
      AND scheduled_start IS NOT NULL AND scheduled_start != ''
      AND NULLIF(scheduled_start,'')::timestamptz >= now()
      AND NULLIF(scheduled_start,'')::timestamptz <= now() + (?::int * interval '1 day')
    ORDER BY NULLIF(scheduled_start,'')::timestamptz ASC
    LIMIT 25
  `).all(n);
  return _mapUpcomingChanges(rows);
}
// Shared JS row-mapping (both forks) — the 5 whitelisted PII-free fields.
function _mapUpcomingChanges(rows) {
  const hhmm = (v) => {
    if (!v) return '';
    const s = String(v).replace(' ', 'T');
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return rows.map(r => {
    const startT = hhmm(r.scheduled_start);
    const endT   = hhmm(r.scheduled_end);
    return {
      date:   r.scheduled_start ? String(r.scheduled_start).slice(0, 10) : null,
      title:  r.subject || '—',
      window: (startT && endT) ? `${startT}–${endT}` : (startT || ''),
      impact: r.risk || null,
      scope:  r.site_id || null,
    };
  });
}

/**
 * Distinct values present in request_records for the 4 analytics
 * multi-select filters (2026-06-11). Drives the dropdown options on
 * analytics.html so new Zoho values appear automatically — no
 * hardcoded lists to maintain. All 4 columns are indexed or small
 * enough that DISTINCT scans are sub-millisecond at current volume.
 */
function getRequestFilterOptions() {
  if (REPORTS_BACKEND === 'postgres') return _getRequestFilterOptionsPg();
  // .sort() (UTF-16 code-unit) applied in BOTH forks — SQL ORDER BY collation differs between
  // sqlite (BINARY) and pg (locale), so the deterministic ordering lives in shared-shape JS.
  const distinct = (col) => db.prepare(
    `SELECT DISTINCT ${col} AS v FROM request_records
     WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY 1`
  ).all().map(r => r.v).sort();
  return {
    statuses: distinct('request_status'),
    types:    distinct('request_type'),
    impacts:  distinct('impact'),
    modes:    distinct('mode'),
  };
}
async function _getRequestFilterOptionsPg() {
  const H = pgHandle();
  const distinct = async (col) => (await H.prepare(`SELECT DISTINCT ${col} AS v FROM request_records WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY 1`).all()).map(r => r.v).sort();
  return {
    statuses: await distinct('request_status'),
    types:    await distinct('request_type'),
    impacts:  await distinct('impact'),
    modes:    await distinct('mode'),
  };
}

// ══ SYSTEM LOGS v1 ══════════════════════════════════════════════════════════
// Unified security/audit event log. logEvent() is fire-and-forget: it NEVER
// throws/rejects to a caller (a dead log must not break a request). Callers
// invoke it BARE (never awaited, never chained → clear of await-precedence).
const _RISK_ACTIONS = new Set([
  'login_failed','session_killed','user_deleted','user_role_changed','password_reset','report_deleted',
]);
function _isRiskAction(action) { return _RISK_ACTIONS.has(String(action || '')); }

const _SECRET_KEY = /pass|secret|token|password|key$|_key|auth/i;
function _redactKeys(keys) { return (keys || []).filter(k => !_SECRET_KEY.test(String(k))); }

function _logCtx(req) {                       // authenticated call sites only
  const u = (req && req.reportUser) || {};
  const ip = (req && (req.ip || (req.headers && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()))) || null;
  return { actor: u.username || 'anonymous', actor_id: (u.id != null ? u.id : null), ip };
}

async function _logEventPg(row) {
  await pgHandle().prepare(
    `INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(row.ts,row.category,row.action,row.actor,row.actor_id,row.target,row.details,row.ip,row.risk);
}
async function logEvent(ev = {}) {
  try {
    const row = {
      ts: new Date().toISOString(),
      category: String(ev.category || 'system'),
      action: String(ev.action || 'unknown'),
      actor: ev.actor != null ? String(ev.actor) : 'system',
      actor_id: ev.actor_id != null ? ev.actor_id : null,
      target: ev.target != null ? String(ev.target) : null,
      details: ev.details == null ? null : (typeof ev.details === 'string' ? ev.details : JSON.stringify(ev.details)),
      ip: ev.ip != null ? String(ev.ip) : null,
      risk: ev.risk != null ? (ev.risk ? 1 : 0) : (_isRiskAction(ev.action) ? 1 : 0),
    };
    if (REPORTS_BACKEND === 'postgres') { await _logEventPg(row); }
    else {
      db.prepare(
        `INSERT INTO system_log (ts,category,action,actor,actor_id,target,details,ip,risk)
         VALUES (@ts,@category,@action,@actor,@actor_id,@target,@details,@ip,@risk)`
      ).run(row);
    }
  } catch (e) { console.warn('[system-log] logEvent failed (swallowed):', e.message); }
}

// WHERE builder — present keys only, parameterised. Unknown keys ignored.
function _syslogWhere(f = {}) {
  const c = [], p = [];
  if (f.category) { c.push('category = ?'); p.push(f.category); }
  if (f.action)   { c.push('action = ?');   p.push(f.action); }
  if (f.actor)    { c.push('actor LIKE ?');  p.push('%' + f.actor + '%'); }
  if (f.risk === 1 || f.risk === '1') { c.push('risk = 1'); }
  if (f.from && f.to) { c.push('substr(ts,1,10) BETWEEN ? AND ?'); p.push(f.from, f.to); }
  else if (f.from)    { c.push('substr(ts,1,10) >= ?'); p.push(f.from); }
  else if (f.to)      { c.push('substr(ts,1,10) <= ?'); p.push(f.to); }
  if (f.q) { c.push('(action LIKE ? OR target LIKE ? OR details LIKE ? OR actor LIKE ?)');
             const like = '%' + f.q + '%'; p.push(like, like, like, like); }
  return { where: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p };
}
async function countSystemLog(filters = {}) {
  const { where, params } = _syslogWhere(filters);
  const sql = `SELECT COUNT(*) AS n FROM system_log ${where}`;
  if (REPORTS_BACKEND === 'postgres') return Number((await pgHandle().prepare(sql).get(...params)).n);
  return db.prepare(sql).get(...params).n;
}
async function listSystemLog(filters = {}, { limit = 50, offset = 0 } = {}) {
  const { where, params } = _syslogWhere(filters);
  const sql = `SELECT * FROM system_log ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`;
  const rows = REPORTS_BACKEND === 'postgres'
    ? await pgHandle().prepare(sql).all(...params, limit, offset)
    : db.prepare(sql).all(...params, limit, offset);
  return { rows, total: await countSystemLog(filters) };
}
async function getSystemLogAnalytics({ window: win = '30d' } = {}) {
  const days = { '7d':7, '30d':30, '90d':90 }[win] || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const q = async (sql, ...a) => (REPORTS_BACKEND === 'postgres'
    ? pgHandle().prepare(sql).all(...a) : db.prepare(sql).all(...a));
  const g = async (sql, ...a) => (REPORTS_BACKEND === 'postgres'
    ? pgHandle().prepare(sql).get(...a) : db.prepare(sql).get(...a));
  const t = await g(`SELECT COUNT(*) AS events, COALESCE(SUM(risk),0) AS risk_events,
      COUNT(DISTINCT actor) AS distinct_actors, COUNT(DISTINCT ip) AS distinct_ips
      FROM system_log WHERE ts >= ?`, since);
  const series      = await q(`SELECT substr(ts,1,10) AS d, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY substr(ts,1,10) ORDER BY d`, since);
  const risk_series = await q(`SELECT substr(ts,1,10) AS d, COUNT(*) AS n FROM system_log WHERE ts >= ? AND risk=1 GROUP BY substr(ts,1,10) ORDER BY d`, since);
  const top_actions = await q(`SELECT action, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY action ORDER BY n DESC LIMIT 12`, since);
  const top_actors  = await q(`SELECT actor, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY actor ORDER BY n DESC LIMIT 12`, since);
  const top_ips     = await q(`SELECT ip, COUNT(*) AS n FROM system_log WHERE ts >= ? AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 12`, since);
  const hourRows    = await q(`SELECT substr(ts,12,2) AS h, COUNT(*) AS n FROM system_log WHERE ts >= ? GROUP BY substr(ts,12,2)`, since);
  const by_hour = Array.from({ length: 24 }, () => 0);
  for (const r of hourRows) { const h = parseInt(r.h, 10); if (h >= 0 && h < 24) by_hour[h] = Number(r.n); }
  const num = a => a.map(x => ({ ...x, n: Number(x.n) }));
  return {
    totals: { events: Number(t.events), risk_events: Number(t.risk_events),
              distinct_actors: Number(t.distinct_actors), distinct_ips: Number(t.distinct_ips) },
    series: num(series), risk_series: num(risk_series),
    top_actions: num(top_actions), top_actors: num(top_actors), top_ips: num(top_ips), by_hour,
  };
}

// One-time backfill of the existing report audit_log into system_log. Idempotent
// via the zero-report-rows guard (NO setConfig marker — DEFAULTS filter trap).
async function _backfillSystemLogFromAudit() {
  try {
    const have = await countSystemLog({ category: 'report' });
    if (have > 0) return;
    const rows = REPORTS_BACKEND === 'postgres'
      ? await pgHandle().prepare(`SELECT report_id, user_id, username, action, details, created_at FROM audit_log`).all()
      : db.prepare(`SELECT report_id, user_id, username, action, details, created_at FROM audit_log`).all();
    for (const r of rows) {
      await logEvent({ category: 'report',
        action: /^report_/.test(r.action) ? r.action : 'report_' + r.action,
        actor: r.username, actor_id: r.user_id, target: r.report_id != null ? String(r.report_id) : null,
        details: r.details, risk: r.action === 'deleted' ? 1 : undefined });
    }
    if (rows.length) console.log(`[system-log] backfilled ${rows.length} report audit rows`);
  } catch (e) { console.warn('[system-log] backfill skipped:', e.message); }
}

module.exports = {
  db,
  REPORTS_BACKEND, initPgReports, pgHandle,
  // System Logs v1
  _isRiskAction, _redactKeys, _logCtx, logEvent,
  listSystemLog, countSystemLog, getSystemLogAnalytics, _backfillSystemLogFromAudit,
  hashPassword, makeSession,
  login, validateSession, logout, safeUser,
  findUserByEntra, linkUserEntra, createSessionForUser,
  updateUserProfileFromEntra, setUserEmail,
  // Active-sessions observability (admin card on reports.html#admin)
  listActiveSessions, forceLogoutByToken,
  // Multi-role RBAC helpers
  getUserRoles, setUserRoles, userHasRole,
  ROLE_HIERARCHY, FEATURE_ROLES_KNOWN,
  listUsers, createUser, updateUser, deleteUser, changePassword,
  listSites, updateSiteGroup, createSite, updateSite, setSiteActive,
  // Per-module site codes (site_module_codes) — read path for the reporting suite
  getSiteIdByModuleCode, listSiteModuleCodes, listSiteMerakiMap, setSiteMerakiCode,
  listWanSubsiteNetworks, setWanSubsiteNetworks,
  // Per-site report blocks (group-scoped — request_records.site is unreliable)
  getSiteHelpdeskMonthly, _computeSiteHelpdesk,
  // Window-scoped siblings ([from,to] inclusive) — the IT Review panel needs a
  // window, not a month. Changes carry the VERBATIM port of the shipped
  // executive-report.html classifier (see _changeOutcome).
  getSiteHelpdeskWindow, getSiteChangesWindow, _computeSiteChanges, _changeOutcome,
  getSiteImpactCounts, _bucketSiteImpact,
  getSiteOpenChanges, _computeOpenChanges,
  getSiteTechnicianStats, _computeTechStats,
  getPreviousWeek, ensureWeek, getWeekRange,
  ensureReport, getReport, listReports,
  saveInfraKpis, upsertInfraSnapshots, getInfraSnapshots, upsertWanSnapshots, getWanSnapshots, upsertWanOutage, getWanOutages, listOpenWanOutages, closeWanOutage, reconcileProvisionalOutage, saveHelpdeskData, saveLights, saveActionItems, _backfillActionUids,
  setActionMerge, clearActionMerge, setActionStatus, setActionLineage, getSiteOpenReportActions,
  getPreviousWeekOpenActions, listAllWeeksWithActions, getActionsForReport,
  listAllWeeksWithLights, getLightsForReport,
  // Action departments (editable dropdown for action items)
  listDepartments, createDepartment, updateDepartment, setDepartmentActive,
  getPreviousWeekInfraKpis,
  updateReportStatus, touchReport, deleteReport,
  reassignReportWeek, requestRecordExists,   // 4D-wiring-2 helpers
  getMonthlyData, getWeekSummaryData, getYearlySummary, getCalendarMonthlyHelpdesk, getCalendarMonthlyTop10, getHelpdesk6MonthHistory,
  getMonthlyHelpdeskHistory, getMajorIncidentsHistory, getChangeRecordsHistory,
  fmtDowntime,   // shared formatter — kept in sync with public/lib/dashboard-shared.js
  // Executive scorecard DB-direct helpers (Phase 1+2 of executive.html rewrite)
  getAgeingBySiteDB, getAgeingByGroupDB, getFirstResponseTrendDB, getCustomerVoiceDB,
  // Phase 3: additional /api/data/* migrations
  getSlaTrendDB, getSlaByCategoryDB,
  // Phase 3 final batch: eliminate live-Zoho dependency entirely
  getGroupRequestsDB, getEmergencyChangesDB, getAgeingSummaryDB,
  getIncidentVsSrDB, getCabApprovalsDB, getCabRecommendationsDB,
  getCustomerVoiceByDimensionDB,
  // Monthly report edits + annual objectives
  getMonthlyReport, getMonthlyEdits, saveMonthlyEdits,
  getAnnualObjectives, saveAnnualObjectives,
  // Audit trail
  logAudit, getReportAuditLog,
  // Sync metadata
  getSyncStatus, getLastSyncAt, markSyncSuccess, markSyncError,
  // Change & CAB upsert
  upsertChangeBatch, upsertCABBatch,
  // Survey upsert
  upsertSurveyResultBatch, upsertSurveyAnswerBatch,
  // Request upsert
  upsertRequestBatch, upsertRequestUdfBatch,
  // Reconciliation helpers (full-sync deletion detection)
  reconcileChangeRecords, reconcileCABApprovals, reconcileSurveyResults,
  reconcileRequestRecords,
  // Query helpers
  getChangeRecords, getCABApprovals, getSurveyResults, getSurveyAnswers,
  getSurveyResultsForVoice, getSurveyVoiceAnswers,   // /api/survey/voice readers
  getRequestRecords,
  // 4D-wiring-1 readers (replace raw-sqlite-handle reads in server.js)
  getRequestRecordsSince, getSubmissionChannelsDB, getSurveyKpisDB,
  // Computed metrics (replicate Zoho Analytics aggregate formulas)
  getChangeMetrics, getCABMetrics, getSurveyMetrics, getRequestMetrics,
  getRequestFilterOptions,
  // Open changes for PPTX slide
  getOpenChangesForSite,
  getActiveMajorIncidentsForSite,
  // Upcoming planned changes (Exec View — planned maintenance)
  getUpcomingChanges,
  // Exec View editorial (SharePoint executive page)
  getExecEditorial, setExecEditorial,
  getExecReportEditorial, setExecReportEditorial,
  getExecMiSummaries, setExecMiSummary,
};
