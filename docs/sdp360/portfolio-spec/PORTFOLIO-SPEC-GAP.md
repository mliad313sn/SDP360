# Gap analysis — IT Portfolio Reconstruction Spec vs SDP360 native PPM

- **Spec:** `docs/sdp360/portfolio-spec/IT-PORTFOLIO-RECONSTRUCTION-SPEC.md` (1,432 lines, §1–§38)
- **Code read:** SDP360 trunk at `637124cc` (read-only; nothing edited). Files: `routes/governance*.js`, `routes/ppm*.js`,
  `services/governanceStore.js`, `services/ppm/*`, `services/ppmAlerts.js`, `services/portfolio*.js`,
  `services/projectSchedule.js`, `public/portfolio.html`, `public/project.html`, `public/lib/{ganttV2,portfolioViews,ppmVisuals}.js`,
  `db/postgres/reports/{016,018,019,021,039,043,044,045,052,056,070,071,072,073,081,085,091,092,093,095,101,102,105,108,110,112}_*.sql`,
  `docs/agent-execution/P04-ppm-certification.md`, `docs/ops/FLAG-REGISTER.json`, `docs/ops/switch-lots.json`.
- **Author:** Claude (AI) — an AI review, **not an independent review, not a PMO sign-off**. Line numbers are first-line
  greps at `637124cc`; another agent is editing PPM files in a separate worktree, so lines may drift.
- **Status vocabulary:** `PRESENT live` = default-on today · `PRESENT (switch: x)` = built, behind a `report_config`
  switch defaulting `0` · `PARTIAL` = exists but materially incomplete vs the requirement · `MISSING` = nothing.
- **Facts vs assumptions:** every PRESENT/PARTIAL row cites code. "Proven by test" is NOT claimed here except where
  P04 already cites the test. Where the spec states business policy (priority meaning, risk levels, DQ RAG bands,
  effort weights), it is marked **POLICY → PROPOSED** — the code may carry it as a proposal, never as approved.

## Key structural facts (read first)

1. **Data model.** One `portfolio_projects` row per project (`018_governance.sql:27`), hung under
   programme → objective (`objective_id NOT NULL`). Columns today: `key` (UNIQUE, **typed by the user**), `name`, `owner`,
   `site_id`, `start_date`/`end_date` (TEXT, validated `YYYY-MM-DD`), `baseline_*`, `forecast_end`, `actual_*`, `status`,
   `stage`, `confidence`, `progress_pct`, `budget`, `spent`, `currency`, `currency_defaulted`, `spend_type`, `charter`,
   `sponsor`, `depends_on` (JSON id list), `sensitive`, `finish_deadline`, `rfi_id`, `version`, soft-delete stamps.
   **None of these exist:** project_ref (PRJ-YYYY-NNN), project_type, priority, IT owner vs delivery lead, business value
   (separate field), indicative quarter, schedule confidence, budget status/approval/reference, FX rate on the project,
   decision required, delivery effort, FTE, workload notes, tags.
2. **Intake** exists as the RFI register (`rfi_requests`, `016_dashboard_definitions.sql:45`; `RFI-YYYY-NNN` from
   `governanceStore.nextRef` `:73`), converted to a project by `rfiToProject` (`governanceStore.js:936`). It is a generic
   request register (kinds tracker/widget/metric/…/governance), not the spec's structured project intake.
3. **Who writes:** project creation/edit = committee (admin tier + committee-member) only (`routes/governance.js:667`,
   `requireCommittee :67`); site editors may write the *plan* only behind `portfolio_editor_plan_writes`
   (switch-lots flags this as HIGH risk, access-policy owner decision).
4. **Engine** (CPM, calendars, resources, EVM, gates, RAID, RAG, DCMA) is strong but mostly OFF — see P04 §3 (35 live /
   42 OFF / 53 partial / 11 missing of 141 W0 items). The spec is a **portfolio-intake & governance** spec, which is
   where SDP360 is thinnest.

---

## §4 Instructions and user guidance

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 4.1 | Field-level guidance (what, why, good example, mistake, required/recommended/automatic) per field | MISSING | — (`public/project.html` has labels/placeholders only, e.g. `portfolio.html:104` status placeholder) | No field catalogue, no help text model. |
| 4.2 | Contextual help icon per field (definition, why, example, mistakes, level of detail) | MISSING | — | No help icon/popover; `help.html` is a module manual, not field help. |
| 4.3 | Pre-submission checklist (16 items: problem, value, sponsor, IT owner, priority, dates, budget, budget status, deps, risks, decision, status, effort, resources, risk exposure, delivery lead) | PARTIAL | `services/projectSchedule.js:170` `stageGate` (charter ≥20 chars before approval; sponsor + start/end/baseline before in_progress); `services/ppm/gateChecklist.js` + `110_ppm_governance_w3.sql` (configurable checklist, switch `ppm_gate_checklist_enabled`) | Built-in gate checks cover 3 of 16 items; the configurable checklist could carry the rest but has no field-bound items (manual ticks/evidence), and most fields do not exist. |

## §5 Project intake and register

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 5.0 | One structured record per project | PRESENT live | `018_governance.sql:27`; `governanceStore.js:483` TABLES.project | Record exists; most spec fields absent (see §6–§18). |
| 5.1a | Project ID `PRJ-{YEAR}-{SEQ}` backend-generated | MISSING | `governanceStore.js:483` (`key` in `req`, typed by user, `portfolio.html:103`) | `nextRef` (`:73`) generates DEC-/RFI- refs but not project refs. |
| 5.1b | ID unique | PRESENT live | `018_governance.sql:28` `key TEXT UNIQUE`; dup → 409 (`governanceStore.js` upsert, UAT-F) | Uniqueness holds for the typed key. |
| 5.1c | ID immutable | PARTIAL | internal `id` is an IDENTITY; `key` is in the editable `cols` (`governanceStore.js:485`), no freeze | Human-facing key can be renamed at any time; only the numeric id is stable. |
| 5.1d | Independent of sorting / filtering / deletion / row position | PRESENT live | IDENTITY id + soft delete (`052_portfolio_soft_delete.sql`); all relations use `project_id` | Holds for `id`; `nextRef` (max+1 over LIKE) would reuse a number after a purge — not safe for an immutable public ID. |
| 5.2a | Site / Office from a controlled list | PRESENT live | `portfolio_projects.site_id` → `sites` registry | Values come from the sites registry, not the spec's hard list (correct per project rules). "Group / Multi-site" = `site_id NULL` by convention only. |
| 5.2b | One primary site + affected sites (multi-value) | PRESENT live | `043_portfolio_scope.sql` `portfolio_project_sites`; `governanceStore.js:422` setProjectSites; route `governance.js:663` (committee) | — |

## §6 Classification

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 6.1 | Project Type (8 controlled values, one dominant) | MISSING | — | No column, no lookup. |
| 6.2 | Optional secondary tags | MISSING | — | No tag model on projects. |

## §7 Business case

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 7.1 | Business need/problem, structured (current situation, impact, problem, required outcome) | PARTIAL | `charter` accepts a structured JSON object (objective, scope_in/out, benefits, success, constraints) — `projectSchedule.js:118` charterText; `rfi_requests.problem` (`016:50`) | Charter fields differ from the spec's 4-part structure; no dedicated "problem" field on the project (RFI problem is copied into charter text at conversion, `governanceStore.js:942`). |
| 7.2 | Expected business value separate from the problem | PARTIAL | `portfolio_benefits` (`056_portfolio_benefits.sql`) — measure, baseline/target, owner, review date, realised + independent verification (`governanceStore.js:697,718`) | Measurable benefits exist and are separate (good), but no headline "expected value" text and no value category (downtime, safety, cost avoidance…) — `value_class` exists behind `benefit_value_class_enabled`. |
| 7.3 | Discourage vague value text ("Improve IT") | MISSING | — | No validation/guidance (falls under §4/§20). |

## §8 Ownership

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 8.1 | Business Sponsor | PRESENT live | `portfolio_projects.sponsor` (`039:6`); required at approval gate (`projectSchedule.js:178`); frozen once approved (`governanceStore.js:641`) | Free text, not a user link. |
| 8.2 | IT Owner | PARTIAL | `portfolio_projects.owner` (`018:28`), frozen after proposal (`governanceStore.js:641`) | The single `owner` field is the de-facto IT owner; not labelled as such. |
| 8.3 | Delivery Lead | MISSING | — (team members with free `role`, `085_ppm_workbench.sql`, switch `ppm_project_team_enabled`; project role `pm`, `108`, switch `ppm_project_roles_enabled`) | No delivery-lead field; a team member with role "pm" is the nearest, both OFF. |
| 8.4 | Sponsor ≠ IT Owner ≠ Delivery Lead | PARTIAL | SoD: owner cannot approve own project (`projectSchedule.js:180` GATE_SOD) | No check that sponsor ≠ owner ≠ delivery lead. |

## §9 Priority

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 9.1 | Priority Critical/High/Medium/Low | MISSING | (RFI has impact/effort/data_risk 1–3 + score `governanceStore.js:278`; task leveling priority 0–1000 `105`) | No project priority. **POLICY → PROPOSED** for the meaning of each level. |
| 9.2 | Suggested interpretation per level | MISSING | — | Business policy; ship as PROPOSED guidance text only. |

## §10 Schedule

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 10.1 | Planned Start / Planned End | PRESENT live | `start_date`, `end_date` (`018:29`) | Stored as TEXT (validated, not a DATE column). |
| 10.2 | Duration = End − Start + 1 (calculated) | PARTIAL | task-level `duration_days` + engine (`services/ppm/scheduleEngine.js`); project gantt rows (`portfolioEvidence.js:36`) | No calculated calendar-day project duration exposed per the spec formula. |
| 10.3 | Block Start > End | PRESENT live | `services/ppm/planIntegrity.js:62,75` DATE_ORDER, checked on every project write (`governanceStore.js:589` → `_integrityCheck`) | — (same-day allowed, consistent with spec's +1). |
| 10.4 | No quarters/TBC in date fields | PRESENT live | `planIntegrity.js` DATE_INVALID; `_day` (`governanceStore.js:45`) | Refused correctly — but there is nowhere else to put the information (10.5). |
| 10.5 | Separate indicative quarter + schedule confidence | PARTIAL | `confidence` low/medium/high (`018:29`, `governanceStore.js:17`) | Generic project confidence exists; no indicative-quarter field; confidence not explicitly "schedule" confidence. |
| 10.6 | "Schedule not baselined" display when dates invalid/absent (§31.4) | PARTIAL | null dates never computed as overdue (`ppmAlerts.js:2`); engine returns null on cycle/range (`projectSchedule.js:194`) | No explicit "Schedule not baselined" label on the portfolio roadmap. |

## §11 Budget

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 11.1 | Estimated budget (numeric) | PRESENT live | `budget NUMERIC` (`018:29`); positive-number check (`governanceStore.js:521`); null = unknown ("—", `portfolio.html:217`) | — |
| 11.2 | Currency | PRESENT live | `currency` ISO-validated (`governanceStore.js:520`); `currency_defaulted` flag (`081`), refusal behind `finance_currency_required` | — |
| 11.3 | Budget status (Approved / Requested / Not budgeted / TBC) | MISSING | — | No column. |
| 11.4 | Original amount/currency, exchange rate, base currency, base amount, rate date | PARTIAL | `fx_rates` table (`095_fx_rates_actuals_import.sql`, rates vs USD, effective_from); per-currency rollup never adds currencies (`portfolioEvidence.js:81`) | No per-project stored rate/base amount/rate date; conversion of project budgets to a base currency not implemented (and needs Finance-certified rates). |
| 11.5 | Budget approval date, budget reference | MISSING | (finance certifications `094`, switch `finance_certification_enabled`, not project-budget approvals) | No fields. |
| 11.6 | Time-phased budget | PRESENT (switch: ppm_budget_periods_enabled) | `072_ppm_budget_periods.sql`, `routes/governancePpm.js:63` | Beyond spec; OFF. |

## §12 Dependencies

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 12.1 | Project A → depends on → Project B (relational) | PARTIAL | `portfolio_projects.depends_on` JSON id list, existence + cycle check (`governanceStore.js:597` → `projectSchedule.dependencyProblem`) | JSON column, no link table / FK (P04 ARCH-5 same pattern for tasks). |
| 12.2 | Dependency categories (procurement, power, connectivity, HSE approval, vendor…) | MISSING | (`ppm_raid_details.dependency_ref` free text, `110`, switch `ppm_raid_enabled`) | No external-dependency entity or category list. |
| 12.3 | Per dependency: owner, status, target date, criticality | MISSING | — | Not modelled. |
| 12.4 | "No known dependency" as a distinct state | MISSING | — | Empty list = unknown or none, indistinguishable. |

## §13 Risk management

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 13.1 | Risk description + mitigation | PRESENT live | `portfolio_risks` title/mitigation/owner/status (`018:38`), RAID kind (`044`) | — |
| 13.2 | Risk exposure Critical/High/Medium/Low | PARTIAL | probability 1–3 × impact 1–3, severity high ≥6 / medium ≥3 / low (`portfolioEvidence.js:56`) | 3 levels, no "Critical"; thresholds hard-coded. **POLICY → PROPOSED** (risk level definitions). |
| 13.3 | Project-level risk exposure field | MISSING | — | Only per-risk; no rolled-up project exposure. |
| 13.4 | Structured: impact, likelihood, exposure, mitigation, owner | PRESENT live | `portfolio_risks` + `riskView` exposure | — |
| 13.5 | Due date, residual risk, status | PARTIAL | status live; `review_date`, `response`, `probability_pct`, `impact_amount` in `ppm_raid_details` (`110`, switch `ppm_raid_enabled`) | No residual risk; due date only as review date (OFF). |
| 13.6 | "No identified risk" distinct state | MISSING | — | Absence of rows = unknown. |

## §14 Decision management

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 14.1 | Decision required Yes/No/TBC on project | MISSING | — | No field. |
| 14.2 | Decision record: description, owner, due date, status | PRESENT live | `decisions` table DEC-YYYY-NNN (`018:14`, `governanceStore.js:211`), routes `governance.js:438,471` | — |
| 14.3 | Decision authority, outcome, decision date | PARTIAL | `closed_at`, proposal/approval of status changes (`governanceStore.js:229,255`) | No authority / outcome fields. |
| 14.4 | Link decision ↔ project | PARTIAL | `decisions.source_kind/source_ref` free text (`governanceStore.js:219`) | No `project` source kind enforced, no FK, no project tab. |
| 14.5 | Formal Decision Agenda | PARTIAL | cockpit sessions with agenda + decisions (`governance.js:269–379`), draft agenda (`071`) | Agenda is meeting-centric; no generated list of "projects awaiting a management decision". |

## §15 Project status / lifecycle

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 15.1 | Existing states (Idea, Assessment, Planned, Approved, In progress, On hold) | PARTIAL | `stage` proposal/approval/in_progress/on_hold/closure/closed (`projectSchedule.js:155`); `status` planned/active/on_hold/done/cancelled (`governanceStore.js:16`); RFI statuses cover idea-like intake (`:15`) | Idea/Assessment live only in RFI; no "Planned/Submitted" distinction on the project. |
| 15.2 | Extended lifecycle (… Submitted, Operational Handover, Benefits Review, Closed) | PARTIAL | gates `projectSchedule.js:156` (closure → closed); benefits review dates + verification (`056`, `governanceStore.js:736`) | No handover or benefits-review stages. |
| 15.3 | Exits Deferred / Rejected / On Hold / Cancelled | PARTIAL | on_hold (gate with reason ≥10 chars), `status=cancelled`; RFI rejected/deferred | No project-level deferred/rejected stage. |

## §16 Delivery effort

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 16.1 | Category Small/Medium/Large/Very Large | MISSING | (RFI `effort` 1–3) | No project field. |
| 16.2 | Scoring model (7 factors → category) | MISSING | — | **POLICY → PROPOSED** (weights and bands). |

## §17 Resource demand

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 17.1 | Average FTE / Peak FTE (numeric) | MISSING | (derivable from task allocation % — `resourcePressure` `ppmVisuals.js:51`, live; member allocation `085`, switch `ppm_project_team_enabled`) | No declared demand fields; derived load requires a task plan, which intake projects do not have. |
| 17.2 | Required skill | MISSING | (`ppm_resources` name/kind/generic, `105`, switch `ppm_resources_enabled`) | No skill attribute. |
| 17.3 | Resource start / finish | PARTIAL | member `from_day/to_day` (`085`, OFF); task dates | Not a project demand window. |
| 17.4 | Internal / External | MISSING | — | — |
| 17.5 | Resource owner | MISSING | — | — |
| 17.6 | Categorical demand kept separate from numeric FTE | MISSING | — | Neither field exists (avoids the §31.6 mix by absence). |

## §18 Workload and risk notes

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 18.1 | Free notes (specialists, vendor dependence, peak period, clashes, access, commissioning windows) | PARTIAL | structured charter can carry a `constraints` field (`projectSchedule.js:113`) | No dedicated field; not surfaced in roadmap/capacity. |

## §19 Master data management

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 19.1 | Admin for Sites | PRESENT live | sites registry + admin card (accounts/sites routes) | — |
| 19.2 | Admin for Project Types, Priorities, Budget Status, Project Status, Decision Values, Delivery Effort, Risk Exposure | MISSING | statuses are code constants (`governanceStore.js:13–17,360–371`, `projectSchedule.js:155`) | No portfolio lookup tables. |
| 19.3 | Add / deactivate / rename / reorder / colour / default / restrict by site / archive | MISSING | — | — |
| 19.4 | Referenced values never physically deleted | PARTIAL | soft delete for portfolio entities (`052`); `md_*` meetings lookups use `active` | Pattern exists elsewhere; not for portfolio lookups (none exist). |

## §20 Data-quality engine

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 20.1 | Missing-field checks (19 checks listed) | PARTIAL | create requires objective/key/name (`governanceStore.js` `T.req`); gate checks charter/sponsor/dates; `unowned_task`/`unowned_milestone` alerts (`ppmAlerts.js:24`); integrity report tool `tools/pg/ppm-integrity-report.js` | ~5 of 19 checks exist in some form; most target fields do not exist. |
| 20.2 | Invalid-date check | PRESENT live | `planIntegrity.js:62` | Refused at write, so never stored. |
| 20.3 | "Budget missing or zero" | PARTIAL | null shown as unknown; `budget_unknown` count per programme (`portfolio.html:220`) | Zero vs blank vs not-budgeted not distinguished (see conflicts). |
| 20.4 | DQ score = completed required / total × 100 (project) | MISSING | — | — |
| 20.5 | Site DQ score | MISSING | — | — |
| 20.6 | DQ RAG Green 100 / Amber 80–99 / Red <80 | MISSING | — | **POLICY → PROPOSED** (KPI threshold, human-owned; `public/lib/kpiRag.js`). |
| 20.7 | Override to Red on blocking error (invalid schedule, missing accountable owner) | MISSING | — | — |

## §21 Executive dashboard

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 21.1a | KPI: Total Projects | PRESENT live | tiles "Projects" (`portfolio.html:214`) | — |
| 21.1b | KPI: Data Quality | MISSING | — | Needs §20. |
| 21.1c | KPI: Critical + High (priority) | MISSING | tile "High risks" is risk-based, not priority | Needs §9. |
| 21.1d | KPI: Budget Identified | PARTIAL | "Money by programme" per currency (`portfolio.html:218`) | No budget-status split. |
| 21.1e | KPI: Decisions Required | MISSING | — | Needs §14.1. |
| 21.1f | Drill-through from every KPI card | PARTIAL | project keys link to `project.html` (`portfolio.html:129`); tiles are static | Tiles do not filter to the underlying project list. |
| 21.2 | Projects by site (count, budget, FTE, risk, priority, DQ) | PARTIAL | capacity per site/week (`governancePpm.js:47`, switch `ppm_capacity_view`) | No site analysis table. |
| 21.3 | Priority analysis | MISSING | — | — |
| 21.4 | Status analysis (distribution, stalled, stage age, approved-not-started, in-progress-without-lead, on hold) | PARTIAL | board by stage (`portfolioViews.js` boardHtml, switch `portfolio_views_enabled`); `stale_plan` alert (`ppmAlerts.js`, needs `stale_plan_days`); late projects tile | No stage-age, no approved-not-started list. |
| 21.5 | Risk analysis by site / type / owner / budget status / period | PARTIAL | risk list + P×I matrix (`ppmVisuals.js:30`) live | No breakdowns. |
| 21.6 | Delivery capacity (effort + FTE + duration + deps + risk + count) | PARTIAL | resource conflicts + pressure per person/week (live), capacity per site (OFF) | No combined view; effort/FTE fields missing. |
| 21.7 | Financial analysis (total, approved, requested, not-budgeted, TBC, by site/type/priority/quarter) | PARTIAL | money by programme, per currency, spend unknown counts | Only by programme; budget status/type/priority/quarter missing. |

## §22 Management alert engine

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 22.1 | Categories: critical-risk, high-risk, unfunded, decision bottleneck, missing delivery ownership, schedule errors | PARTIAL | `ppmAlerts.js:24` KINDS (task/milestone overdue, blocked, unowned task/milestone, dependency_blocked, baseline_slip, capacity, gate_approaching, stale_plan) | 0 of the 6 spec categories exact; "missing ownership" partly via unowned_task/milestone. |
| 22.2 | Exception queue visible | PRESENT live | `GET /api/governance/portfolio/exceptions` (`governance.js:808`) | — |
| 22.3 | Alert as actionable record (ID, type, severity, trigger, recommended action, owner, created, due, status, escalation level, resolution) | PARTIAL | items have key/kind/owner/message/since; `ppm_alert_state` first_seen/last_notified/cleared (`045`); `alert_firings` (`019:20`) | No assignment, due date, severity, recommended action, resolution. |
| 22.4 | Lifecycle Create → Assign → Follow → Escalate → Resolve → Close | MISSING | (commitments register has this lifecycle — `021_commitments.sql`, `routes/commitments.js`) | Alerts are not promotable to a tracked item. |
| 22.5 | In-app alert | PRESENT (switch: ppm_alerts_enabled) | `tools/governance/ppm-alerts.js` (in-app notices + firings) | Nightly job armed OFF. |
| 22.6 | E-mail notification | PRESENT (switch: alert_external_enabled) | `tools/governance/ppm-alerts.js:74` | Requires both switches; stays armed OFF per rules. |
| 22.7 | Teams notification | MISSING | (Teams channels exist for SLA/sync alerts only) | Not wired for PPM; must ship armed OFF. |
| 22.8 | Weekly action digest | PARTIAL | `notifications.digested_at` (`019:23`), cockpit "Friday queue" | No PPM-specific digest. |

## §23 Automatic timeline and Gantt

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 23.1 | Projects appear automatically on a portfolio roadmap | PRESENT live | `ganttRows` (`portfolioEvidence.js:36`), timeline panel (`portfolio.html:74`) | — |
| 23.2 | Columns: ID, name, site, delivery lead, status, risk, start, finish, duration | PARTIAL | key, name, dates, status, milestones, slip | No site/lead/risk/duration columns on the roadmap. |
| 23.3 | Views Year / Quarter / Month / Week | PARTIAL | task Gantt v2 zoom day/week/month/quarter (`ganttV2.js:10`, switch `ppm_gantt_v2_enabled`) | Portfolio timeline has one scale; no year view. |
| 23.4 | Drag start/finish, move, extend | PRESENT (switch: ppm_gantt_v2_enabled) | `ganttV2.js:13,217` (task level) | Task-level only; portfolio-level drag missing (and conflicts with frozen baseline after approval). |
| 23.5 | Milestones, dependencies, critical path | PRESENT live | milestones on timeline; project critical path (`governance.js:547`, `scheduleEngine.js`) | Cross-project critical path not computed. |
| 23.6 | Filters by site/status/risk/owner | MISSING | (my-projects switch only) | — |
| 23.7 | Baseline vs actual dates | PARTIAL | baseline_end slip in gantt rows; baseline slots (`ppm_baseline_slots_enabled`) | Project-level only. |
| 23.8 | Export Excel / PDF / PowerPoint | PARTIAL | deck.pptx, workbook.xlsx, roadmap publications (`101`, switch `roadmap_audience_publication_enabled`) | No PDF; no filtered roadmap export. |
| 23.9 | Monthly active project load (active projects, FTE, critical, high-risk, very large, vendor) | PARTIAL | resource pressure per person/week (live); capacity per site/week (OFF) | No monthly project-count load; FTE/effort/vendor fields missing. |
| 23.10 | Configurable capacity thresholds by site/team | MISSING | `capacity_alerts_enabled` is "planned" in FLAG-REGISTER | Not built. |
| 23.11 | Schedule conflicts identified | PARTIAL | resource conflicts > 100 % (`projectSchedule.js:73`) | No project-vs-project window/dependency conflict detection (e.g. successor starts before predecessor ends). |

## §24 Visual design system

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 24.1 | Palette (navy/blue/warning) | PARTIAL | brand tokens `_tokens.css` | **Conflict:** SDP360 has its own brand system; keep it, map semantics. |
| 24.2 | Semantic colours (Critical red … TBC grey) | PARTIAL | RAG + "colour is never the only signal" (`portfolio.html:211`) | No TBC grey state (no TBC values exist). |
| 24.3 | Segoe UI typography | MISSING | Libre Franklin (brand) | **Conflict** with brand tokens — recommend NOT adopting. |
| 24.4 | Page hierarchy title → description → filter bar → content | PARTIAL | shell header + panels | No filter bar on portfolio. |
| 24.5 | Tables: sticky headers, frozen ID/site/name, search, multi-filter, sort, group, saved views, column choice, inline edit, bulk update, export, full screen | PARTIAL | scroll tables, list view (OFF), XLSX export | Almost all register-table features missing. |

## §25 Navigation

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 25.1 | Sidebar Home/Projects/My Projects/Site Portfolio/New Project/Dashboard/DQ/Roadmap/Risks & Deps/Decision Agenda/Reports/Admin/Help | PARTIAL | single `portfolio.html` page + `my projects` (switch `portfolio_my_projects_default`) + governance cockpit pages | No dedicated New Project / DQ / Decision Agenda / Risks & Deps pages. |
| 25.2 | Project tabs Overview/Business Case/Ownership/Schedule/Budget/Risks/Dependencies/Resources/Decisions/Documents/Activity | PARTIAL | `project.html:76–89` Overview, Charter, Plan, Milestones, RAID, Benefits, Budget*, RACI*, Changes*, Board*, Gates, Comments*, History (*switch) | Missing Ownership, Dependencies, Resources, Decisions, Documents tabs. |

## §26 Workflow

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 26.1 | Draft → Site Review → DQ Check → Group IT → Arch/Security → Budget → Management Decision → Approved → Delivery → Handover → Benefits → Closed | PARTIAL | gates proposal→approval→in_progress→closure→closed (`projectSchedule.js:156`); gate checklists with role/user sign-off slots + quorum (`gateChecklist.js`, switch `ppm_gate_checklist_enabled`) | Review steps not modelled as stages; checklist could carry them per gate (OFF). |
| 26.2 | Save Draft / Submit | PARTIAL | create (committee) / gate to approval | No contributor drafts. |
| 26.3 | Return for correction / Request information | PARTIAL | gate approval → proposal (`projectSchedule.js:158`) | No request-information action/state. |
| 26.4 | Assign reviewer | PARTIAL | checklist approver slots (OFF) | — |
| 26.5 | Approve / Reject / Defer | PARTIAL | approve = gate move with SoD; sign-off approve/reject (OFF) | No project reject/defer outcome. |
| 26.6 | Put on hold / Resume | PRESENT live | on_hold ⇄ in_progress with reason (`projectSchedule.js:183`) | — |
| 26.7 | Record decision | PARTIAL | decisions register (not project-linked) | — |
| 26.8 | Record comment | PRESENT (switch: ppm_comments_enabled) | `108_ppm_roles_comments.sql`, `routes/governanceCollab.js:51` | — |
| 26.9 | Attach document | MISSING | (gate evidence links only, OFF) | P04 ARCH-14 MISSING. |
| 26.10 | Close project | PRESENT live | closure → closed with open-task / high-risk checks (`projectSchedule.js:181`) | — |

## §27 Roles and permissions

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 27.1 | Site Contributor (create, edit drafts, submit) | MISSING | creation committee-only (`governance.js:667`); plan writes behind `portfolio_editor_plan_writes` (HIGH-risk lot) | Widening write = access-policy owner decision. |
| 27.2 | Site IT Manager (review site portfolio) | PARTIAL | site-scoped read (`portfolioAccess.js:54`, switch `portfolio_site_scope_reads`) | No site review action. |
| 27.3 | Group IT Reviewer | PARTIAL | committee-member role | No distinct reviewer step. |
| 27.4 | Business Sponsor (confirm need/value) | MISSING | sponsor is free text | No sponsor confirmation (must be an identity-bound human action). |
| 27.5 | Portfolio Manager | PARTIAL | committee / project role `pm` (OFF) | — |
| 27.6 | Executive (review, approve, reject, defer) | PARTIAL | `portfolio_executive_readonly` (OFF) read-only; approvals by committee | — |
| 27.7 | Administrator (users, reference data, workflow, notifications, periods, rules) | PARTIAL | admin tier, governance policies (`027`), roles matrix (`routes/governanceRoles.js`) | No portfolio reference data / periods. |
| 27.8 | Access by role AND site | PRESENT (switch: portfolio_site_scope_reads) | `portfolioAccess.js:54,72,87` | Live today: every session reads every project; committee writes. |

## §28 Audit trail

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 28.1 | Created by/date, modified by/date | PARTIAL | `created_at/updated_at` columns; actor in `ppm_events` and system log `portfolio_saved` | No created_by / modified_by columns on projects. |
| 28.2 | Field changed, previous, new value | PARTIAL | hash-chained append-only `ppm_events` (`039`) for owner/sponsor, budget/spent/currency/spend_type, sites, sensitive, stage, baselines, benefits, task reassign (`governanceStore.js:648–649`) | Name, key, charter, dates, status, confidence, depends_on edits not field-logged. |
| 28.3 | Status change / approval / decision / comment | PRESENT live | stage moves + gate sign-offs (append-only, `110`), decisions history (`governance.js:487`) | Comments OFF. |
| 28.4 | Approved data never changes silently | PARTIAL | baseline frozen after approval, owner/sponsor frozen, status follows stage (`governanceStore.js:637–643`) | Charter/name/dates/budget-status edits after approval not frozen (budget changes are logged). |

## §29 Document management

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 29.1 | Attach typed documents (business case, quotation, design, …, handover) | MISSING | `services/blobStore.js` exists (inspections); gate evidence = links (OFF); benefit `evidence_link` | No project document entity (P04 ARCH-14, H2). |

## §30 Search, filtering, reporting

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 30.1 | Search by ID/name/site/owner/sponsor/type/risk/vendor/keyword | MISSING | — | — |
| 30.2 | Filters (year, site, type, priority, status, risk, budget status, IT owner, lead, sponsor, decision) | MISSING | view switch + my/all (OFF) | — |
| 30.3a | Executive portfolio report | PRESENT live | `/api/governance/portfolio/report.html` (`governance.js:862`), deck.pptx (`:831`) | — |
| 30.3b | Site portfolio report | PARTIAL | roadmap publication audience `site` (OFF); project report (OFF) | — |
| 30.3c | Budget report | PARTIAL | workbook money; annual pack (switch `ppm_annual_pack_enabled`) | No budget-status report. |
| 30.3d | High-risk projects | PARTIAL | risks panel/sheet | Not a project-level report. |
| 30.3e | Decision agenda report | PARTIAL | minutes HTML/PDF per session | No project decision agenda. |
| 30.3f | Resource capacity report | PARTIAL | Capacity sheet in workbook (`portfolioDeck.js:105`) | — |
| 30.3g | Roadmap | PRESENT live | timeline + deck | — |
| 30.3h | Data quality report | MISSING | — | — |
| 30.3i | Unfunded projects | MISSING | — | needs budget status |
| 30.3j | Projects without owners | PARTIAL | unowned task/milestone exceptions | not project owner/lead/sponsor |
| 30.3k | Projects on hold | PARTIAL | stage on board (OFF) | no report |
| 30.4 | Export Excel | PRESENT live | `workbook.xlsx` (`governance.js:836`) | — |
| 30.5 | Export PDF | PARTIAL | session minutes PDF only | no portfolio PDF |
| 30.6 | Export PowerPoint | PRESENT live | `deck.pptx` | — |
| 30.7 | Export CSV | PARTIAL | RACI csv only (OFF) | — |
| 30.8 | Exports preserve active filters | MISSING | exports take the whole readable view (`governance.js` exportData) | — |

## §31 Issues not to replicate (checked as requirements)

| # | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 31.2 | Backend immutable IDs | PARTIAL | see 5.1a/c | — |
| 31.3 | Separate exact dates / indicative quarter / confidence | PARTIAL | see 10.4/10.5 | — |
| 31.5 | Amount + currency + rate + base + converted | PARTIAL | see 11.4 | — |
| 31.6 | FTE separate from categorical demand | MISSING | see 17 | — |
| 31.7 | ID as relationship key everywhere | PRESENT live | all FKs on `project_id` | — |
| 31.8 | No fixed range limits | PRESENT live | DB queries | — |
| 31.9 | Alerts assignable/closable | MISSING | see 22.4 | — |
| 31.10 | Blank / Zero / TBC / N/A / no known dependency / no identified risk distinct | PARTIAL | null ≠ 0 doctrine (`portfolio.html:216`, E-NULL-3; `currency_defaulted`) | TBC / N/A / "none known" states absent. |

---

## §37 Acceptance criteria

| # | Criterion | Status | Evidence / gap |
|---|---|---|---|
| A1 | One structured record per project | PARTIAL | Record exists; most spec fields missing (§6–§18). |
| A2 | Permanent unique ID | PARTIAL | Numeric id permanent; human key typed + editable; no PRJ-YYYY-NNN. |
| A3 | Standardised project classifications | MISSING | No project type / priority / effort lookups. |
| A4 | Business problem and expected value separate | PARTIAL | Charter (problem-ish) vs benefits table (measurable value); no dedicated problem/value fields. |
| A5 | Sponsor, IT owner, delivery lead separate | PARTIAL | sponsor + owner; no delivery lead; no distinctness check. |
| A6 | Dates stored with correct types | PARTIAL | Validated `YYYY-MM-DD` TEXT (refuses quarters/TBC) — not DATE columns; no quarter field. |
| A7 | Budgets numeric and currency-aware | PRESENT live | NUMERIC + ISO currency + defaulted flag + no cross-currency sums. Base-currency conversion absent (§11.4). |
| A8 | FTE numeric | MISSING | No FTE fields (allocation % only). |
| A9 | Missing info detected automatically | PARTIAL | A few required fields + gate checks + ownership exceptions. |
| A10 | Project-level DQ score | MISSING | — |
| A11 | Site DQ scores | MISSING | — |
| A12 | Portfolio KPIs update automatically | PRESENT live | Tiles computed on each read (`portfolio.html:214`); spec KPIs (DQ, priority, budget status, decisions) missing. |
| A13 | Dashboard drill-through | PARTIAL | Project links only; tiles static. |
| A14 | Projects appear automatically on the roadmap | PRESENT live | `ganttRows`. |
| A15 | Schedule conflicts identified | PARTIAL | Resource over-allocation only; no project schedule-conflict rule. |
| A16 | Capacity concentration identified | PARTIAL | Person/week pressure live; site/week behind `ppm_capacity_view`. |
| A17 | Major risks escalated | PARTIAL | High risks tile + closed-gate block; no escalation path for risks. |
| A18 | Management decisions recorded | PRESENT live | Decision register DEC-YYYY-NNN; not project-linked. |
| A19 | Unfunded projects identified | MISSING | No budget status. |
| A20 | Alerts assigned and closed | MISSING | Exceptions are computed, not tracked. |
| A21 | Access by role and site | PRESENT (switch: portfolio_site_scope_reads) | Role gating live; site scope OFF. |
| A22 | Important changes auditable | PARTIAL | Hash-chained ledger for finance/roles/stage/baselines; other fields not logged. |
| A23 | Portfolio exportable | PRESENT live | XLSX + PPTX + HTML (filters not preserved). |
| A24 | Architecture supports Teams/M365/Power BI | PARTIAL | `/api/v1` + OData external API (`routes/extApi.js`), Teams channels exist elsewhere, Entra SSO; no portfolio entity in the external API, no PPM Teams channel. |

§37 totals: PRESENT live 5 · PRESENT (switch) 1 · PARTIAL 12 · MISSING 6 (of 24).

---

## Requirement-row totals (§4–§31 tables above)

Counted mechanically from the status column (awk over the §4–§31 rows, 158 rows):

| Status | Rows |
|---|---:|
| PRESENT live | 29 |
| PRESENT (switch) | 6 |
| PARTIAL | 73 |
| MISSING | 50 |
| **Total** | **158** |

## MVP §32 coverage

| MVP item | Status | Weight |
|---|---|---:|
| Project creation | PRESENT live (committee only) | 1 |
| Project editing | PRESENT live | 1 |
| Automatic immutable IDs | PARTIAL | 0.5 |
| Project register | PARTIAL (no register table / spec fields) | 0.5 |
| Master-data management | PARTIAL (sites only) | 0.5 |
| Mandatory-field validation | PARTIAL | 0.5 |
| Data-quality score | MISSING | 0 |
| Site access | PRESENT (switch: portfolio_site_scope_reads) | 1 |
| Dashboard | PARTIAL | 0.5 |
| Site analysis | PARTIAL (capacity per site, OFF) | 0.5 |
| Priority analysis | MISSING | 0 |
| Status analysis | PARTIAL | 0.5 |
| Risk analysis | PARTIAL | 0.5 |
| Budget analysis | PARTIAL | 0.5 |
| Project filters | PARTIAL | 0.5 |
| Decision-required list | PARTIAL (register, no project flag) | 0.5 |
| Gantt roadmap | PRESENT live | 1 |
| Management alerts | PARTIAL (queue live, no lifecycle, job OFF) | 0.5 |
| Excel export | PRESENT live (filters not preserved) | 1 |
| Audit history | PARTIAL | 0.5 |

**MVP coverage: 11.5 / 20 = 57.5 %** weighted (PRESENT = 1, PARTIAL = 0.5, MISSING = 0). Strict view (only items
fully present): 5 / 20 = **25 %** (4 / 20 = 20 % counting live only, since site access is switched off). The weighted
figure flatters: most PARTIALs are "a generic mechanism exists, the spec fields do not".

---

## Conflicts with existing decisions (must be resolved by a human, not by code)

1. **DQ RAG 100 / 80 bands (§20.2)** and **project RAG** are KPI threshold policies → human-owned; ship as
   `PROPOSED` in `kpiRag.js` / `ppm_rag_thresholds`-style config, shadow only, never "approved".
2. **Priority meanings (§9), risk levels Critical..Low (§13), delivery-effort weights (§16)** are business policy →
   PROPOSED reference data with "not approved" banner. Existing risk severity (P×I ≥6 high, `portfolioEvidence.js:56`)
   must not be silently re-banded; a 4-level mapping is a PMO decision.
3. **"Budget missing or zero" = error (§20)** conflicts with the null-vs-zero doctrine: 0 is a measured value. Proposed
   rule: blank = missing; 0 is valid only with budget status `not_budgeted`, otherwise a DQ *warning*, not missing.
4. **Hard-coded site list (§5.1)** conflicts with the sites registry rule (no hard-coded aliases) — use the registry.
5. **Segoe UI / palette (§24)** conflicts with the brand token system — keep brand tokens, map semantic colours.
6. **Site Contributor creates projects (§27)** widens write access (today committee-only) — same class as
   `portfolio_editor_plan_writes` (switch-lots: HIGH, STOP-AND-REPORT, access-policy owner).
7. **Business Sponsor "confirms"/Executive "approves" (§27)** are identity-bound human acts — record the act of a real
   logged-in person; never infer or pre-fill an approval.
8. **Drag project dates on the roadmap (§23)** conflicts with "baseline frozen after approval" — drag may only move
   forecast/plan dates pre-approval or via a change request after.
9. **Teams / e-mail / weekly digest (§22)** exist as channels but stay **armed OFF**; AI functions (§34–35) stay
   proposals/OFF; Power BI (§33) only through the existing external API, no new connector.
10. **Spec lifecycle (§15/§26) vs stage gates** — extending stages must keep the existing gate rules and SoD; status keeps
    following stage.
11. **Base-currency conversion (§11)** needs Finance-certified FX rates (`fx_rates`, `finance_certification_enabled`):
    converted totals must read UNKNOWN when no certified rate exists.

---

## Implementation plan (6 lots, MVP first)

General rules for every lot: extend `portfolio_projects` / `governanceStore.js` / `routes/governance.js` /
`portfolio.html` / `project.html` — **no parallel module**; PostgreSQL only; one migration file per lot under
`db/postgres/reports/NNN_*.sql` (next free number at implementation time — 112 is the last at `637124cc`, another agent
is active), additive and idempotent, with a manual down script (`tests/ppm-rollback-scripts.test.js` pattern); each new
column NULL = unknown; new behaviour behind a `report_config` switch default `'0'` registered in `reportConfig.DEFAULTS`
+ FLAG-REGISTER + switch-lots; defect fixes default ON; failing test first; route-authz smoke covers new routes.

### Lot 1 — Register identity, classification and intake fields (MVP)
- **Scope:** §5.1 PRJ-YYYY-NNN (backend, immutable, never reused), §6 type + tags, §7 problem/value fields, §8 delivery
  lead (+ `owner` relabelled IT owner) + distinctness warning, §9 priority, §10 indicative quarter + schedule confidence
  + computed duration, §11 budget status / approval date / reference, §14.1 decision required (yes/no/tbc), §16.1 effort
  category, §17.1 avg/peak FTE, §18 workload notes, §31.10 explicit value states (TBC / N/A / none-known) via a per-field
  state map; §19 portfolio lookups (type, priority, budget status, decision values, effort, risk exposure) with
  add/deactivate/rename/order/colour/default/site-restriction/archive.
- **Files:** `services/governanceStore.js` (TABLES.project cols, normalise, `nextRef` hardened: sequence table + unique
  index, no max+1 reuse after purge; `key` frozen once `project_ref` exists), `routes/governance.js`, new pure
  `services/ppm/portfolioLookups.js` + admin card in the existing admin page, `portfolio.html`/`project.html` (Ownership,
  Business case fields), RFI → project copies problem into `business_need`.
- **Migration:** add columns to `portfolio_projects`; `ppm_lookup_values(domain, code, label_en, label_fr, color,
  sort_order, is_default, site_ids, active, archived_at)`; `ppm_project_ref_seq(year, last_n)`; backfill of refs for
  existing projects by a dry-run tool (`tools/pg/ppm-backfill-refs.js`, `--apply`), not in the migration.
- **Switch:** `ppm_intake_register_enabled` (fields + lookups visible/writable). Refs generation for new projects under
  the same switch.
- **Tests:** ref concurrency (two creates, no dup, no reuse after purge), immutability (409 on key change after ref),
  lookup soft-retire keeps history, value-state round trip (TBC ≠ null ≠ 0), switch OFF = today byte-identical API.
- **Effort:** 6–8 days. **Risks:** lookup seed values are business policy → seed as PROPOSED; ref backfill ordering must
  be agreed (created_at); routes payload growth for the money-strip function (`stripMoney`) must strip new amounts.

### Lot 2 — Data-quality engine, field guidance, submission checklist (MVP)
- **Scope:** §20 all checks (incl. blocking override), project DQ score, site DQ score, DQ RAG (PROPOSED bands), §4 field
  catalogue (what/why/example/mistake/required) + help icon, §4.3 submission checklist bound to fields; optional
  enforcement at the proposal → approval gate.
- **Files:** new pure `services/ppm/dataQuality.js` (rules over a project row + risks/deps/decisions; no I/O),
  `services/ppm/fieldGuide.js` (EN/FR catalogue), `projectSchedule.stageGate` hook (only when enforcement switch on),
  `routes/governance.js` (`dq` block on portfolio + project reads), `public/lib/ppmFieldHelp.js` (no inline script,
  STRICT_PAGES), `public/lib/kpiRag.js` (PROPOSED `ppm_data_quality` policy).
- **Migration:** none (computed on read); optional `ppm_dq_snapshots` later for trends (not MVP).
- **Switches:** `ppm_data_quality_enabled` (show score/checks, shadow); `ppm_dq_gate_enforced` (block approval on a
  blocking error) — separate, so the PMO can shadow-test first.
- **Tests:** each of the 19 checks, blank vs zero vs TBC, blocking override to Red, site score = Σ completed / Σ required
  (never mean of %), unknown thresholds read "PROPOSED".
- **Effort:** 4–6 days. **Risks:** required-field set is policy (PROPOSED); enforcement could block live approvals →
  keep enforcement switch separate and OFF.

### Lot 3 — Register table, executive dashboard, filters, drill-through, filtered exports (MVP)
- **Scope:** §21 five KPI cards with drill-through; site / priority / status (stage age, approved-not-started,
  in-progress-without-lead, on hold) / risk / budget (per currency, by status, never cross-currency unless certified FX)
  analyses; §24.5/§30 register table (search, multi-filter, sort, saved views via URL filters, column choice, sticky
  header, frozen ID/site/name); §30 standard reports (unfunded, without owners, on hold, high-risk, DQ); exports
  XLSX/CSV preserving filters; §23 roadmap filters, extra columns, "Schedule not baselined", year/quarter scale, monthly
  active load (projects, FTE, critical, high-risk, very large).
- **Files:** `services/portfolioEvidence.js` (pure aggregations), `public/lib/portfolioViews.js` + `urlFilters.js`
  (schema), `public/portfolio.html`, `services/portfolioDeck.js` (filtered sheets + CSV), `services/exportPolicy.js`
  (new formats under the same gates; money stripping unchanged).
- **Migration:** none (saved views can reuse an existing per-user prefs pattern; if persisted server-side, one small
  `ppm_saved_views` table).
- **Switch:** `ppm_portfolio_dashboard_v2_enabled` (reuses `portfolio_views_enabled` for the list view).
- **Tests:** KPI = count of the drill-through list (reconciliation), filter round trip in export, money hidden for
  non-money readers in every new view, currencies never summed, a11y cliquet.
- **Effort:** 7–9 days. **Risks:** performance of read-time aggregation at portfolio scale (fine for hundreds of
  projects); 60 fps not a concern here (no task bars).

### Lot 4 — Decision agenda + actionable management alerts (MVP)
- **Scope:** §14 project-linked decisions (`source_kind='project'` validated, authority, outcome, decision date) +
  decision agenda (projects with decision_required = yes/tbc and their open decisions); §22 six spec alert kinds
  (critical_risk, high_risk, unfunded, decision_bottleneck, missing_delivery_lead, schedule_error) added to
  `ppmAlerts.KINDS`; alert lifecycle by **promoting an exception to a commitment** (existing commitments register:
  assign → follow → escalate via the escalation matrix → verify/close), keeping `ppm_alert_state` as the dedup key;
  weekly PPM digest via the existing notifications digest; Teams channel wired but armed OFF.
- **Files:** `services/ppmAlerts.js`, `tools/governance/ppm-alerts.js`, `services/governanceStore.js` (decisions),
  `routes/governance.js` (agenda + promote endpoint), commitments service (extend source kinds with `ppm_alert`),
  cockpit/portfolio pages.
- **Migration:** `ALTER TABLE decisions ADD authority, outcome, decided_at, project_id (nullable, no cascade)`;
  `ppm_alert_state ADD commitment_uid, severity, recommended_action`.
- **Switches:** `ppm_decision_agenda_enabled`, `ppm_alert_actions_enabled`; existing `ppm_alerts_enabled`,
  `alert_external_enabled` stay OFF; Teams uses the existing notifications channel switch (OFF).
- **Tests:** each new alert kind incl. null-date never fires, promotion idempotent (one commitment per alert key),
  cleared alert does not close a commitment silently (human closes), escalation follows the matrix, notifications armed
  OFF send nothing.
- **Effort:** 5–6 days. **Risks:** alert thresholds (e.g. bottleneck age) are policy → PROPOSED; overlap with existing
  commitment volumes on the cockpit.

### Lot 5 — Extended lifecycle, review workflow, roles, full audit (MVP audit + Phase 2 approval workflow)
- **Scope:** §15/§26 stages idea/assessment/submitted/handover/benefits_review + exits deferred/rejected/cancelled,
  mapped onto the current gates (existing rules + SoD kept, status still follows stage); review steps (site review, DQ
  check, group IT, arch/security, budget, management decision) as **gate checklist templates** with role slots (W3
  machinery); actions request-information / return-for-correction / assign reviewer; §27 portfolio role catalogue mapped
  to existing roles + project roles (no new auth system); contributor drafts only if the access-policy owner approves;
  §28 field-level audit of every project field (old/new in `ppm_events`) + created_by/modified_by; freeze of
  approved business-case fields (change request required).
- **Files:** `services/projectSchedule.js` (STAGES/GATES), `services/ppm/gateChecklist.js`, `services/governanceStore.js`
  (field audit, freeze), `routes/governance.js`, `services/portfolioAccess.js`, `project.html` (Activity tab = history).
- **Migration:** `portfolio_projects ADD created_by, updated_by`; stage CHECK unchanged (TEXT); gate checklist
  `gate_to` CHECK in `110` must be widened (ALTER constraint, additive).
- **Switches:** `ppm_extended_lifecycle_enabled`; `ppm_field_audit_enabled` (recommend early enable — low risk, but new
  behaviour → OFF by rule); contributor create = separate `portfolio_contributor_create` (HIGH, owner decision).
- **Tests:** every gate negative incl. new stages, SoD (sponsor ≠ approver, owner ≠ approver), no approval without a
  real signer, field audit row per changed field, frozen fields 409 after approval, switch OFF = today.
- **Effort:** 7–9 days. **Risks:** existing projects' stage mapping; widening writes (stop-and-report); approvals are
  human acts — nothing auto-approves.

### Lot 6 — Structured dependencies & risks, resource demand & capacity, documents, effort scoring, BI (Phase 2)
- **Scope:** §12 `ppm_project_dependencies` (predecessor project or external category, owner, status, target date,
  criticality; JSON `depends_on` kept read-compatible, backfilled by a dry-run tool); §13 4-level exposure (PROPOSED
  mapping), residual risk, due date, project exposure rollup (extends `portfolio_risks` + `ppm_raid_details`); §17
  `ppm_project_demand` (skill, avg/peak FTE, window, internal/external, owner) + monthly load + configurable capacity
  thresholds (`capacity_alerts_enabled`, already planned); §29 `ppm_project_documents` on `blobStore` (typed, versioned,
  soft-delete, site-scoped reads); §16.2 effort scoring (PROPOSED weights); portfolio scenario planning (extend CR
  simulation to portfolio level, read-only what-if); Power BI via adding portfolio entity sets to the existing
  `/api/v1` + OData (per-consumer keys, money scope respected).
- **Files:** `services/governanceStore.js`, `services/ppm/raid.js`, `services/ppm/resources.js`, `services/blobStore.js`,
  `routes/governanceW3.js`, `routes/extApi.js`, `project.html` (Dependencies / Resources / Documents tabs).
- **Migration:** new tables above + `portfolio_risks ADD residual_*, due_date`.
- **Switches:** `ppm_structured_dependencies_enabled`, `ppm_resource_demand_enabled`, `ppm_documents_enabled`,
  `ppm_effort_scoring_enabled`, `ppm_scenarios_enabled`, `ext_api_portfolio_enabled`.
- **Tests:** dependency cycle across projects, external dependency without owner flagged by DQ, FTE numeric only,
  capacity threshold boundaries, document path-traversal + site scope + money-free metadata, external API money strip.
- **Effort:** 10–14 days. **Risks:** document storage/retention policy and malware scanning are operator decisions;
  FX/base-currency totals blocked on Finance certification; AI functions (§34–35) explicitly out of scope (proposals OFF).

**Order and dependency:** Lot 1 → Lot 2 (needs fields) → Lot 3 (needs fields + DQ) → Lot 4 → Lot 5 → Lot 6.
Lots 1–4 close the §32 MVP except "audit history" (Lot 5, field audit) — Lot 5's audit part can be pulled forward.
**Total estimate (AI, unvalidated): 39–52 developer-days**, excluding PMO/Finance/access-policy decisions and human
acceptance (business witness project, as in P04).

## Recommendation

**FAIL against the spec today** (MVP 57.5 % weighted / 25 % strict; §37: 6 of 24 met, 1 of them only behind a switch; 12 partial, 6 missing).
The scheduling/engine side is ahead of the spec; the intake, classification, data-quality, decision-agenda and
alert-lifecycle side — the core of this spec — is missing. Build Lots 1–4 behind OFF switches, shadow-test with the
PMO, and get human decisions on the 11 conflicts before any switch is turned on.
