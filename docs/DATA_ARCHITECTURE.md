# SDP Dashboard — Data Architecture (Schema Reference)

**Last updated**: 2026-06-05
**Audience**: Another agent / contractor / new developer who needs to build a
report, dashboard, integration, or analysis on top of this codebase.

This document is a **standalone reference**. You can hand it to a fresh
session and it will have everything needed to write SQL queries, build
PPTX reports, or design new modules without re-reading the source code.

---

## 0 · Quick TL;DR

```
4 SQLite databases (better-sqlite3, WAL mode)
─────────────────────────────────────────────
reports.db       ← AUTH + Zoho synced data + reports + 2 add-on modules
tracker.db       ← Activity Tracker (11 sites × 31 activities × months)
inspection.db    ← IT Inspections (10 sites × 17 categories × 173 items)
meetings.db      ← Meetings PVs + Issues + Council escalations

Cross-DB linkage = a SINGLE shared column: reports.db users.site_name
Each satellite DB has its own siteNameToCode() map to translate it to
its internal 3-letter code (HOUNDE → MGO in tracker, → HGO in inspection
& Risk Register, etc.). Codes don't always match across modules.
```

---

## 1 · `reports.db` — Hub central (DATA_DIR/reports.db)

Created and managed by `reports-db.js`. PRAGMA `journal_mode = WAL`.

### 1.1 — Auth + identity

```sql
CREATE TABLE sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE NOT NULL,    -- e.g. 'HOUNDE', 'MANA', 'LAFIGUE'
  zoho_group TEXT,                    -- Zoho AP group name, e.g. 'Hounde IT Agents'
  active     INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,        -- scrypt
  salt          TEXT NOT NULL,
  site_id       INTEGER,              -- NULL = admin/exec (cross-site)
  role          TEXT DEFAULT 'editor',-- super_admin | executive | admin | editor | viewer
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id)
);

CREATE TABLE user_roles (
  user_id    INTEGER NOT NULL,        -- FK users(id) ON DELETE CASCADE
  role       TEXT NOT NULL,           -- tracker-admin | tracker-editor | report-author | audit-viewer
  granted_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,        -- FK users(id) ON DELETE CASCADE
  expires_at TEXT NOT NULL,
  last_seen  TEXT,                    -- bumped on every authenticated request
  created_at TEXT DEFAULT (datetime('now'))
);
```

Role model (orthogonal): `users.role` carries the legacy hierarchical role
(super_admin > executive > admin > editor > viewer). `user_roles` carries
feature roles that compose (a user can be `editor` + `tracker-admin`).

### 1.2 — Zoho-synced operational data (synced by `zoho-sync.js`)

Most-used table for reports → **`request_records`** (every SDP ticket).

```sql
CREATE TABLE request_records (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id             TEXT UNIQUE NOT NULL,  -- Zoho RequestID (numeric)
  display_id             TEXT,                  -- '#INC-XXXX' / '#SR-XXXX'
  subject                TEXT,
  request_status         TEXT,                  -- 'Open', 'Resolved', 'Closed'
  pending_status         INTEGER DEFAULT 1,     -- 1=open, 0=closed (Request Pending Status)
  overdue_status         INTEGER DEFAULT 0,     -- 1=SLA violated
  request_type           TEXT,                  -- 'Incident' | 'Service Request' | 'Major Incident'
  service_request        INTEGER DEFAULT 0,     -- 1=SR, 0=Incident (derived)
  is_escalated           INTEGER DEFAULT 0,
  reopen_count           INTEGER DEFAULT 0,
  due_by_time            TEXT,                  -- ISO datetime (SLA deadline)
  time_elapsed_ms        INTEGER,               -- raw ms; /3_600_000 → hours
  created_time           TEXT,                  -- ISO datetime
  resolved_time          TEXT,                  -- ISO datetime (nullable)
  completed_time         TEXT,                  -- ISO datetime (nullable)
  responded_time         TEXT,                  -- ISO datetime (nullable)
  assigned_time          TEXT,                  -- ISO datetime (nullable)
  last_updated_time      TEXT,                  -- ISO datetime (nullable)
  first_response_overdue TEXT,                  -- 'true' | 'false' (text)
  technician             TEXT,
  requester              TEXT,
  category               TEXT,
  sub_category           TEXT,
  site                   TEXT,                  -- raw Zoho site label (HOUNDE / MANA / Sabodala / ...)
  tech_group             TEXT,                  -- Zoho Group ('Hounde IT Agents', 'CAB Agents', ...)
  mode                   TEXT,                  -- Email | Web Portal | Phone
  impact                 TEXT,                  -- 'Enterprise' | 'Single department' | 'Multiple departments' | 'Individual'
  udf_json               TEXT,                  -- JSON: { 'UDF:Root Cause Analysis :': '...', ... } — only populated for Major Incidents
  fetched_at             TEXT                   -- last upsert ISO datetime
);
CREATE INDEX idx_rr_created  ON request_records(created_time);
CREATE INDEX idx_rr_status   ON request_records(request_status);
CREATE INDEX idx_rr_site     ON request_records(site);
CREATE INDEX idx_rr_pending  ON request_records(pending_status);
CREATE INDEX idx_rr_overdue  ON request_records(overdue_status);
```

**`udf_json` field-name variants** (Zoho returns inconsistent keys —
helpers in `public/lib/dashboard-shared.js → incidentUdf(r, kind)` handle
all of these):

| Kind | Variants seen in production |
|---|---|
| RCA (Root Cause) | `UDF:Root Cause Analysis :`, `UDF:Root Cause Analysis`, `UDF:RCA`, `Root Cause Analysis`, `RCA`, `rca`, `root_cause_analysis` |
| CA (Corrective Action) | `UDF:Corrective action:`, `UDF:Corrective Action`, `Corrective Action`, `CA`, `corrective_action` |
| PIR (Post-Incident Review) | `UDF:PIR Required:`, `UDF:Post-Incident Review:`, `PIR Required`, `PIR`, `pir_required` |
| LL (Lessons Learned) | `UDF:Lessons Learned:`, `Lessons Learned`, `LL`, `lessons_learned` |

```sql
CREATE TABLE change_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id     TEXT UNIQUE NOT NULL,   -- Zoho ChangeID
  display_id    TEXT,                   -- 'CRQ-XXXX'
  subject       TEXT,
  status        TEXT,
  stage         TEXT,
  stage_status  TEXT,                   -- Zoho "Stage and Status" combined
  risk          TEXT,
  change_type   TEXT,
  emergency     INTEGER DEFAULT 0,
  category      TEXT,
  sub_category  TEXT,
  requester     TEXT,
  requester_id  TEXT,
  owner_id      TEXT,
  manager       TEXT,
  group_name    TEXT,                   -- 'ITSM Agents', 'Change Manager', etc.
  -- + dates: created_time, scheduled_start_time, planned_end_time, etc.
  fetched_at    TEXT
);

CREATE TABLE cab_approvals (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id              TEXT UNIQUE NOT NULL,
  change_id                TEXT NOT NULL,   -- soft FK → change_records.change_id
  approver_name            TEXT,
  approval_status          TEXT,            -- 'Approved' | 'Rejected' | 'Pending'
  approval_stage           TEXT,
  approval_level           TEXT,
  approval_level_status    TEXT,
  recommendation_requested TEXT,
  action_taken_on          TEXT,
  turnaround_minutes       INTEGER,         -- CAB SLA metric
  rule_type                TEXT,
  comments                 TEXT,
  fetched_at               TEXT
);

CREATE TABLE survey_results (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id           TEXT UNIQUE NOT NULL,
  response_id         TEXT,
  survey_id           TEXT,
  survey_name         TEXT,                 -- denormalised
  request_id          TEXT,                 -- soft FK → request_records.request_id
  request_display_id  TEXT,                 -- denormalised '#INC-XXXX'
  change_id           TEXT,                 -- nullable soft FK → change_records
  user_id             TEXT,
  overall_score       REAL,                 -- 0–100 percentage (CSAT)
  survey_sent_on      TEXT,
  survey_responded_on TEXT,                 -- nullable (= not answered)
  fetched_at          TEXT
);
CREATE INDEX idx_sr_request ON survey_results(request_display_id);

CREATE TABLE survey_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id   TEXT NOT NULL,              -- soft FK → survey_results.response_id
  result_id     TEXT NOT NULL,              -- soft FK → survey_results.result_id
  question_id   TEXT,
  question_text TEXT,                       -- denormalised
  question_type TEXT,                       -- single_choice | star_rating | textarea
  answer_text   TEXT,                       -- free-text answer
  answer_option TEXT,                       -- selected option label
  score         INTEGER,                    -- numeric score (nullable)
  skipped       INTEGER DEFAULT 0,
  fetched_at    TEXT
);
CREATE INDEX idx_sa_response ON survey_answers(response_id);
CREATE INDEX idx_sa_result   ON survey_answers(result_id);

CREATE TABLE sync_metadata (
  job_name          TEXT PRIMARY KEY,        -- 'helpdesk' | 'change_cab' | 'survey'
  last_sync_at      TEXT,                    -- last SUCCESSFUL sync ISO
  last_sync_rows    INTEGER DEFAULT 0,
  last_full_sync_at TEXT,
  schema_snapshot   TEXT,
  deleted_count     INTEGER DEFAULT 0,
  last_error        TEXT,
  last_error_at     TEXT,
  sync_count        INTEGER DEFAULT 0
);
```

### 1.3 — Reports + KPIs (weekly + monthly site reports)

```sql
CREATE TABLE weeks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  year        INTEGER NOT NULL,
  week_number INTEGER NOT NULL,        -- Zoho AP convention (NOT ISO week)
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  label       TEXT NOT NULL,           -- e.g. 'W12 2026'
  UNIQUE(year, week_number)
);

CREATE TABLE weekly_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL,       -- FK sites(id)
  week_id      INTEGER NOT NULL,       -- FK weeks(id)
  status       TEXT DEFAULT 'draft',   -- draft | submitted
  submitted_at TEXT,
  submitted_by INTEGER,                -- FK users(id)
  created_by   INTEGER,                -- FK users(id)
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(site_id, week_id)
);

CREATE TABLE monthly_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      INTEGER NOT NULL,
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,
  status       TEXT DEFAULT 'draft',
  -- ...
  UNIQUE(site_id, year, month)
);

CREATE TABLE annual_objectives (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  year    INTEGER NOT NULL,
  -- ...
  UNIQUE(site_id, year)
);

CREATE TABLE infra_kpis (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    INTEGER NOT NULL,        -- FK weekly_reports(id) ON DELETE CASCADE
  service      TEXT NOT NULL,           -- 'Network', 'Email', 'WAN1 Fetekro Explo', etc.
  kpi          TEXT NOT NULL,
  target       TEXT,
  status_value TEXT,
  status_color TEXT DEFAULT 'green',    -- green | orange | red | none
  trend        TEXT DEFAULT 'stable',   -- up | down | stable | no_change
  sort_order   INTEGER DEFAULT 0
);

CREATE TABLE helpdesk_data (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id             INTEGER NOT NULL UNIQUE,  -- FK weekly_reports
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
  sla_violations        TEXT,           -- JSON: [{category, pct}]
  group_metrics         TEXT,           -- JSON: per-Zoho-group KPI snapshot
  all_groups            TEXT,           -- JSON: list of groups seen in the sync
  fetched_at            TEXT,
  selected_group        TEXT,
  chart_data            TEXT            -- JSON: chart series for the report
);

CREATE TABLE lights (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL,                    -- FK weekly_reports CASCADE
  type       TEXT NOT NULL,                       -- low_light | high_light | change_in_progress | change_pending
  content    TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE action_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER NOT NULL,                    -- FK weekly_reports CASCADE
  task       TEXT NOT NULL,
  priority   TEXT DEFAULT 'Medium',               -- High | Medium | Low
  due_date   TEXT,
  owner      TEXT,
  status     TEXT DEFAULT 'open',                 -- open | in_progress | closed
  department TEXT,
  comment    TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE action_departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER DEFAULT 0,
  active     INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id  INTEGER,                             -- nullable for non-report actions
  site_id    INTEGER,
  user_id    INTEGER,
  username   TEXT,
  action     TEXT NOT NULL,                       -- created|edited_infra|edited_helpdesk|edited_lights|edited_actions|submitted|reverted|deleted|edited_monthly|edited_objectives
  details    TEXT,                                -- JSON optional
  created_at TEXT DEFAULT (datetime('now'))
);
```

### 1.4 — Add-on modules living in reports.db (not in their own DB)

```sql
-- Risk Register: maps SDP free-form site labels → Risk Register short codes
CREATE TABLE rr_site_aliases (
  sdp_label  TEXT PRIMARY KEY,         -- 'HOUNDE', 'Hounde', 'MANA', 'LAFIGUE - SML', etc.
  code       TEXT NOT NULL,            -- 'HGO', 'MGO', 'SML', 'MASSAWA', 'OUAGA OFF1', 'EXPLO', etc.
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- Group Presets: dropdown configs for Tickets and Changes dashboard filters
CREATE TABLE dashboard_preset_groups (
  scope         TEXT NOT NULL,         -- 'tickets' | 'changes' (separate per scope)
  preset_name   TEXT NOT NULL,         -- 'Operations' | 'Application' | 'Cybersecurity' | 'ITSM' | 'Other'
  group_name    TEXT NOT NULL,         -- the Zoho group / change group name
  display_order INTEGER DEFAULT 0,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by    TEXT,
  PRIMARY KEY (scope, preset_name, group_name)
);
CREATE INDEX idx_dpg_scope ON dashboard_preset_groups(scope);
CREATE INDEX idx_dpg_group ON dashboard_preset_groups(scope, group_name);
```

---

## 2 · `tracker.db` — Activity Tracker (worktree root)

Managed by `tracker-db.js`.

> ### ⚠️ Schema v2 — per-year (current source of truth, ADR-001)
>
> Since 2026-06-12 the tracker runs in **per-year mode**
> (`TRACKER_PER_YEAR_EDITS=1` in prod `.env`). Each year owns its own
> pillars, activities and targets. The **normalised v2 tables are the
> source of truth**:
>
> ```sql
> tracker_years      (year PK, current_month, ...)
> tracker_pillars    (id, year, code, name, weight, display_order;   UNIQUE per year)
> tracker_activities (id, pillar_id FK→tracker_pillars, code, ...;    UNIQUE per year)
> tracker_targets_v2 (year, site, activity_id FK→tracker_activities, target, active;
>                     PK(year, site, activity_id), FK CASCADE)
> tracker_inputs_v2  (year, site, activity_id, months_json;           same shape, FK CASCADE)
> ```
>
> **The legacy singleton `tracker_config` + `tracker_targets` +
> `tracker_inputs` below are FROZEN forensics** — kept for backward
> reference but **never written and never re-promoted to source of
> truth** after the first divergent edit (2026 ≠ 2027). The boot-time
> legacy mirror / prune / v2-sync are auto-skipped in per-year mode;
> re-enabling them would resurrect deleted activities from the stale
> legacy. **Rollback in per-year mode = backup-restore ONLY** (the
> env-var rollback died with the first divergent edit). See
> `docs/adr/ADR-001-tracker-year-pillar-activity.md` and the ADR-001
> COMPLETE row in CLAUDE.md.
>
> Score math (`engine.js` browser + `tracker-pptx.js` server) is
> unchanged; only the persistence shape moved to per-year.

### Legacy schema (FROZEN — forensics only, do not write)

```sql
CREATE TABLE tracker_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,   -- singleton row
  activities_json     TEXT NOT NULL DEFAULT '[]',
  pillar_weights_json TEXT NOT NULL DEFAULT '{}',
  active_sites_json   TEXT NOT NULL DEFAULT '[]',
  years_json          TEXT NOT NULL DEFAULT '[]',
  current_month       INTEGER NOT NULL DEFAULT 4,
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE tracker_targets (
  site        TEXT NOT NULL,           -- 3-letter code (see SITE_MAP below)
  activity_ix INTEGER NOT NULL,        -- index into activities_json[]
  target      TEXT NOT NULL DEFAULT '0',
  active      INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (site, activity_ix)
);

CREATE TABLE tracker_inputs (
  year        INTEGER NOT NULL,
  site        TEXT NOT NULL,
  activity_ix INTEGER NOT NULL,
  months_json TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',  -- Jan..Dec
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (year, site, activity_ix)
);
```

### Tracker site codes (`SITE_MAP` in tracker-db.js)

```js
{
  'MANA':'MGO',   'Mana IT Agent':'MGO',
  'HOUNDE':'HGO', 'Hounde IT Agents':'HGO',
  'LAFIGUE':'SML','Lafigue IT Agents':'SML',
  'ITY':'ITY',    'ITY IT Agents':'ITY',
  'Sabodala':'SGO','Sabodala IT Agents':'SGO',
  'ABIDJAN':'ABJ','Abidjan IT Agents':'ABJ',
  'Dakar':'DKR',  'Dakar IT Agents':'DKR',
  'KALANA':'KLN', 'Kalana IT Agents':'KLN',
  'EXPLORATION':'EXP','Exploration BF Support':'EXP','Exploration CI Support':'EXP',
  'OUAGA':'EDV',  'Ouaga IT Agents':'EDV','Ouagadougou-EDV1':'EDV',
  'TANDA':'TND',  'Tanda IT Agents':'TND'
}
```

### activities_json — shape of one activity

```jsonc
{
  "name": "Backup verification",
  "pillar": "1-Network Infrast",         // one of the 4 pillars
  "kpi": "BOOLEAN",                      // BOOLEAN | COUNT | PERCENT | MILESTONE | CURRENCY | RATING
  "start": 1,                            // start month (1=Jan, 12=Dec) — used by Roadmap tab
  "end":   12                            // end month
}
```

### Score computation (mirrored in `engine.js` browser-side AND `tracker-pptx.js` server-side — keep in sync!)

| KPI type | GREEN | AMBER | RED |
|---|---|---|---|
| `BOOLEAN` (cumulative) | ≥ 1 | ≥ 0.5 | else if ended, otherwise pending |
| `PERCENT` (avg of active months) | ≥ target | ≥ 75% of target | < 75% |
| `MILESTONE` (phase complete) | complete | in progress | none & ended |
| `CURRENCY` (actual / target) | ≥ 100% | ≥ 75% | < 75% |
| `RATING` (avg of non-zero months / target) | ≥ target | ≥ 75% | < 75% |
| `COUNT` | same as PERCENT (vs target) | | |

Site-level RAG: `< 55% → red`, `< 65% → amber`, else green
Activity-level RAG: `< 50% → red`, `< 80% → amber`, else green

---

## 3 · `inspection.db` — IT Inspections (worktree root)

Managed by `inspection-db.js`. 8 tables, prefix `insp_*`.

```sql
-- Lookups (seeded from inspection-init.json on first run)
CREATE TABLE insp_sites (
  code          TEXT PRIMARY KEY,      -- SGO/HGO/MGO/SMI/SML/KGO + DKR/ABJ/OUA/OTH
  name_en       TEXT NOT NULL,
  name_fr       TEXT,
  country       TEXT,
  site_type     TEXT DEFAULT 'mine',   -- mine | office | other
  display_order INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1
);

CREATE TABLE insp_areas (
  code          TEXT PRIMARY KEY,
  name_en       TEXT NOT NULL,
  name_fr       TEXT,
  area_group    TEXT,
  display_order INTEGER DEFAULT 0,
  active        INTEGER DEFAULT 1
);

CREATE TABLE insp_types (
  code          TEXT PRIMARY KEY,
  label_en      TEXT NOT NULL,
  label_fr      TEXT,
  display_order INTEGER DEFAULT 0
);

CREATE TABLE insp_inspections (
  id                   TEXT PRIMARY KEY,        -- e.g. 'EM-IT-20260531-7591'
  label                TEXT,
  inspection_date      TEXT,                    -- ISO yyyy-mm-dd
  inspection_time      TEXT,
  inspection_type      TEXT,                    -- FK insp_types.code
  site_code            TEXT,                    -- FK insp_sites.code
  area_code            TEXT,                    -- FK insp_areas.code
  area_text            TEXT,                    -- free-text fallback
  specific_location    TEXT,
  inspector_name       TEXT,
  inspector_role       TEXT,
  accompanied_by       TEXT,
  weather              TEXT,
  last_inspection_date TEXT,
  scope                TEXT,
  overall_risk         TEXT,                    -- 'Critical' | 'High' | 'Medium' | 'Low'
  operational_impact   TEXT,
  key_observations     TEXT,
  positive_findings    TEXT,
  distribution         TEXT,
  state_json           TEXT,                    -- the FULL state blob (round-trip safe)
  status               TEXT DEFAULT 'draft',    -- draft | submitted | closed
  created_by           INTEGER,                 -- FK reports.db users(id) (soft)
  created_at           TEXT DEFAULT (datetime('now')),
  updated_at           TEXT DEFAULT (datetime('now')),
  submitted_at         TEXT
);
CREATE INDEX ix_insp_site_date ON insp_inspections(site_code, inspection_date);
CREATE INDEX ix_insp_status    ON insp_inspections(status);

CREATE TABLE insp_findings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  TEXT NOT NULL,                 -- FK insp_inspections CASCADE
  category       TEXT NOT NULL,                 -- 'net', 'srv', 'sto', 'rack', etc. (17 categories)
  item_index     INTEGER NOT NULL,
  item_code      TEXT,
  item_text_en   TEXT,                          -- DENORMALIZED — survives item rename
  item_text_fr   TEXT,                          -- DENORMALIZED
  status         TEXT,                          -- 'ok' | 'minor' | 'major' | 'critical' | 'opp' | 'na'
  notes          TEXT,
  UNIQUE(inspection_id, category, item_index)
);
CREATE INDEX ix_insp_findings_status ON insp_findings(status);

CREATE TABLE insp_actions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  TEXT NOT NULL,                 -- FK insp_inspections CASCADE
  ord            INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  linked_item    TEXT,                          -- 'category-item_index' soft pointer
  priority       TEXT,                          -- 'Critical' | 'High' | 'Medium' | 'Low'
  owner          TEXT,
  due_date       TEXT,
  status         TEXT DEFAULT 'Open',
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  closed_at      TEXT
);
CREATE INDEX ix_insp_actions_inspection ON insp_actions(inspection_id);

CREATE TABLE insp_photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id  TEXT NOT NULL,                 -- FK insp_inspections CASCADE
  finding_key    TEXT,                          -- 'category-item_index'
  action_id      INTEGER,                       -- nullable FK insp_actions
  caption        TEXT,
  mime_type      TEXT DEFAULT 'image/jpeg',
  data_b64       TEXT,                          -- INLINE base64 (compressed to ~250-400 KB/photo)
  size_bytes     INTEGER,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_insp_photos_inspection ON insp_photos(inspection_id);

CREATE TABLE insp_signatures (
  inspection_id  TEXT NOT NULL,                 -- FK insp_inspections CASCADE
  signer_type    TEXT NOT NULL,                 -- 'inspector' | 'manager'
  signer_name    TEXT,
  signer_date    TEXT,
  signature_b64  TEXT,                          -- INLINE PNG base64
  signed_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (inspection_id, signer_type)
);
```

### Inspection site codes (`SITE_MAP` in inspection-db.js)

```js
{
  // Mines (different codes from tracker!)
  'MANA':'MGO',     'Mana IT Agent':'MGO',
  'HOUNDE':'HGO',   'Hounde IT Agents':'HGO',
  'LAFIGUE':'SML',  'Lafigue IT Agents':'SML',
  'ITY':'SMI',      'ITY IT Agents':'SMI',          // tracker uses 'ITY', inspection uses 'SMI'
  'Sabodala':'SGO', 'Sabodala IT Agents':'SGO',
  'KALANA':'KGO',   'Kalana IT Agents':'KGO',       // tracker uses 'KLN', inspection uses 'KGO'
  // Regional offices
  'ABIDJAN':'ABJ',  'Abidjan IT Agents':'ABJ',
  'Dakar':'DKR',    'Dakar IT Agents':'DKR',
  'OUAGA':'OUA',    'Ouaga IT Agents':'OUA',  'Ouagadougou-EDV1':'OUA',  // tracker uses 'EDV'
}
```

Inspection module also computes a normalised lookup that handles accent
stripping (`Houndé` → `HGO`) and the "-IT Agents" suffix. See
`_NORM_SITE_MAP` in inspection-db.js.

### 17 inspection categories (each with ~10 items, 173 items total)

`net` Network · `srv` Servers & Hypervisor · `sto` Storage & Datastores ·
`rack` Server Room/Rack · `pwr` Power & UPS · `cool` Cooling · `sec`
Physical Security · `wifi` Wi-Fi · `tel` Telephony · `print` Printing ·
`mon` Monitoring · `bk` Backup · `aval` Antivirus & Endpoint · `app`
Apps · `usr` End-User Devices · `inv` Inventory · `cab` Cabling

Status per finding: `ok` | `minor` | `major` | `critical` | `opp` | `na`

---

## 4 · `meetings.db` — Meetings & Council Escalations v2 (worktree root)

Managed by `meetings-db.js`. 11 lookup tables + 6 core tables, prefix `md_*`.

### Lookups (all bilingual `name_en` + `name_fr`)

```sql
CREATE TABLE md_intake_sources    (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_departments       (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_categories        (code TEXT PRIMARY KEY, name_en, name_fr, description_en, description_fr, display_order);
CREATE TABLE md_severities        (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_statuses          (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_meeting_statuses  (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_escalation_reasons(code TEXT PRIMARY KEY, name_en, name_fr, description_en, description_fr, display_order);
CREATE TABLE md_council_themes    (code TEXT PRIMARY KEY, name_en, name_fr, description_en, description_fr, indicative_ask_en, indicative_ask_fr, display_order);
CREATE TABLE md_project_phases    (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_it_involvement    (code TEXT PRIMARY KEY, name_en, name_fr, display_order);
CREATE TABLE md_engagements       (code TEXT PRIMARY KEY, name_en, name_fr, rule_en, rule_fr, display_order);
```

### 9 canonical issue categories (`md_categories.code`)

`CN` Connectivity · `HW` Hardware · `IN` Infrastructure · `OT` Other ·
`AP` Application · `SC` Security · `DR` Disaster Recovery · `SD` Service
Delivery · `LV` Leveraging

### Core tables

```sql
CREATE TABLE md_meetings (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  reference             TEXT UNIQUE,           -- 'HGO_Maintenance_PV_2026-05' (auto-generated)
  site_code             TEXT NOT NULL,         -- matches inspection codes (HGO/MGO/...)
  department            TEXT NOT NULL,         -- FK md_departments.code
  meeting_date          TEXT NOT NULL,         -- ISO yyyy-mm-dd
  duration_min          INTEGER,
  department_head       TEXT,
  department_head_title TEXT,
  site_it_lead          TEXT,
  other_attendees       TEXT,
  intake_source         TEXT DEFAULT 'dept_meeting',  -- FK md_intake_sources.code
  priority_1            TEXT,
  priority_2            TEXT,
  priority_3            TEXT,
  next_meeting_date     TEXT,
  next_meeting_location TEXT,
  status                TEXT DEFAULT 'draft',  -- FK md_meeting_statuses.code
  submitted_at          TEXT,
  dept_head_signed_at   TEXT,
  site_it_signed_at     TEXT,
  created_by            INTEGER,                -- soft FK reports.db users(id)
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_md_meetings_site_date ON md_meetings(site_code, meeting_date);
CREATE INDEX ix_md_meetings_dept      ON md_meetings(department);
CREATE INDEX ix_md_meetings_status    ON md_meetings(status);

CREATE TABLE md_meeting_projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id       INTEGER NOT NULL,           -- FK md_meetings CASCADE
  ord              INTEGER DEFAULT 0,
  project_name     TEXT NOT NULL,
  phase            TEXT,                       -- FK md_project_phases.code
  it_involvement   TEXT,                       -- FK md_it_involvement.code
  status           TEXT,                       -- on_track | at_risk | blocked | done
  it_lead          TEXT,
  business_sponsor TEXT,
  start_date       TEXT,
  target_end       TEXT,
  notes            TEXT
);

CREATE TABLE md_issues (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id        INTEGER NOT NULL,          -- FK md_meetings CASCADE
  ord               INTEGER DEFAULT 0,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL,             -- FK md_categories.code
  severity          TEXT DEFAULT 'MEDIUM',     -- FK md_severities.code (HIGH|MEDIUM|LOW)
  affects           TEXT,
  champion          TEXT,                      -- IT Champion (Engagement 3 — REQUIRED)
  champion_email    TEXT,
  target_date       TEXT,
  status            TEXT DEFAULT 'open',       -- FK md_statuses.code
  escalate          INTEGER DEFAULT 0,
  escalation_reason TEXT,                      -- FK md_escalation_reasons.code (if escalate=1)
  council_theme     TEXT,                      -- FK md_council_themes.code (if escalate=1)
  notes             TEXT,
  closed_at         TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_md_issues_meeting  ON md_issues(meeting_id);
CREATE INDEX ix_md_issues_category ON md_issues(category);
CREATE INDEX ix_md_issues_severity ON md_issues(severity);
CREATE INDEX ix_md_issues_status   ON md_issues(status);
CREATE INDEX ix_md_issues_escalate ON md_issues(escalate);

CREATE TABLE md_issue_updates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id        INTEGER NOT NULL,            -- FK md_issues CASCADE
  author_id       INTEGER,                     -- soft FK reports.db users(id)
  author_name     TEXT,
  body            TEXT,
  status_change   TEXT,                        -- e.g. 'open → resolved'
  escalate_change INTEGER,                     -- 0|1 transition
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_md_updates_issue ON md_issue_updates(issue_id);

CREATE TABLE md_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id      INTEGER NOT NULL,            -- FK md_meetings CASCADE
  ord             INTEGER DEFAULT 0,
  description     TEXT NOT NULL,
  owner_it        TEXT,                        -- IT Champion (Engagement 3)
  owner_email     TEXT,
  target_date     TEXT,
  status          TEXT DEFAULT 'open',
  linked_issue_id INTEGER,                     -- FK md_issues(id) ON DELETE SET NULL
  closed_at       TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX ix_md_actions_meeting ON md_actions(meeting_id);
CREATE INDEX ix_md_actions_issue   ON md_actions(linked_issue_id);

CREATE TABLE md_meeting_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id  INTEGER NOT NULL,                -- FK md_meetings CASCADE
  filename    TEXT,
  mime_type   TEXT DEFAULT 'application/octet-stream',
  data_b64    TEXT,                            -- INLINE base64 (rare)
  size_bytes  INTEGER,
  uploaded_by INTEGER,                         -- soft FK reports.db users(id)
  created_at  TEXT DEFAULT (datetime('now'))
);
```

### Meetings reuses inspection's siteNameToCode

Per `meetings-db.js`, `_userMeetingsSite(req)` uses
`inspectionDb.siteNameToCode()` — so meetings site_code values are the
SAME as inspection codes (HGO, MGO, SML, SMI, KGO, ...).

---

## 5 · Cross-database linkage map

The codebase has NO multi-DB FK constraints (SQLite doesn't support
them). Instead, soft references with applicative validation. Below is
the FULL list of cross-DB joins.

```
                       reports.db
                       ┌───────────────────────────┐
                       │ users.site_name = 'HOUNDE'│ ← unique source of truth
                       └────────────┬──────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │ tracker-db.js             │ inspection-db.js          │ meetings-db.js
        │ siteNameToCode()          │ siteNameToCode()          │ (uses inspection's)
        │ → 'MGO' (tracker code)    │ → 'HGO' (inspection code) │ → 'HGO'
        ▼                           ▼                           ▼
   tracker_inputs.site       insp_inspections.site_code   md_meetings.site_code
```

### Linkages by direction

| FROM (table.column)            | TO (table.column)                | Type   | Validated? |
|---|---|---|---|
| `tracker_inputs.site`          | `tracker SITE_MAP` codes         | string | App-level  |
| `insp_inspections.site_code`   | `insp_sites.code`                | TEXT   | YES (FK in same DB) |
| `insp_inspections.created_by`  | `reports.db users.id`            | INT    | App-level (no FK) |
| `insp_findings.inspection_id`  | `insp_inspections.id`            | TEXT   | YES (FK CASCADE) |
| `insp_actions.inspection_id`   | `insp_inspections.id`            | TEXT   | YES (FK CASCADE) |
| `insp_photos.inspection_id`    | `insp_inspections.id`            | TEXT   | YES (FK CASCADE) |
| `insp_photos.action_id`        | `insp_actions.id`                | INT    | App-level (nullable) |
| `insp_signatures.inspection_id`| `insp_inspections.id`            | TEXT   | YES (FK CASCADE) |
| `md_meetings.site_code`        | `insp_sites.code` (same map)     | TEXT   | App-level (no FK cross-DB) |
| `md_meetings.created_by`       | `reports.db users.id`            | INT    | App-level |
| `md_issues.meeting_id`         | `md_meetings.id`                 | INT    | YES (FK CASCADE) |
| `md_issue_updates.issue_id`    | `md_issues.id`                   | INT    | YES (FK CASCADE) |
| `md_issue_updates.author_id`   | `reports.db users.id`            | INT    | App-level |
| `md_actions.meeting_id`        | `md_meetings.id`                 | INT    | YES (FK CASCADE) |
| `md_actions.linked_issue_id`   | `md_issues.id`                   | INT    | YES (FK SET NULL) |
| `request_records.site`         | `reports.db users.site_name`     | TEXT   | App-level (case-tolerant) |
| `request_records.request_id`   | `survey_results.request_id`      | TEXT   | App-level (soft FK) |
| `change_records.change_id`     | `cab_approvals.change_id`        | TEXT   | App-level (soft FK) |
| `survey_results.response_id`   | `survey_answers.response_id`     | TEXT   | App-level (soft FK) |

---

## 6 · External data sources

### Zoho ServiceDesk Plus (SDP)

Sync job: `zoho-sync.js → syncRequestData()` (cron hourly + manual via
admin button). Reads from REQUEST_TABLE view + MAJOR_INCIDENTS view
(separate fetch because the base view doesn't return UDFs).

| Zoho field                    | reports.db column             |
|---|---|
| RequestID                     | `request_records.request_id`   |
| Display ID                    | `request_records.display_id`   |
| Subject                       | `request_records.subject`      |
| Request Status                | `request_records.request_status` |
| Pending Status                | `request_records.pending_status` (1/0) |
| First Response Overdue        | `request_records.first_response_overdue` (text 'true'/'false') |
| Request Type                  | `request_records.request_type` |
| Service Request               | `request_records.service_request` (1/0 derived) |
| Created Time / Resolved Time / Completed Time / Responded Time / Assigned Time / Last Updated Time | corresponding `*_time` columns (ISO) |
| Technician                    | `request_records.technician`   |
| Requester                     | `request_records.requester`    |
| Category / Sub Category       | `request_records.category` / `.sub_category` |
| Site                          | `request_records.site` (raw Zoho label) |
| Group                         | `request_records.tech_group`   |
| Mode                          | `request_records.mode`         |
| Impact                        | `request_records.impact`       |
| Time Elapsed (raw ms)         | `request_records.time_elapsed_ms` |
| Major Incident UDFs (RCA, CA, PIR, LL, Workaround, Preventive Measures) | `request_records.udf_json` (only populated for Major Incidents) |

### Zoho ServiceDesk Plus (changes)

Sync via `zoho-sync.js → syncChangeData()`. Fetches from CHANGE_TABLE +
CAB approvals view. Most fields map 1:1 like requests.

### Zoho Surveys (via Analytics Plus)

Sync via `zoho-sync.js → syncSurveyData()`. Reads three views:
- `Zoho Survey Results` (106803000000002079) → `survey_results`
- `Zoho Survey Questions` (106803000000002077) → seed for question_text
- `Zoho Survey Answers` (106803000000002076) → `survey_answers`

OAuth scope: **`MEAplus.fullaccess.all`** (the narrower `data.read` +
`metadata.read` scope triggers 7301 SECURITY_NOT_PERMITTED — see
`docs/ANALYTICS_PLUS_API_SCOPES.md`).

---

## 7 · Common report-writing query patterns

### Tickets created in a given month, filtered by Operations group preset

```sql
-- Resolve the active "Operations" preset from dashboard_preset_groups
WITH ops_groups AS (
  SELECT group_name FROM dashboard_preset_groups
  WHERE scope = 'tickets' AND preset_name = 'Operations'
)
SELECT * FROM request_records
WHERE strftime('%Y-%m', created_time) = '2026-05'
  AND request_type LIKE '%Incident%'
  AND tech_group IN (SELECT group_name FROM ops_groups);
```

### Major Incidents created in month + their UDF fields

```sql
SELECT
  request_id, display_id, subject, site, technician,
  json_extract(udf_json, '$."UDF:Root Cause Analysis :"')  AS rca,
  json_extract(udf_json, '$."UDF:Corrective Action"')      AS ca,
  json_extract(udf_json, '$."UDF:Lessons Learned"')        AS ll,
  json_extract(udf_json, '$."UDF:PIR Required:"')          AS pir,
  -- time_elapsed_ms / 3_600_000 → downtime hours
  (time_elapsed_ms * 1.0 / 3600000) AS downtime_hours
FROM request_records
WHERE request_type = 'Major Incident'
  AND strftime('%Y-%m', created_time) = '2026-05'
ORDER BY created_time;
```

Note: UDF keys are messy — use the `incidentUdf(r, kind)` helper from
`public/lib/dashboard-shared.js` if working in JavaScript instead of
raw JSON extraction.

### SLA Compliance % (Resolution) — ITSM-canonical denominator

```sql
-- Denominator = closed tickets only (NOT total). See FORMULA_RECONCILIATION.md §6
SELECT
  COUNT(CASE WHEN pending_status = 0 AND overdue_status = 0 THEN 1 END) * 100.0 /
  NULLIF(COUNT(CASE WHEN pending_status = 0 THEN 1 END), 0) AS sla_compliance_pct
FROM request_records
WHERE strftime('%Y-%m', created_time) = '2026-05'
  AND request_type LIKE '%Incident%';
```

### Change Success Rate

```sql
-- "Executed" denominator: success + failed + backed_out. Cancelled/rejected EXCLUDED.
SELECT
  COUNT(CASE WHEN status IN ('Completed', 'Implemented') THEN 1 END) * 100.0 /
  NULLIF(COUNT(CASE WHEN status IN ('Completed', 'Implemented', 'Failed', 'Backed out') THEN 1 END), 0) AS success_rate
FROM change_records
WHERE strftime('%Y-%m', created_time) = '2026-05';
```

### Activity Tracker — fleet score for current month

```sql
-- Pull config + targets + this month's inputs in one round-trip.
WITH cfg AS (SELECT activities_json, active_sites_json, current_month FROM tracker_config WHERE id=1)
SELECT
  ti.site, ti.activity_ix,
  tt.target,
  tt.active,
  json_extract(ti.months_json, '$[' || (cfg.current_month - 1) || ']') AS month_value
FROM tracker_inputs ti
JOIN cfg ON 1=1
LEFT JOIN tracker_targets tt ON tt.site = ti.site AND tt.activity_ix = ti.activity_ix
WHERE ti.year = 2026
  AND tt.active = 1                                          -- only count active targets
  AND ti.site IN (SELECT value FROM json_each(cfg.active_sites_json));
```

### Inspection findings rolled up by status × site for a month

```sql
SELECT
  i.site_code,
  f.status,
  COUNT(*) AS n_findings
FROM insp_findings f
JOIN insp_inspections i ON i.id = f.inspection_id
WHERE strftime('%Y-%m', i.inspection_date) = '2026-05'
  AND i.status IN ('submitted', 'closed')
GROUP BY i.site_code, f.status;
```

### Meetings — open HIGH-severity issues with escalation, this quarter

```sql
SELECT
  m.reference, m.site_code, m.department, m.meeting_date,
  i.title, i.category, i.champion, i.target_date,
  ct.name_en AS council_theme,
  er.name_en AS escalation_reason
FROM md_issues i
JOIN md_meetings m              ON m.id = i.meeting_id
LEFT JOIN md_council_themes ct  ON ct.code = i.council_theme
LEFT JOIN md_escalation_reasons er ON er.code = i.escalation_reason
WHERE i.status NOT IN ('resolved', 'closed', 'cancelled')
  AND i.severity = 'HIGH'
  AND i.escalate = 1
  AND m.meeting_date >= '2026-04-01'
ORDER BY i.target_date ASC NULLS LAST;
```

### Cross-DB query pattern (Node side)

Since SQLite doesn't support cross-DB queries directly without ATTACH,
**ALWAYS do this in two steps from Node**:

```js
// Step 1: get the user → site mapping from reports.db
const reportsDb = require('./reports-db.js');
const user = reportsDb.getUser(req.session.user_id);
const userSiteName = user.site_name;       // 'HOUNDE'

// Step 2: map to module-specific code, then query the module DB
const trackerDb = require('./tracker-db.js');
const trackerSite = trackerDb.siteNameToCode(userSiteName);  // 'MGO'

const trackerDb = trackerDb.getDB();
const inputs = trackerDb.prepare(
  'SELECT * FROM tracker_inputs WHERE year = ? AND site = ?'
).all(2026, trackerSite);
```

You can also use `ATTACH DATABASE` for read-only joins, but the
existing modules don't because of clean separation:

```sql
-- From a script that opens reports.db:
ATTACH DATABASE 'tracker.db' AS tdb;
SELECT
  u.full_name, u.site_name,
  ti.site, ti.activity_ix, ti.months_json
FROM main.users u
JOIN tdb.tracker_inputs ti ON ti.site = ...  -- requires the siteNameToCode map
                                              -- which lives in JS, not SQL
WHERE u.id = ?;
```

---

## 8 · File-path quick reference

```
reports.db        ← DATA_DIR/reports.db  (typically C:\Apps\SDP-Dashboard\reports.db on prod)
tracker.db        ← <repo root>/tracker.db
inspection.db     ← <repo root>/inspection.db
meetings.db       ← <repo root>/meetings.db

reports-db.js     ← exports: getDB, listUsers, listSites, getUser, validateSession, ...
tracker-db.js     ← exports: loadTracker, saveTracker, resetTracker, siteNameToCode
inspection-db.js  ← exports: loadLookups, listPeople, listInspections, saveInspection, siteNameToCode
meetings-db.js    ← exports: loadLookups, listMeetings, saveMeeting, insights, compareDepartment

risk-register-export.js   ← reads request_records, joins via rr_site_aliases
services/groupPresets.js  ← reads/writes dashboard_preset_groups
services/reportPayload.js ← builds the unified Group IT Report payload (PPTX)
```

---

## 9 · Things NOT to assume

- **DON'T assume** site codes are consistent across modules (tracker ITY
  vs inspection SMI, tracker KLN vs inspection KGO, tracker EDV vs
  inspection OUA).
- **DON'T assume** SDP site labels match `sites.name` byte-for-byte —
  case can vary (`Massawa` / `MASSAWA`), and there are one-offs like
  `LAFIGUE - SML`. Use `rr_site_aliases` or a normalised lookup.
- **DON'T assume** `request_records.impact` is populated — ~91% of
  historical rows are NULL (field added recently). Treat NULL as
  in-scope for risk register; exclude explicit `Individual`.
- **DON'T assume** UDF field names are stable. Use `incidentUdf(r,
  kind)` from `dashboard-shared.js`.
- **DON'T assume** `request_records.subject` reflects the latest
  state — it's what Zoho returned at last sync.
- **DON'T sync-call Zoho from a report** — always read from the cached
  `request_records` / `change_records` / `survey_results` tables.
  Zoho calls have OAuth refresh-token rate limits and would slow the
  report 10x.
- **`Major Incident`** is determined by `request_type = 'Major Incident'`
  (not by impact = Enterprise). The Zoho field is canonical.
- **KPI denominators are ITSM-canonical, NOT /total** for SLA %, Reopen
  Rate, FRT %, Change Success Rate — see CLAUDE.md §"KPI denominator
  doctrine" and `FORMULA_RECONCILIATION.md` §6.

---

## 10 · Where to dig deeper

| Question | File to read |
|---|---|
| How does the helpdesk dashboard compute KPIs? | `public/lib/dashboard-shared.js` |
| How are PPTX reports rendered? | `reports-monthly-pptx.js` + `reports-weekly-pptx.js` (duplicated `slideMonthly*`!) |
| How is the Group IT Report deck built? | `services/reportPayload.js` + `tools/exec-pptx/render.py` |
| How does Zoho sync work? | `zoho-sync.js` |
| What's the cache policy for browser assets? | CLAUDE.md §"Coding Principles — Browser-side asset caching" |
| Why does field X return 0? | First check the sync (`pm2 logs ... \| findstr Zoho`), then check the field name variants |

---

*End of DATA_ARCHITECTURE.md — last updated 2026-06-05*
