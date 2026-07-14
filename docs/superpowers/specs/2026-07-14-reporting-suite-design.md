# Automated Reporting Suite — Design Spec

> Date: 2026-07-14 · Author: Azize (operator) + Claude (dev box)
> Status: design approved on mockups; pending spec review + user review before writing-plans.
> Related: `services/reportPayload.js` (exec-pptx), `services/execSummary.js` (SharePoint Exec View),
> `services/backupSchedule.js` (the schtasks pattern this reuses), the user's static
> `IT_Business_Reviews_Inspection_Assurance_Dashboard.html` (Chart.js scoreboard — becomes the template).

---

## 1. Purpose

Three complementary reporting products, one shared engine, delivered by email + a live page:

1. **IT Coordinator report** (weekly) — operational. Per site: scoreboard (meetings + inspection),
   helpdesk, technician performance (helpdesk-only in v1), and a decisive **Recommended Actions**
   section. Audience: the site/office IT coordinator.
2. **Finance Manager report** (monthly) — the same data, **de-technicalised** (service / risk /
   business framing, no ITSM jargon), plus a **Managerial Attention** table. Audience: the site's
   Finance Manager, who is the coordinator's hierarchical manager.
3. **SharePoint / Executive View refresh** — deferred sub-project; expands the existing
   `exec-view.html` v1. Out of scope for this spec's implementation, captured here for coherence.

The unit of every report is **one site, one period**. A **consolidated "all sites"** variant (the
user's original scoreboard, live) goes to the Group IT lead.

### 1.1 Cadence vs. data grain (resolved)

"Weekly" (Coordinator) and "monthly" (Finance) describe **how often the report is SENT**, not the
grain of the numbers. Every per-site reader in §2 is **calendar-month** grained, and there are no
weekly readers. Therefore:

- **Both reports show month-to-date (MTD) figures for the current calendar month**, plus the
  previous-month comparison the monthly readers already provide.
- The Coordinator report is sent weekly so the coordinator sees the month *building up* and can act
  mid-month; the Finance report is sent once after month-end for the closed month.
- `period.kind` = `'weekly'` (Coordinator) / `'monthly'` (Finance) only tags the send cadence and the
  header wording ("Week of …, month-to-date" vs "<Month> — final"). It does **not** change which
  readers are called. No true-weekly data source is introduced in v1 (flagged as a v2 follow-up).

## 2. What already exists (reuse, do not reinvent)

| Need | Existing reader | Backend |
|---|---|---|
| Meetings per-site summary | `meetings-db.getSiteMonthlyMeetingSummary(siteCode, year, month)` — cadence KPIs, per-dept RAG, trend, commentary | PG-forked ✅ |
| Meetings actions (overdue by owner) | `meetings-db.listActions({site, status})` | PG-forked ✅ |
| Inspection roll-up | `inspection-db.aggregate({site})` (total / by_status / overdue / monthly) | PG-forked ✅ |
| Inspection corrective actions | `inspection-db.listActions({site})` (owner, due_date, status) | PG-forked ✅ |
| Helpdesk per-site monthly | `reports-db.getCalendarMonthlyHelpdesk(site_id, year, month)` | PG-forked ✅ |
| Helpdesk technicians | `request_records.technician` (+ `site`) queried per site | PG ✅ |
| Strategic (Activity Tracker) score | `tracker-pptx.{fleetStats, ss, score}` (exported) | pure JS ✅ |
| Site status (incident-derived) | `services/execSummary.deriveSiteStatus` | pure JS ✅ |
| Scheduled task mechanism | `services/backupSchedule.js` + `Manage-SDP.ps1 -Schedule` (schtasks) | ✅ |
| Chart.js scoreboard visual | the user's static HTML (data as `const DB={...}`) | becomes the template |

> **Two distinct scores, do not conflate:** the **composite scoreboard score** (§4 Block 1) is a NEW
> pure function `services/siteScore.js` computed from meetings + inspection dimensions (the user's
> static-HTML scoreboard logic — formula in §4.1). The **strategic score** from `tracker-pptx` is a
> *separate, optional* KPI tile (Activity Tracker's 31 activities) surfaced as a single number, NOT
> folded into the composite. In v1 the strategic tile is shown read-only when tracker data exists.

**Reality checks that shape the design (challenged from the user's proposal):**

- **Coordinator + Finance Manager identities are NOT modelled**, but they are *discoverable* in the
  meetings data: coordinator ≈ `md_meetings.site_it_lead` (most frequent per site over 6 mo);
  Finance Manager ≈ `department_head` of the `finance`-department PV (most recent). These are
  **free-text names, no emails, messy spelling**. → A small **authoritative directory** is required;
  the meetings extraction only *pre-fills* it (admin confirms).
- **Technician identity is fragmented free-text across modules** (helpdesk `technician`, inspection
  `inspector_name`/`owner`, meetings `owner_it`) with no shared key. → Technician performance is
  **helpdesk-only in v1**; cross-module scoring is deferred until a technician roster exists.
- **Survey/CSAT is not tagged with site** → per-site satisfaction is omitted (or fleet-wide with a
  caveat). Not shown in either report v1.
- **No real-time monitoring (OPManager)** → the FM "service continuity" statuses are
  **incident-derived** (via `deriveSiteStatus`), documented as such, not live uptime.
- **No email capability exists today** → an SMTP mailer is new (Graph optional later, behind an
  adapter). PDF rendering via headless Chrome/Edge (present on the Windows host; already used for
  PPTX QA).
- **Site key differs per module** (helpdesk `site_id`/name "HOUNDE" vs `site_code` "HGO") → resolve
  via existing alias maps (`inspection.siteNameToCode`, `rr_site_aliases`).

## 3. Architecture

Chosen approach: **"one HTML template → 3 outputs", server-composed, maximal reuse.**

```
                 ┌───────────────────────────────────────────────────────────┐
                 │  services/siteReport.js                                    │
  reports-db ───▶│    siteReportData(siteCode, period)  → one JSON object     │
  meetings-db ──▶│      (composes the existing per-site readers above;        │
  inspection-db▶ │       resolves site_code↔site_id via alias maps)           │
  tracker-pptx ─▶│    allSitesReportData(period) → consolidated scoreboard    │
                 └───────────────┬───────────────────────────────────────────┘
                                 │ JSON
        ┌────────────────────────┼─────────────────────────────┐
        ▼                        ▼                             ▼
  /site-report.html      services/reportRender.js        email HTML summary
  (LIVE page,            renderPdf(html) → Buffer         (Outlook-safe fragment
   Chart.js, the         via headless Chrome/Edge          built from the same data)
   user's scoreboard      --print-to-pdf
   fed by fetch)               │
                               ▼
                        services/mailer.js (transport = smtp | graph)
                          send({to, cc, subject, html, attachments:[pdf]})
                               ▲
        ┌──────────────────────┴───────────────────────────────┐
        │  Config module (admin, super_admin)                   │
        │   report_recipients · report_config · report_schedules│
        │   services/reportDirectory.js · reportConfig.js       │
        │   Windows tasks (schtasks, backupSchedule pattern) +  │
        │   "Preview / Send now" button                         │
        └───────────────────────────────────────────────────────┘
```

Each unit is small, single-purpose, and independently testable:

- **`services/siteReport.js`** — pure composition. Input `(siteCode, period)`, output a frozen JSON
  shape (§4). No I/O of its own beyond the existing readers. Snapshot-testable + one prod-snapshot run.
- **`services/reportDirectory.js`** — the recipients table CRUD + `suggestFromMeetings()` (non-
  destructive pre-fill) + `resolveRecipient(site, kind)` → `{to, cc}` or null (never returns an
  unconfirmed email when the safety flag is on).
- **`services/reportConfig.js`** — key/value settings (transport, smtp_*, from, reply_to, default
  domain, formats, safety flag).
- **`services/mailer.js`** — transport adapter; `smtp` (nodemailer) in v1, `graph` stubbed behind
  the same interface. Never throws into the caller's request path (logs + returns a result object).
- **`services/reportRender.js`** — `renderPdf(htmlOrUrl)` via headless Chrome/Edge; degrades to
  "PDF unavailable, HTML-only" with a WARN if no browser is found.
- **`public/site-report.html`** — the live page. The user's Chart.js scoreboard, its hardcoded
  `const DB` replaced by `fetch('/api/reports/site-data?site=…&period=…')`. Query `?site=all` →
  the consolidated league/effort/gap dashboard.
- **Report templates** — one composer per audience (`coordinator`, `finance`) that turns
  `siteReportData` into `{ htmlBody, fullHtml, subject }`. `fullHtml` → PDF; `htmlBody` → email body.

**New npm dependency:** `nodemailer` (pure JS, no native binding — xcopy-deployable like the pg
driver). No dependency for PDF (spawns the system Chrome/Edge).

## 4. `siteReportData` output contract

```
{
  site_code, site_name, period: {label, year, month, week, kind:'weekly'|'monthly'},
  data_as_of,                         // last relevant sync timestamp

  score: {                            // §Block 1 — the scoreboard
    composite, rag:'green'|'amber'|'red', trend_pts,   // Green≥70 Amber45-69 Red<45
    dimensions: { reviews, resolution_pct, overdue, inspections, findings, signoff_pct },
    two_moves: [ {text, gain_pts}, {text, gain_pts} ]  // biggest score-gain actions (deterministic)
  },

  meetings: {                         // §Block 2 — from getSiteMonthlyMeetingSummary
    pvs_held, pvs_target, open_issues, high_open, resolved, new, escalations,
    departments: [ {department, status:'on_track'|'blocked'|'no_pv', last_pv} ],
    overdue_actions: [ {description, owner, target_date} ]
  },

  inspection: {                       // §Block 3 — aggregate + listActions
    inspections_done, findings_critical_major, overall_risk,
    overdue_actions: [ {description, owner, due_date} ]
    // NOTE: no per-zone breakdown in v1 — inspection-db.aggregate exposes
    // total/by_status/overdue/monthly only. `top_zones` deferred to v2 (needs a
    // new per-area aggregate reader).
  },

  helpdesk: {                         // §Block 4 — getCalendarMonthlyHelpdesk + per-site query
    created, resolved, backlog, sla_overdue,
    major_incidents,                         // count of critical/major incidents this month
                                             // (same per-site helpdesk query; feeds fm.major_incidents)
    top_categories: [ {category, count} ],   // GROUP BY category, top 5
    recurring: [ {label, count} ]            // GROUP BY (category, sub_category)
                                             // where count>=3; NOT free-text subject
                                             // clustering (deferred). label = "cat / sub".
  },

  technicians: [                      // §Block 5 — helpdesk-only in v1
    { name, assigned, resolved, avg_resolution_h, reopened, current_load,
      alerts: [ /* deterministic thresholds, computed in siteReport.js: */
        'overloaded'    // current_load > 1.5 × site-median load
        | 'low_closure' // resolved/assigned < 0.6 AND assigned >= 5
        | 'repeat_late' // sla_overdue count for this tech >= 3
      ] }
  ],

  recommended: [                      // §Block 6 — deterministic synthesis of blocks 2-5
    { kind:'support'|'meeting'|'escalate'|'visit', text }
  ],

  // Finance-Manager de-technicalised view (derived ENTIRELY from the same blocks — no new data):
  fm: {
    service_level_label,               // words from Block-1 rag: green→"Stable" amber→"Under strain" red→"At risk"
    major_incidents,                   // = count of critical/major incidents this month (helpdesk)
    routine_discipline_label,          // words from meetings signoff_pct + inspection cadence
    site_status,                       // SINGLE site-level status from deriveSiteStatus:
                                       //   'major' | 'degraded' | 'operational' (honest: incident-derived, not uptime).
                                       //   deriveSiteStatus OMITS healthy sites, so the composer maps absent → 'operational'.
    user_support: { requests, resolved_in_time_pct, avg_resolution_label, overdue },  // Block-4 helpdesk, worded
    top_frustrations: [text],          // top recurring HELPDESK categories (Block-4 recurring), NOT survey verbatims
    managerial_attention: [ {subject, situation, impact, action_expected} ],  // synthesised from HIGH-open
                                       //   meetings issues + critical inspection findings + overdue actions
    message: { good:[text], improve:[text], decide:[text] }
  }
}
```

**Deliberately NOT in `fm` (would need data we don't have — never faked):**
`key_service_availability_pct` (no uptime feed — OPManager absent); per-service `continuity[]`
(deriveSiteStatus is site-level, one status per site, so `fm.site_status` is a single value, not a
per-service list); per-site CSAT (survey not site-tagged); `top_frustrations` from survey verbatims
(same reason — it comes from helpdesk categories instead). Cross-module technician scoring is also
out (Block 5 is helpdesk-only). These omissions are load-bearing honesty decisions, not TODOs.

### 4.1 Composite score + `two_moves` (deterministic — `services/siteScore.js`)

Pure function `computeSiteScore(meetings, inspection)` → `{composite, rag, dimensions, two_moves}`.
Six sub-scores, each normalised 0–100, combined by fixed weights (sum = 1.0):

| Dimension | Weight | 0–100 sub-score |
|---|---|---|
| `reviews` (cadence) | 0.20 | `min(100, pvs_held / pvs_target × 100)` |
| `resolution_pct` (issues closed) | 0.20 | `resolved / (resolved + open_issues) × 100` (100 if none) |
| `overdue` (issue+action punctuality) | 0.15 | `100 − min(100, overdue_actions_count × 15)` |
| `inspections` (inspection cadence) | 0.15 | `min(100, inspections_done / 1 × 100)` (≥1/month = 100) |
| `findings` (inspection risk) | 0.15 | `100 − min(100, findings_critical_major × 20)` |
| `signoff_pct` (PV sign-off discipline) | 0.15 | `signoff_pct` (already 0–100 from meetings summary) |

`composite = round(Σ weightᵢ × sub_scoreᵢ)`. **RAG:** Green ≥ 70 · Amber 45–69 · Red < 45.
`trend_pts` = `composite(this period) − composite(previous period)` (previous from the readers' MoM
comparison; `null` on the first period).

**`two_moves`** = the two dimensions with the largest *recoverable* gap, ranked by
`weightᵢ × (100 − sub_scoreᵢ)` (the composite points you'd win by taking that sub-score to 100).
Each yields a fixed template sentence keyed by dimension (e.g. `reviews` →
"Hold the {gap} missing department PV(s) this month") and `gain_pts = round(weightᵢ × (100 −
sub_scoreᵢ))`. Fully deterministic; no AI. Ties broken by the dimension order in the table above.

## 5. Data model (new tables in `sdp_dashboard` + sqlite mirror)

```sql
CREATE TABLE report_recipients (
  site_code TEXT PRIMARY KEY, site_name TEXT,
  coordinator_name TEXT, coordinator_email TEXT, coordinator_email_confirmed INTEGER DEFAULT 0,
  fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
  cc_emails TEXT, active INTEGER DEFAULT 1, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE report_config (           -- key/value settings
  key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE report_schedules (        -- one row per report type
  report_type TEXT PRIMARY KEY,        -- 'coordinator' | 'group' | 'finance'
  enabled INTEGER DEFAULT 0, day TEXT, time TEXT, updated_at TIMESTAMPTZ DEFAULT now(), updated_by TEXT
);
CREATE TABLE report_sent_log (         -- idempotency + audit of every send
  id SERIAL PRIMARY KEY, report_type TEXT, site_code TEXT, period TEXT,  -- period = 'YYYY-MM' (both cadences)
  recipients TEXT, result TEXT, sent_at TIMESTAMPTZ DEFAULT now()
);
-- Dedup is (type,site,period) scoped to the same calendar day, so the four weekly Coordinator
-- sends within one month (same 'YYYY-MM' period) are NOT deduped against each other — only a
-- same-day re-fire is. The audit history stays unambiguous via sent_at.
CREATE INDEX ix_report_sent_log_dedup ON report_sent_log(report_type, site_code, period);
```

Follows the reports-db backend-flag pattern (sqlite body + async PG fork, `REPORTS_BACKEND`); added
to the PG schema files + `copy-reports-config.js` (mirrors the `dashboard_preset_groups` /
`rr_site_aliases` precedent).

**Group ("all sites") recipient** — the consolidated report has no site, so it is NOT a
`report_recipients` row. It lives in `report_config` under keys `group_report_to` /
`group_report_cc` / `group_report_to_confirmed`. `resolveRecipient('all','group')` reads these.

## 6. API (super_admin, behind the existing `/api/` gate)

| Method · path | Purpose |
|---|---|
| `GET/PUT /api/reports/config` | delivery settings |
| `GET /api/reports/recipients` · `PUT /api/reports/recipients/:site` · `POST /api/reports/recipients/suggest` | directory CRUD + pre-fill |
| `GET/PUT /api/reports/schedule` | per-type schedule → (re)creates Windows tasks |
| `GET /api/reports/site-data?site=&period=` | the `siteReportData` JSON (feeds the live page + preview) |
| `POST /api/reports/send?type=&site=` | manual "send now" (or `preview=1` → returns html+pdf without sending) |
| `POST /api/reports/test-smtp` | SMTP connection test |

## 7. Delivery mechanics

- **Email body** = the audience-specific compact HTML summary (table-based, RAG chips, no JS —
  Outlook-safe). **PDF attachment** = the full page rendered via headless Chrome/Edge. **Deep link**
  to `/site-report.html?site=…` (live, interactive). All three from one data object.
- **Transport** = `report_config.transport` (`smtp` v1 / `graph` later). SMTP via nodemailer; host/
  port/tls/from/reply-to from config. Graph path stubbed behind the same `send()` interface.
- **Scheduling** = `report_schedules` → two Windows tasks per enabled type (weekly / monthly), via
  the same `Manage-SDP.ps1 -Schedule` + `services/backupSchedule.js` mechanism, calling a Node CLI
  `tools/reports/send-reports.js --type=coordinator`. Runs under SYSTEM even if the app is down.
- **Safety**: with `never_send_unconfirmed=1` (default), a site whose recipient email is not
  confirmed is skipped (logged), never emailed a guessed address. "Send now" and scheduled runs both
  honour it. Every send is audit-logged (`logAudit`): type, site, recipients, result.

## 8. Delivery plan (sub-projects, each its own spec→plan→impl cycle)

1. **Foundation** — `report_recipients`/`report_config`/`report_schedules` + `reportDirectory.js` +
   `reportConfig.js` + `siteScore.js` + `siteReport.js` + `mailer.js` (smtp) + `reportRender.js`
   (pdf) + `/site-report.html` live page (the scoreboard, live) + admin config card (3 tabs).
2. **Coordinator report** — coordinator template composer + `POST /send?type=coordinator` + preview.
3. **Scheduling** — Windows tasks + auto-send + safety gate.
4. **Finance Manager report** — the de-technicalised template composer (reuses everything).
5. **SharePoint refresh** — later; depends on nothing new here.

**This document is the umbrella design for sub-projects 1–4** (the two report products + their shared
engine + config module). **5** is out of scope here. Each sub-project gets its own writing-plans pass;
they ship in order (2→3, 4 depends on 1). Sub-project 1 (Foundation) is where writing-plans starts.

## 9. Error handling

- Every reader call in `siteReportData` is wrapped; a failing block degrades to an empty block with a
  visible "data unavailable" note, never a 500 (same resilience doctrine as `reportPayload.build`).
- `mailer.send` never throws into a request; returns `{ok, error?}`; scheduled runs continue to the
  next site on a per-site failure and log a summary.
- `renderPdf` degrades to HTML-only (email still sent) with a WARN if **no browser is found** AND
  is spawned with a **hard timeout** (`REPORT_PDF_TIMEOUT_MS`, default 90 s — same guard-timeout
  doctrine as the exec-pptx route): a hung headless process is killed and the send falls back to
  HTML-only rather than blocking the schedule.
- Site with no data for the period → report still renders with zeros + a "no activity" note.
- **Send idempotency** — a `report_sent_log(report_type, site_code, period, sent_at, result)` row is
  written on every successful send; both "Send now" and scheduled runs check it and **skip a
  same-(type,site,period) send already made today** unless `force=1` is passed. Prevents double-sends
  from a manual+scheduled overlap or a re-fired task.
- **Schedule PUT** wraps the `schtasks` create/delete; a task-creation failure returns a 500 with the
  schtasks stderr and leaves the previous task untouched (does not half-apply).

## 10. Testing

- **`siteReport.js`** — snapshot test on a seeded DB + one run against `prod-snapshot` under
  `REPORTS_BACKEND=postgres` (numbers must match a sqlite run; same dress-rehearsal method used for
  `reportPayload`).
- **`reportDirectory.js`** — TDD: idempotent `suggestFromMeetings` (never overwrites confirmed),
  unconfirmed-email exclusion, `resolveRecipient` to/cc.
- **`siteScore.js`** — pure unit tests: each dimension's normalisation at 0 / partial / cap; RAG
  cut-offs at 44/45/69/70; `two_moves` ranking + `gain_pts`; tie-break order.
- **`mailer.js`** — unit test with a stub transport (assert compose: to/cc/subject/attachments);
  no real SMTP in tests.
- **Template composers** (`coordinator`/`finance`) — snapshot test on a fixed `siteReportData`
  object: assert the de-technicalisation (FM composer emits no ITSM jargon — grep the output for a
  banned-terms list: SLA/FRT/MTTR/RCA/backlog), the `htmlBody` is table-only (no `<script>`), and
  `subject` carries site+period.
- **`reportRender.renderPdf`** — test the degradation paths with a stubbed spawn: no-browser → HTML
  -only result; timeout → process killed + HTML-only. No real Chrome in CI.
- **`reportConfig.js` / schedules** — round-trip + `SCHTASKS_CMD` override (as `backupSchedule` test)
  + task-creation-failure surfaces the error.
- **Idempotency** — `report_sent_log` dedup: second same-day send skipped unless `force=1`.
- **Routes** — added to `tests/server-routes-smoke.test.js` (sqlite mode): recipients CRUD,
  `site-data`, `send?preview=1` (asserts no `report_sent_log` row written for a preview).
- **Regression** — full suite + reports.db PG suites stay green.

## 11. Deploy notes

- `nodemailer` ships via the same xcopy-a-pure-JS-package route as the pg driver (no npm install on
  prod). PDF needs no dependency (system browser).
- `server.js`, `reports.html`, `site-report.html` are `_htmlCache`/server surfaces → apply ZIP then
  `_pm2_restart_prod.cmd` (stop→wait→start).
- New tables auto-create at boot (idempotent), same as every prior reports.db table.
