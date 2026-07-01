# SharePoint IT Operations Executive View — v1 Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming) — pending spec review + implementation plan
**Branch:** `feat/sharepoint-exec-view-v1`

## Goal

Ship a concise, **employee-facing** IT Operations "Executive View" as a single
**read-only page hosted in our existing dashboard**, surfaced on SharePoint via a
Quick Link. It must let any employee grasp overall IT status in <5 s and reach
the right action in one click — without reproducing the full operational
dashboard.

This is **v1 = one page only**. The 5 additional tabs from the external Model-4
handoff (Service Health, Sites, Projects, Reports, Knowledge) are explicitly
**out of scope** (v2).

## Context — why this shape

The external handoff (`sharepoint-executive-view-model-4-handoff.md`, authored
without full knowledge of our codebase) assumes the data must be freshly wired
from source systems into a native SharePoint SPFx web part. Grounded in **what we
already built**, that is unnecessary:

- `services/reportPayload.js build()` already assembles essentially the entire
  Executive View dataset for the monthly PPTX: helpdesk KPIs + MoM deltas, CSAT,
  changes/emergency, major incidents (with downtime), and the full Activity
  Tracker rollup (green/amber/red, `avg_score`, per-site, per-pillar, 6-month
  trends).
- The editorial-input pattern already exists (the Operations Summary `os-*`
  editor persisted per month in `reports.db`).
- We own the app, the design system (`_tokens.css`, brand), the auth, and the
  hourly Zoho sync.

So v1 is a **thin presentation surface + one read-only aggregator endpoint** over
data we already produce — not a new SPFx project. Native SharePoint rendering
(SPFx / Graph push to Lists / Power BI) is deferred to v2 if governance requires
it.

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Hosting & auth | **Public read-only page in our dashboard** (no login), aggregates only, **no PII**. SharePoint links to it via Quick Link. |
| Page scope | **Full single page** (matches the user's mockup variant 3). |
| Site status | **Derived from incidents** (Major Incident + SLA breach). **No uptime %** (we don't ingest OPManager). Exception-only. |
| Editorial input | **Extend the existing Operations Summary editor** (`os-*` keys in `reports.db`). |
| Language | English (like the mockups). FR later if needed. |

## Architecture

Four units, each with one responsibility:

```
Employee (in SharePoint)
  │  clicks Quick Link
  ▼
public/exec-view.html      ← public, read-only, no login (reuses _tokens.css/brand)
  │  fetch
  ▼
GET /api/exec/summary      ← PUBLIC endpoint, aggregates only, NO PII
  │  reuses
  ├─ services/reportPayload.build()   (KPIs, CSAT, changes, MI, tracker — trimmed)
  ├─ site-status derivation (from open incidents / active MI / overdue)
  └─ editorial (highlights/focus) read from reports.db
                              ▲
                              │ entered via
        Operations Summary editor (extended)  →  reports.db
```

| Unit | Responsibility | Depends on |
|---|---|---|
| `GET /api/exec/summary` | Assemble the v1 JSON, **filter all PII**, derive site status | `reportPayload`, `reports-db`, editorial getter |
| `public/exec-view.html` | Pure presentation (render JSON, auto-refresh, "last updated") | the endpoint |
| Editorial extension | Capture highlights/focus → `reports.db` | existing admin card |
| SharePoint | Front door (Quick Link → page URL) | nothing (zero M365 dev) |

Freshness: data = last Zoho cron sync (hourly). The page shows "Last updated"
from `sync_metadata.requests.last_sync_at` and auto-refreshes (every 5 min).

## Endpoint contract — `GET /api/exec/summary`

Aggregates only. Shape:

```jsonc
{
  "data_as_of": "2026-06-25T08:00:00Z",   // sync_metadata.requests.last_sync_at
  "period": "2026-06",
  "status": { "level": "operational|degraded|major", "active_major_incidents": 0 },
  "kpis": {
    "requests_resolved": { "value": 1236, "delta_pct": 8 },
    "sla_compliance":    { "value_pct": 91, "delta_pp": 2 },
    "avg_resolution_h":  { "value": 14, "delta_h": -3 },
    "csat":              { "value_pct": 88, "delta_pp": 4 },
    "change_success":    { "value_pct": 96, "delta_pp": 1 },
    "spark": { "sla": [], "csat": [], "change": [] }   // small series, optional, no PII
  },
  "sites_attention": [ { "code": "SGO", "name": "Sabodala", "status": "degraded", "open_incidents": 2 } ],
  "all_sites_ok": false,
  "planned_maintenance": [ { "date": "2026-06-26", "title": "SAP Upgrade", "window": "22:00–04:00", "impact": "High", "scope": "ITY, Houndé" } ],
  "strategic_progress": { "overall_pct": 72, "pillars": [ { "name": "Network & Infrastructure", "pct": 82 } ] },
  "highlights": [ "2 major projects completed" ],
  "focus_areas": [ { "title": "UPS Upgrade – Lafigué", "subtitle": "Improving site power reliability" } ]
}
```

### Block → source mapping (everything already exists)

| Block | Source |
|---|---|
| `status.level` | derived: active MI → `major`; else degraded site → `degraded`; else `operational` |
| `kpis` | `reportPayload.build()`: `closed`/`total`→resolved, `sla_compliance`(+`_delta_pp`), `avg_res_days`, CSAT block, change-success helper |
| `kpis.spark` | existing 6-month histories (sla trend, csat) — small arrays, no PII |
| `sites_attention` | derived: open incidents per site + `getActiveMajorIncidentsForSite` (exception-only) |
| `planned_maintenance` | `change_records` approved, `scheduled_start` within 7 days (max 3) |
| `strategic_progress` | Tracker: `avg_score`→overall, `pillars{name:score}` (4 pillars) |
| `highlights` / `focus_areas` | editorial `reports.db` (`os-highlights` / `os-focus`) |

### PII boundary (strict)

The endpoint exposes **only** the whitelisted fields above. **Never**: ticket
subjects, requester/technician names, CSAT verbatims, ticket/record IDs. For
maintenance, only change title/window/impact/scope (no requester). The boundary
is enforced **field-by-field in the endpoint**, not by trusting `build()`'s full
output.

## Site-status derivation (pure function)

For each canonical site:
- `open_incidents` = count of **non-closed** incidents for the site (current state).
- **`major`** = an **active (unresolved) Major Incident** on the site.
- **`degraded`** = no MI, but **≥ 1 open incident that is overdue** (`overdue_status`).
- **`operational`** = open incidents all within SLA (or none).

**Exception-only**: the block lists only `major` + `degraded` sites, most severe
first, **max 4 rows**. If none → "All monitored sites are operating normally".
The overdue threshold is configurable for later tuning.

## Editorial extension (Operations Summary editor)

Extend the existing per-month `os-*` persistence in `reports.db`:
- `os-highlights` → array of short strings (max 4).
- `os-focus` → array of `{ title, subtitle }` (max 3).

- **UI**: add fields to the existing Operations Summary admin card (highlights
  textarea + small focus repeater).
- **Read**: the endpoint reads these keys for the **current month**.
- **Empty = hidden**: if unset, the highlights/focus blocks are **omitted** from
  the page (no empty panels).

## Exposure & security (public route)

- `GET /api/exec/summary` and `exec-view.html` must **bypass auth**: register the
  endpoint **before** the global `app.use('/api/', …)` gate (or allowlist it);
  serve the page via a public handler (no `injectApiKey`, no session), added to
  the `_htmlCache` boot list.
- Hardening: GET only · **whitelisted aggregates** (the real control) · **~60 s
  server-side cache** of the JSON (data changes hourly → avoids recompute + limits
  abuse) · no secrets/config exposed · same-origin (no CORS needed).
- Optional (non-blocking): restrict to the internal network at the **IIS** layer.

## Refresh & error handling

- Page: fetch on load + **auto-refresh every 5 min** + "Last updated: `data_as_of`".
- **Per block**: unavailable/stale source → "Data unavailable" (never a misleading
  zero); the endpoint returns `null` for that block and the page renders
  accordingly.
- Endpoint down → neutral "Status temporarily unavailable" + keep last render.
- Freshness guard: if `data_as_of` older than N hours, a subtle "data may be
  delayed" note.

## Testing

- Endpoint integration test (in-memory `reports.db` seeded): JSON shape,
  **anti-PII assertion** (no forbidden field present), site-status derivation
  (major/degraded/operational cases), exception-only + cap-4, empty-editorial →
  blocks omitted.
- Site-status derivation as a **pure function** → dedicated unit tests.
- Page: light visual smoke via preview tools (not a hard test).

## Out of scope (v1)

- The 5 other tabs (Service Health, detailed Sites, Projects, Reports, Knowledge).
- Real site availability (OPManager integration) → v2.
- Native SharePoint rendering (SPFx / Graph push to Lists / Power BI) → v2 if
  governance requires it.
- Multi-tab nav hidden in v1 (single page); optional "Full dashboard" link for staff.
- French localization (page ships in English).

## Acceptance criteria

- A user identifies overall IT status in <5 s; reaches issue reporting / service
  request in one click (deep links to ServiceDesk Plus).
- Only sites needing attention appear (exception-only, max 4); no fake uptime %.
- No block shows more than its cap (5 KPIs, 4 site exceptions, 3 maintenance,
  4 highlights, 3 focus areas).
- Every value carries the last-refresh timestamp / reporting period.
- The endpoint exposes **zero PII** (verified by test).
- Editorial content edited once in the dashboard auto-updates the page.
- The page is public read-only; the endpoint bypasses the auth gate safely.
