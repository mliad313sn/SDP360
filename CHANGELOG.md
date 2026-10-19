# SDP Dashboard — Changelog

All notable changes to the Endeavour Mining IT Operations Dashboard are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — SDP-Dashboard 2.0, step 4: security (2026-10-19)

### Security
- **Dependencies**: 11 vulnerabilities (1 critical, 5 high) → **0**. axios 1.20, nodemailer 10, express patched,
  SheetJS 0.20.3 (maintained build, vendored in `vendor/`), overrides for `image-size` and `uuid`.
  CI now FAILS on a high/critical vulnerability and on an ESLint security error (`eslint.config.js`); Dependabot weekly.
- **Secrets**: v2 encryption (scrypt + per-value salt), v1 still readable and upgraded by
  `tools/pg/encrypt-secrets.js --apply`; the server refuses to start without `SDP_CONFIG_KEY` in production mode
  (`REQUIRE_POSTGRES=1` or `REQUIRE_CONFIG_KEY=1`).
- **Keys**: constant-time comparison (dashboard key, Meridian key, SSO nonce); OpManager key in a header, never in
  the URL; OpManager TLS verified by default (`opmanager_ca_file` for an internal CA); no session token in a URL.
- **Sign-in**: persistent throttle (10 failures per account / 30 per address in 15 min, survives a restart);
  session cookie Secure as soon as the request is HTTPS; break-glass sign-ins journaled as risk events.
- **CSP**: strict policy (no inline script) on new pages; inline-script ratchet on the 32 legacy pages
  (569 items, may only go down); the shared header no longer uses an inline handler.
- **SSO** (armed off): Entra groups → roles and sites at sign-in; nightly deactivation of departed accounts
  (`entra.deprovision`, preview mode, 20 % cap).
- **Audit**: every API write and every 403 journaled in System Logs (category `api`), kept 12 months
  (`audit.retention`); incident procedure `docs/ops/INCIDENT-RESPONSE.md`.
- **Tests**: authorization test on every API route (328 discovered; anonymous refused, viewer refused on the
  116 role-gated ones); break-glass, throttle, group map, deprovisioning, CSP ratchet.

### Deployment
- The package carries a complete production `node_modules` (dependencies changed); `_apply_on_prod.cmd` swaps it
  with an automatic rollback — no npm on the server.

---

## [Unreleased] — SDP-Dashboard 2.0, step 3: KPI dictionary, RAG registry, site registry (2026-10-19)

### Added
- **KPI dictionary** (`services/metrics/registry.js`, 46 indicators: formula, window, owner, source, colour
  scale) — page **Operations ▸ KPI Dictionary** (EN/FR) and `GET /api/metrics/registry`.
- **Per-KPI API** `GET /api/metrics/:key?site=CODE&month=YYYY-MM` (or `from=&to=`), site-scoped like every
  site read; it calls the existing reader, never a second formula.
- **RAG policy registry** `public/lib/kpiRag.js`: the 10 server-side colour scales in one place, value for
  value — adopted by 8 server modules; no colour changed (fidelity tests + PPTX fingerprint unchanged).
- **Site registry** `GET /api/registry/sites` (admin) + tab: every module's code per site, hard-coded maps
  that disagree with the database, unmapped asset labels.
- `tools/metrics/rag-impact.js` — read-only before/after table for the proposed 3-policy convergence.
- Help §7.6 EN/FR; design dossier `docs/design/ETAPE-03-kpi.md` (decisions DEC-1…DEC-5 pending).

### Changed
- Inspection conformity is computed by one shared formula (`services/metrics/formulas.js`).

---

## [Unreleased] — SDP-Dashboard 2.0, step 2: PostgreSQL only, schema migrator, CI (2026-10-19)

### Added
- **Schema migrator** `db/migrate.js` (`--status`, `--apply`): applies `db/postgres/<module>/NNN_*.sql` in
  order, journal `schema_migrations`, one transaction per script under an advisory lock; an edited script is
  re-applied. Every `initPg*` now goes through it; the inline DDL moved to `reports/016`, `meetings/002`,
  `assets/002` (ADR-002).
- **Zero SQLite in production**: `REQUIRE_POSTGRES=1` makes the server refuse to start while a module is on
  SQLite (`services/backendGuard.js`); Sync health shows the backend of every module and pending scripts.
- **Nightly encrypted backup** (runner job `db.backup`, 02:30): pg_dump → gzip → AES-256-GCM, retention 14
  days; enabled by `SDP_BACKUP_DIR` + `SDP_BACKUP_KEY` (no plaintext backup is ever written).
  `tools/pg/restore-backup.js` + `docs/ops/RESTORE-DRILL.md` (quarterly drill).
- **CI** (`.github/workflows/ci.yml`): syntax gate (`tools/ci/lint.js`), migrator on an empty PostgreSQL 17
  then replayed, full test suite sqlite + PostgreSQL with coverage, informational `npm audit`.

---

## [Unreleased] — SDP-Dashboard 2.0, step 1: reliable, observable synchronisation (2026-10-19)

### Added
- **Sync runner** (`services/sync/`): every scheduled job (14, formerly bare `cron.schedule` lines in
  `server.js`) is declared in `services/sync/jobs.js` and runs with an overlap lock, retries with
  exponential backoff on transient errors (network, 429, 5xx; `Retry-After` honoured), one row per run in
  `sync_runs`, a per-job state (`sync_job_state`), failures mirrored to the System Log (category `sync`).
- **Alerts** after 2 consecutive failures (once per streak), on staleness (hourly sweep) and on recovery —
  e-mail and/or Teams card, armed OFF (`sync_alert_enabled`, `sync_alert_recipients`, `sync_alert_teams`).
- **Health**: `GET /api/sync/health`, `GET /api/sync/runs`, `POST /api/sync/run/:key` (admin+), and the
  **System Logs ▸ Sync health** tab (status, last success, age, 28-day success rate, streak, Run now,
  alert settings).
- Schema: `db/postgres/reports/015_sync_runs.sql` (sqlite created lazily). Run log retention 30 days
  (`SYNC_RUN_RETENTION_DAYS`).

### Changed
- **Truncation guard**: the Zoho reconciliations (tickets, changes, CAB, survey — sqlite and PostgreSQL)
  refuse to delete more than 20 % of a table in one run (`SYNC_TRUNCATION_TOLERANCE_PCT`); nothing is
  deleted, the run fails, the alert fires.
- Manual triggers (`/api/sync/trigger/:job`, `/api/sync/trigger/assets`) go through the runner (409 when
  the job is already running). A partially failed assets sync is now reported as a failure.

---

## [1.11.0] — 2026-04-15

### Added
- **IT Activity Tracker** — new full-featured module at `/activity-tracker.html`:
  - 10 active sites, 31 activities across 4 strategic pillars (Network Infra 30%, Biz Partnering 35%, Risk & Compliance 20%, People Dev 15%)
  - 5 KPI types: `BOOLEAN`, `PERCENT`, `MILESTONE`, `CURRENCY`, `RATING`
  - Weighted scoring engine — pillar weights × activity weights × per-month actuals → site % score
  - Month-by-month RAG (Green / Amber / Red) with delta vs previous month
  - RBAC: `super_admin` / `executive` — full read/write; `admin` — own-site inputs only; `editor` / `viewer` — read-only
  - Pillar-by-pillar breakdown panel and site-comparison leaderboard
- **Tracker SQLite persistence** (`tracker-db.js` + `tracker.db`):
  - Three tables: `tracker_config`, `tracker_targets`, `tracker_inputs`
  - Auto-seeds from `tracker-init.json` on first run (default activities, weights, sites)
  - `saveTracker(D, userSite)` enforces site-level RBAC at the DB layer — admin role can only write own site inputs
  - `resetTracker()` for super_admin (re-seeds to defaults)
- **Tracker PPTX export** (`tracker-pptx.js`):
  - Server-side 2-slide PowerPoint generation matching the Endeavour Mining template exactly
  - Slide 1 — IT Ops Strategy Roadmap: navy header, logo, KPI tiles, 2 chart cards (site performance bar + RAG-by-pillar stacked bar), plain italic footer
  - Slide 2 — Executive Commentary & Site Summaries: pillar boxes with real PNG icons, site cards with colored top bar + RAG badges + progress separator + auto commentary icons (green ✓ / amber ⚠), General Review section, plain italic footer (no black bar)
  - All images embedded from `public/tracker-icons/` at server start — no CDN dependency
  - Layout matched pixel-for-pixel from template: `LAYOUT_16x9` (10" × 5.625"), all coordinates derived from template XML (EMU → inches)
  - Dynamic layout: pillar box width and site card width adapt to any number of pillars/sites
  - Auto-generated commentary: `siteCommentary()` inspects RAG changes vs previous month; `generalReview()` identifies fleet-wide patterns
  - Passes through `fixComboChartAxes()` — all PPTX files open correctly in Microsoft PowerPoint
- **New server endpoints** in `server.js`:
  - `GET  /api/tracker/load`   — load full tracker state (admin+)
  - `POST /api/tracker/save`   — save tracker state with RBAC site-restriction (admin+)
  - `POST /api/tracker/export` — generate and download PPTX (admin+)
  - `POST /api/tracker/reset`  — reset to defaults (super_admin only)

### Fixed
- **Tracker PPTX — PowerPoint compatibility**: Applied `fixComboChartAxes()` post-processing (same as all other PPTX files). pptxgenjs 3.12.x generates combo charts with axis XML referencing IDs not defined in the file; PowerPoint is strict and refuses to open; LibreOffice is lenient. The fix patches the XML inside the ZIP buffer before sending.
- **Tracker PPTX — Black site-color bars**: `D.siteColors` values include `#` prefix (e.g. `"#0D9488"`). pptxgenjs `chartColors` expects hex without `#`. Added `hex(c)` helper: `c.replace(/^#/, '')`.
- **Tracker PPTX — Stray border rectangles**: All shapes now carry explicit `line:{color:X,pt:0}` to suppress pptxgenjs default borders that appear as red/black outlines in PowerPoint.
- **Tracker PPTX — Slide layout**: Changed from `LAYOUT_WIDE` (13.33"×7.50") to `LAYOUT_16x9` (10"×5.625") to match the template. All x/y/w/h coordinates adjusted accordingly.

### Developer / Files
- `tracker-db.js` — new file; SQLite persistence for tracker module
- `tracker-pptx.js` — new file; server-side PPTX generator
- `tracker-init.json` — default seed data (activities, targets, pillar weights)
- `public/activity-tracker.html` — new page; full tracker UI; PPTX export calls `/api/tracker/export`
- `public/tracker-icons/` — 8 PNG files extracted from template: `logo.png`, `pillar1-4.png`, `green-check.png`, `amber-warn.png`, `amber-warn2.png`
- `server.js` — 4 new tracker API routes added at line ~3517
- `package.json` — version bumped to `1.11.0`

### Developer Notes
- The `tracker-icons/` folder must be present on the production server before PM2 reload. Copy with: `xcopy "...\public\tracker-icons\*" "C:\Apps\SDP-Dashboard\public\tracker-icons\" /Y /I`
- Commentary is **auto-generated at export time** from DB data — it is not stored text. Accuracy depends on per-site monthly actuals being entered before export.
- `LAYOUT_16x9` in pptxgenjs = 10"×5.625". `LAYOUT_WIDE` = 13.33"×7.5". These are **not** the same — always verify with `sldSz cx="9144000"` (10") vs `cx="12192000"` (13.33") in the output XML.
- The `better-sqlite3` native module is compiled for the target platform. Do not move `tracker.db` or `node_modules/better-sqlite3` to a different OS/arch without rebuilding.

---

## [1.10.3] — 2026-04-01

### Fixed
- **Monthly PPTX — Emoji rendering**: Multi-byte emoji (`🔴`, `🟢`, `🔄`, `✅`, `⏸`, `📅`) were
  rendering as `?` in PowerPoint because pptxgenjs does not support them in table/shape text.
  Replaced throughout with safe BMP Unicode symbols:
  - Slide 5 section badges: `▼ Issues & Incidents` / `▲ Successes & Achievements`
  - Slide 7 status column: `✓ Achieved` / `► In Progress` / `■ Deferred`
  - Slide 4 month total label: `MONTH TOTAL (calendar)` (was `📅 MONTH TOTAL (day 1→end)`)
- **Slide 7 — Placeholder row status**: When no objectives are defined, the placeholder row
  previously showed `🔄 in progress`. Now correctly shows `—` (grey, non-bold).

---

## [1.10.2] — 2026-04-01

### Fixed
- **Monthly PPTX Slide 2 — Trend column**: Arrow now inherits the status cell color (green/orange/red
  derived from value vs target) instead of a fixed grey. A red service shows a red arrow regardless of
  whether the trend direction is up, down, or stable.
- **Monthly PPTX Slide 3 — Infrastructure KPI Trend**: Completely rewritten.
  - Now shows all **12 months (Jan–Dec)** using `getYearlySummary()` data instead of 5 past months
    from `monthlyData.pastMonths` — eliminating the Mar/March duplicate-column bug permanently.
  - Current report month header highlighted orange; future months show "—".
  - Abbreviated month headers (Jan, Feb, …) to fit all 12 columns on the slide.
  - **YTD Avg** column replaces "Year Avg": only months with a real value > 0 are included in the
    average (zero = no data, excluded to avoid distorting availability metrics).
- **Monthly PPTX Slide 4 — Helpdesk MONTH TOTAL row**: Now uses `calendar_hd` (calendar-based query,
  day 1 → end of month, matching Analytics Plus) when available. Falls back to weekly-row sum only if
  `calendar_hd` is absent. Row label shows `📅 MONTH TOTAL (day 1→end)` when calendar data is used.
- **Monthly UI — Infra KPIs tab**: Status dots (🟢/🟡/🔴) and trend arrows now auto-derived from
  numeric value vs target, matching PPTX logic. WAN2 at 60% against 98% target now correctly shows
  🔴 and a red arrow instead of a manually-stored green dot.
- **Weekly PPTX + Monthly PPTX Slide 2**: Trend arrow color now matches status cell color (same fix
  applied to `reports-weekly-pptx.js` weekly `slideInfraKpis` and v1 monthly slide).

### Developer / Files
- `reports-monthly-pptx.js`: `slideMonthlyInfraTrend` signature changed to
  `(pptx, yearlyData, siteName, monthLabel, reportMonth)`; `generateMonthlyPptxV2` and
  `generateAllSitesMonthlyPptx` accept new `yearlyData` parameter.
- `server.js`: both PPTX-v2 endpoints now call `rdb.getYearlySummary()` and pass result through.
- `public/reports.html`: `renderMrInfra()` uses new `autoKpiColor()` and `trendArrow()` helpers.

---

## [1.10.1] — 2026-04-01

### Fixed
- **Monthly PPTX Slide 2 — Infrastructure KPIs (Last Week)**: Status cell color now auto-derived
  from a numeric comparison of `status_value` vs `target` (green ≥ target, orange ≥ 90 % of target,
  red below that), regardless of the color the IT manager manually stored in the DB.
  Falls back to the stored `status_color` only when numeric comparison is not possible (non-numeric
  values or missing target).  `trendArrow` / `trendColor` logic was already correct — unchanged.
- **Monthly PPTX Slide 3 — Infrastructure KPI Trend**:
  - Duplicate current-month column bug fixed: `pastMonths` entries whose label matches the current
    `monthLabel` are now excluded before building `allMonths`.
  - All data cells are now colored green / orange / red based on value vs target — not only the
    current-month column as before.
  - Added **Year Avg** column (rightmost, dark-blue header) showing the average of every month
    with data for each service row, also colored by the same green/orange/red scheme.

### Developer / Files
- `reports-monthly-pptx.js` — new helpers `autoStatusColor()` and `infraCellColor()` added;
  `slideMonthlyLastWeekInfra()` and `slideMonthlyInfraTrend()` updated accordingly.
  File header version bumped to v1.10.1.
- `reports-weekly-pptx.js` — same `autoStatusColor()` helper added; weekly `slideInfraKpis()` and
  legacy monthly `slideMonthlyLastWeekInfra()` updated — ensures all sites display consistent
  green/orange/red status cells in the weekly PPTX regardless of manually-stored color values.

---

## [1.10.0] — 2026-03-31

### Added
- **Audit Trail system** — full tracking of who did what on every report:
  - New `audit_log` SQLite table (`report_id`, `site_id`, `user_id`, `username`, `action`, `details` JSON, `created_at`)
  - `created_by` column added to `weekly_reports` (migration-safe ALTER)
  - Actions logged: `created`, `edited_infra`, `edited_helpdesk`, `edited_lights`, `edited_actions`, `submitted`, `reverted`, `deleted`, `reassigned_week`, `edited_monthly`, `edited_objectives`
  - New server endpoint `GET /api/reports/:id/audit` — returns last 30 entries for a report
  - Audit panel shown at the bottom of every open weekly report form, auto-refreshed after each save/submit/revert
- **super_admin role** — new role above `admin`:
  - Only `super_admin` can revert a submitted report back to Draft (returns HTTP 403 for other roles with clear message)
  - `super_admin` can manage reports for all sites (same as `admin`)
  - `super_admin` option added to the user management role dropdown
  - `requireAdmin` middleware now accepts both `admin` and `super_admin`
- **Calendar-based monthly helpdesk totals** — the "Monthly Total" row in the Helpdesk Metrics tab now counts tickets by `created_time` from `request_records`, matching the Zoho Analytics Plus formula (day 1 → last day of month), rather than summing weekly report rows. Shows `(day 1→end, AP formula)` label to distinguish from weekly sum fallback
  - New DB function `getCalendarMonthlyHelpdesk(site_id, year, month)` — uses `overdue_status` for resolution SLA and `first_response_overdue` field for first-reply SLA
  - `getYearlySummary` updated to use calendar-based helpdesk data for the Jan–Dec trend table
  - `getMonthlyData` now includes `calendar_hd` in its response

### Changed
- Delete endpoint error message now says "ask a super_admin to revert first" instead of "ask an admin"
- `revertReport()` in frontend now shows a confirmation dialog and handles 403 with a readable error toast
- Submit button refreshes audit trail immediately after submitting

### Developer / Files
- `reports-db.js` — `getYearlySummary`, `getCalendarMonthlyHelpdesk`, `logAudit`, `getReportAuditLog` added; all exported
- `server.js` — audit logging wired into all 8 report-save endpoints + status endpoint + delete + reassign-week + monthly edits + objectives save
- `public/reports.html` — audit panel HTML, `loadAuditLog()`, `super_admin` role in dropdown, `renderMrHelpdesk` calendar total row, `revertReport()` enhanced

---

## [1.9.0] — 2026-03-30

### Added
- **Monthly Report Editor** — new `📅 Monthly` nav tab in `reports.html` with:
  - Month / Year / Site selector with **Load Data** button
  - Editable **Low Lights / High Lights** table (Week · Type · Content columns)
  - Editable **Actions & Follow-ups** table (Week · Task · Priority · Due Date · Owner · Status)
  - **Annual IT Objectives** editor with add/remove rows and status selector
  - **Save** buttons persist edits to SQLite `monthly_reports` table
  - Export buttons: single-site PPTX and all-sites combined PPTX
- **New 7-slide monthly PPTX format** (`generateMonthlyPptxV2`):
  1. Cover slide
  2. Last-week Infrastructure KPIs
  3. Monthly Infrastructure Trend (6-month comparison table)
  4. Monthly Helpdesk Metrics (week-by-week table + monthly totals)
  5. Merged Low Lights / High Lights with Week column
  6. Merged Actions & Follow-ups with Week column
  7. Annual IT Objectives
- **All-sites monthly PPTX** (`generateAllSitesMonthlyPptx`) — one deck for every active site with data, with per-site divider slides
- **New DB tables** in `reports-db.js`:
  - `monthly_reports` — stores user-edited lights/actions per site/year/month (JSON columns)
  - `annual_objectives` — per-site per-year IT objectives with status tracking
- **New server endpoints**:
  - `GET /api/reports/monthly/:site_id/:year/:month/edits` — fetch merged or saved lights/actions
  - `POST /api/reports/monthly/:site_id/:year/:month/edits` — save edited lights/actions
  - `GET /api/reports/objectives/:site_id/:year` — fetch annual objectives
  - `POST /api/reports/objectives/:site_id/:year` — save annual objectives
  - `GET /api/reports/monthly/:site_id/:year/:month/pptx-v2` — download new 7-slide format
  - `GET /api/reports/monthly/all-sites/:year/:month/pptx` — download combined all-sites deck

### Changed
- Monthly PPTX card on Reports page updated to call new V2 endpoint; All-Sites button added (admin only)
- `reports-weekly-pptx.js` — old `generateMonthlyPptx` (week-by-week repetition) kept for legacy; new functions added without breaking existing exports

### Developer Notes
- `getMonthlyEdits()` auto-merges lights/actions from weekly reports if no saved edits exist; returns `source: 'auto'` or `source: 'saved'`
- `saveMonthlyEdits()` uses `COALESCE(excluded.*, *)` so partial saves (lights only or actions only) do not overwrite the other column
- `annual_objectives` has a unique index on `(site_id, year)`; saving replaces all rows for that site+year in one transaction
- PPTX `generateAllSitesMonthlyPptx` skips sites with no weekly reports for the month; returns 404 if all sites are empty

---

## [1.8.0] — 2026-03-30

### Fixed
- **Resolution SLA always showing 100%** — `isResOverdue()` fallback checked `=== 'yes'` but
  Zoho stores `Overdue Status` as numeric string `"1"` (violated) / `"0"` (within SLA).
  `Due By Time` is also empty for all tickets so the primary timestamp path never executed.
  Fix: fallback now accepts `"1"`, `"yes"`, and `"true"`. The `if (!isRes) return false` gate
  was relaxed so open overdue tickets also count, aligning with Zoho AP formula
  `countif(Overdue Status = 1)` which counts all tickets regardless of status.
  Cancelled tickets remain excluded.
  **Files:** `public/index.html`, `public/executive.html`, `public/executive-report.html`, `server.js`

- **1st Reply SLA always showing 100%** — `server.js` `_rebuildCacheFromSQLite()` mapped the
  SQLite column `first_response_overdue` to field key `'First Response Overdue'` (missing " Status").
  All browser code reads `r['First Response Overdue Status']` → field was always undefined → 0
  violations counted.
  Fix: renamed the key to `'First Response Overdue Status'` to match the Zoho field name.
  **File:** `server.js`

- **`reports-db.js` SQL first-response count only matched `'true'`** — Zoho stores
  `first_response_overdue` as `'1'`, `'Yes'`, or `'true'` depending on version/data age.
  Fix: query now uses `LOWER(...) IN ('true','1','yes')`.
  **File:** `reports-db.js`

- **`executive.html` `frViolated` missing `'yes'` case** — comparison at the ticket-level
  loop only checked `=== 'true'` and `=== '1'`, not `=== 'yes'`.
  **File:** `public/executive.html`

- **PM2 process name corrected** — process is registered as `endeavour-dashboard`, not
  `sdp-dashboard`. Updated README and SKILL.md references.

### Changed
- `isResOverdue()` comment block updated across all four files to document the
  Zoho AP formula alignment and the dual-format Overdue Status field.
- `FORMULA_RECONCILIATION.md` updated with confirmed field value formats and fix log.
- `package.json` version bumped from `1.0.0` to `1.8.0`.

### Developer Notes
- `Due By Time` is empty for all tickets in this workspace. If ManageEngine ever
  populates this field, the timestamp-based primary path in `isResOverdue()` will
  automatically take precedence over the `Overdue Status` fallback — no code change needed.
- `Overdue Status` and `First Response Overdue Status` may return different string
  formats across Zoho versions: `"1"`/`"0"` (numeric), `"Yes"`/`"No"` (text), or
  `"true"`/`"false"` (boolean-text). All dashboard code now handles all three variants.

---

## [1.7.0] — 2026-03 (prior)

### Added
- Comprehensive developer documentation: `README.md`, `SDP_Dashboard_API_Reference.docx`,
  `SDP_Dashboard_Developer_Guide.docx`
- Tech-break selector in weekly reports
- PowerPoint export for helpdesk weekly reports

### Changed
- Group list reduced from 16 to canonical 11 Operations groups; removed `CAB Agents`,
  `Dakar IT Agents`, `IT Agents` (phantom ticket sources)
- Week convention standardised to Zoho Sunday-start across all files
- SLA formula aligned to Zoho AP: `Math.round((1 - violations/total) * 1000) / 10`

---

## [1.6.0] — 2026-02

### Added
- SQLite WAL mode for better concurrent read performance
- `_rebuildCacheFromSQLite()` — server rebuilds in-memory cache from `request_records`
  when Zoho API is unavailable (offline-resilient operation)
- Dual-close check (`isClosed` + status fallback) for ageing report accuracy

### Fixed
- Week label offset vs Zoho AP (was using ISO Monday-start, now Zoho Sunday-start)
- UNIQUE constraint crash on reassign-week sync

---

## [1.5.0] — 2026-01

### Added
- `zoho-sync.js` background sync every 2 hours (node-cron)
- `raw_cache.json` disk persistence with 4-hour TTL
- Nightly cache clear at 03:15

### Changed
- OAuth scope corrected from `ZohoAnalytics.*` to `MEAplus.*` (ManageEngine Analytics Plus)
- PM2 Windows service setup for RDP-safe operation

---

## [1.0.0–1.4.0] — 2025

Initial development: Express proxy server, Zoho OAuth integration, SQLite schema,
KPI dashboard (`index.html`), executive summary (`executive.html`),
monthly PPTX report pipeline, survey/CSAT integration, site reports module.
