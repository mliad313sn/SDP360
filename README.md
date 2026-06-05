# Endeavour Mining — SDP IT Dashboard

> **Version:** v1.11.0 · **Stack:** Node.js 18+ / Express · SQLite (better-sqlite3) · Zoho Analytics MEAplus
> **Port (default):** 3456 · **PM2 app name:** `endeavour-dashboard`
> **Production path:** `C:\Apps\SDP-Dashboard\` · **Dev path:** `C:\Users\Admin\Documents\SDP-Dashboard\`

---

## Overview

A self-hosted IT operations dashboard for Endeavour Mining's African sites (Sabodala, Wahgnion/Fetekro, Mana, Ity, Houndé, Boungou, Kalana, Abidjan, Dakar, Ouaga). It pulls live ticket data from **Zoho Analytics Plus (MEAplus workspace)** every 2 hours, calculates KPIs, and provides six specialised pages for reporting, executive summaries, activity tracking, and PowerPoint export.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (LAN)                                                      │
│  index.html │ reports.html │ executive.html │ activity-tracker.html │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP (port 3456)
┌──────────────────────────▼──────────────────────────────────────────┐
│  server.js  (Express)                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐               │
│  │ Basic Auth  │  │ Session Auth│  │  Rate Limiter│               │
│  └─────────────┘  └─────────────┘  └──────────────┘               │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  REST API routes                                              │  │
│  │  /api/reports/*  /api/tracker/*  /api/survey/*  /api/sync/*  │  │
│  └───────────────────┬──────────────────────────────────────────┘  │
│     ┌────────────────▼───────────────────────┐                     │
│     │  reports-db.js (better-sqlite3)         │                     │
│     │  reports.db  (tickets, reports, users)  │                     │
│     └────────────────────────────────────────┘                     │
│     ┌────────────────────────────────────────┐                     │
│     │  tracker-db.js (better-sqlite3)         │                     │
│     │  tracker.db  (activities, targets,      │                     │
│     │               monthly inputs)           │                     │
│     └────────────────────────────────────────┘                     │
│     ┌────────────────────────────────────────┐                     │
│     │  PPTX Generators                        │                     │
│     │  reports-weekly-pptx.js                 │                     │
│     │  reports-monthly-pptx.js                │                     │
│     │  tracker-pptx.js                        │                     │
│     │  pptx-fix-axes.js  (XML post-processor) │                     │
│     └────────────────────────────────────────┘                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ OAuth (MEAplus scope)
┌──────────────────────────▼──────────────────────────────────────────┐
│  Zoho Analytics Plus (MEAplus workspace)                            │
│  Ticket views, Change/CAB, Survey/CSAT data                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Feature Inventory

### Page 1 — Main Dashboard (`/` → `public/index.html`)
- Live KPI cards: Inbound, Closed, Resolution SLA%, First Reply SLA%
- Combo chart: 13-week rolling ticket volume + SLA trend lines
- Ageing breakdown bar chart (by ticket age bucket)
- Top SLA violations table (real-time)
- Group + week filters; localStorage preset buttons
- Auto-sync badge showing last Zoho sync time

### Page 2 — Reports (`/reports.html` → `public/reports.html`)
- Session-based login (role: super_admin / executive / admin / editor / viewer)
- Weekly report filing: Infrastructure, Helpdesk, Traffic Lights, Action Items sections
- Draft → Submit → Approve workflow
- Weekly PPTX export (single site, all-sites summary)
- Monthly PPTX export (calendar-month summary)

### Page 3 — Executive Summary (`/executive.html` → `public/executive.html`)
- Cross-site KPI grid (all sites at a glance)
- 6-month trend sparklines per site
- SLA heat-map table

### Page 4 — Executive Report (`/executive-report.html` → `public/executive-report.html`)
- Print-ready full-page executive report
- localStorage presets for month/year/site filter combos
- Syncs live from the same Zoho data

### Page 5 — Activity Tracker (`/activity-tracker.html` → `public/activity-tracker.html`)
- 31 activities grouped into 4 IT pillars (Network Infra, Biz Partnering, Risk & Compliance, People Dev)
- 10 active sites: MGO, HGO, SML, ITY, SGO, ABJ, DKR, KLN, EXP, EDV
- Monthly input grid: actual vs target per site per activity
- Pillar scoring with configurable weights (default: 30/35/20/15 %)
- RAG badge per site (green ≥ 85%, amber 70–84%, red < 70%)
- Executive commentary auto-generated at export time
- PPTX export: 2-slide branded report (Slide 1: KPIs + charts, Slide 2: pillar breakdown + site cards)
- RBAC: super_admin/executive = all sites; admin = own site inputs only; viewer = read-only

### Page 6 — Login (`/login.html`)
- Session authentication entry point for protected modules

---

## File Structure

```
SDP-Dashboard/
├── server.js                   # Express server, all API routes, sync cron jobs
├── reports-db.js               # SQLite schema + query helpers for reports.db
├── reports-weekly-pptx.js      # Weekly + monthly PPTX (slideMonthly* functions HERE)
├── reports-monthly-pptx.js     # Dedicated monthly PPTX (identical slideMonthly* copies)
├── tracker-db.js               # SQLite layer for tracker.db (loadTracker/saveTracker/reset)
├── tracker-pptx.js             # Activity Tracker PPTX generator (2-slide export)
├── tracker-init.json           # Default seed data for tracker.db
├── pptx-fix-axes.js            # Mandatory XML post-processor for all PPTX files
├── package.json                # v1.11.0 — dependencies listed below
├── Dockerfile                  # Container build
├── docker-compose.yml          # Compose with data/ volume mount
├── .env                        # ← NOT in git — contains secrets
├── .env - Copie.example        # Template — safe to commit
├── CLAUDE.md                   # AI memory file — architecture + design decisions
├── CHANGELOG.md                # Full version history
├── README.md                   # This file
│
├── public/                     # Static files served by Express
│   ├── index.html              # Main KPI dashboard
│   ├── executive.html          # Executive summary
│   ├── executive-report.html   # Print-ready executive report
│   ├── reports.html            # Weekly report filing module
│   ├── activity-tracker.html   # IT Activity Tracker
│   ├── login.html              # Login page
│   ├── help.html               # User help
│   ├── auth.js                 # Unified auth helper (all pages)
│   └── tracker-icons/          # Embedded PNG icons for Tracker PPTX
│       ├── logo.png            # Endeavour Mining logo
│       ├── pillar1.png         # Network Infrastructure icon
│       ├── pillar2.png         # Business Partnering icon
│       ├── pillar3.png         # Risk & Compliance icon
│       ├── pillar4.png         # People Development icon
│       ├── green-check.png     # Green circle ✓ (commentary icon)
│       ├── amber-warn.png      # Amber warning ⚠ (per-site commentary)
│       └── amber-warn2.png     # Amber warning ⚠ (general review)
│
├── data/                       # Runtime data — NOT in git
│   ├── reports.db              # Main SQLite DB (tickets, reports, users, sync)
│   └── raw_cache.json          # Zoho API response cache
│
├── reports.db                  # (root) — reports DB location (actual path)
└── tracker.db                  # (root) — tracker DB location (actual path)
```

> **Note on PPTX files:** `slideMonthly*` functions exist in **both** `reports-weekly-pptx.js` AND `reports-monthly-pptx.js`. Any change to a monthly slide **must be applied to both files identically**.

---

## Quick Start

### Option A — Bare Metal (Node.js)

```bash
# 1. Place project files on server
cd C:\Apps\SDP-Dashboard

# 2. Install dependencies (includes native better-sqlite3 build)
npm install

# 3. Configure environment
copy ".env - Copie.example" .env
# Edit .env — fill in Zoho credentials (see Environment Variables below)

# 4. Start server
node server.js
# or with auto-restart:
npm run dev    # requires: npm install -g nodemon

# 5. Open dashboard
# http://localhost:3456
```

### Option B — PM2 (Windows Service, survives RDP disconnect)

```bash
npm install -g pm2 pm2-windows-service

# Set PM2 home (keeps data outside user profile)
setx PM2_HOME "C:\ProgramData\pm2" /M

# Start and save process list
pm2 start server.js --name "endeavour-dashboard"
pm2 save

# Install as Windows service (run as Administrator)
pm2-service-install

# Useful PM2 commands
pm2 status                        # check running status
pm2 logs endeavour-dashboard      # tail live logs
pm2 reload endeavour-dashboard    # zero-downtime reload after code changes
pm2 restart endeavour-dashboard   # full restart (clears memory)
```

### Option C — Docker

```bash
# Build and start (data/ volume auto-mounted)
docker compose up -d

# Tail logs
docker compose logs -f

# Stop
docker compose down
```

---

## Environment Variables

Copy `.env - Copie.example` → `.env` and fill in every value.

| Variable | Required | Description |
|----------|----------|-------------|
| `ZOHO_CLIENT_ID` | ✅ | OAuth Client ID from https://api-console.zoho.com |
| `ZOHO_CLIENT_SECRET` | ✅ | OAuth Client Secret |
| `ZOHO_REFRESH_TOKEN` | ✅ | Long-lived refresh token (MEAplus scope) |
| `WORKSPACE_ID` | ✅ | Zoho Analytics Plus workspace ID |
| `ORG_ID` | ✅ | Zoho organisation ID |
| `DASH_USER` | ✅ | HTTP Basic Auth username (all pages) |
| `DASH_PASS` | ✅ | HTTP Basic Auth password (min 12 chars) |
| `PORT` | optional | HTTP port (default: 3456) |
| `CACHE_TTL` | optional | Cache lifetime in seconds (default: 300) |
| `ZOHO_SURVEY_ID` | optional | Analytics Plus view ID for survey/CSAT data |
| `ANTHROPIC_API_KEY` | optional | Claude API key (enables AI Analyze buttons) |
| `NODE_ENV` | optional | `development` for verbose error detail in responses |
| `DASHBOARD_API_KEY` | optional | Internal API key (auto-derived from DASH_PASS if omitted) |

> **SECURITY:** The server **refuses to start** if `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `DASH_USER`, or `DASH_PASS` are missing, or if `DASH_PASS` is shorter than 12 characters.

---

## Zoho OAuth — Getting a Refresh Token

Required scope: `MEAplus.data.read,MEAplus.metadata.read`
Do **not** use `ZohoAnalytics.*` — it targets the wrong workspace.

```
1. Go to https://api-console.zoho.com → Self Client
2. Paste scope: MEAplus.data.read,MEAplus.metadata.read
3. Set duration: 10 minutes
4. Copy the authorisation code
5. Exchange for refresh token:

   POST https://accounts.zoho.com/oauth/v2/token
     grant_type=authorization_code
     client_id=<your client_id>
     client_secret=<your client_secret>
     redirect_uri=https://api-console.zoho.com
     code=<authorisation_code>

6. Paste refresh_token → ZOHO_REFRESH_TOKEN in .env
```

Access tokens are cached in `.token_cache.json` (gitignored) and auto-refreshed before expiry.

---

## Database Schema

### `reports.db` — Main Database

```sql
-- Weekly report records
CREATE TABLE weeks       (id, year, week_num, week_start, week_end, created_at)
CREATE TABLE reports     (id, week_id, site_id, status, submitted_by, approved_by, ...)

-- Report sections
CREATE TABLE infra_sections    (id, report_id, category, service_name, status, comment, ...)
CREATE TABLE helpdesk_sections (id, report_id, inbound, closed, sla_res_pct, ...)
CREATE TABLE lights_sections   (id, report_id, item, rag_status, comment)
CREATE TABLE action_items      (id, report_id, action, owner, due_date, status)

-- Users and sessions (reports module auth)
CREATE TABLE users    (id, username, password_hash, role, site_name, created_at)
CREATE TABLE sessions (id, user_id, token, expires_at, created_at)

-- Zoho sync tables
CREATE TABLE zoho_tickets      (ticket_id PK, subject, status, priority, site, ...)
CREATE TABLE zoho_changes      (change_id PK, title, status, category, ...)
CREATE TABLE zoho_cab          (cab_id PK, ...)
CREATE TABLE zoho_survey       (survey_id PK, csat_score, site, ...)
CREATE TABLE sync_metadata     (key PK, value)   -- stores last_sync_at timestamps
```

### `tracker.db` — Activity Tracker Database

```sql
-- Single config row (id=1 always)
CREATE TABLE tracker_config (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  activities_json     TEXT,   -- JSON array of {name, pillar, kpi, unit}
  pillar_weights_json TEXT,   -- JSON {pillarName: weight}
  active_sites_json   TEXT,   -- JSON array of active site codes
  years_json          TEXT,   -- JSON array of tracked years
  current_month       INTEGER,
  updated_at          TEXT
)

-- Per-site, per-activity targets
CREATE TABLE tracker_targets (
  site        TEXT,
  activity_ix INTEGER,
  target      TEXT,   -- numeric or 'TRUE/FALSE' for boolean activities
  active      INTEGER,  -- 0/1
  PRIMARY KEY (site, activity_ix)
)

-- Monthly input values (actuals entered by site admins)
CREATE TABLE tracker_inputs (
  year        INTEGER,
  site        TEXT,
  activity_ix INTEGER,
  months_json TEXT,   -- JSON [v1,v2,...,v12] — 12 monthly values
  PRIMARY KEY (year, site, activity_ix)
)
```

**Site codes:** MGO (Mana), HGO (Houndé), SML (Lafigue), ITY (Ity), SGO (Sabodala), ABJ (Abidjan), DKR (Dakar), KLN (Kalana), EXP (Exploration), EDV (Ouaga/EDV)

---

## Authentication & RBAC

### Two Independent Auth Systems

**1. HTTP Basic Auth** — applies to all pages and API routes
- Set `DASH_USER` + `DASH_PASS` in `.env`
- Browser login prompt; cannot be bypassed

**2. Session-based Auth** — applies to `/reports.html` and `/activity-tracker.html`
- Login via `POST /api/reports/auth/login` → returns `{ token }`
- Token stored in `sessionStorage`; sent as `X-Report-Token` header
- Sessions expire after 8 hours

### Role Hierarchy

| Role | Access Level |
|------|-------------|
| `super_admin` | All sites, all data, user management, tracker config, targets |
| `executive` | All sites read + PPTX export, tracker global config |
| `admin` | Own site reports + own site tracker inputs only |
| `editor` | Own site report filing (no approve) |
| `viewer` | Read-only, no edit |

### Tracker RBAC (enforced at DB layer)

`saveTracker(D, userSite)`:
- `userSite = null` (exec/super_admin) → writes everything: config, targets, all site inputs
- `userSite = 'MGO'` (admin) → writes **only** inputs for MGO; config and targets unchanged

---

## API Reference

### Zoho Data & Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/raw` | Live Zoho ticket data (all sites, all open tickets) |
| GET | `/api/helpdesk-metrics` | Computed KPI metrics for current/selected week |
| GET | `/api/sync/trigger` | Manually trigger Zoho sync |
| GET | `/api/sync/status` | Last sync timestamps |

### Reports Module

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/reports/auth/login` | Login → session token |
| POST | `/api/reports/auth/logout` | Invalidate session |
| GET | `/api/reports` | List reports (filterable) |
| GET | `/api/reports/:id` | Single report with all sections |
| POST | `/api/reports` | Create new report |
| PUT | `/api/reports/:id` | Update report sections |
| POST | `/api/reports/:id/submit` | Submit report for approval |
| POST | `/api/reports/:id/approve` | Approve report |
| GET | `/api/reports/:id/pptx` | Export weekly report as PPTX |
| GET | `/api/reports/monthly/:site/:year/:month/pptx` | Monthly PPTX |
| GET | `/api/reports/weekly-summary/:year/:week/pptx` | All-sites weekly PPTX |

### IT Activity Tracker

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tracker` | Load full tracker state (D object) |
| POST | `/api/tracker` | Save tracker state (RBAC enforced) |
| POST | `/api/tracker/reset` | Reset to defaults (exec/super_admin only) |
| GET | `/api/tracker/pptx` | Export Activity Tracker PPTX (2 slides) |

### Survey / Voice of Customer

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/survey/voice` | Survey results (filterable by month) |
| GET | `/api/survey/csat` | CSAT score summary |

---

## PPTX Export System

All three PPTX generators follow the same pattern:

```js
const pr = new PptxGenJS();
pr.layout = 'LAYOUT_16x9';  // 10" × 5.625" — matches Endeavour template
// ... add slides ...
const rawBuf = await pr.write({ outputType: 'nodebuffer' });
return fixComboChartAxes(rawBuf);   // MANDATORY — fixes pptxgenjs combo chart XML bug
```

### `pptx-fix-axes.js` — Why It Exists

`pptxgenjs` 3.12.x generates incorrect axis ID cross-references in combo charts (bar+line). PowerPoint is strict about this and refuses to open the file. LibreOffice is lenient and opens it anyway. `fixComboChartAxes()` opens the PPTX as a ZIP, patches all `<c:axId val="..."/>` references in chart XML, and repacks the ZIP. **Every PPTX generator must call this.**

### Canvas Dimensions (LAYOUT_16x9 = 10" × 5.625")

| Property | Value |
|----------|-------|
| Slide width | 10.00" |
| Slide height | 5.625" |
| Left margin | 0.40" |
| Content width | 9.26" |

### Tracker PPTX — Slide 1 (KPI Overview)

```
y=0.00–1.30   Header bar (teal #0D9488)
y=1.22        Teal accent stripe h=0.08
              Logo top-left (x=0.50, y=0.22, w=0.42, h=0.42)
y=1.52        KPI tiles × 5  (w=1.65, h=0.80, gap=0.05)
y=2.55        Left chart card  x=0.40, w=4.50, h=2.70
              Right chart card x=5.10, w=4.50, h=2.70
y=5.35        Footer text (italic gray #94A3B8, no black bar)
```

### Tracker PPTX — Slide 2 (Pillar Detail)

```
y=0.00–0.72   Header bar (teal)
y=0.65        Teal accent stripe h=0.07
y=0.84        Pillar boxes × 4  (h=0.46, dynamic width, with pillar icons)
y=1.42        Section heading
y=1.65        Site cards × N  (h=2.55, dynamic width)
              Each card: colored top bar | site name | RAG badge | separator
              | green/amber icon + commentary text
y=4.30        General Review section
y=5.38        Footer text (italic gray, no black bar)
```

### Icon Files (`public/tracker-icons/`)

| File | Contents | Used In |
|------|----------|---------|
| `logo.png` | Endeavour Mining logo | Both slides, top-left |
| `pillar1.png` | Network Infrastructure icon | Slide 2 pillar boxes |
| `pillar2.png` | Business Partnering icon | Slide 2 pillar boxes |
| `pillar3.png` | Risk & Compliance icon | Slide 2 pillar boxes |
| `pillar4.png` | People Development icon | Slide 2 pillar boxes |
| `green-check.png` | Green circle ✓ | Slide 2 site commentary |
| `amber-warn.png` | Amber warning ⚠ | Slide 2 site commentary |
| `amber-warn2.png` | Amber warning ⚠ (alt) | Slide 2 general review |

> Icons were extracted from `IT_Ops_Strategy_Mar2026_template.pptx` using JSZip. Do not replace them with emoji — emoji render as `?` in PowerPoint PPTX.

---

## Zoho Week Convention

Zoho Analytics Plus uses **Sunday-start weeks**:
- W01 = first Sunday on or after January 1
- Each week runs Sunday 00:00 → Saturday 23:59
- Example: W13 2026 = 29 Mar 2026 (Sun) → 4 Apr 2026 (Sat)

**Critical:** All `week_start` / `week_end` dates in `reports.db` must follow this convention. The helper `ensureWeek(year, weekNum)` in `reports-db.js` computes dates correctly. Records from W01–W10 2026 (before v1.6.0) may use ISO Monday-start — verify before running comparisons.

---

## Incident SLA Configuration

### Priority Mapping

| Zoho Priority | P-Label | SLA Profile |
|---------------|---------|-------------|
| Critical | P1 | Strictest response |
| High | P2 | Fast response |
| Medium/Normal | P3 | Standard response |
| Low | P4 | Relaxed (same all sites) |

### SLA Targets by Site Profile

**Standard Profile** — MANA, LONDON, EXPLORATION, HOUNDE, ITY, KALANA, LAFIGUE

| Priority | Response | Resolution |
|----------|----------|------------|
| P1 | 30 min | 2 hours |
| P2 | 1 hour | 4 hours |
| P3 | 4 hours | 1 day |
| P4 | 1 day | 5 days |

**Enhanced Profile** — Dakar, Ouaga, Sabodala

| Priority | Response | Resolution |
|----------|----------|------------|
| P1 | **15 min** | 2 hours |
| P2 | **30 min** | 4 hours |
| P3 | **2 hours** | 1 day |
| P4 | 1 day | 5 days |

**Abidjan (Intermediate)**

| Priority | Response | Resolution |
|----------|----------|------------|
| P1 | 30 min | 2 hours |
| P2 | 1 hour | 4 hours |
| P3 | **2 hours** | 1 day |
| P4 | 1 day | 5 days |

---

## Deployment

### Standard Deploy (after code changes)

```cmd
:: 1. Copy changed JS files to production
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\server.js"               "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\reports-weekly-pptx.js"  "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\reports-monthly-pptx.js" "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\tracker-pptx.js"         "C:\Apps\SDP-Dashboard\" /Y
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\tracker-db.js"           "C:\Apps\SDP-Dashboard\" /Y
:: (add any other changed files)

:: 2. Copy static files if changed
xcopy "C:\Users\Admin\Documents\SDP-Dashboard\public\*" "C:\Apps\SDP-Dashboard\public\" /Y /E

:: 3. Reload server (zero-downtime)
pm2 reload endeavour-dashboard
```

### If Port 3456 Is Already in Use (EADDRINUSE)

```cmd
powershell -command "Get-NetTCPConnection -LocalPort 3456 | Select-Object -ExpandProperty OwningProcess | ForEach-Object { taskkill /F /PID $_ }"
pm2 restart endeavour-dashboard
```

### Verify New Code Is Loaded

```cmd
node -e "require('./reports-weekly-pptx.js')" 2>&1 | head -3
node -e "require('./tracker-pptx.js')" 2>&1 | head -3
```

### Production Deployment Checklist

- [ ] `.env` file present with all required variables
- [ ] `DASH_PASS` is at least 12 characters
- [ ] `NODE_ENV=production` in `.env`
- [ ] Zoho refresh token uses `MEAplus.data.read,MEAplus.metadata.read` scope (not `ZohoAnalytics.*`)
- [ ] `tracker.db` and `reports.db` are writable by the Node process
- [ ] PM2 configured for auto-restart on reboot (`pm2 save` + `pm2-service-install`)
- [ ] Firewall: port 3456 accessible only from LAN (not public internet)
- [ ] `public/tracker-icons/` folder present with all 8 PNG files
- [ ] Backup scheduled (weekly minimum)
- [ ] At least one `super_admin` user created in `reports.db`

---

## Backup & Restore

```batch
REM Backup (databases + config, exclude node_modules)
xcopy "C:\Apps\SDP-Dashboard" "C:\Apps\SDP-Dashboard-backup-%date:/=-%\" /E /I /H /Y /EXCLUDE:exclude.txt

REM Contents of exclude.txt:
REM node_modules\
REM .git\
```

Restore: `pm2 stop endeavour-dashboard` → swap folder → `pm2 reload endeavour-dashboard`

---

## Developer Handover Notes

### Key Design Decisions

1. **LAYOUT_16x9 for all PPTX** — Despite the name suggesting 16:9, this is 10"×5.625" in pptxgenjs. This matches the Endeavour Mining template. Do NOT use `LAYOUT_WIDE` (which is 13.33"×7.5").

2. **`fixComboChartAxes()` is mandatory** — Every PPTX generator must pipe output through this. Forgetting it causes PowerPoint to reject the file (LibreOffice will still open it, masking the bug during development).

3. **Duplicate `slideMonthly*` functions** — Monthly slide functions exist verbatim in both `reports-weekly-pptx.js` and `reports-monthly-pptx.js`. This is intentional (both files expose a monthly export endpoint). They must be kept in sync manually.

4. **`tracker.db` seeds from `tracker-init.json`** — The first time `tracker-db.js` opens the DB, it auto-seeds from this JSON file. To change defaults, edit `tracker-init.json` AND delete `tracker.db` (or run `POST /api/tracker/reset`).

5. **`better-sqlite3` is platform-compiled** — If you move the project to a different machine or Node version, run `npm install` again to recompile the native module. Pre-built binaries from another machine will crash.

6. **Hex colors in PPTX** — pptxgenjs expects hex WITHOUT `#` prefix. `D.siteColors` stores colors WITH `#`. Always strip the `#` with: `c.replace(/^#/, '')`.

7. **No emoji in PPTX** — Multi-byte emoji (⚡🔴✅ etc.) render as `?` in PowerPoint. Use BMP Unicode symbols only: `\u2713` (✓), `\u26A0` (⚠), `\u25A0` (■), `\u25B2` (▲), `\u25BC` (▼).

### Dead Code / Legacy Files

| File | Status | Notes |
|------|--------|-------|
| `zoho-sync.js` | May be unused | Sync logic was consolidated into `server.js`. Verify before deleting. |
| `public/analytics.html` | Possibly stale | Not in main nav. Confirm with users before removing. |
| `public/help.html` | Possibly stale | Static content, may not reflect current feature set. |
| `data/helpdesk.db` | Legacy | Old Zoho cache from pre-v1.6.0. Safe to archive if `reports.db` is current. |

### Tech Debt

| Item | Priority | Notes |
|------|----------|-------|
| `server.js` is ~3000+ lines | Medium | Should be split into route files (e.g., `routes/tracker.js`, `routes/reports.js`) |
| Duplicate `slideMonthly*` functions | Medium | Refactor into a shared `slides-monthly.js` module |
| No automated tests | High | No unit tests exist. Add at minimum: PPTX generation smoke test, DB schema migration test |
| `tracker-init.json` duplication | Low | Frontend and backend both define the same default data. Single source of truth needed. |
| SQLite WAL files in production root | Low | `tracker.db-wal` and `tracker.db-shm` accumulate. Add periodic checkpoint or VACUUM to cron. |
| `DASHBOARD_API_KEY` auto-derivation | Low | Fragile. Should be an explicit required env var. |

### Debug Commands

```cmd
:: Check PM2 status
pm2 status

:: Tail live server logs
pm2 logs endeavour-dashboard --lines 100

:: Test PPTX generation syntax
node -e "new Function(require('fs').readFileSync('tracker-pptx.js','utf8'))" 2>&1

:: Inspect tracker DB
sqlite3 tracker.db "SELECT site, activity_ix, target FROM tracker_targets LIMIT 20;"
sqlite3 tracker.db "SELECT year, site, activity_ix, months_json FROM tracker_inputs LIMIT 10;"

:: Inspect reports DB
sqlite3 reports.db ".tables"
sqlite3 reports.db "SELECT id, username, role, site_name FROM users;"

:: Check Zoho token cache
type .token_cache.json

:: Test Zoho auth manually
node -e "const s=require('./server.js')" 2>&1 | head -5
```

---

## Dependencies

```json
{
  "axios": "^1.6.0",         // Zoho API HTTP client
  "better-sqlite3": "^9.4.3", // SQLite (native — recompile if Node version changes)
  "cors": "^2.8.5",           // CORS headers
  "dotenv": "^16.3.0",        // .env loading
  "express": "^4.18.2",       // Web framework
  "node-cron": "^3.0.3",      // Sync cron jobs
  "pptxgenjs": "^3.12.0"      // PPTX generation
}
```

---

## Reference Documents

| Document | Description |
|----------|-------------|
| `CHANGELOG.md` | Full version history v1.0–v1.11.0 |
| `CLAUDE.md` | AI session memory — architecture decisions, layout specs, known pitfalls |
| `SDP_Dashboard_API_Reference.docx` | Full REST API reference |
| `SDP_Dashboard_Developer_Guide.docx` | Architecture, Zoho integration deep-dive |
| `Endeavour_IT_Dashboard_UserManual_EN_FR.docx` | End-user manual (EN + FR) |
| `ANALYTICS_PLUS_API_SCOPES.md` | Zoho scope troubleshooting |
| `FORMULA_RECONCILIATION.md` | KPI formula reconciliation vs Zoho AP |

---

*Maintained by Endeavour Mining IT · Last updated: April 2026 · v1.11.0*
