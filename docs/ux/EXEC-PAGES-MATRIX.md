# Executive surfaces — what each page answers (matrix)

> **PROPOSAL — decision pending (human gate).** Nothing below is approved, merged, deprecated or redirected.
> The keep / merge / deprecate column is a *proposal* for the owners to accept or reject (findings F16, G14,
> F29). No page is removed or redirected by this document. The decision is to be taken **on usage facts**:
> collect at least 30 days of `page_viewed` events first (Admin ▸ System Logs ▸ Page usage, or
> `GET /api/ux/page-usage?days=30`, super_admin — distinct users per page per role tier).

Written 2026-11-04 (goal C-09) from the code on this branch. Gates are the ones the code enforces today.

## The five surfaces

| | Executive Home | IT Review | Executive Scorecard | Exec View (public) | Deck Builder |
|---|---|---|---|---|---|
| **URL** | `dashboards.html?key=exec-home` | `it-review.html` | `executive.html` | `exec-view.html` | `executive-report.html` |
| **Question it answers** | "Where are we this week, per objective?" — one dated light per objective + per-site RAG grid + open actions | "How is the site programme doing?" — the author's 15-panel review: programme score, 5 Engagements, inspections assurance, pipeline, helpdesk & changes complement | "How did the service perform this month?" — helpdesk KPI snapshot, action plan, technician scorecard, change & incidents, customer voice | "Is IT healthy right now?" — exception-only snapshot for every employee (active Major Incident / overdue sites, planned changes, highlights) | "What goes in the monthly Group IT deck?" — authoring of the 11-slide PPTX + commentary |
| **Audience** | executive, scorecard-viewer | executive, scorecard-viewer | executive, scorecard-viewer | anyone (no login; SharePoint quick link) | super_admin (menu widened by `ui_deck_builder_roles`, page gate still super_admin) |
| **Gate in code** | shell entry `exec-home` roles executive\|scorecard-viewer; page `auth.js data-require="any"`; data = dashboard scope rules (`routes/dashboards.js`) | `auth.js data-require="executive\|scorecard-viewer"`; `GET /api/reports/review-data` `requireRole(['executive','scorecard-viewer'])` | `auth.js data-require="executive\|scorecard-viewer"` | none (public); `GET /api/exec/summary` exempt from the `/api/` gate, whitelisted fields | `auth.js data-require="super_admin"`; export `POST /api/reports/exec-pptx` admin+ |
| **Data sources** | metric registry (`services/metricRegistry.js`): `tracker.fleet_score_pct`, `helpdesk.resolution_sla_pct`, `inspection.conformity_pct`, `meetings.engagement_score`, `helpdesk.window_*` — via `services/dashboardData.js` | `services/reviewData.js` (meetings + inspections denormalised) → `services/reviewDashboard.js` (fidelity-pinned port); extras: helpdesk/changes window readers, operational scoreboard | `request_records`, `change_records`, survey tables via `/api/data/*` + `/api/metrics/*`, computed in the browser (`public/lib/dashboard-shared.js`) | `services/execSummary.js` (helpdesk history, active MIs, upcoming changes, tracker scorers) + `exec_view_editorial` | browser payload (`_buildExecPptxPayload`) + `services/reportPayload.js build()` → `tools/exec-pptx/render.py`; editorial in `exec_report_editorial` |
| **Window** | selected week/month (filter), trend 13 weeks | programme start → as-of; panels per selected period; score rolling 3 months on e-mails | selected month (+ 12-month trends) | report month | selected month |
| **Owner (to confirm)** | KPI committee (dashboard definition is versioned, four-eyes publish) | model author (Group IT); IT Service & Support Manager for the page | IT Service & Support Manager | Group IT (editorial: super_admin) | IT Service & Support Manager |
| **Nav icon** | `gauge` | `bar-chart-3` | `clipboard-list` (was `gauge`, identical to Home — fixed by C-09) | not in the menu | `presentation` |

## Overlaps

| Overlap | Pages | Same figure? |
|---|---|---|
| Resolution SLA % | Home (registry), Scorecard (browser), Exec View (server history), Deck Builder (deck) | Same doctrine (closed-only denominator); different code paths — parity is covered by `kpi-change-parity`/`sla-definition-parity` tests, not by one shared reader. |
| Strategic roadmap / tracker score | Home (`tracker.fleet_score_pct`), Exec View (tracker scorers), Deck Builder (slides 10/11) | Same scorers (`tracker-pptx.js`). |
| Per-site status | Home (RAG grid), IT Review (programme scoreboard + operational scoreboard), Exec View (exception list) | **Different questions**: Home = SLA RAG, IT Review = programme discipline (sbDims) and operational composite, Exec View = active MI / overdue backlog. Not interchangeable. |
| Major incidents | Home (window count), Scorecard (change & incidents tab), Exec View (active MIs), Deck Builder (slide 9) | Home/Deck = raised in the window; Exec View = open now — two populations by design. |
| Changes | Scorecard, IT Review helpdesk & changes panel, Deck Builder (slide 8), Exec View (upcoming) | Outcome classifier shared with the deck; IT Review uses a fixed 90-day window. |

## Proposal (PROPOSED — not decided)

| Page | Proposal | Why | Redirect if accepted | Condition before acting |
|---|---|---|---|---|
| Executive Home | **Keep** — the single "where are we" entry for executives | Registry-backed, dated, versioned, four-eyes publish | — | — |
| IT Review | **Keep** (distinct question: programme discipline) | Authoritative model of its author; fidelity-pinned | — | Author confirms it stays a separate page |
| Executive Scorecard | **Merge candidate** into Executive Home (KPI snapshot section) + keep the technician scorecard / customer voice tabs as drill pages | Its KPI tab repeats Home's questions with browser-side maths | `executive.html` → `dashboards.html?key=exec-home` (only the KPI tab) | 30 days of `page_viewed` by role; owner sign-off; parity test Home = Scorecard on the same month |
| Exec View (public) | **Keep** (different audience: no login) | Only surface for non-IT staff | — | — |
| Deck Builder | **Keep for now**; long-term question = Report Studio (G24) | Authoring tool, not a reading surface | — (decision G24 "Deck Builder vs Studio") | Separate decision |

## Who signs

The owners named above (to be confirmed) and the Product Owner. Until they sign, every page stays where it is and
this matrix is a working document. Signatures, dates and the final decision are written by people, not by an agent.
