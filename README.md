# SDP360 — IT Operations Management & Field Reporting Platform

> **Version:** 2.0.0-alpha.1 · **Lineage:** fork of [`samaziz679/SDP-Dashboard`](https://github.com/samaziz679/SDP-Dashboard) v1.11 (Endeavour Mining IT Dashboard)
> **Stack:** Node.js 18+ / Express · PostgreSQL 17 (SQLite fallback) · ManageEngine ServiceDesk Plus via Zoho Analytics Plus + SDP Cloud API v3 · OpManager · Meraki · pptxgenjs
> **Default port:** 3456 · **Tests:** `npm test` (Node built-in runner)

SDP360 unifies a heterogeneous IT-operations data landscape into one operations hub:

| Data class | Examples | How it reaches SDP360 |
|---|---|---|
| **Integrated** (read-only mirrors) | SDP requests, changes, CAB, CSAT surveys, IT assets, OpManager availability, Meraki WAN links & outages | ETL jobs through the generic **sync runner** (`services/sync/`) |
| **Native** (authored in the platform) | weekly/monthly site reports, action items, department meetings (PV), site inspections, activity trackers, roadmap, risk-register decisions | Platform UI, CSV/XLSX import, RFI-approved trackers |

The governance, architecture and roadmap for turning the inherited dashboard into that hub are in **[`docs/sdp360/`](docs/sdp360/README.md)**:

1. [`00-ASSESSMENT.md`](docs/sdp360/00-ASSESSMENT.md) — deep analysis & map of the inherited code base (what exists, what is hard-coded, what breaks)
2. [`01-STRATEGIC-MASTER-DOCUMENT.md`](docs/sdp360/01-STRATEGIC-MASTER-DOCUMENT.md) — platform vision, architectural blueprint, unified data model, ingestion pipeline
3. [`02-COMMITTEE-CHARTER.md`](docs/sdp360/02-COMMITTEE-CHARTER.md) — IT Ops Expert Review Committee: charter, cadence, evaluation rubrics, RFI workflow
4. [`03-ROADMAP.md`](docs/sdp360/03-ROADMAP.md) — four-phase execution roadmap with deliverables, milestones, dependencies
5. [`04-TRACKER-DASHBOARD-ENGINE-SPEC.md`](docs/sdp360/04-TRACKER-DASHBOARD-ENGINE-SPEC.md) — functional specification of the Custom Tracker & Dynamic Dashboard engine
6. [`05-SOP-DASHBOARDS-AND-TRACKERS.md`](docs/sdp360/05-SOP-DASHBOARDS-AND-TRACKERS.md) — SOP templates for creating, validating, publishing trackers & dashboards + UX standards

## What changed versus SDP-Dashboard v1.11

Code shipped in this fork (all covered by tests, `npm run test:sdp360`):

- **`services/sync/syncRunner.js`** — one lifecycle for every ETL job: overlap lock, exponential back-off retry with `Retry-After`, transient/permanent error classification, delta-since-watermark helper, natural-key dedup, **empty-fetch guard** (a 0-row export can no longer cascade into a mass delete), secret scrubbing, run log. `syncStore.js` persists runs/watermarks/locks on SQLite or PostgreSQL (`db/postgres/sync/001_init.sql`); failures are mirrored into `system_log`.
- **`routes/sync.js`** — `GET /api/sync/runs`, `GET /api/sync/health` (mounted in `server.js`).
- **`services/kpiRag.js`** — single registry of KPI value types and RAG policies; the five inherited cut-off sets are registered verbatim so modules can migrate with no visible change, then be converged by the committee (`kpi_rag_policies` table).
- **`services/trackerDefinitions.js`** — schema, validator and generic scorer for self-service trackers (any period kind, any units, data-driven KPI types) + `fromLegacyInit()` importer for the 2026 IT Activity Tracker. Storage: `db/postgres/tracker/002_tracker_definitions.sql`.
- **`services/dashboardWidgets.js`** — dashboard definition validator (widget catalogue, grid collision/overflow, metric-registry binding, *no raw SQL*) + field-device readiness rule. Storage: `db/postgres/reports/015_dashboard_definitions.sql` (metric registry, dashboards, **RFI register**).
- **CI** (`.github/workflows/ci.yml`), **`DOTENV.example`**, root clean-up (one-off prod scripts → `ops/legacy-scripts/`).

Everything else (modules, pages, PPTX/Excel/e-mail engines, installer, RBAC) is inherited unchanged; the legacy README with the full feature inventory is kept at [`docs/LEGACY_README_SDP_DASHBOARD.md`](docs/LEGACY_README_SDP_DASHBOARD.md) and the inherited design log at [`CLAUDE.md`](CLAUDE.md).

## Quick start (development)

```bash
cp DOTENV.example .env          # set DASH_PASS (≥ 12 chars); Zoho keys optional for local work
npm ci
npm test                        # ~30 s, sqlite, ~2 300 tests; PG suites skip without PG_ADMIN_URL
npm start                       # http://localhost:3456
```

PostgreSQL dev cluster: `tools/pg/dev-up.sh` (see `tools/pg/README.md`). Production install on Windows/IIS/PM2: `docs/INSTALLER.md`.

## Repository layout

```
server.js                 Express app, auth gates, cron registrations (monolith — split tracked in roadmap Phase 1)
routes/                   extracted route modules (inspection, opmanager, siteAwareness, roadmap, teamsSla, sync …)
services/                 domain logic; services/sync = SDP360 sync runner; kpiRag / trackerDefinitions / dashboardWidgets = engine core
*-db.js                   data-access layers (reports, tracker, meetings, inspection, assets) — sqlite + pg forks
db/postgres/              idempotent PG schema per module (reports, tracker, meetings, inspection, assets, sync)
public/                   static UI (37 pages, shared shell, brand tokens, design-system specimens)
tests/                    node --test suites (unit, *.smoke route tests, pg-* integration)
tools/                    installer, deploy packager, pg utilities, integration CLIs (meraki, opmanager, teams)
docs/sdp360/              SDP360 strategy, governance, roadmap, specs, SOPs, templates
ops/legacy-scripts/       inherited one-off prod scripts (forensic only)
```
