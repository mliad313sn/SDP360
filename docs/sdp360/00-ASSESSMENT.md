# 00 — Assessment & Map of the Inherited Platform (`samaziz679/SDP-Dashboard` v1.11)

*Analysis date: 2026-10-19 · HEAD analysed: `e74d4cf` ("justification to cancel a report follow-up, Undo in the hub …") · Method: full read of code, schema, tests and the 6 166-line design log (`CLAUDE.md`); test suite executed on Linux/Node 22.*

## 1. Executive summary

The inherited repository is **not a dashboard but a 12-module operations platform** that grew by accretion over seven months for Endeavour Mining's West-African sites. It already contains most of the raw material the `/goal` asks for: an SDP mirror, native trackers, meetings and inspections, a reporting suite, RBAC with site scoping, PostgreSQL migration, PPTX/e-mail/Teams outputs and ~2 300 automated tests. What it lacks is **uniformity and governance**: five RAG scales, three site-code vocabularies, two storage back-ends in parallel, one 9 164-line `server.js`, no CI, no delta sync, no retry, no field/offline capability, and a design log that can only be read chronologically.

| Dimension | Verdict | Evidence |
|---|---|---|
| Functional breadth | **Strong** | 37 pages, 12 modules, 260+ API routes, 6 export engines |
| Test culture | **Strong** | 2 372 tests, 2 287 pass locally (3 fail: PowerShell-only and TZ-dependent) |
| Data integration | **Fragile** | full CSV re-download hourly, 1 retry (401 only), no overlap lock on 4 of 5 pollers, empty-fetch guard on assets only |
| Data model consistency | **Weak** | no cross-module FKs; sites matched by name/alias cascades; tracker codes ≠ registry codes |
| KPI governance | **Weak** | 5 RAG cut-off sets; 2 "boss's 6-dimension" models with different dimensions; anchor dates hard-coded (`2026-07-14`) |
| Field / mobile readiness | **Low** | no PWA, no offline queue, 100 MB JSON inspection uploads, desktop-density tables |
| Operability | **Medium** | PM2 + IIS + ZIP deploys with a `.git/last-deployed` marker and "frozen lots"; no CI; prod drifts from `main` |
| Security | **Medium** | hand-rolled session, rate limiter and CSP (`'unsafe-inline'`); secrets encryption opt-in; OpManager key in query string, TLS check off |

## 2. Platform map

### 2.1 Runtime topology

```
Browser (LAN / IIS 443) ──► IIS reverse proxy ──► Node/Express :3456 (PM2 "endeavour-dashboard")
                                                      │
        ┌───────────────┬───────────────┬─────────────┼─────────────┬───────────────┐
   reports-db.js   tracker-db.js   meetings-db.js  inspection-db.js  assets-db.js   services/*
   (8 394 lines)   (1 958)         (md_*)          (insp_*)          (sqlite only)
        │  sqlite OR pg (per-module env flag *_BACKEND)             │
        └───────────────┴───────► PostgreSQL 17 `sdp_dashboard` (table prefixes, no schemas) ◄──────┘
                                                      │
   cron (server.js:497-602) ──► Zoho Analytics Plus (CSV views) · SDP Cloud API v3 · OpManager REST · Meraki API · Meridian (dormant) · 4MyPeople
   outputs ──► pptxgenjs decks (6 generators) · python-pptx exec deck · nodemailer · SheetJS xlsx · Teams Adaptive Cards · SharePoint JSON
```

### 2.2 Modules and ownership of data

| Module | Pages | Primary tables | Data class | Notes |
|---|---|---|---|---|
| Helpdesk KPIs | `index`, `analytics`, `executive*`, `exec-view`, `it-review` | `request_records`, `change_records`, `cab_approvals`, `survey_*`, `sync_metadata` | Integrated (Zoho) | hourly full CSV; `_rawCache` in Node heap |
| Weekly / monthly site reports | `reports` (8 553 lines), `site-report` | `weeks`, `weekly_reports`, `monthly_reports`, `infra_kpis`, `lights`, `action_items` | Native | draft → submit → approve; action lineage/merge groups |
| Activity Tracker | `activity-tracker` (React in-browser Babel, 2 653-line `App.jsx`) | `tracker_*`, `tracker_*_v2`, `tracker_years/pillars/activities` | Native | 4 pillars × 31 activities × 11 sites; month lock; PPTX |
| Department meetings (PV) | 12 `meetings-*` pages | 18 `md_*` tables | Native | bilingual lookups; signatures; Business Incubation |
| Site inspections | `inspection*` | 10 `insp_*` tables | Native | base64 photos inline; 100 MB body limit |
| Site Actions Register | `site-actions`, `site-awareness` | none (pure merge of meetings + inspection + reports) | Derived | `services/siteActionsRegister.js` |
| Assets | `assets`, `assets-finance`, `assets-hygiene` | 12 asset tables (**still SQLite**) | Integrated (Zoho) + native reconcile decisions | daily full replace with guards |
| Infra / WAN | `infra-health`, `wan`, `wan-health`, `wan-sla` | `infra_metric_snapshots`, `wan_link_snapshots`, `wan_outages`, `wan_subsite_networks` | Integrated (OpManager, Meraki) | SLA & ISP chargeback engine |
| Teams SLA alerts | admin tab | `sla_alert_log` | Integrated (SDP API v3) | only job with an overlap lock |
| Roadmap Manager | `itsm-roadmap` | `roadmap_*` | Native, per-user | super_admin only |
| Risk Register | admin + Excel | `rr_site_aliases`, config | Derived from SDP | monthly Excel |
| System Logs / Admin | `system-logs`, `reports#admin` | `system_log`, `users`, `user_roles`, `user_sites`, `sessions`, `report_config` | Native | SSO Entra, encrypted secrets |

### 2.3 Integration inventory (from `server.js`, `zoho-sync.js`, `assets-sync.js`, `services/*Client.js`)

| Source | Protocol / auth | Schedule | Mode | Retry | Overlap lock | Dedup key | Error sink |
|---|---|---|---|---|---|---|---|
| Zoho Analytics Plus — requests | OAuth refresh → CSV export | `45 * * * *` | full download, client-side "changed since" filter | 1 (401 only), async bulk fallback on 8133 | **none** | `request_id` ON CONFLICT | `sync_metadata.last_error`, console |
| Zoho — changes / CAB / survey | same | `30 * * * *`, `0 * * * *` | full, reconcile every 4th run | same | none | `change_id` UNIQUE | same |
| Zoho — assets (6 views) | same | `30 4 * * *` | DELETE + INSERT per view | none | none | PK per view; rows without PK dropped | same |
| SDP Cloud API v3 | `Zoho-oauthtoken`, scope `SDPOnDemand.requests.READ` | `*/5` | paged list (≤ 50 pages) | none (400 → drop filter) | `_running` flag | `(request_id, kind)` | `teams_sla_last_run` |
| OpManager | REST apiKey **in query string**, `rejectUnauthorized:false` | `10 5 * * *` | snapshot upsert | none | none | `(device, week)` | console |
| Meraki | `X-Cisco-Meraki-API-Key` | `20 5`, `25 5`, `*/5` (3 h lookback) | snapshot + event paging (≤ 200 pages) | none, **no 429 handling** | none | `upsertWanOutage` | console |
| Meridian (dormant) | API keys in `report_config` | `0 5 * * *` out; inbound `/api/actions/open` | push upsert | none | n/a | `"source:id"` | console |
| 4MyPeople | `X-API-Key`, 8 s timeout | on demand | live read | none → returns `[]` | n/a | n/a | console |

### 2.4 Front-end & field readiness

- 37 single-file pages, plain HTML/JS, Chart.js 4.4; React only for the tracker and a prototype, compiled **in the browser by Babel** (no build step).
- 33/37 pages carry a viewport meta, 30 files have `@media` rules → "responsive in places". **No** manifest, service worker, offline queue, background sync or touch-first forms. `localStorage` is used in 25 pages for presets/tokens only.
- Shared shell (`_shell.js`, `_tokens.css`, `module-tabs.js`) and a real brand token set (`public/brand`, 20 design-system specimen pages) exist and are the right base for the field UI.

### 2.5 RBAC

Role ladder `super_admin > executive > admin > editor > viewer` plus feature roles (`tracker-admin`, `tracker-editor`, `report-author`, `audit-viewer`, `scorecard-viewer`, `site-business`, `group-business`). Primary site in `users.site_id`, extra sites in `user_sites`; all scope checks must go through `services/userSites.js` (`hasSite`, `inScope`). 25 site coordinators are `editor` locked to their site (since 2026-10-02). Admin settings are `super_admin` only. SSO: hand-rolled Entra OIDC with PKCE.

## 3. Findings (ranked)

### F1 — No real delta, no uniform retry, one empty-fetch guard (critical for Phase 1)
Every hourly job re-downloads the full view ("CSV export has no server-side date filter", `zoho-sync.js:10`); deletions are detected by diffing the live-ID set, so **a truncated CSV would cascade into mass deletes** of `request_records` (only assets has the 0-row guard, `assets-sync.js:41-46`). Retry exists once, on 401. Meraki has no 429 handling although Meraki rate-limits. Only `poll-sla.js` prevents overlapping runs. **Fixed in this fork:** `services/sync/syncRunner.js` (lock, back-off, classification, delta helper, empty guard, dedup, run log) — jobs still need to be wired through it (roadmap P1-3).

### F2 — Sync failures are invisible
Failures reach `sync_metadata.last_error` and PM2 console only; nothing in `system_log`; no alert. Meraki/OpManager/Meridian keep no run state. **Fixed in this fork:** run log `sync_runs` + `/api/sync/runs|health` + `system_log` mirroring.

### F3 — Five RAG scales and two "6-dimension" models
`engine.js` 90/75, exec summary 70/50, `siteScore.js` & `deckGovernanceV2.js` 70/45 (with different dimensions and thresholds: reviews ≥ 8/5 vs meetings ≥ 8/6, inspections ≥ 3 vs ≥ 4, sign-off amber 30 vs 40), `siteComposite.js` & `siteScoreboard.js` 75/55; tracker RAG duplicated in `tracker-pptx.js` ("edit both"); anchor date `2026-07-14` hard-coded in composite and deck v2. **Fixed in this fork (foundation):** `services/kpiRag.js` registry + `kpi_rag_policies` table; convergence is a committee decision (02 §6, 03 P2-1).

### F4 — Three site-code vocabularies
Tracker `ITY/KLN/EDV/TND/EXP`, registry `SMI/KGO/OUA/TANDA/EXPLO`, inspections bridge with aliases; `scoreboardAliases.js` hard-codes accent-folded asset labels; `site-registry.csv` still has "A CONFIRMER" cells; open question whether Massawa is a site. No FK joins across modules; `siteResolve.js` tries name → UPPER → zoho_group tokens and returns `null` ("non applicable") on miss. → Unified `sites` + `site_module_codes` as the single key (01 §4.2, 03 P1-4).

### F5 — Dual back-end, half-finished cutover
Every `*-db.js` keeps the SQLite path "byte-for-byte" next to a PG fork; Assets is still SQLite; 9 KPI readers have non-deterministic tie ordering between engines (`PG_CUTOVER_RUNBOOK.md`); `pg_dump` schedule not done; stale architecture docs still describe 4 SQLite files. → P1-5 finish cutover, P1-6 retire SQLite forks module by module.

### F6 — Monolith and in-browser compilation
`server.js` 9 164 lines (260+ routes; 7 modules extracted), `reports-db.js` 8 394, `reports.html` 8 553, `App.jsx` 2 653 compiled by Babel in the browser. No lint, no CI (fixed: `.github/workflows/ci.yml`). → P1-7 extraction budget per sprint; P3 build step for field bundle.

### F7 — Tracker is one hard-coded programme
Only one tracker instance; 12-month year; pillar codes must match `/^P\d+-/`; 6 KPI types as if/else; grace day 5 fixed; palette and short-names in code; COUNT activities ("Monthly Department Meeting", "Monthly Inspection") typed by hand although the meetings and inspection modules already count them. **Fixed in this fork (foundation):** `services/trackerDefinitions.js` + `002_tracker_definitions.sql`; builder UI and data-source binding in P2.

### F8 — Field/mobile gap
See §2.4. Mine sites run on 3G/VSAT; the inspection form posts up to 100 MB JSON in one request and inlines base64 photos in PG. → P3 (PWA shell, chunked uploads, offline queue, low-bandwidth mode).

### F9 — Security hardening list
`'unsafe-inline'` CSP, hand-rolled rate limiter (in-memory per process), secrets encryption opt-in (plaintext without `SDP_CONFIG_KEY`), SHA-256 without KDF for the key, OpManager key in URL + `rejectUnauthorized:false`, Meridian key compared with `!==`, SheetJS `xlsx@0.18.5` (unmaintained on npm). → P1-8 hardening lot.

### F10 — Deployment drift
ZIP + `.git/last-deployed` marker; "frozen lots" deliberately held behind the marker and packaged by hand; installer safety work not in prod. → P1-9 versioned release packages built by CI; frozen-lot register stays until the first CI-built release.

### F11 — Operational knowledge locked in a chronological log
`CLAUDE.md` (6 166 lines, FR/EN) is the only place many rules live ("never `site_id ===`", "upsert by id, never delete + reinsert", "recompute from counters, never average scores", transfer statuses need a justification…). → extract into `docs/sdp360/05` house rules + ADRs (P1-10).

## 4. Strengths to preserve

- Test-first culture with golden fixtures (`tests/__golden__`), smoke suites per route family, fidelity "oracle" tests against the boss's spreadsheet.
- Idempotent, per-module PG DDL (`db/postgres/**`), `IF NOT EXISTS` everywhere, identity columns.
- Server-enforced site scoping (`userSites.js`), encrypted secrets in `report_config`, write-only secret endpoints.
- Deliberate ITSM formula divergences documented (`FORMULA_RECONCILIATION.md` D1–D4) — a ready-made first entry for the KPI dictionary.
- Brand token system and design-system specimens — the field UI should be built on them, not beside them.
- Real governance artefacts already exist: ITIL-style change request (`CHANGE_REQUEST_HTTPS_LOGIN.md`, CAB sign-off), rollout/backout checklist, FMEA audit with a `/goal` library G-01…G-12, `site-registry.csv`.

## 5. Baseline measurements (this fork, 2026-10-19)

| Measure | Value |
|---|---|
| Tests (sqlite, Linux) | 2 372 total · 2 287 pass · 3 fail (PowerShell `Check-FrozenLots` ×3 need `pwsh`; `2026-W03` and pptx-timeout tests depend on local TZ/pptx timing) · 97 skipped (PG) |
| Tests added by SDP360 | 35 (sync runner 14, sync store 3, kpiRag 5, tracker definitions 5, dashboard widgets 4, sync routes smoke 4) |
| `server.js` | 9 166 lines, 2 added |
| Root-level one-off scripts | 30 → 5 (25 moved to `ops/legacy-scripts/`) |
| CI | none → GitHub Actions on every push |
