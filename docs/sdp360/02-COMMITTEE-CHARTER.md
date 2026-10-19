# 02 — IT Ops Expert Review Committee: Charter & Operational Review Framework

*Status: v1 draft for ratification at the committee's first session. Changes to this charter are themselves RFIs of kind `governance`.*

## 1. Purpose

The **IT Ops Expert Review Committee** ("the Committee") owns *what SDP360 measures and how it is shown*. It decides which KPIs exist and how they are defined, which trackers and dashboards are published, and in what order improvement requests are delivered. It does **not** manage the delivery team's sprint, write code or approve production deployments (that remains the CAB's role, per the existing change process in `docs/CHANGE_REQUEST_HTTPS_LOGIN.md`).

## 2. Scope

| In scope | Out of scope |
|---|---|
| KPI dictionary: definitions, formulas, windows, RAG policies (`metric_registry`, `kpi_rag_policies`) | SDP configuration (categories, SLAs inside ServiceDesk Plus) |
| Tracker definitions and their publication status | Individual ticket handling |
| Dashboard definitions (site, executive, field) | Infrastructure changes (CAB) |
| Request for Improvement (RFI) triage and prioritisation | Vendor contracts, licences |
| Site code registry (`sites`, `site_module_codes`) | HR / people data (4MyPeople) |
| Data-quality rules and reconciliation thresholds | Security incidents (CSIRT process) |
| Acceptance of each roadmap phase's exit criteria | Budget approval (sponsor) |

## 3. Composition and roles

| Seat | Count | Who (profile) | Accountable for |
|---|---|---|---|
| **Chair** — IT Ops Lead (Service & Support Manager) | 1 | owner of IT operations across sites | agenda, decisions, tie-break, escalation to sponsor |
| **Data Engineer / DBA** | 1 | PostgreSQL + sync owner | data model, sync health, formula implementability, data-quality rulings |
| **System Architect / Lead Developer** | 1 | platform code owner | feasibility, effort sizing, technical debt, security |
| **Field Technicians** | 2 (rotating per semester, different sites) | site IT technicians / coordinators | field reality, usability, time-to-report, offline needs |
| **Business Analyst / Reporting** | 1 | executive reporting owner | KPI relevance, executive deck fidelity, SOP compliance |
| **Business Stakeholder** (site GM delegate or Business Partner) | 1 | consumer of site dashboards | business value, department engagement |
| **Secretary** (non-voting) | 1 | PMO / analyst | minutes, RFI register upkeep, action follow-up |

Quorum: Chair (or delegate) + Data Engineer + at least one Field Technician + 1 other voting seat. Decisions by consensus; failing that, simple majority with the Chair's casting vote. Any member may request that a decision be recorded as *dissent noted*.

### 3.1 Decision authority (RACI)

| Decision | Chair | Data Eng | Architect | Field Tech | BA | Business | Sponsor |
|---|---|---|---|---|---|---|---|
| Add / change KPI definition or RAG policy | A | R | C | C | R | C | I |
| Publish / retire a tracker | A | C | C | R | C | C | I |
| Publish / retire a dashboard | A | C | C | R (field) | R (exec) | C | I |
| RFI prioritisation (quarter plan) | A | C | R (effort) | C | C | C | I |
| Site registry change | A | R | C | C | I | C | I |
| Phase exit acceptance | R | R | R | R | R | C | **A** |
| Charter change | R | C | C | C | C | C | **A** |

## 4. Cadence

| Meeting | Frequency | Duration | Agenda |
|---|---|---|---|
| **Triage** | bi-weekly (odd weeks, Tuesday) | 45 min | new RFIs → score, accept/defer/reject; sync-health review (`/api/sync/health`); data-quality exceptions |
| **Review Board** | monthly (first Thursday) | 90 min | KPI dictionary changes; tracker/dashboard publications; roadmap progress vs exit criteria; metrics of the committee itself (§8) |
| **Quarterly Planning** | quarterly | half-day | RFI backlog ranking for the quarter; phase gate; charter review |
| **Field clinic** | monthly, on a site (rotating), may be remote | 60 min | technicians demo pain points; outputs become RFIs |

Minutes use `templates/REVIEW-MINUTES-TEMPLATE.md`, are stored under `docs/sdp360/minutes/YYYY-MM-DD-<meeting>.md`, and every decision carries an id `DEC-YYYY-NNN` referenced by the implementing commit or RFI.

## 5. Request for Improvement (RFI) workflow

Any user may submit an RFI from the platform (Help ▸ "Request an improvement", stored in `rfi_requests`) or with `templates/RFI-TEMPLATE.md`. Kinds: `tracker`, `widget`, `metric`, `integration`, `ux`, `data-quality`, `governance`.

```
submitted ──► triaged (scored, §6.1) ──┬──► accepted ──► scheduled (quarter/sprint) ──► delivered ──► verified by requester
                                       ├──► deferred (re-triaged next quarter)
                                       └──► rejected (reason recorded, requester informed)
```

Service levels: acknowledgement ≤ 2 working days (Secretary); triage at the next Triage meeting (≤ 14 days); requester informed of the decision ≤ 3 days after. A delivered RFI is closed only when the requester confirms on the platform (`verified`).

Fast lane: a `data-quality` RFI reporting a wrong number on a published dashboard is triaged within 2 working days by Chair + Data Engineer, and the affected widget shows a "under review" badge until resolved.

## 6. Evaluation criteria

### 6.1 RFI scoring rubric (1–3 each; priority = Impact × Reach ÷ Effort, data-risk as a gate)

| Criterion | 1 | 2 | 3 |
|---|---|---|---|
| **Impact** | convenience | saves ≥ 1 h/week per site or removes a manual re-keying | changes a decision executives take, or removes a compliance gap |
| **Reach** | one site / one role | several sites or one whole role | all sites or executive level |
| **Effort** (Architect) | ≤ 2 days, configuration or definition only | ≤ 2 weeks, one module | > 2 weeks or cross-module / new integration |
| **Data risk** (Data Eng) — gate | uses registered metrics only | needs a new reader on existing data | needs a new source, PII, or changes a published definition |

A data-risk 3 RFI cannot be `accepted` without a written data note from the Data Engineer (source, key, refresh, PII). Ties are broken in favour of field-originated RFIs.

### 6.2 KPI definition standard (every row of `metric_registry` must pass)

| Attribute | Rule |
|---|---|
| **Key** | `module.measure_unit` (e.g. `helpdesk.resolution_sla_pct`); immutable once published; deprecate + new key instead of redefining |
| **Formula** | numerator and denominator spelled out in words; counters named with their source column; divergence from the ITSM tool's own figure explicitly documented (as `FORMULA_RECONCILIATION.md` D1–D4 already does) |
| **Window** | one of `week` (ISO, Mon–Sun), `month` (calendar), `rolling13w`, `rolling3m`, `ytd`; no hard-coded anchor dates (removes the `2026-07-14` anchors) |
| **Aggregation** | from counters (G4); site → fleet by re-summing, never by averaging site percentages |
| **RAG policy** | reference to `kpi_rag_policies`; direction (higher/lower is better) stated |
| **Not-applicable rule** | what renders when the denominator is 0 or the source never synced (G5) |
| **Owner & RFI** | committee seat accountable; approving `DEC-` id |
| **Test** | at least one fidelity test with a fixture the owner signed off |

### 6.3 Tracker acceptance criteria (before `published`)

1. Definition validates (`trackerDefinitions.validate` → `ok`), group weights sum to 1, every item has a KPI type from the registry.
2. Every item that *can* be fed from platform data (meetings held, inspections done, tickets closed…) is bound to a `source` — hand-typed counts are the exception and need a justification.
3. Targets set for every active unit; the unit list uses canonical site codes.
4. A dry-run month was scored and reviewed by at least one Field Technician and the Business Analyst.
5. RAG policy named; if different from `tracker-activity`, the difference is justified in the RFI.
6. Month-lock / grace rules declared (default: current month + previous until the 5th).

### 6.4 Dashboard acceptance criteria

1. `validateDashboard` → `ok` against the live metric registry (no unknown metric, no raw SQL, no overlaps).
2. Audience declared; `field` dashboards pass `fieldReadiness`.
3. Every KPI widget names its RAG policy and window in its subtitle (SOP 05 §4).
4. Reviewed on the target device class (desktop 1366 px; phone 360 px for field) with screenshots attached to the RFI.
5. Owner and review date set; dashboards are re-certified every 6 months or retired.

### 6.5 Converging the inherited RAG scales (first Review Board agenda item)

| Policy today | Used by | Proposal for the committee |
|---|---|---|
| `tracker-activity` 90/75 (ratio) | activity tracker items, PPTX | keep as **activity attainment** policy |
| `tracker-executive` 70/50 | tracker executive bands | **retire**; unit-level roll-up uses `site-score` scale after ×100 |
| `site-score` 70/45 (points) | site scoreboard 6-dim, deck v2 | keep as **governance score** policy; align the two 6-dimension models' thresholds (reviews 8/6, inspections 4/2, overdue 0/4, sign-off 70/40) |
| `site-composite` 75/55 | composite, ops scoreboard | **merge into `site-score`** unless BA shows the 5-point difference changes an executive decision |
| `sla-percent` 90/70 | CSAT, SLA cards | keep for percentage SLAs |

## 7. Standardising metrics across mining / field sites

- **One registry, site filter, no per-site formulas.** Differences between sites are expressed by *targets* (per-unit targets in trackers, SLA targets per circuit) — never by a different formula.
- **Site registry is canonical** (`sites`, `site_module_codes`); the committee closes the open cells of `docs/integration/site-registry.csv` at its first Review Board (incl. the Massawa question) and the tracker codes are mapped (`ITY→SMI`, `KLN→KGO`, `EDV→OUA`, `TND→TANDA`, `EXP→EXPLO`) through the table, not through code aliases.
- **Service calendars**: SLA windows per site (shift pattern, time zone) live in `report_config` and are read by the WAN SLA and ticket SLA readers alike.
- **"Not applicable" is a first-class state** for a site without the capability (e.g. no Meraki uplink).

## 8. The committee measures itself

| Measure | Target | Source |
|---|---|---|
| RFI acknowledgement time | ≤ 2 working days | `rfi_requests.created_at` → first status change |
| RFIs triaged within 14 days | ≥ 90 % | register |
| Delivered RFIs verified by requester within 30 days | ≥ 80 % | register |
| Published KPIs with complete definition (§6.2) | 100 % | `metric_registry` audit |
| Dashboards re-certified on time | 100 % | `dashboard_definitions.updated_at` |
| Field-originated share of accepted RFIs | ≥ 40 % | register |

## 9. Escalation

Disagreements the Committee cannot resolve in two consecutive meetings go to the Sponsor (CIO / Group IT Director) with a one-page brief (options, recommendation, dissent). Anything touching production deployment follows the CAB.
