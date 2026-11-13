# PPM parity audit — W0 (read-only) — consolidated view

- **Date:** 2026-11-12 · **Head audited:** `55dc67c` · **Nature:** read-only gap analysis. No code was changed for W0.
- **Detail matrices (per requirement, with file:line and test evidence):**
  - [`W0-MATRIX-ENGINE.md`](W0-MATRIX-ENGINE.md): architecture model, A WBS, B scheduling/CPM, D resources, E EVM and financials, J interoperability, stub scan.
  - [`W0-MATRIX-UX-GOV.md`](W0-MATRIX-UX-GOV.md): C Gantt and views, F simplified view and executive dashboard, G governance, H collaboration and reporting, I performance and offline, K security and localisation, L agile and roadmaps.
- **Status:** **NOT CERTIFIED.** Not one T1–T11 certification test passes in the sense required. Nothing here claims parity with MS Project.

## 1. Totals

| Matrix | Items | IMPLEMENTED | PARTIAL | STUBBED | MISSING |
|---|---:|---:|---:|---:|---:|
| Engine (ARCH, A, B, D, E, J) | 83 | 15 | 36 | 0 | 32 |
| UX and governance (C, F, G, H, I, K, L) | 58 | 5 | 29 | 0 | 24 |
| **Total** | **141** | **20 (14 %)** | **65** | **0** | **56** |

- **Counting notes:**
  - 3 engine items and 7 UX items counted as IMPLEMENTED or PARTIAL are complete and tested but sit behind a `report_config` switch that is **off** by default, so users do not see them today.
  - Engine J4 (Jira/Azure DevOps) was out of bounds at audit time. The user lifted the ban on 2026-11-12, so it is counted as MISSING (P3) here.
- **STUBBED = 0:** no fake logic was found (no TODO, `Math.random`, mock data or linear spread in PPM production paths). The gaps are real absences, not pretend features.

## 2. What the tool is today

The native tool is a **light IT portfolio manager**:
- projects, tasks, milestones, risks, phases, gates, benefits and baselines;
- a read-only SVG Gantt;
- a relative-day critical-path calculation, finish-to-start links only, in calendar days;
- strong server-side access control and a hash-chained audit ledger.

It is **not** a scheduling engine of the MS Project class:
- no calendars, constraints, task types, SS/FF/SF links or lags;
- no earned value, resource pool, levelling, MSPDI import/export, interactive or virtualised Gantt, or offline project editing.

## 3. P0 defects (data correctness) — W1 starts here

| Ref | Defect | Evidence |
|---|---|---|
| B-CPM-1 | Entered task dates are ignored by the schedule (every task starts at day 0). The Gantt draws the entered dates but flags critical-path tasks from a different, relative calculation. | `services/projectSchedule.js:67`, `public/project.html:441`, repro R1 |
| A-SUM-1 | Summary tasks are scheduled like leaves; nothing rolls up from children. | repro R2 |
| A-INT-1 | No hierarchy integrity: self-parent, parent cycles, parent from another project, end before start and non-date strings are all accepted. | `services/governanceStore.js:420-457`, repro R3 |
| E-NULL-1 | Unknown progress counted as 0 % in an unweighted mean. | `services/portfolioEvidence.js:21`, repro R6 |
| E-NULL-2 | Missing baseline reads as "slip 0". | `services/portfolioEvidence.js:36`, repro R7 |
| E-NULL-3 | Unknown spend added as 0. | `services/portfolioEvidence.js:81`, repro R8 |
| I-CONC-1 | Task, project and milestone writes are last-writer-wins with no version check (decisions and sessions already have one). | `services/governanceStore.js:41` |
| E-EVM-1 | No earned value at all (PV, EV, SPI, CPI, ETC, VAC, TCPI). | engine matrix §E |
| B-MS-1 | A 0-day milestone is forced to 1 day. | repro R5 |
| ARCH-MIG-1 | No PPM migration has a rollback script. | `db/postgres_rollback/` |

## 4. Certification suite T1–T11 (definitions from the request) — current coverage

| T | Definition | Closest existing test | Today |
|---|---|---|---|
| T1 | 1,000-task MSPDI golden file round-trip, to the minute | `ppm-mspdi.test.js` (generated golden, SHA-256 pinned, fixed point, re-schedule identical) + `ppm-engine-routes.smoke` (DB export → import → export) — W2-ENGINE | PASS on our parser; opening the file in MS Project = human check |
| T2 | CPM: 4 link types × lag × 8 constraints × calendars, float incl. negative | `ppm-schedule-engine.test.js` (W1) + `ppm-w2-engine.test.js` (lag units d/ed/%, leads, constraints with typed lags, deadlines, holidays / exceptions, hand fixtures) | PASS at engine level (not an exhaustive cartesian product) |
| T3 | Task-type matrix, 3 types × effort-driven | none | MISSING |
| T4 | Rollups: work-weighted %, cost/work leaf→portfolio, 100 % rule | none (unweighted mean, see E-NULL-1) | MISSING |
| T5 | EVM hand-computed reference | `ppm-budget-periods.test.js` (EAC from money periods only) | MISSING |
| T6 | Levelling, every move explained | `ppm-w2-engine.test.js` + `ppm-w2-bench.test.js` (1,000 tasks) + smoke (proposal → fingerprinted apply) — W2-ENGINE | PASS (engine, switch off by default) |
| T7 | Performance: 10k reschedule < 1 s, 5k rows at 60 fps, memory soak | `ppm-schedule-engine.test.js` (10k CPM < 1 s) + `ppm-w2-bench.test.js` / `tools/ppm/bench-engine.js` (CPM + levelling 1k / 5k, recorded in `docs/ppm/W2-ENGINE-CONTRACT.md` §7) | engine half PASS; 60 fps / soak = W2-ui |
| T8 | Offline: 50 edits disconnected, zero loss, conflicts surfaced | field outbox tests (inspections, tracker, actions only) | MISSING for projects |
| T9 | Gate negative tests + RAG boundary and hysteresis | `project-schedule.test.js` "stage gates…", lifecycle smoke `GATE_SOD 409` (gates) — no project RAG engine | PARTIAL (gates only) |
| T10 | Dashboard reconciles to the engine, drill-down, toggle preserves state | `portfolio-views.test.js` (views, not EVM reconciliation) | PARTIAL |
| T11 | DCMA 14-point schedule quality check | none | MISSING |

**W3 update (`goal/w3-governance`):** T9 — gate negatives (owner, non-approver, reject without reason, incomplete checklist → 409, standing reject, cycle/version scope, append-only) and RAG boundary + hysteresis tests now exist (`tests/ppm-w3-pure.test.js`, `tests/ppm-w3.smoke.test.js`) → PARTIAL-built behind switches off; T10 — KPI cards recomputed from the source rows and the engines, preference per user (drill-down + browser toggle check still open) → PARTIAL; T11 — DCMA 14 points on hand-built fixtures, unmeasurable points null → built (OFF). Thresholds are PROPOSED; nothing is certified.

Engine test coverage ≥ 90 % has not been measured; no coverage tool runs on these files yet.

## 5. Plan for W1–W4

Order follows the request. Every fix has a failing test first. Risky behaviour changes go behind a switch whose default is today's behaviour.

- **W1 — P0 correctness:**
  - the ten P0 defects above;
  - a real date-based CPM: forward/backward pass on dates, total/free/negative float, summary rollup, 0-day milestones, hierarchy integrity, optimistic version checks;
  - task-type matrix (W = D × U);
  - work-weighted rollups with the 100 % rule;
  - EVM engine (PV time-phased from the baseline, four EV methods, AC from actuals, the full index set);
  - rollback scripts for the PPM migrations.
  - Proves T2 (part), T3, T4, T5.
- **W2 — P1 parity:**
  - SS/FF/SF links with lag/lead (days, %, elapsed) and the 8 constraints plus deadlines;
  - project/task/resource calendars built on the existing site holiday calendars;
  - resource pool with rates A–E, contours, levelling with explanations;
  - 11 baselines plus interim plans;
  - interactive, virtualised canvas/SVG Gantt (zoom, drag, resize, link, undo, grid editing);
  - companion views;
  - lossless MSPDI XML import/export with a 1,000-task golden file;
  - performance benchmarks.
  - Proves T1, T2, T6, T7.
- **W3 — P2 executive and governance:**
  - Simplified ↔ Expert toggle;
  - KPI cards and phase strip reconciled to the engine;
  - configurable gate checklist with required artifacts and multi-approver e-sign-off;
  - composite project RAG with hysteresis and boundary tests;
  - RAID with P×I and exposure;
  - change requests with simulated impact before approval;
  - DCMA 14-point check;
  - scheduled PDF/Excel reports and a paginated Gantt print.
  - Proves T9, T10, T11.
- **W4 — P3 enterprise:**
  - offline project editing with conflict detection and a merge screen;
  - finer PPM roles (PM, scheduler, resource manager, contributor, client);
  - FR on all PPM pages;
  - comments with @mentions;
  - agile boards mapped to work packages;
  - roadmap now/next/later;
  - optional external connectors (.mpp via converter, P6 XER, Jira/Azure DevOps).
  - Proves T8.

**External tools (user decision of 2026-11-12):** connectors to external PPM tools are now allowed, but only as optional extras. The native tool must be fully usable on its own, and no native feature may depend on an external tool. This is why external connectors come last (W4), after the native engine.

## 6. Residual gap register

Until T1–T11 are green, every row not IMPLEMENTED in the two matrices is a residual gap: 121 of the 141 rows at W0. This register will be updated after each wave, with the commit that closes each row.
