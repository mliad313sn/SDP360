# 03 — Four-Phase Execution Roadmap

*Horizon: 12 months from kick-off. Each phase has an exit gate accepted by the Committee (02 §3.1). Items marked **✅** are delivered in this repository; **◐** means the foundation is in place and the remaining work is scoped.*

## Phase overview

| Phase | Theme | Duration | Exit gate (headline) |
|---|---|---|---|
| **P1** | Foundation & Sync | months 1–3 | all scheduled jobs on the sync runner, PG-only, CI-built releases, KPI dictionary v1 published |
| **P2** | Tracker & Dashboard Engine | months 3–6 | 2026 tracker runs on the engine; ≥ 3 self-service trackers and ≥ 5 dashboards published by non-developers |
| **P3** | Field Experience & Mobility | months 6–9 | inspections and tracker inputs captured offline on phones at ≥ 3 sites; weekly input ≤ 20 min |
| **P4** | Advanced Reporting & Automation | months 9–12 | scheduled executive pack with auto-summary; threshold alerts live; SLA cards ≤ 10 min fresh |

Dependencies run strictly forward (P2 needs P1's registry and site codes; P3 needs P2's engine for field dashboards; P4 needs P3's capture for complete data), but UI design for P3 starts during P2.

---

## Phase 1 — Foundation & Sync (months 1–3)

| # | Deliverable | Detail | Owner | Depends on | Status |
|---|---|---|---|---|---|
| P1-1 | **Generic sync runner** | lock · retry/back-off · transient classification · watermark · dedup · empty guard · run log · scrub | Architect | — | ✅ `services/sync/` + 17 tests |
| P1-2 | **Sync observability** | `sync_runs`, `/api/sync/runs`, `/api/sync/health`, `system_log` mirroring | Architect | P1-1 | ✅ `routes/sync.js` + smoke test |
| P1-3 | **Wire all jobs through the runner** | Zoho requests/changes/survey (delta via `deltaSince` on `Last Updated Time`), assets (upsert + guarded soft-delete), OpManager, Meraki (429 back-off), Teams SLA poll, pg_dump | Data Eng + Architect | P1-1 | ◐ — one job per sprint, requests first |
| P1-4 | **Canonical site registry** | close `site-registry.csv` gaps; load `site_module_codes` for tracker/assets/risk-register; delete `scoreboardAliases.js` hard-coded map and inspection aliases | Committee (DEC) + Data Eng | — | scoped |
| P1-5 | **Finish PostgreSQL cutover** | Assets → PG via hardened `copy-assets.js`; fix the 9 non-deterministic readers (explicit `ORDER BY` tie-breakers); nightly `pg_dump` through runner | Data Eng | P1-3 | scoped (runbook exists) |
| P1-6 | **Retire SQLite forks** | module by module after P1-5; SQLite kept for unit tests only | Architect | P1-5 | scoped |
| P1-7 | **Modular monolith** | extraction budget: ≥ 600 `server.js` lines per sprint into `routes/*`; one cron registry module | Architect | — | scoped (`routes/sync.js` is the pattern) |
| P1-8 | **Security hardening lot** | mandatory `SDP_CONFIG_KEY` + scrypt KDF + re-encrypt script; OpManager TLS verify; Meraki/OpManager keys out of URLs; constant-time key compare; replace `xlsx@0.18.5`; CSP without `'unsafe-inline'` on new pages | Architect | — | scoped |
| P1-9 | **CI & release packages** | GitHub Actions test on push ✅; release ZIP built by CI from a tag; frozen-lot register retired after first CI release | Architect | — | ◐ CI done |
| P1-10 | **House rules & ADRs** | extract binding rules from `CLAUDE.md` into `docs/sdp360/05` + `docs/adr/`; `CLAUDE.md` becomes a pointer + current-state page | Architect + BA | — | ◐ (SOP 05 §7 lists them) |
| P1-11 | **KPI dictionary v1** | register the existing KPIs (D1–D4, CSAT, WAN availability, scoreboard dims) in `metric_registry` with RAG policies from `kpi_rag_policies` | Committee + BA | registry tables ✅ | scoped |
| P1-12 | **Committee stood up** | charter ratified, seats filled, RFI intake live (`rfi_requests` ✅ table; Help page form) | Chair | — | scoped |

**Exit criteria:** 100 % of scheduled jobs visible in `/api/sync/health`; sync success ≥ 99 % over 4 weeks; zero SQLite in production; CI green on `main`; first CI-built release deployed; `metric_registry` ≥ 15 published KPIs; two Triage meetings held.

**Risks:** Zoho quota when moving requests to `*/30` (mitigation: delta apply only, monitor 8133 fallbacks); Windows native module rebuilds if Node version changes (mitigation: keep Node 22 LTS, installer pins).

---

## Phase 2 — Tracker & Dashboard Engine (months 3–6)

| # | Deliverable | Detail | Owner | Depends on | Status |
|---|---|---|---|---|---|
| P2-1 | **RAG policy convergence** | committee decision per 02 §6.5; modules read `kpiRag.POLICIES` loaded from `kpi_rag_policies`; delete duplicated bands in `tracker-pptx.js` | Committee + Architect | P1-11 | ◐ registry ✅ |
| P2-2 | **Tracker definition engine** | schema, validator, scorer, legacy importer | Architect | — | ✅ `services/trackerDefinitions.js` + 5 tests |
| P2-3 | **Tracker Builder UI** | create/edit definition (period kind, units, groups, items, KPI type, weights, targets), validate inline, dry-run score, submit for review → publish (versioned) | Front-end | P2-2, P1-4 | scoped (04 §3) |
| P2-4 | **Tracker runtime** | entry grid per unit × period, month lock, import from xlsx, bound items auto-filled from `source` readers (meetings, inspections, tickets) | Architect | P2-3 | scoped (04 §4) |
| P2-5 | **Migrate the 2026 IT Activity Tracker** | `fromLegacyInit()` → definition `it-activity-2026`; parallel-run one month; retire `tracker_*` tables after sign-off | Data Eng + Field | P2-4 | ◐ importer ✅ |
| P2-6 | **Metric registry API** | `GET /api/metrics/registry`, `GET /api/metrics/:key?site=&window=` dispatching to readers; reader contract | Architect | P1-11 | scoped (04 §5) |
| P2-7 | **Dashboard definition engine** | validator, grid rules, metric binding, field profile | Architect | — | ✅ `services/dashboardWidgets.js` + 4 tests |
| P2-8 | **Dashboard Builder & renderer** | drag-grid composer, widget catalogue, filters, preview per audience, publish (versioned); renderer on shared shell with Chart.js | Front-end | P2-6, P2-7 | scoped (04 §6) |
| P2-9 | **Standard templates** | tracker templates: field dispatch, hardware deployment, site maintenance, department meetings compliance; dashboard templates: site weekly, exec monthly, field daily | BA + Field | P2-3, P2-8 | scoped (05 + templates ✅) |
| P2-10 | **Engine ↔ exports** | PPTX/Excel generators read the same scorer and metric API (no second formula) | Architect | P2-4, P2-6 | scoped |

**Exit criteria:** ≥ 3 trackers and ≥ 5 dashboards created by committee members without developer help; 2026 tracker scores identical (±0.1 pp) between legacy engine and new engine over the parallel month; every published widget resolves to a registered metric; RAG scales reduced to ≤ 3 policies.

---

## Phase 3 — Field Experience & Mobility (months 6–9)

| # | Deliverable | Detail | Owner | Depends on |
|---|---|---|---|---|
| P3-1 | **Build step & field bundle** | esbuild for `public/field/` and the two React apps; end in-browser Babel | Architect | — |
| P3-2 | **Field PWA shell** | installable, service worker, IndexedDB outbox, "data as of" stamps, auth token refresh offline-aware | Front-end | P3-1 |
| P3-3 | **Offline inspection capture** | checklist, findings, photos (client compression ≤ 300 KB, chunked upload to blob store), signatures; idempotent `PUT /api/field/outbox/:uuid` | Front-end + Architect | P3-2 |
| P3-4 | **Offline tracker entry** | per-unit entry for the technician's site; month lock respected on sync | Front-end | P3-2, P2-4 |
| P3-5 | **Quick actions** | one tap: create SDP ticket from a finding (SDP API v3 write scope — new OAuth scope, CAB item), close/transfer an action with justification (`statusTransfer`) | Architect | P3-3 |
| P3-6 | **Low-bandwidth mode** | pre-aggregated site payloads, `audience: field` dashboards (≤ 8 widgets), image-free theme, 24 h read cache | Front-end | P2-8 |
| P3-7 | **`field-tech` role** | capture rights without report editing; scoped by `userSites` | Architect | — |
| P3-8 | **Pilot** | 3 sites, 6 weeks, field clinic every 2 weeks, RFIs captured | Field + Chair | all |

**Exit criteria:** inspection with 10 photos synced ≤ 2 min at 1 Mbit/s; zero data loss across connectivity drops in pilot; weekly site input ≤ 20 min measured at 3 sites; NPS from pilot technicians ≥ +30.

---

## Phase 4 — Advanced Reporting & Automation (months 9–12)

| # | Deliverable | Detail | Owner | Depends on |
|---|---|---|---|---|
| P4-1 | **Executive summary auto-generation** | templated narrative from metric deltas (fleet change > 1 pp, pillar > 3 pp, site ±10 pp rules inherited from `engine.js`), optional LLM polish behind `AI_PROVIDER` with human approval before send | BA + Architect | P2-6 |
| P4-2 | **Scheduled report packs** | site weekly, exec monthly as PDF + PPTX + CSV; schedules in `report_schedules`; sent through runner (visible in `sync_runs`) | Architect | P2-10 |
| P4-3 | **Threshold alert rules** | rule table (metric, site, comparator, threshold, cool-down, channel); Teams card + e-mail; reuse `teamsCard.js`; alerts for sync staleness, SLA breach, WAN down, tracker RED two months | Architect | P2-6, P1-2 |
| P4-4 | **Near-real-time SLA cards** | SDP API v3 delta poll every 5 min feeding open-ticket cards; CSV stays reporting source | Data Eng | P1-3 |
| P4-5 | **SharePoint / Teams embedding** | exec dashboard as embeddable read-only view (existing `exec/summary` pattern) | Front-end | P2-8 |
| P4-6 | **Resilience** | PG streaming replica, RPO 15 min; restore drill quarterly | Data Eng | P1-5 |
| P4-7 | **Analytics API & MCP server (optional)** | read-only metric API for Copilot Studio per `docs/integration/2026-09-01-itops-automation-roadmap.md` | Architect | P2-6 |

**Exit criteria:** monthly exec pack produced with zero manual data entry; ≥ 10 alert rules live with < 5 % false positives over a month; RPO 15 min demonstrated by drill.

---

## Cross-phase governance

- Every deliverable is an RFI or a `DEC-` decision; the Committee's monthly Review Board tracks this table.
- Definition of done for code: tests in CI, docs updated (`docs/sdp360` or ADR), house rules respected (05 §7), release note in `CHANGELOG.md`.
- Capacity assumption: 1 architect/lead dev full-time, 1 front-end developer from P2, data engineer 50 %, BA 30 %, two technicians 10 % each.
