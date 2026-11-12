# W0 — MS-Project parity gap matrix: architecture, WBS, scheduling, resources, EVM, interop

- **Head audited:** `55dc67c` (local branch `sdp-waves`, worktree `/home/user/fixinst`)
- **Nature:** READ-ONLY audit. No code, schema or data was changed. This file is the only output and is left uncommitted.
- **Scope (this half):** architecture model · A (WBS) · B (scheduling/CPM) · D (resources/capacity) · E (EVM & financials) · J (interoperability) · stub scan.
- **Evidence run:** 13 existing test files executed on throwaway PG databases (`project-schedule`, `ppm-baseline`, `ppm-budget-periods`, `ppm-capacity`, `ppm-workbench`, `allocation-contract`, `ppm-visuals`, `project-page`, `portfolio-benefits`, `ppm-baselines.smoke`, `ppm-project-lifecycle.smoke`, `ppm-workbench.smoke`, `ppm-raci-templates`) → **100 pass / 0 fail**; DBs dropped afterwards. Plus a pure-function repro script (results R1–R8 below), no DB.
- **Taxonomy:** IMPLEMENTED (proven by a cited test or repro) · PARTIAL (exists, incomplete/incorrect — concrete case cited) · STUBBED (UI/API with fake logic) · MISSING · OUT-OF-BOUNDARY (`.claude/rules/SDP360_BOUNDARIES.md`). Priority: P0 math/data correctness & integrity · P1 MS-Project parity & performance · P2 exec/governance · P3 enterprise.

## Architecture as found

SDP360's PPM is a **lightweight IT portfolio/governance tool, not a scheduling engine**. Data model (PostgreSQL, `db/postgres/reports/`):
`portfolio_programmes` → `portfolio_objectives` (weighted) → `portfolio_projects` (`018_governance.sql:21-30`; stage/charter/sponsor/baseline/actual columns added by `039_native_ppm.sql:4-12`) → `portfolio_tasks` (`039_native_ppm.sql:15-22`) plus `portfolio_milestones`, `portfolio_deliverables`, `portfolio_risks` (RAID via `kind` risk|issue|assumption, `044_project_page.sql`). Around them: `portfolio_baselines` (versioned, append-only, **dates only**, `045_ppm_baselines.sql`), `ppm_events` (append-only + hash-chained ledger, `039:24-36`), `ppm_budget_periods` (month × currency × baseline/actual/forecast, `072`), `ppm_raci` + `ppm_templates` (`073`), `ppm_project_members`, `ppm_time_entries`, `ppm_change_requests` (`085`), `portfolio_benefits` (`056`, `081`), `portfolio_project_sites` (`043`).

**Tasks and dependencies:** a task row carries `parent_id` (self-FK, the only hierarchy), a free-text `wbs_code`, `start_date`/`end_date` as **TEXT**, `duration_days` (integer, calendar days), `allocation_pct`, `progress_pct`, `effort_hours`, `owner` (free text) and `depends_on` as a **JSON array of predecessor ids stored in a TEXT column** — finish-to-start only, no lag, no link type. There is no Calendar, Resource, Assignment, TimephasedData (beyond monthly money and daily actual hours), WBS-node-as-entity, Document, or Portfolio table (the portfolio is the implicit set of programmes).

**Is there a Gantt engine?** No. `services/projectSchedule.js` (213 lines, pure) offers a cycle check (`dependencyProblem`), a Kahn-ordered forward/backward pass over **finish-to-start, calendar-day durations, anchored at day 0** (`criticalPath`, `scheduleView`), a per-owner over-allocation check (delegated to `public/lib/allocationContract.js`), stage gates, and baseline-vs-forecast variance. The project page (`public/project.html:498-534`) draws a **read-only, non-virtualized SVG** whose bars use the *entered* dates when present and the *computed* dates only when absent — so the drawn bar and the critical-path flag can come from two different models (R1). The portfolio "Gantt" (`public/portfolio.html:225`) is an HTML table, one row per project. Editing is form-based (no drag, indent/outdent or inline grid). Server-side RBAC on PPM routes exists (session + committee / plan-write / money rules).

## Repro results (pure functions, `node` on head `55dc67c`)

| Ref | Input | Output | Meaning |
|---|---|---|---|
| R1 | task 1 `2026-01-01→01-10`, task 2 `2026-03-01→03-05`, no deps, anchor `2026-01-01` | task 2 `es_date 2026-01-01`, slack 5, task 1 critical | Entered start dates are ignored by CPM; the project really finishes 03-05 with task 2, yet task 1 is flagged critical. Gantt draws task 2 in March (entered dates) next to a CP computed in January. |
| R2 | parent 10 (30 d) with children 11 (2 d) → 12 (3 d) | `path:[10]`, children slack 25 | A summary task is a scheduled network node with its own duration; children never roll up to it. |
| R3 | child 11 depends on its own parent 10 | `null` (accepted) | Parent/child dependency not refused. |
| R4 | 2 d task from Fri 2026-11-13 → successor | successor on Sun 2026-11-15 | Calendar days only; no working calendar. |
| R5 | task `duration_days: 0` | `ef = es+1`, `assumed_duration: true` | A 0-duration milestone task is forced to 1 day. |
| R6 | objective with no metric/manual progress, projects at 100 % and `null` | `evidence_pct 50` | Unknown project progress counted as 0 % (violates the "UNKNOWN never 0" rule) and averaged unweighted. |
| R7 | project with `end_date` but no `baseline_end` | `slip_days 0` | Unmeasurable slip reported as "on baseline" (0) instead of null. |
| R8 | USD project budget 100 / spent `null` + budget 50 / spent 20 | `spent 20`, no unknown flag | A project with a known budget and unknown spent contributes 0 spent silently; `budget_unknown` only counts projects where both are null. |

## Matrix

| ID | requirement | status | evidence file:line | test ref | priority | fix summary |
|---|---|---|---|---|---|---|
| ARCH-1 | Portfolio entity | PARTIAL | no table; implicit = all `portfolio_programmes` (`services/governanceStore.js:325-343`) | ppm-project-lifecycle.smoke "witness project end to end" | P2 | Add explicit portfolio (or document single-portfolio assumption) |
| ARCH-2 | Program entity | IMPLEMENTED | `018_governance.sql:21`; objectives layer `:23` | ppm-project-lifecycle.smoke "G13: roadmap → portfolio migration…" | — | — |
| ARCH-3 | Project entity | IMPLEMENTED | `018:27`, `039:4-12` | ppm-project-lifecycle.smoke "A-14: GET /portfolio/project/:id…" | — | — |
| ARCH-4 | WBSNode/Task entity | PARTIAL | `039_native_ppm.sql:15-22` (tasks with `parent_id`; no WBS-node model) | project-schedule tests (pure) | P1 | Task tree with typed summary/leaf, computed WBS |
| ARCH-5 | Dependency entity | PARTIAL | `depends_on TEXT` JSON array on task (`039:20`, store `governanceStore.js:424`) | project-schedule "dependencies: self, unknown, duplicate and cycles…" | P0 | Dedicated link table (pred, succ, type, lag, lag_unit) with FK integrity |
| ARCH-6 | Calendar entity | MISSING | none (calendar days everywhere, `projectSchedule.js:13`) | R4 | P1 | Calendar + exceptions model |
| ARCH-7 | Resource entity | MISSING | owner is free text (`039:17`); `ppm_project_members` is a per-project label (`085`) | — | P1 | Enterprise resource pool table |
| ARCH-8 | Assignment entity | PARTIAL | one owner + `allocation_pct` per task (`039:19`); team members `085` | ppm-workbench "R2-WB-04 a member allocation fills an UNKNOWN…" | P1 | Many-to-many task↔resource assignment with units/work |
| ARCH-9 | TimephasedData | PARTIAL | `ppm_budget_periods` monthly money (`072`); `ppm_time_entries` daily actual hours (`085`); no timephased work/PV | ppm-budget-periods "EAC = actual to date…" | P0 (for EVM) | Timephased work/cost store (planned per day/period) |
| ARCH-10 | Baseline entity | PARTIAL | `portfolio_baselines` dates only (`045`; `ppmBaseline.js:4`) | ppm-baselines.smoke "switch on: approval → in_progress writes version 1…" | P1 | Add work/cost to baselines, BL slots |
| ARCH-11 | Risk / Issue | IMPLEMENTED | `portfolio_risks` + `kind` (`044`), `RISK_KINDS` `governanceStore.js:305` | ppm-project-lifecycle.smoke "A-14: RAID kinds and task fields are validated…"; ppm-visuals "riskMatrix…" | — | — |
| ARCH-12 | ChangeRequest | IMPLEMENTED (flag-gated) | `ppm_change_requests` (`085`), `ppmWorkbench.js` CR_ACTIONS | ppm-workbench.smoke "R2-WB-01 change requests…"; ppm-workbench "R2-WB-01 crTransition…" | — | — |
| ARCH-13 | Gate / SignOff | IMPLEMENTED | `projectSchedule.js:179-211` stage gates; ledger `ppm_events` | project-schedule "stage gates: order, charter, baseline, sponsor, separation of duties…" | — | Identity signature is human (boundary) |
| ARCH-14 | Document entity | MISSING | only `evidence_link` on benefits (`056`) | — | P3 | Document/attachment model per project |
| ARCH-15 | Timesheet | PARTIAL | `ppm_time_entries` (`085`), no approval | ppm-workbench.smoke "R2-WB-02 time entries…" | P1 | Timesheet periods + approval (see D9) |
| ARCH-16 | User / Role | IMPLEMENTED | platform users/roles; PPM uses committee + `portfolioAccess` | portfolio-access tests; ppm-baselines.smoke "exceptions: a site editor sees only…" | — | — |
| ARCH-17 | AuditEvent | IMPLEMENTED | `ppm_events` append-only + hash chain (`039:24-36`) | ppm-baselines.smoke "…ledger baseline_captured" | — | — |
| ARCH-18 | Stable IDs | IMPLEMENTED | `BIGINT GENERATED ALWAYS AS IDENTITY` on all PPM tables | (schema) | — | — |
| ARCH-19 | Computed WBS codes | MISSING | `wbs_code` is free text, user-typed (`project.html:114`, normalise `governanceStore.js:431`) — duplicates/gaps accepted | — | P1 | Derive WBS code from tree position; mask |
| ARCH-20 | Timephased storage vs totals only | PARTIAL | totals per task; only money (monthly) and actual hours (daily) are timephased | — | P0 (EVM) | see ARCH-9 |
| ARCH-21 | Incremental recalculation | MISSING | `scheduleView` recomputes whole project on every GET (`routes/governance.js:583+`); nothing persisted | — | P1 | Persist computed dates; recalc dirty subgraph |
| ARCH-22 | Single source of truth grid↔Gantt | PARTIAL / incorrect | bar from entered dates, CP from day-0 network (`project.html:441-445` vs `projectSchedule.js:67`) | R1 | P0 | One scheduled date set drives table, bar and CP |
| ARCH-23 | Virtualization + canvas/SVG | PARTIAL | SVG yes (`project.html:498`); fixed 980 px, every row rendered, no virtualization | ppm-visuals "project.html Gantt: bars are focusable…" | P1 | Row virtualization, zoom/timescale |
| ARCH-24 | Reversible migrations | MISSING (for PPM) | `db/postgres_rollback/` has 5 drops, none for 010/011/018/039/043-045/052/056/072/073/081/085 | — | P2 | Add down scripts for PPM migrations |
| ARCH-25 | Server-side RBAC on PPM routes | IMPLEMENTED | `routes/governance.js:556-726` (requireReportSession + requireCommittee / `refusePlanWrite` / `canReadProject` / money strip); `routes/roadmap.js` super_admin; workbench routes reuse `refusePlanWrite` | ppm-baselines.smoke "deck.pptx and workbook.xlsx: … viewer gets no budget"; ppm-workbench.smoke "cross-site 404 under the read scope"; portfolio-access tests | — | — |
| A1 | Unlimited indent/outdent | PARTIAL | arbitrary depth via `parent_id`; no indent/outdent action; no parent-cycle or same-project check (`governanceStore.js:420-457`) | — | P0 (integrity) / P1 (UX) | Validate parent same project, no self/cycle; indent/outdent ops |
| A2 | Parent-child recalculation | MISSING | no rollup of dates/work/progress to parent; parent scheduled as its own node | R2 | P0 | Summary tasks computed from children |
| A3 | Drag/drop/insert/delete with auto re-indexed WBS + custom mask | MISSING | form editor only; `sort_order` manual; WBS free text | — | P1 | Tree editor + WBS recompute |
| A4 | Summary rolled-up dates/work/cost, read-only in auto mode | MISSING | parent fields fully editable, no rollup | R2 | P0 | Read-only computed summary fields |
| A5 | Work-weighted % complete | MISSING / incorrect | task `progress_pct` manual; project/objective progress manual; objective fallback = **naive mean with null→0** (`services/portfolioEvidence.js:21`) | R6 | P0 | Weight by work/duration; exclude unknown, report coverage |
| A6 | 100%-rule validation | MISSING | none | — | P2 | Validate children cover parent scope |
| A7 | Leaf tasks | PARTIAL | implicit (no children); not distinguished for scheduling (R2) | R2 | P1 | Leaf vs summary semantics |
| A8 | 0-duration milestones | PARTIAL | separate `portfolio_milestones` (no deps, not in CPM); a 0-day task is forced to 1 day | R5 | P1 | Milestone = 0-duration task in network |
| A9 | WBS dictionary (scope, acceptance, owner) | PARTIAL | task has owner; charter has scope at project level (`projectSchedule.js:127-140`); no per-node scope/acceptance | project-schedule "charterText…" | P2 | Dictionary fields per node |
| A10 | Templates | IMPLEMENTED (flag-gated) | `ppm_templates` (`073`), `ppmRaci.js:61-71`, `governanceStore.js:687-715` | ppm-raci-templates "templateFromProject carries no people… planFromTemplate puts parents first" | — | — |
| A11 | Tree view | PARTIAL | `taskOrder` indent by depth in table/Gantt labels (`project.html:354-363`); no expand/collapse | project-page tests (render only) | P1 | Collapsible tree grid |
| B1 | Manual vs auto scheduling mode | PARTIAL / incorrect | de facto mixed: entered dates win for the bar, computed dates only when dates absent; no mode flag | R1 | P0 | Explicit per-task mode; auto mode must recompute dates |
| B2 | Task types Fixed Units/Duration/Work × effort-driven (W=D×U) | MISSING | `effort_hours`, `duration_days`, `allocation_pct` independent, no W=D×U | — | P1 | Task type engine |
| B3 | Link types FS/SS/FF/SF with ±lag/lead (days, %, elapsed) | PARTIAL | FS only, no lag (`projectSchedule.js:67`) | project-schedule "critical path: longest finish-to-start chain…" | P1 | Typed links with lag |
| B4 | Multiple preds/succs | IMPLEMENTED | `depends_on` array; `succ` map (`projectSchedule.js:59-61`) | project-schedule "critical path…" (task 4 has 2 preds) | — | — |
| B5 | Cycle detection | IMPLEMENTED (deps) / PARTIAL (hierarchy) | `dependencyProblem` `projectSchedule.js:21-42`, enforced on write `governanceStore.js:484-491`; parent/child links and parent cycles unchecked | project-schedule "dependencies: self, unknown, duplicate and cycles are refused"; R3 | P0 (hierarchy part) | Refuse parent↔child links and parent cycles |
| B6 | 8 constraints ASAP/ALAP/SNET/SNLT/FNET/FNLT/MSO/MFO | MISSING | none; entered dates are not constraints (R1) | R1 | P1 | Constraint model in forward/backward pass |
| B7 | Deadlines + breach alerts | PARTIAL | milestone `due_date` late flag (`project.html:528`), `ppmAlerts.js` dependency/late alerts; no task deadline field | ppm-alerts tests | P1 | Task deadline + negative-float alert |
| B8 | Calendars (project/task/resource, working weeks, holidays per country, shifts, exceptions, elapsed) | MISSING | calendar days only | R4 | P1 | Calendar engine |
| B9 | Forward/backward pass ES/EF/LS/LF | PARTIAL | relative-day pass exists (`projectSchedule.js:66-70`) but ignores dates, constraints, calendars, summary semantics | project-schedule "scheduleView: anchors es/ef…"; R1, R2 | P0 | Date-aware pass |
| B10 | Total float | PARTIAL | `slack = LS−ES` (`:71`); wrong when entered dates differ from network (R1) | project-schedule "critical path…slack of the parallel task" | P0 | — (follows B9) |
| B11 | Free float | MISSING | not computed | — | P1 | Compute FF |
| B12 | Negative float | MISSING | cannot occur (no constraints/deadlines) | — | P1 | Needs B6/B7 |
| B13 | Critical path | PARTIAL / incorrect | zero-slack chain; single path walk from one start (`:73-74`); wrong under R1/R2 | project-schedule "scheduleView: … critical flags equal the critical path"; R1 | P0 | Date-aware CP; multiple chains |
| B14 | Near-critical threshold | MISSING | — | — | P2 | Configurable float threshold |
| B15 | Split / recurring / inactive tasks | MISSING | — | — | P2 | — |
| B16 | Progress (% complete, % work complete, physical %) | PARTIAL | `progress_pct` manual only (`044`); no % work / physical | — | P1 | Distinct progress measures |
| B17 | Actual/remaining duration, status date, progress line | PARTIAL | `actual_start/actual_end` columns; no remaining duration, no status date (page uses `as_of`/today), no progress line | project-schedule "variance: baseline vs forecast vs actual" | P1 | Status date + remaining work model |
| B18 | Baselines BL0–BL10 + interim plans | PARTIAL | one versioned series, dates only, captured at approval (`governanceStore.js:723-760`) | ppm-baselines.smoke "switch on: approval → in_progress writes version 1…" | P1 | Named slots incl. work/cost; interim plans |
| B19 | Variances | PARTIAL | finish/start variance days (`projectSchedule.js:116-125`), diff between versions (`ppmBaseline.js:40-56`); no work/cost variance; portfolio slip null→0 | ppm-baseline "diffBaselines gives day shifts…"; R7 | P0 (R7) | Return null slip without baseline |
| B20 | Re-baseline via change request | IMPLEMENTED (flag-gated) | `rebaselineCheck` `ppmBaseline.js:59-65`; CR apply → baseline version | ppm-baselines.smoke "re-baseline: … another member writes version 2"; ppm-workbench.smoke "R2-WB-01 … apply → baseline version + ledger" | — | — |
| B21 | Task inspector explaining why a date was computed | PARTIAL | Gantt aria-label states "computed", slack, "duration unknown" (`project.html:521`); no driver/predecessor explanation | project-page "Gantt bars carry an aria-label…" | P2 | Driving-predecessor/constraint explanation |
| D1 | Work / material / cost resources | MISSING | — | — | P1 | Resource types |
| D2 | Max units, availability windows, calendars | PARTIAL | member allocation 0..100 + from/to window (`ppmWorkbench.js` normaliseMember, `085`); no calendar | ppm-workbench "R2-WB-04 normaliseMember…" | P1 | Resource availability profile |
| D3 | Rate tables A–E with effective dates + cost-per-use | MISSING | — | — | P1 | Rate tables (needed for AC/EV) |
| D4 | Assignment contours | MISSING | effort spread evenly over calendar days (`ppmVisuals.js` header) | — | P2 | Contours |
| D5 | Overallocation detection + heatmap | IMPLEMENTED | `allocationContract` conflicts/coverage; `resourcePressure`, `capacityBySite` (`ppmVisuals.js:51-125`) | allocation-contract "coverage: counts add up…"; ppm-visuals "resourcePressure agrees with projectSchedule.resourceConflicts…"; ppm-capacity "capacityBySite…" | — | Units are owner-level, per calendar day |
| D6 | Auto/manual leveling respecting links/constraints with explanation | MISSING | `capacityConflicts` only proposes another owner ("suggestion is a proposal only", `ppmVisuals.js:127-152`) | ppm-capacity "capacityConflicts: … suggestion is a proposal only" | P1 | Leveling engine (delay/split) |
| D7 | Generic → named swap | PARTIAL | owner reassignment traced in ledger (`governanceStore.js:530-541`); no generic resource concept | ppm-workbench.smoke (team) / capacity owner reason | P2 | Generic resources |
| D8 | Timesheets | PARTIAL | daily entries, planned vs actual hours (`projectSchedule.js:99-113`) | ppm-workbench "R2-WB-02 actualHours: no entry = null…"; ppm-workbench.smoke "R2-WB-02 time entries…" | P1 | — |
| D9 | Timesheet approval workflow | MISSING | entries are final on write | — | P1 | Submit/approve periods |
| E1 | Timephased PV from BASELINE | MISSING | no PV anywhere (grep SPI/CPI/earned value: no hits outside EAC); budget baseline is a manual monthly amount, not derived from baseline schedule | — | P0 | PV from baseline timephased cost |
| E2 | EV methods (0/100, 50/50, % complete, physical) | MISSING | — | — | P0 | EV engine |
| E3 | AC from actuals | PARTIAL | manual monthly `actual` amounts (`ppmBudgetPeriods.js:47-49`); hours not costed (no rates) | ppm-budget-periods "EAC = actual to date…" | P0 | AC from timesheets × rates + fixed costs |
| E4 | PV EV AC SV CV SPI CPI | MISSING | — | — | P0 | — |
| E5 | EAC ETC VAC TCPI | PARTIAL | EAC = actual_to_date + remaining forecast, variance vs baseline total (`ppmBudgetPeriods.js:47-55`); no ETC/VAC/TCPI, not CPI-based | ppm-budget-periods "EAC = actual to date + remaining forecast; variance…" | P1 | Standard EVM formulas once PV/EV exist |
| E6 | Bottom-up rollups leaf→summary→project→portfolio | PARTIAL / incorrect | task→project: none; project→programme money `moneyRollup` per currency (`portfolioEvidence.js:74-86`) counts unknown `spent` as 0 when budget known; objective progress null→0 | R6, R8; ppm-project-lifecycle.smoke "two currencies are never added together" | P0 | Null-aware rollups with coverage counts |
| E7 | CapEx / OpEx | PARTIAL | `spend_type` capex/opex/mixed label only, no amount split (`039:11`) | — | P2 | Amount per class |
| E8 | Resource + fixed costs | MISSING | single project `budget`/`spent` + monthly periods; no cost lines | — | P1 | Cost model |
| E9 | Multi-currency XOF/USD/EUR with rates | PARTIAL | per-currency, never summed (`ppmBudgetPeriods.js:4`, `portfolioEvidence.js:69-73`); currency default flagged (`governanceStore.js:459-468`); no FX conversion for PPM | ppm-budget-periods "two currencies are never summed"; portfolio-finance-currency.smoke | P1 | Dated FX table + converted reporting view |
| E10 | S-curves | MISSING | monthly table only (`public/lib/ppmExtras.js:17-29`) | — | P2 | Cumulative PV/EV/AC chart |
| J1 | MSPDI XML lossless round-trip | MISSING | no MSPDI code (grep) | — | P1 | Importer/exporter — a FILE format, in boundary (not a connector) |
| J2 | CSV/Excel mapped import/export documented as lossy | PARTIAL | exports: `workbook.xlsx`, `deck.pptx`, `raci.csv`, `annual-pack.xlsx` (`routes/governance.js:696-706`, `routes/governancePpm.js:81,131`); no task import, no lossiness doc | ppm-baselines.smoke "deck.pptx and workbook.xlsx…"; ppm-raci-templates "matrix + CSV…" | P1 | Mapped task import + documented loss |
| J3 | .mpp / Primavera P6 files | MISSING | — | — | P3 | File import (XER/XML) is in boundary; binary .mpp needs licensed library |
| J4 | Jira / Azure DevOps | MISSING | — | — | P3 | Was OUT-OF-BOUNDARY at audit time; the user lifted the external-PPM-connector ban on 2026-11-12. Allowed as an optional extra only — the native tool must stand alone. |
| J5 | REST API | PARTIAL | internal JSON routes, session-cookie auth, undocumented for third parties | ppm-project-lifecycle.smoke (HTTP) | P3 | Documented, token-auth API |
| J6 | Webhooks (PPM events) | MISSING | webhooks exist only for Teams SLA alerts | — | P3 | Outbound event webhook (not a connector to a PPM tool) |
| J7 | SSO | IMPLEMENTED (platform) | Entra OIDC `services/ssoEntra.js`, `ssoSettings.js` | sso-routes.smoke, sso-entra, sso-login | — | — |

## Stub-pattern scan

Scanned: `services/projectSchedule.js`, `services/ppm*.js`, `services/portfolio*.js`, `services/roadmap*.js`, `services/governanceStore.js`, `routes/governance*.js`, `routes/roadmap.js`, `public/lib/ppm*.js`, `public/lib/portfolioViews.js`, `public/project.html`, `public/portfolio.html`, `public/itsm-roadmap.html`. Patterns: `TODO|FIXME|XXX|Math.random|mock|dummy|fake|lorem`, empty/quiet catch, linear spread.

- **TODO/FIXME/Math.random/mock arrays:** no hits in the PPM code paths.
- `routes/governance.js:69`, `:328` — `catch (_) {}` around audit `logEvent` (prod path; by design fire-and-forget logging, acceptable).
- `routes/governance.js:138` — `catch (_) {}` around `scoreTracker` per tracker inside the governance evidence loop (prod path): a scoring error silently drops that tracker's row instead of returning UNKNOWN. **P2**, should emit an explicit "not measured" row.
- `routes/governance.js:771` — `catch (_) { meetings = null; }` optional dependency (prod path, acceptable degrade).
- `services/projectSchedule.js:137`, `public/project.html:346` — `JSON.parse` fallback to plain-text charter (prod path, intentional).
- **Linear spread:** `public/lib/ppmVisuals.js` (header §resourcePressure) spreads `effort_hours` evenly over calendar days for the pressure view — display-only, no PV derived from it. No linear PV spread exists because **no PV exists at all** (E1 MISSING, not STUBBED).
- **Zero-as-unknown fallbacks (not stubs but P0 correctness):** `portfolioEvidence.js:21` (`Number(p.progress_pct) || 0`), `:36` (`slip … : 0` without baseline), `:81` (`Number(p.spent) || 0`).

No item qualified as STUBBED: what exists computes for real; what is absent is genuinely absent.

## Status counts

IMPLEMENTED 15 (incl. 3 flag-gated, 1 platform-level) · PARTIAL 36 · STUBBED 0 · MISSING 31 · OUT-OF-BOUNDARY 1 — 83 items (ARCH 25, A 11, B 21, D 9, E 10, J 7). Status is the leading word of the status cell; "PARTIAL / incorrect" rows are counted PARTIAL and are the P0 correctness defects.
