# W0 gap matrix — PPM UX, governance, collaboration, performance, security, agile (modules C · F · G · H · I · K · L + T1–T11)

- **Head:** `55dc67c` (worktree `/home/user/fixinst`, local branch `sdp-waves`) — "Regenerate inventories after the UAT-F merge".
- **Nature:** **read-only audit.** No code changed, nothing committed. One ad-hoc micro-benchmark was run from the scratchpad (not committed).
- **Evidence run:** `project-schedule`, `ppm-baseline`, `ppm-project-lifecycle.smoke`, `ppm-workbench`, `ppm-workbench.smoke`,
  `portfolio-views`, `project-page`, `ppm-baselines.smoke`, `roadmap-publication.smoke` on throwaway PostgreSQL → **56 tests, 56 pass,
  0 fail, 0 skipped**. Other tests are cited by file + title from source, not re-run.
- **Taxonomy:** IMPLEMENTED = end-to-end and proven by a cited test · PARTIAL = incomplete/incorrect (case given) · STUBBED = UI/API with
  fake logic · MISSING = absent. A feature that is complete but sits behind a `report_config` switch defaulting to `'0'` is recorded as
  **PARTIAL (OFF)** — switched-off is not IMPLEMENTED for users. Priority: P0 correctness/integrity · P1 MS-Project parity & performance ·
  P2 exec/governance · P3 enterprise.
- **Baseline of the product under audit:** the project tool is `public/project.html` (726 lines, tabbed page, one server-built SVG
  Gantt), `public/portfolio.html` (timeline + programme tree), `public/cockpit.html` (governance sessions + PPM exception queue),
  `public/itsm-roadmap.html` (a super_admin's personal objectives list). The scheduler is `services/projectSchedule.js`
  (finish-to-start only, no lag, **calendar days**, no resource levelling). Nothing in this half of the scope was found STUBBED
  (no `Math.random`, mock arrays or hard-coded returns in the PPM paths); the gaps are honest absences or switched-off code.

---

## C — Gantt UI & views

| ID | Requirement | Status | Evidence file:line | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| C1 | Dual-pane grid ↔ timeline, scroll-sync, row alignment, shared state | PARTIAL | Labels and bars live in ONE SVG (`public/project.html:498-535`, `ganttSvg`) so rows align; the editable grid is a separate read-only table folded in a `<details>` (`project.html:104`, `:457`) with no scroll sync; editing is a separate form (`taskEditor`, `:536`) | `project-page.test.js` "Gantt bars carry an aria-label…" (structure only) | P1 | Real split-pane: sticky grid + timeline in one scroll container, shared selection model |
| C2 | Zoom hours → years, 3-tier timescale | MISSING | Fixed `W = 980` px, timescale = two date labels at both ends (`project.html:499`, `:510`); portfolio timeline likewise (`portfolio.html:205-218`) | — | P1 | Time-scale model (unit/tier/px-per-unit) + zoom control |
| C3 | Bar move, edge resize, progress drag, drag-to-link | MISSING | Click/Enter on a bar only opens the task row/editor (`project.html:487-497`); dependencies are a `<select multiple>` (`:544`) | — | P1 | Pointer interaction layer writing through the existing `PUT /api/governance/portfolio/task` (A-15 rule) |
| C4 | Excel-like grid: copy/paste, fill-down, multi-select, undo/redo | MISSING | One task at a time through a form (`project.html:536-565`); no undo stack anywhere in the page | — | P1 | Grid component with command stack; batch write route |
| C5 | Column chooser, filters, grouping, outline levels | PARTIAL | Outline = `parent_id` + WBS indentation (`project.html:459` `padding-left 14*depth`); no collapse/expand, no summary roll-up of dates/progress, no column chooser, filter or group-by | — | P1 | Summary-task roll-up in `scheduleView`; grid features |
| C6a | Bar style — critical path red | IMPLEMENTED | `fill = crit ? "#B91C1C"` + text "CP" (`project.html:521-525`); CPM `criticalPath` (`services/projectSchedule.js:52-82`) | `project-schedule.test.js` "critical path: longest finish-to-start chain…"; `project-page.test.js` "Gantt bars carry an aria-label and critical tasks carry a text marker" | — | — |
| C6b | Baseline ghost bars beneath active, switchable BL0–BL10 | PARTIAL | Dashed ghost rect (`project.html:517`) from ONE selected version (`blVersion`, `:367`) or the task baseline fields; never several at once. Version capture is behind `ppm_baseline_versions='0'` (`services/reportConfig.js:221`) | `ppm-baselines.smoke.test.js` "switch on: approval → in_progress writes version 1…"; `ppm-visuals.test.js` "baseline legend is visible" | P1 | Multi-baseline overlay; switch on in pilot |
| C6c | Slack lines | MISSING | Slack only as a table number (`project.html:459`) | — | P1 | Draw free/total slack line after bar |
| C6d | Progress fill | PARTIAL | 2-px line under the bar when `progress_pct` set (`project.html:524`); progress is entered by hand, never derived | `project-page.test.js` (aria label carries progress) | P2 | Fill inside bar; derive from effort/actuals |
| C6e | Milestone diamonds | IMPLEMENTED | `◆` per milestone with ✓/! (`project.html:529-532`) | `ppm-visuals.test.js` "project.html Gantt…"; lifecycle smoke | — | — |
| C6f | Summary brackets, deadline arrows, split bars, lag labels | MISSING | No summary rendering; no deadline field; no split; no lag in the data model (`projectSchedule.js` FS only) | — | P1 | Data model first (deadline, splits, lag), then glyphs |
| C7a | Tracking Gantt | PARTIAL | The single Gantt shows plan + dashed baseline + today line — a tracking view by approximation, no actual-vs-baseline split bar | `ppm-visuals.test.js` | P1 | Dedicated view (actual / remaining / baseline stacked) |
| C7b | Multiple Baselines view | MISSING | One version at a time (`blVersion`) | — | P1 | — |
| C7c | Network / PERT diagram | MISSING | — | — | P1 | — |
| C7d | Calendar view | MISSING | — | — | P2 | — |
| C7e | Task / Resource Usage | PARTIAL | Resource pressure per person × week, peak %, unknown allocation never guessed (`public/lib/ppmVisuals.js` `resourcePressure`) — a weekly heat table, not a time-phased usage grid | `ppm-visuals.test.js` "resourcePressure: peak per person/week…" | P1 | Time-phased hours/day per assignment |
| C7f | Resource Sheet | PARTIAL (OFF) | Team panel (name, role, allocation, window) `public/lib/ppmWorkbench.js:17-60`, behind `ppm_project_team_enabled='0'` (`reportConfig.js:346`); owners otherwise free text | `ppm-workbench.smoke.test.js` "R2-WB-04 team: 404 while off…" | P1 | Turn on; person ids instead of free text |
| C7g | Resource Graph, Team Planner | MISSING | — | — | P2 | — |
| C7h | Timeline slide export | PARTIAL | Portfolio-level `deck.pptx` has a "Schedule vs baseline" slide (`services/portfolioDeck.js:67`); no per-project timeline slide | `ppm-baselines.smoke.test.js` "deck.pptx and workbook.xlsx: committee gets amounts…" | P2 | Project timeline slide |

## F — Simplified project view & executive dashboard

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| F1 | Expert ↔ Simplified toggle preserving state, no technical columns in simplified | MISSING | No such toggle in `project.html` / `portfolio.html` (grep "simplified" = 0) | — | P2 | View-mode flag in URL state |
| F2 | KPI cards: RAG, % schedule complete, budget burn actual vs planned, active risks/blockers, next milestone | PARTIAL | Overview tiles `project.html:398-411`: "Finish vs baseline" RAG = client-side `slipRag` (≤0 green, ≤14 d amber, >14 d red, calendar days, `:349-353`, untested); "Progress" = hand-entered `progress_pct`; money = `spent / budget` text only, no planned-to-date; "Open high risks" present; **no next-milestone card** | none for `slipRag` (grep of `tests/` = 0) | P2 | Server-side status engine (see G2); computed % complete; next milestone |
| F3 | Phase strip Initiation→Feasibility→Planning→Execution→Closure with % complete / gate status / health per phase | PARTIAL | Stage dots over `STAGES = proposal, approval, in_progress, on_hold, closure, closed` (`projectSchedule.js:155`, `project.html:400`); no per-phase % or health | `project-schedule.test.js` "stage gates…" (stage order only) | P2 | Phase model with mapping + per-phase metrics |
| F4 | Portfolio roll-up filter/group by project, programme, site, sponsor, RAG with drill-down | PARTIAL | Programme → objective → project tree + timeline with drill to `project.html?id=` (`portfolio.html:67-71`, `:220-223`); board by stage behind `portfolio_views_enabled='0'` (`reportConfig.js:355`); **no filter by site, sponsor or RAG** | `portfolio-views.test.js` (3); e2e `t8-keyboard-portfolio.spec.js` | P2 | Filter bar via `lib/urlFilters.js` |
| F5 | Widgets: S-curve PV/EV/AC, phase bars, milestone strip, top overdue/at-risk | PARTIAL | No EVM anywhere (grep SPI/CPI/earned in services/public = 0) → **S-curve MISSING**; milestone markers on the portfolio timeline; top overdue/blocked = cockpit "PPM exceptions" (`cockpit.html:63`, `routes/governance.js:670-676` `findExceptions`) | `ppm-alerts.test.js`, `ppm-alerts-cli.test.js` | P2 | EVM model (PV from baseline × time-phased cost, EV from % complete, AC from budget periods) |
| F6 | Dashboard numbers reconcile to engine outputs, proven by test | PARTIAL — **P0 defect** | Objective roll-up `projDone` counts a project with **no progress as 0 %** (`services/portfolioEvidence.js:21`, `Number(p.progress_pct) \|\| 0`) — violates the null≠0 rule and drags objectives down; capacity parity and roadmap parity ARE tested | `portfolio-capacity-parity.test.js`, `roadmap-parity.test.js`; nothing pins `projDone` | **P0** | Average only known values; null when none; add test |

## G — Governance: stage gates, RAG, RAID, change control

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| G1 | Gate transition BLOCKED unless mandatory checklist + artifacts + RBAC e-sign-off (audited), negative tests | PARTIAL | `stageGate` (`projectSchedule.js:175-195`): order, charter ≥ 20 chars, sponsor, start/end/baseline dates, **owner ≠ approver** (GATE_SOD), no open tasks at closure, no open high risk at closed, reason ≥ 10 for hold/reopen; committee-only route `routes/governance.js:576`; passage written to the hash-chained `ppm_events`. **Missing:** configurable per-gate checklist, required artifacts (documents), multi-approver e-sign-off (identity = session only) | `project-schedule.test.js` "stage gates: order, charter, baseline, sponsor, separation of duties, closure checks"; `ppm-project-lifecycle.smoke.test.js` "A-14: the owner sees GATE_SOD … POST is refused 409" | P2 | Gate definition table (checklist items, artifact slots, approver roles); never claim legal signature |
| G2 | RAG engine: configurable composite + hysteresis; RED if SPI<0.90 or CPI<0.90 or critical-milestone slip >10 working days or open severe risk; AMBER 0.90–0.95 / slip ≤10 d / high risk; boundary tests | MISSING | Project `status` is a free manual field (`PROJECT_STATUSES`, `services/governanceStore.js:16`); the only automatic colour is the client `slipRag` (14 calendar days); `public/lib/kpiRag.js` registry has no project policy; no SPI/CPI, no hysteresis; `ppm_alert_slip_days='10'` is **calendar** days for the alert job only | none | P2 | `services/projectRag.js` pure engine + `kpiRag` policy row + boundary tests; working days via `workCalendar` |
| G3 | RAID register: P×I, mitigation, owner, residual, cost exposure | PARTIAL | `portfolio_risks.kind` risk/issue/assumption (`governanceStore.js:287`), P×I on 1..3, mitigation, owner, status, matrix (`ppmVisuals.riskMatrix`); **no residual P×I, no cost exposure, no "dependency" kind** (dependencies = task links) | lifecycle smoke "A-14: RAID kinds and task fields are validated…"; `ppm-visuals.test.js` "riskMatrix…" | P2 | Residual scoring + exposure (money-gated) |
| G4 | Change requests with schedule/cost impact simulation BEFORE approval | PARTIAL (OFF) | Lifecycle proposed→assessed→approved/rejected→applied, author never decides, apply → re-baseline (`ppmWorkbench.js` CR_STEPS; `routes/governanceWorkbench.js:119-156`) behind `ppm_change_requests_enabled='0'` (`reportConfig.js:352`). Impact is a **declared** number (days / amount), no what-if re-run of the CPM | `ppm-workbench.test.js` "R2-WB-01 crTransition…"; `ppm-workbench.smoke.test.js` "R2-WB-01 change requests: 404 while off; on: author ≠ approver…" | P2 | Dry-run `scheduleView` on a proposed delta, show finish/critical-path shift |
| G5 | Versioned baselines | PARTIAL (OFF) | Append-only `portfolio_baselines`, capture at approval + committee re-baseline with SoD (`services/ppmBaseline.js`, `governanceStore.js:738-756`); switches `ppm_baseline_versions='0'`, `ppm_rebaseline_enabled='0'`. Dates only — **no cost baseline** | `ppm-baselines.smoke.test.js` (8 incl. "rows cannot be updated or deleted"); `ppm-baseline.test.js` | P1 | Turn on; add cost baseline (money-gated) |
| G6 | Decision log | IMPLEMENTED | `decisions` register DEC-…, status history in hash-chained `ppm_events` (`governanceStore.js:174-215`); stale-write guard (`:209-210`). Enforced lifecycle behind `decision_lifecycle_enforced` (off) | `decision-lifecycle.test.js`; `governance-routes.smoke.test.js` (hash chain assertion, line 136) | — | — |

## H — Collaboration & reporting

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| H1 | Comments with @mentions on project items | MISSING | No comment entity on project/task/risk; History tab = ledger events (`project.html:719`) | — | P2 | Comment table + mention notifications |
| H2 | Versioned attachments | MISSING | Only `evidence_link` URL on benefits; no file store for projects (inspection blob store not used here) | — | P2 | Reuse `services/blobStore.js` with version rows |
| H3 | Notifications | PARTIAL (OFF) | Nightly A11 exception job notifies in-app only when `ppm_alerts_enabled='1'`; dry run otherwise (`reportConfig.js:223`) | `ppm-alerts.test.js`, `ppm-alerts-cli.test.js` | P2 | Event-driven notifications (assignment, gate, CR) |
| H4 | Audit trail | IMPLEMENTED | `ppm_events` append-only + hash-chain triggers (`db/postgres/reports/039_native_ppm.sql:28-41`); History tab; system_log | `governance-routes.smoke.test.js` (row_hash); `ppm-baselines.smoke.test.js`; `project-page.test.js` "History tab handles HTTP 403…" | — | — |
| H5 | Stakeholder RACI | PARTIAL (OFF) | Task × person RACI, exactly one A (`public/lib/ppmExtras.js`, `routes/governancePpm.js:74-100`) behind `ppm_raci_enabled='0'` | `ppm-raci-templates.test.js` (5) | P3 | Turn on; stakeholder (not only task) RACI |
| H6 | Scheduled PDF / Excel reports | MISSING | `services/reportSchedule.js` has no portfolio/project type; deck.pptx / workbook.xlsx / report.html are on-demand only (`routes/governance.js:696-740`) | `portfolio-deck.test.js` (on-demand) | P2 | `portfolio` schedule type, armed OFF, like the other digests |
| H7 | Paginated printable Gantt with legend | MISSING | On-screen legend only (`project.html:469-479`); no `@media print` in project.html / portfolio.html; Gantt width fixed | — | P2 | Print stylesheet + page-split SVG |
| H8 | Export API | PARTIAL | Session-gated `workbook.xlsx`, `deck.pptx`, `raci.csv`; external API `/ext/v1` is metrics-only (`routes/extApi.js:84-87`); no MSPDI/XML/MPP import or export | `portfolio-deck.test.js`; `ppm-workbench.test.js` (workbook) | P1 | Read-only `/ext/v1/projects` scope + MSPDI export |

## I — Performance, persistence, offline-first

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| I1 | ≥ 5,000-row Gantt at 60 fps (virtualization + canvas/SVG) | MISSING — architectural gap | Whole chart is one string-built SVG re-rendered with `innerHTML` (`project.html:455`, `:498-535`); every row also rendered in the table; no windowing | — (no perf test; `perf-baseline.test.js` only aggregates e2e timings) | P1 | Virtualized row window + canvas or pooled SVG |
| I2 | 10k-task incremental reschedule < 1 s | PARTIAL | `scheduleView` is a full (not incremental) CPM recompute; ad-hoc measurement at head on this box: **10,000 tasks ≈ 102 ms, 5,000 ≈ 69 ms** (scratchpad script, not committed). But "reschedule" is display-only: entered task dates are **never moved** by a predecessor change (`barOf` prefers entered dates, `project.html:441-446`), so a dependency can be silently violated | none committed | P0/P1 | Propagation pass that flags or shifts violated FS links; perf test in CI |
| I3 | 10-minute scroll soak, memory stable | MISSING | — | — | P1 | Browser soak harness |
| I4 | Offline-first for PROJECT data (local transactions survive reload, sync queue, low-bandwidth mode) | MISSING | The field-app outbox is **inspections / tracker / action / ticket only** (`services/fieldOutbox.js:12`); `project.html` writes with direct `fetch` (`:273`) — no local queue, no draft store | Field outbox is tested (`field-outbox.test.js`, `field-no-silent-loss.test.js`) — not applicable to projects | P1 | Extend outbox kinds to project/task writes or a project draft store |
| I5 | Multi-user conflict detection + merge UI | MISSING — **P0 integrity** | Task/project/milestone updates are last-write-wins: `updateRow` = `UPDATE … WHERE id=?` with no version/updated_at check (`services/governanceStore.js:41`). Contrast decisions/sessions, which DO guard (`:159`, `:209-210`) | none | **P0** | `version` column + `WHERE version=?` → 409 STALE + reload/merge prompt |

## K — Security, admin, localisation

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| K1 | Roles admin / PM / scheduler / resource manager / contributor / viewer / client | PARTIAL | Real roles: admin tier, `committee-member` (gates, approvals — `routes/governance.js:62-64`), site `editor` (plan writes only with `portfolio_editor_plan_writes='0'` → OFF), viewer (read), finance money reader. No PM/scheduler/resource-manager/client distinction; owner is free text | `portfolio-access.test.js` "canEditPlan — writes off/on…"; `portfolio-access-parity.smoke.test.js` | P3 | Role mapping table in AUTHZ-MATRIX before any new role |
| K2 | Org > site > project scoping | PARTIAL (OFF) | `canReadProject` / `filterPortfolio` (`services/portfolioAccess.js`) behind `portfolio_site_scope_reads='0'` (`reportConfig.js:216`) → **today every session reads every project** | `portfolio-access.test.js`; `portfolio-site-scope.smoke.test.js` | P3 | Turn on after pilot |
| K3 | Field-level rights | PARTIAL | Money only (`canSeeMoney`, deck/workbook strip amounts); no other field-level control | `ppm-baselines.smoke.test.js` "deck.pptx and workbook.xlsx: … a viewer gets no budget / spent anywhere"; `money-coverage.test.js` | P3 | — |
| K4 | MFA / SSO | PARTIAL | Entra SSO exists but `sso_mode` off by default; no native MFA (delegated to Entra) | `sso-*` tests (outside PPM) | P3 | — |
| K5 | Audit log | IMPLEMENTED | `ppm_events` + `system_log` | see H4 | — | — |
| K6 | Reversible migrations | MISSING | Forward-only `db/postgres/reports/*.sql` (no down scripts; soft-delete only for portfolio rows, `052_portfolio_soft_delete.sql`) | `soft-delete-portfolio.test.js` (data, not schema) | P3 | Paired down-migrations or documented restore point per migration |
| K7 | FR / EN UI on PPM pages | PARTIAL (OFF) | `portfolio.fr.js` exists but `ui_i18n_pages='0'`; **project.html listed "French pending"** (`tests/i18n-coverage.test.js:119`); cockpit self-translated; itsm-roadmap hard-coded French | `i18n-coverage.test.js` | P3 | `project.fr.js` + switch on |
| K8 | Local date / number formats | MISSING | ISO dates and raw numbers throughout project/portfolio pages | — | P3 | `Intl` formatting via i18n boot |
| K9 | Per-country holiday calendars | PARTIAL | `site_calendar` + `services/workCalendar.js` exist and are used by escalations/handoffs, **not by the scheduler** (`projectSchedule.js` uses calendar days, `days()` line 13) | none for projects | P1 | Feed `workCalendar` into CPM durations |
| K10 | Multi-currency | PARTIAL | Per-currency amounts never summed (correct), no FX consolidation for PPM | `portfolio-finance-currency.smoke.test.js`; lifecycle smoke "two currencies are never added together" | P3 | Optional certified FX roll-up |

## L — Agile / hybrid & roadmaps

| ID | Requirement | Status | Evidence | Test ref | Prio | Fix summary |
|---|---|---|---|---|---|---|
| L1 | Boards / sprints / backlog mapped to work packages with roll-up rules | MISSING | Only a read-only portfolio board by stage (OFF, `portfolioViews.boardHtml`); no sprint/backlog entity | `portfolio-views.test.js` (board only) | P3 | — |
| L2 | Portfolio roadmap by quarter / month | PARTIAL | Continuous-date portfolio timeline (`portfolio.html:205-218`); no quarter/month bucketing; `itsm-roadmap.html` is a personal objective list (no timeline) | e2e `t8-keyboard-portfolio.spec.js` | P2 | Bucketed roadmap view |
| L3 | Milestone trend analysis | MISSING | `baseline_date` vs `due_date` per milestone only; baseline-version diff exists (OFF) but no trend chart | `ppm-baseline.test.js` (diff only) | P2 | MTA chart from baseline versions |
| L4 | Now / Next / Later | MISSING | — | — | P3 | — |

---

## T1–T11 coverage

> **Assumption, stated plainly:** the T1–T11 certification definitions are not in the repository (no `docs/audits/2026-11-12-ppm-parity`
> spec existed before this file; the `T1…T12` files under `docs/ops/` are usability-test sheets, unrelated). The rows below use the
> standard MS-Project-parity certification set this checklist implies; re-map if the requester's list differs.

| T | Certification test (assumed) | Closest existing test | Coverage |
|---|---|---|---|
| T1 | CPM correctness vs reference (forward/backward pass, slack) incl. SS/FF/SF + lag | `project-schedule.test.js` "critical path: longest finish-to-start chain, slack of the parallel task"; "scheduleView: anchors es/ef…" | PARTIAL (FS only, no lag, no reference oracle) |
| T2 | Working-day calendars / holidays in durations | none for projects (`workCalendar` tests cover escalations) | MISSING |
| T3 | Resource over-allocation / levelling | `project-schedule.test.js` "resource conflicts…"; `ppm-visuals.test.js` "resourcePressure agrees with projectSchedule.resourceConflicts…" | PARTIAL (detect only, no levelling) |
| T4 | Baseline capture, immutability, variance | `ppm-baselines.smoke.test.js` (8); `ppm-baseline.test.js` (3) | PARTIAL (behind OFF switch; dates only) |
| T5 | EVM SPI/CPI/EAC math | `ppm-budget-periods.test.js` (EAC from money periods only) | MISSING (no SPI/CPI/EV) |
| T6 | Stage-gate negative tests (blocked without prerequisites, SoD) | `project-schedule.test.js` "stage gates…"; lifecycle smoke "GATE_SOD … 409" | PARTIAL (no checklist/artifact/e-sign gates to test) |
| T7 | RAG boundary tests (SPI/CPI/slip/risk thresholds, hysteresis) | `kpi-rag.test.js` (generic tracker policies, not projects) | MISSING |
| T8 | 5k-row Gantt render ≥ 60 fps | none (`perf-baseline.test.js` aggregates e2e timings only) | MISSING |
| T9 | 10k-task reschedule < 1 s | none committed (ad-hoc 102 ms measurement in this audit) | MISSING |
| T10 | Offline + multi-user conflict / merge for project data | `field-outbox.test.js`, `field-no-silent-loss.test.js` (field app kinds only) | MISSING for projects |
| T11 | Import/export round-trip (MSPDI/XML/XLSX) | `portfolio-deck.test.js`, `ppm-workbench.test.js` "workbook…" (export only) | PARTIAL (XLSX/PPTX export only, no import, no MSPDI) |

---

## Switched-off features (exist, tested, OFF by default — not available to users today)

`ppm_baseline_versions`, `ppm_rebaseline_enabled` (G5/C6b) · `ppm_change_requests_enabled` (G4) · `ppm_alerts_enabled` (H3) ·
`ppm_raci_enabled`, `ppm_templates_enabled` (H5) · `ppm_project_team_enabled` (C7f) · `ppm_time_entries_enabled` ·
`ppm_budget_periods_enabled` · `ppm_capacity_view` · `portfolio_views_enabled` (F4 board/list) · `roadmap_publication_enabled` ·
`portfolio_site_scope_reads` (K2 — **every session reads every project today**) · `portfolio_editor_plan_writes` (K1 — only the
committee writes plans today) · `ui_i18n_pages` (K7) · `decision_lifecycle_enforced`. All in `services/reportConfig.js` DEFAULTS
(lines 216-359). The UAT committee document (`docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md:57-60`) already
notes that the plan-F workbench is not usable without several of them.

## Counts (this half)

IMPLEMENTED 5 · PARTIAL 29 (of which PARTIAL (OFF) 7) · STUBBED 0 · MISSING 24 — over 58 checklist rows; T1–T11: PARTIAL 5, MISSING 6.
