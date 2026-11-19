# P04 — PPM certification (T1–T11) at HEAD, after the W1–W4 merges

- **Lot:** p04-ppm-cert · base `e8900a7` · branch `qual/p04-ppm-cert` · 2026-11-19 · agent: Claude (AI). **Every
  review in this file is an AI review, not an independent one.**
- **Verdict: NOT CERTIFIED.** No T row is closed in the sense the request requires until the two HUMAN checks (Microsoft
  Project interoperability, business witness project) are done and the PMO approves the thresholds. Every PPM feature
  added in W1–W4 except the W1 engine / integrity fixes is still behind a switch that defaults to off.
- **Nothing built outside the W0 gap list.** Three defects found by the certification tests were fixed (failing test
  first); two tools and two human kits were added. No migration, no route, no switch.

## 1. Defects found and fixed (failing first, then passing)

| T | Defect | Fix | Proof |
|---|---|---|---|
| T10 | With `ppm_calendars_enabled` on, the project page plan, the W3 summary cards, the RAG slip and DCMA scheduled on Mon–Fri while the W2 `/schedule` route used the project calendar (site holiday): card 2027-01-15 vs engine 2027-01-18 | `services/ppm/engineInput.js` — one engine input for every view (`routes/ppmEngine.js` computeProject, `routes/governance.js` project plan, `services/ppm/w3Context.js`, DCMA probe) | `tests/ppm-p04-reconcile.smoke.test.js` failed (`'2027-01-15' != '2027-01-18'`), now passes; switches off = unchanged (same test) |
| T4 | A cancelled leaf weighed in the summary rollup (root 12.5 %) but not in the project card (25 %); it also inflated the 100 % rule | `services/ppm/scheduleEngine.js` summary rollup skips cancelled leaves | `tests/ppm-p04-rollups.test.js` 3 of 4 failed, now 4/4 |
| T8 | Same field edited twice offline → the person's own first edit shown as a conflict; default "theirs" dropped the newer value | `public/lib/ppmOfflineQueue.js` enqueue: an earlier queued edit of the same row/field becomes the base | `tests/ppm-offline-queue.test.js` +2 (both failed first), 7/7 |

ADR: `docs/ai-decisions/ADR-P04-ppm-certification.md`.

## 2. T1–T11 at HEAD

| T | Definition | Status | Proof (test) | What is still missing |
|---|---|---|---|---|
| T1 | 1,000-task MSPDI round trip to the minute | **PARTIAL** — agent half PASS | `ppm-mspdi` (golden, SHA-256 pinned, fixed point), `ppm-engine-routes.smoke` (export → import → export), `ppm-p04-kits` (3 kit files are fixed points) | HUMAN: open the files in Microsoft Project (kit `P04-interop-kit/`) |
| T2 | CPM: 4 link types × lag × 8 constraints × calendars, negative float | **PASS** (engine) | `ppm-schedule-engine`, `ppm-w2-engine` (hand-computed), `ppm-p04-reconcile.smoke` (calendar in every view) | not an exhaustive cartesian product; calendars OFF by default |
| T3 | Task-type matrix 3 types × effort-driven | **PARTIAL** | `ppm-schedule-engine` "task types × effort-driven…" (3 × 2 × 4 = 24 cases, W = D × U invariant, hand values) | `recalc` is not applied when a task is saved — a write-behaviour change needing a PMO decision + a named switch |
| T4 | Work-weighted rollups, cost/work leaf → portfolio, 100 % rule | **PARTIAL** | `ppm-p04-rollups` (hand-computed, cancelled excluded, unknown ⇒ null, 100 % rule), `ppm-evm` "leaf → summary → project → programme → portfolio, per currency" | objective / portfolio % = unweighted mean of reporting projects (`portfolioEvidence.objectiveView`); 100 % rule checks work only |
| T5 | EVM against a hand-computed reference | **PASS** (engine, OFF) | `ppm-evm` "T5 reference project…": PV 1600, EV 2000, AC 1600, SV/CV 400, SPI/CPI 1.25, EAC 3200, ETC 1600, VAC 800, TCPI 0.8333 — arithmetic in the test comments | Finance certification; PV phased Mon–Fri (ignores project calendars); `ppm_evm_enabled` = 0 |
| T6 | Levelling, every move explained | **PASS** (engine, OFF) | `ppm-w2-engine` (T6), `ppm-w2-bench`, `ppm-engine-routes.smoke` (proposal → fingerprinted apply) | switch off |
| T7 | 10k reschedule < 1 s · 5k rows at 60 fps · memory soak | **PARTIAL** | engine: `ppm-schedule-engine` "benchmark: 10 000 tasks…" PASS; browser: `tools/ppm/bench-gantt-browser.js` (§4) — windowing PASS (≤ 41 bars of 5,000), heap flat PASS, **60 fps FAIL** | rendering cost per frame (§4); a real-screen run (human) |
| T8 | 50 offline edits, zero loss, conflicts shown | **PARTIAL** — logic PASS | `ppm-offline-queue` (50 edits in order; 50 edits over 10 tasks with one real concurrent change → only that task conflicts, zero loss) | switch OFF; field acceptance on a real device (human); browser merge screen not run by the agent |
| T9 | Gate negatives + RAG boundary and hysteresis | **PASS** (built OFF) | `ppm-w3-pure` (every edge, hysteresis series), `ppm-w3.smoke` "T9…" | thresholds PROPOSED (§7) |
| T10 | Dashboard reconciles to the engine, drill-down, toggle preserves state | **PARTIAL** | `ppm-w3-pure` "KPI cards reconcile…", `ppm-w3.smoke` "T10 summary…", `ppm-p04-reconcile.smoke` (calendars on) | drill-down from the cards and the toggle in a browser (human); portfolio list critical length still on Mon–Fri |
| T11 | DCMA 14 points | **PASS** (built OFF) | `ppm-w3-pure` "DCMA…" ×3, `ppm-w3.smoke` "T11…" | DCMA thresholds are the published DCMA figures, PROPOSED for the PMO |

Totals: PASS 5 (T2, T5, T6, T9, T11 — engine level, all but T2 behind switches off) · PARTIAL 6 (T1, T3, T4, T7, T8, T10) · MISSING 0.

## 3. Re-audit of the two W0 matrices at HEAD

Status taxonomy: **IMPLEMENTED** = live for users today (default on) and proven by a test · **IMPLEMENTED (OFF)** =
complete and tested but behind a `report_config` switch that defaults to '0' (users do not see it) · **PARTIAL** =
exists but incomplete (gap stated; "(OFF)" when also switched off) · **MISSING**. The W0 column is the status published
at `c8f1794` (`git show c8f1794:docs/audits/2026-11-12-ppm-parity/W0-MATRIX-*.md`). Line numbers are resolved at this
branch's HEAD by grep (`file:line` = first line carrying the cited symbol).

| | Items | IMPLEMENTED (live) | IMPLEMENTED (OFF) | PARTIAL | MISSING |
|---|---:|---:|---:|---:|---:|
| **W0 (2026-11-12)** | 141 | 20 | — (counted in IMPLEMENTED / PARTIAL) | 65 | 56 |
| **HEAD (P04, 2026-11-19)** | 141 | **35** | **42** | **53** | **11** |

Remaining MISSING (11): ARCH-14 document entity · ARCH-19 computed WBS codes · A3 tree drag/insert with WBS re-index ·
B15 split / recurring tasks · J6 PPM webhooks · C6c slack lines · C7b multiple-baselines view · C7d calendar view · H2
versioned attachments · K8 local date/number formats · L3 milestone trend analysis. None was built (P04 builds nothing
beyond certification fixes).

| ID | W0 | HEAD | Evidence (file:line) | Test | Note |
|---|---|---|---|---|---|
| ARCH-1 | PARTIAL | **PARTIAL** | `services/governanceStore.js:380` | ppm-project-lifecycle.smoke | implicit single portfolio = all programmes; no portfolio table (documented assumption) |
| ARCH-2 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/018_governance.sql:21` | ppm-project-lifecycle.smoke | — |
| ARCH-3 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/018_governance.sql:27` | ppm-project-lifecycle.smoke | — |
| ARCH-4 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:195` | ppm-schedule-engine "summary tasks…" | typed summary vs leaf derived from the tree (W1, ON); still no separate WBS-node table |
| ARCH-5 | PARTIAL | **PARTIAL** | `services/governanceStore.js:33` | ppm-schedule-engine "link types…" | typed links (type, lag, unit) in a JSON column per task, validated on write; no link table with FK |
| ARCH-6 | MISSING | **IMPLEMENTED (OFF)** | `db/postgres/reports/105_ppm_engine_w2.sql:12` | ppm-w2-engine "calendars…"; ppm-p04-reconcile.smoke | ppm_calendars_enabled |
| ARCH-7 | MISSING | **IMPLEMENTED (OFF)** | `db/postgres/reports/105_ppm_engine_w2.sql:52` | ppm-engine-routes.smoke | ppm_resources_enabled |
| ARCH-8 | PARTIAL | **IMPLEMENTED (OFF)** | `db/postgres/reports/105_ppm_engine_w2.sql:80` | ppm-engine-routes.smoke | ppm_resources_enabled |
| ARCH-9 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:84` | ppm-w2-engine "contours…"; ppm-evm "S-curve…" | time-phased work per day computed from assignments; PV time-phased from the baseline (EVM) |
| ARCH-10 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/baselineSlots.js:12` | ppm-w2-engine "baseline slots…" | ppm_baseline_slots_enabled |
| ARCH-11 | IMPLEMENTED | **IMPLEMENTED** | `services/governanceStore.js:360` | ppm-project-lifecycle.smoke | — |
| ARCH-12 | IMPLEMENTED | **IMPLEMENTED (OFF)** | `db/postgres/reports/085_ppm_workbench.sql:44` | ppm-workbench.smoke | ppm_change_requests_enabled |
| ARCH-13 | IMPLEMENTED | **IMPLEMENTED** | `services/projectSchedule.js:156` | project-schedule "stage gates…" | identity signature stays human |
| ARCH-14 | MISSING | **MISSING** | `—` | — | no document / attachment model for projects |
| ARCH-15 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/timesheets.js:2` | ppm-p7b-pure; ppm-p7b.smoke | ppm_time_entries_enabled + ppm_timesheet_approval_enabled |
| ARCH-16 | IMPLEMENTED | **IMPLEMENTED** | `services/portfolioAccess.js:54` | portfolio-access | — |
| ARCH-17 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/039_native_ppm.sql:2` | governance-routes.smoke | — |
| ARCH-18 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/039_native_ppm.sql:19` | (schema) | — |
| ARCH-19 | MISSING | **MISSING** | `services/governanceStore.js:487` | — | wbs_code still typed free text; the MSPDI/XER export writes it as given |
| ARCH-20 | PARTIAL | **PARTIAL** | `services/ppm/resources.js:84` | ppm-w2-engine "contours…" | time-phasing is COMPUTED on read, not stored |
| ARCH-21 | MISSING | **PARTIAL** | `tests/ppm-schedule-engine.test.js:221` | ppm-schedule-engine "benchmark: 10 000 tasks…" | full recompute on every read (10k < 1 s); no persisted dates, no dirty-subgraph recalc |
| ARCH-22 | PARTIAL / incorrect | **IMPLEMENTED** | `services/projectSchedule.js:137` | ppm-schedule-engine "R1 regression…"; ppm-p04-reconcile.smoke | one engine date set; P04: the same engine input for page plan, W2 schedule, W3 cards (calendars on) |
| ARCH-23 | PARTIAL | **PARTIAL** | `public/lib/ganttCore.js:208` | ppm-gantt-core "visibleWindow…"; tools/ppm/bench-gantt-browser.js | windowed Gantt v2 (OFF); 60 fps not reached in the P04 headless measurement |
| ARCH-24 | MISSING | **IMPLEMENTED** | `tests/ppm-rollback-scripts.test.js:47` | ppm-rollback-scripts | manual down scripts for every PPM migration |
| ARCH-25 | IMPLEMENTED | **IMPLEMENTED** | `routes/governance.js:613` | authz matrix; ppm-w4-enterprise.smoke | — |
| A1 | PARTIAL | **PARTIAL** | `services/ppm/planIntegrity.js:12` | ppm-plan-integrity | integrity ON (self/cycle/other project); no indent/outdent action in any editor |
| A2 | MISSING | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:502` | ppm-schedule-engine "summary tasks…"; ppm-p04-rollups | dates / work / % roll up (ON) |
| A3 | MISSING | **MISSING** | `—` | — | no tree drag/insert with automatic WBS re-index |
| A4 | MISSING | **PARTIAL** | `services/ppm/scheduleEngine.js:508` | ppm-schedule-engine "summary tasks…" | engine ignores a typed summary duration (warning); editors still let a summary's own fields be typed |
| A5 | MISSING / incorrect | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:134` | ppm-p04-rollups; ppm-schedule-engine "work-weighted…" | task tree work-weighted, unknown ⇒ null; P04: cancelled leaves excluded (root row = card). Objective rollup = unweighted mean of reporting projects (portfolioEvidence) — see T4 |
| A6 | MISSING | **PARTIAL** | `services/ppm/scheduleEngine.js:505` | ppm-p04-rollups "100 % rule" | warning on WORK only (no cost / scope 100 % rule) |
| A7 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:240` | ppm-schedule-engine "summary tasks…" | only leaves are network nodes |
| A8 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:212` | ppm-schedule-engine "0-day milestones…" | portfolio_milestones table still outside the network |
| A9 | PARTIAL | **PARTIAL** | `services/projectSchedule.js:118` | project-schedule "charterText…" | project-level charter; no per-node scope / acceptance |
| A10 | IMPLEMENTED | **IMPLEMENTED (OFF)** | `db/postgres/reports/073_ppm_raci_templates.sql:18` | ppm-raci-templates | ppm_templates_enabled |
| A11 | PARTIAL | **PARTIAL** | `public/project.html:450` | project-page | indented tree; no expand / collapse |
| B1 | PARTIAL / incorrect | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:209` | ppm-schedule-engine "manual vs auto…" | engine ON; editor field behind ppm_schedule_engine_v2_ui |
| B2 | MISSING | **PARTIAL** | `services/ppm/scheduleEngine.js:102` | ppm-schedule-engine "task types × effort-driven…" | 3 × 2 × 4 matrix PASS in the pure engine; NOT applied when a task is saved (T3) |
| B3 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:38` | ppm-w2-engine "lag units…" | FS/SS/FF/SF, d / ed / % lag, leads (ON in the engine; typed-link editor field OFF) |
| B4 | IMPLEMENTED | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:163` | project-schedule "critical path…" | — |
| B5 | IMPLEMENTED | **IMPLEMENTED** | `services/ppm/planIntegrity.js:13` | project-schedule "dependencies…"; ppm-plan-integrity | hierarchy part closed (W1-INTEGRITY) |
| B6 | MISSING | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:33` | ppm-schedule-engine "constraints…"; ppm-w2-engine "the 8 constraints…" | ALAP chains not iterated to a fixed point (ADR) |
| B7 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:517` | ppm-w2-engine "deadlines…" | no breach alert in ppmAlerts |
| B8 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/calendars.js:95` | ppm-w2-engine "calendars…"; ppm-p04-reconcile.smoke | shifts within a day not modelled |
| B9 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:175` | ppm-schedule-engine "forward/backward pass…" | — |
| B10 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:489` | ppm-schedule-engine "forward/backward pass…" | — |
| B11 | MISSING | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:489` | ppm-schedule-engine "forward/backward pass…" | — |
| B12 | MISSING | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:490` | ppm-schedule-engine "negative float…" | — |
| B13 | PARTIAL / incorrect | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:529` | ppm-schedule-engine "critical = total float…" | all chains |
| B14 | MISSING | **PARTIAL** | `services/ppm/scheduleEngine.js:172` | ppm-schedule-engine "critical = total float…" | engine option; no setting exposed (threshold = PMO, PROPOSED) |
| B15 | MISSING | **MISSING** | `—` | — | no split / recurring tasks; cancelled = inactive only in rollups (P04) |
| B16 | PARTIAL | **PARTIAL** | `services/ppm/evm.js:13` | ppm-evm "EV methods…" | % complete + physical % (EVM, OFF); no % work complete |
| B17 | PARTIAL | **PARTIAL** | `routes/ppmEngine.js:49` | ppm-engine-routes.smoke | status date on the W2 schedule + DCMA; no remaining duration model, no progress line |
| B18 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/baselineSlots.js:14` | ppm-engine-routes.smoke | ppm_baseline_slots_enabled |
| B19 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/baselineSlots.js:48` | ppm-w2-engine "baseline slots…" | start / finish / work / cost variance per slot; slip null without baseline (ON) |
| B20 | IMPLEMENTED | **IMPLEMENTED (OFF)** | `services/ppmBaseline.js:59` | ppm-baselines.smoke | ppm_rebaseline_enabled |
| B21 | PARTIAL | **PARTIAL** | `services/ppm/scheduleEngine.js:493` | ppm-schedule-engine | driver per task returned by the API; not rendered in either Gantt |
| D1 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:98` | ppm-w2-engine "rate tables…" | ppm_resources_enabled |
| D2 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:126` | ppm-w2-engine "over-allocation…" | — |
| D3 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:62` | ppm-w2-engine "rate tables A–E…" | amounts not certified (Finance input) |
| D4 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:22` | ppm-w2-engine "contours…" | MS-Project-like shapes, not certified copies |
| D5 | IMPLEMENTED | **IMPLEMENTED** | `services/ppm/resources.js:133` | ppm-w2-engine "over-allocation…"; capacity tests | owner-level check ON; per-resource daily loads OFF |
| D6 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/resources.js:169` | ppm-w2-engine "over-allocation detection and levelling (T6)…" | ppm_leveling_enabled |
| D7 | PARTIAL | **PARTIAL** | `db/postgres/reports/105_ppm_engine_w2.sql:58` | ppm-engine-routes.smoke | generic flag on a resource; no generic → named swap action |
| D8 | PARTIAL | **PARTIAL** | `services/projectSchedule.js:84` | ppm-workbench "R2-WB-02…" | daily entries, planned vs actual |
| D9 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/timesheets.js:7` | ppm-p7b-pure; ppm-p7b.smoke | ppm_timesheet_approval_enabled |
| E1 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:212` | ppm-evm "PV is time-phased from the baseline…" | Mon–Fri phasing: ignores ppm_calendars (residual) |
| E2 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:24` | ppm-evm "EV methods…" | — |
| E3 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:209` | ppm-evm "T5 reference project…" | periods or costed hours |
| E4 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:126` | ppm-evm "T5 reference project…" | hand-computed reference |
| E5 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:132` | ppm-evm "T5 reference project…" | EAC default BAC/CPI = PROPOSED (Finance confirms) |
| E6 | PARTIAL / incorrect | **PARTIAL** | `services/ppm/evm.js:44` | ppm-evm "leaf → summary → project → programme → portfolio…" | EVM cost rollup per currency OFF; objective % rollup unweighted (portfolioEvidence) |
| E7 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/evm.js:26` | ppm-evm "…CapEx/OpEx split" | per task amount split |
| E8 | MISSING | **PARTIAL** | `services/ppm/resources.js:98` | ppm-w2-engine "rate tables…" | resource cost lines (OFF); no fixed-cost line entity |
| E9 | PARTIAL | **PARTIAL** | `services/ppm/evm.js:168` | ppm-evm "two-currency portfolio, converted view" | converted view only with an explicit rate table (ppm_evm_fx_rates empty) |
| E10 | MISSING | **PARTIAL** | `services/ppm/evm.js:326` | ppm-evm "S-curve…" | series in the API (OFF); no chart on the page |
| J1 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/mspdi.js:50` | ppm-mspdi "T1…"; ppm-p04-kits | opening in MS Project = HUMAN check (kit prepared) |
| J2 | PARTIAL | **PARTIAL** | `routes/governance.js:32` | ppm-baselines.smoke | exports only; no mapped task import from CSV/Excel; lossiness not documented |
| J3 | MISSING | **PARTIAL** | `services/ppm/xer.js:99` | ppm-xer; ppm-connectors-routes.smoke | XER import/export (OFF); .mpp = converter hook only |
| J4 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/workItemSync.js:24` | ppm-work-item-sync | fake transports only — no real tenant tested |
| J5 | PARTIAL | **PARTIAL** | `docs/ppm/W2-ENGINE-CONTRACT.md:3` | ppm-engine-routes.smoke | documented session API; no token auth for third parties |
| J6 | MISSING | **MISSING** | `—` | — | no outbound PPM event webhook |
| J7 | IMPLEMENTED | **IMPLEMENTED** | `services/ssoEntra.js:29` | sso-entra | platform |
| C1 | PARTIAL | **IMPLEMENTED (OFF)** | `public/lib/ganttV2.js:78` | ppm-gantt-v2-page.smoke | ppm_gantt_v2_enabled |
| C2 | MISSING | **PARTIAL** | `public/lib/ganttCore.js:10` | ppm-gantt-core "zoom scales…" | day → quarter (OFF); no hours / years tier |
| C3 | MISSING | **PARTIAL** | `public/lib/ganttCore.js:236` | ppm-gantt-core "dragDates…"; "canLink…" | move / resize / link (OFF); no progress drag |
| C4 | MISSING | **PARTIAL** | `public/lib/ganttCore.js:377` | ppm-gantt-core "undo / redo…"; "inline editing…" | inline edit + undo (OFF); no copy/paste, fill-down, multi-select |
| C5 | PARTIAL | **PARTIAL** | `public/project.html:450` | project-page | outline indent; no column chooser / filter / group |
| C6a | IMPLEMENTED | **IMPLEMENTED** | `public/project.html:555` | project-page; ppm-visuals | critical flag now from the engine (W1) |
| C6b | PARTIAL | **PARTIAL** | `public/lib/ganttV2.js:109` | ppm-gantt-core "rowsFrom + layout…" | one baseline ghost; slots BL0–10 exist (OFF) but not switchable in the Gantt |
| C6c | MISSING | **MISSING** | `—` | — | float shown as a number only |
| C6d | PARTIAL | **PARTIAL** | `public/lib/ganttV2.js:120` | ppm-gantt-core | progress line, manual % |
| C6e | IMPLEMENTED | **IMPLEMENTED** | `public/project.html:555` | ppm-visuals | — |
| C6f | MISSING | **PARTIAL** | `public/lib/ganttV2.js:117` | ppm-gantt-core | summary bars + lag in link title (OFF); no deadline arrow, no split |
| C7a | PARTIAL | **PARTIAL** | `public/lib/ganttV2.js:62` | ppm-gantt-core | plan + baseline + today |
| C7b | MISSING | **MISSING** | `—` | — | one baseline at a time |
| C7c | MISSING | **IMPLEMENTED (OFF)** | `public/lib/ganttV2.js:9` | ppm-gantt-core "companion views…" | ppm_gantt_v2_enabled |
| C7d | MISSING | **MISSING** | `—` | — | no calendar view |
| C7e | PARTIAL | **IMPLEMENTED (OFF)** | `public/lib/ganttV2.js:8` | ppm-gantt-core "companion views…" | unknown never 0 |
| C7f | PARTIAL | **PARTIAL (OFF)** | `public/lib/ppmWorkbench.js:4` | ppm-workbench.smoke | team panel + resource pool API (OFF) |
| C7g | MISSING | **PARTIAL** | `public/lib/ganttV2.js:9` | ppm-gantt-core "companion views…" | resource graph (OFF); no team planner |
| C7h | PARTIAL | **PARTIAL** | `services/portfolioDeck.js:67` | portfolio-deck | portfolio slide; no per-project timeline slide |
| F1 | MISSING | **IMPLEMENTED (OFF)** | `public/lib/ppmGovernanceW3.js:38` | ppm-w3.smoke "T10 summary…" | browser toggle check = human |
| F2 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/projectKpis.js:80` | ppm-w3-pure "KPI cards reconcile…"; ppm-p04-reconcile.smoke | P04: cards read the calendar-aware engine input |
| F3 | PARTIAL | **PARTIAL** | `services/ppm/projectKpis.js:21` | ppm-w3.smoke | 4 phases over 6 stages, mapping PROPOSED |
| F4 | PARTIAL | **PARTIAL** | `public/portfolio.html:129` | portfolio-views | no filter by site / sponsor / RAG |
| F5 | PARTIAL | **PARTIAL** | `services/ppm/evm.js:326` | ppm-evm "S-curve…" | S-curve data (OFF), no widget |
| F6 | PARTIAL | **PARTIAL** | `services/ppm/w3Context.js:11` | ppm-w3.smoke "T10…"; ppm-p04-reconcile.smoke; portfolio-evidence-null | cards = engine (calendars on, P04 fix); portfolio list critical length still on Mon–Fri; drill-down not tested |
| G1 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/gateChecklist.js:27` | ppm-w3-pure "gate checklist…"; ppm-w3.smoke "T9…" | identity e-signature = human |
| G2 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/projectRag.js:26` | ppm-w3-pure "RAG boundaries…" | thresholds PROPOSED |
| G3 | PARTIAL | **PARTIAL** | `services/ppm/raid.js:48` | ppm-w3-pure "RAID…" | OFF; residual risk not modelled |
| G4 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/crSimulation.js:94` | ppm-p7b-pure; ppm-p7b.smoke | ppm_cr_simulation_enabled |
| G5 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/baselineSlots.js:6` | ppm-w2-engine "baseline slots…" | work + cost in slots |
| G6 | IMPLEMENTED | **IMPLEMENTED** | `services/governanceStore.js:3` | decision-lifecycle | — |
| H1 | MISSING | **IMPLEMENTED (OFF)** | `services/ppm/comments.js:2` | ppm-comments | ppm_comments_enabled |
| H2 | MISSING | **MISSING** | `—` | — | no versioned attachments on projects |
| H3 | PARTIAL | **PARTIAL (OFF)** | `services/reportConfig.js:223` | ppm-alerts | nightly in-app only |
| H4 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/039_native_ppm.sql:2` | governance-routes.smoke | — |
| H5 | PARTIAL | **PARTIAL (OFF)** | `public/lib/ppmExtras.js:50` | ppm-raci-templates | task RACI only |
| H6 | MISSING | **IMPLEMENTED (OFF)** | `tools/reports/send-ppm-reports.js:49` | ppm-w3.smoke "scheduled project report…" | armed off |
| H7 | MISSING | **PARTIAL** | `public/lib/ppmGovernanceW3.js:10` | — | print layout = human browser check |
| H8 | PARTIAL | **PARTIAL** | `routes/ppmEngine.js:25` | ppm-engine-routes.smoke | MSPDI / XER export (OFF); no external token API for projects |
| I1 | MISSING | **PARTIAL** | `public/lib/ganttCore.js:208` | tools/ppm/bench-gantt-browser.js (P04) | windowed (OFF): ≤ 41 bars of 5,000 in the DOM; headless p50 frame 2–4 × the plain-scroll baseline — 60 fps NOT met |
| I2 | PARTIAL | **IMPLEMENTED** | `services/ppm/scheduleEngine.js:175` | ppm-schedule-engine "benchmark: 10 000 tasks…" | full recompute < 1 s (not incremental) |
| I3 | MISSING | **PARTIAL** | `tools/ppm/bench-gantt-browser.js:5` | tools/ppm/bench-gantt-browser.js (P04) | 300-cycle (~7 min) headless soak: heap flat 5.7–7.2 MB; a 10-minute soak on a real screen = human |
| I4 | MISSING | **PARTIAL (OFF)** | `public/lib/ppmOfflineQueue.js:79` | ppm-offline-queue (7) | task / milestone edits only; no low-bandwidth mode; field acceptance = human |
| I5 | MISSING | **IMPLEMENTED (OFF)** | `public/lib/ppmOfflineQueue.js:115` | ppm-concurrency.smoke; ppm-offline-queue | detection ON (409); merge screen OFF |
| K1 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/projectRoles.js:39` | ppm-project-roles; ppm-w4-enterprise.smoke | ppm_project_roles_enabled |
| K2 | PARTIAL | **PARTIAL (OFF)** | `services/reportConfig.js:216` | portfolio-site-scope.smoke | every session reads every project today |
| K3 | PARTIAL | **PARTIAL** | `routes/governance.js:709` | money-coverage | money + client role |
| K4 | PARTIAL | **PARTIAL** | `services/ssoSettings.js:14` | sso-routes.smoke | platform |
| K5 | IMPLEMENTED | **IMPLEMENTED** | `db/postgres/reports/039_native_ppm.sql:2` | see H4 | — |
| K6 | MISSING | **IMPLEMENTED** | `tests/ppm-rollback-scripts.test.js:47` | ppm-rollback-scripts | manual, some destructive |
| K7 | PARTIAL | **IMPLEMENTED (OFF)** | `public/lib/i18n/project.fr.js:1` | i18n-coverage | ui_i18n_pages |
| K8 | MISSING | **MISSING** | `—` | — | ISO dates / raw numbers on PPM pages |
| K9 | PARTIAL | **IMPLEMENTED (OFF)** | `services/ppm/calendars.js:44` | ppm-w2-engine "calendars…"; ppm-p04-reconcile.smoke | site holiday calendar feeds the engine |
| K10 | PARTIAL | **PARTIAL** | `services/ppm/evm.js:168` | ppm-evm | converted view only with a rate table |
| L1 | MISSING | **PARTIAL (OFF)** | `public/lib/ppmBoard.js:11` | ppm-board-nnl | board on work packages; no sprint / backlog entity |
| L2 | PARTIAL | **PARTIAL** | `public/portfolio.html:75` | portfolio-views | continuous timeline; no quarter buckets |
| L3 | MISSING | **MISSING** | `—` | — | no milestone trend chart |
| L4 | MISSING | **IMPLEMENTED (OFF)** | `public/lib/ppmRoadmapNnl.js:11` | ppm-board-nnl | ppm_roadmap_nnl_enabled |

## 4. T7 browser half — measured (headless Chromium 157.0.8103.78, this sandbox, 10 agents running in parallel)

Tool: `node tools/ppm/bench-gantt-browser.js --tasks=5000 --scroll-s=10 --soak=30` (fictitious tasks, the shipped
`public/lib/ganttCore.js` + `ganttV2.js`, no server). Run of 2026-11-19:

```
Gantt v2 browser bench — 5000 tasks, 157.0.8103.78 (headless)
  engine schedule        260 ms (Node)
  baseline (plain div)   p50 16.7 ms, p95 33.2 ms — what this headless browser gives without any Gantt
  mount                  188.2 ms, 31 bars + 186 grid cells in the DOM, scroll height 130040px
  scroll 10s            132 frames, mean 75.9 ms, p50 66.6, p95 200, p99 250, max 350; 112 frames > 16.7 ms; max bars drawn 41
  main thread during scroll: script 2872 ms · layout 1799 ms · style 1298 ms · all tasks 10038 ms (132 layouts)
  heap                   before 4 MB · after first pass 5.7 MB · soak 30 cycles: first 6.1 last 6 max 6.2 MB (growth over the last half -0.2 MB)
```

- **Windowing: PASS** — of 5,000 rows only 31–41 bars and 186 grid cells exist in the DOM at any time.
- **Memory: PASS** — heap flat across the soak (no growth over the last half). A long soak — `--soak=300` (300 × re-mount + 1 s full scroll, about 7 minutes wall clock, run 2026-11-19 11:45→11:52 — shorter than the request's 10-minute soak; the 10-minute real-screen run stays a human step) — stayed between 5.7 and 7.2 MB, last 6.0 MB, growth over the last half −0.3 MB, no page error.
- **60 fps: NOT MET.** The long-soak run (lighter machine load) measured its 10 s scroll at p50 16.7 ms, p95 66.7 ms, 199 of 362 frames > 16.7 ms; the run above p50 66.6 ms, p95 200 ms — the figure moves with the sandbox load, more than half of the frames miss 16.7 ms in both. A plain 130,000-px div scrolls at p50 16.7 ms in the same browser; the Gantt runs at p50 33–67 ms
  (p95 133–200 ms), with the main thread busy the whole run. A CPU profile shows `paint()` (`public/lib/ganttV2.js`)
  spending about 12 ms of script per frame rebuilding the visible SVG through `innerHTML`, plus style / layout of an SVG
  sized to the whole plan (5,000 × 26 px tall). The same ratio holds at 1,000 tasks, so it is the per-frame repaint, not
  the row count. Recorded as a W2-UI defect; not fixed here (a rendering rewrite is not a certification fix). Headless
  frame times approximate a real screen (no GPU compositing); the acceptance run on a real screen is a human step.
- The 60 fps / 16.7 ms target is the request's figure; whether it is the acceptance threshold is a PMO decision.

## 5. Coverage of the PPM engine files (measured, not chased)

`node --test --experimental-test-coverage --test-coverage-include='services/ppm/*.js' --test-coverage-include='public/lib/ganttCore.js'`
over `tests/ppm-*.test.js`, `project-schedule`, `project-page` (245 tests; 243 pass — 2 failures are load artefacts:
the 10k benchmark under coverage instrumentation + 10 parallel agents, and `ppm-workbench.smoke` under concurrency 4;
both pass when run alone, re-run recorded below).

| File | Line % | Branch % | Funcs % |
|---|---:|---:|---:|
| **all PPM files** | **98.84** | **82.06** | **96.54** |
| scheduleEngine.js | 100.00 | 95.46 | 100.00 |
| evm.js | 100.00 | 89.43 | 100.00 |
| mspdi.js | 100.00 | 92.76 | 98.39 |
| resources.js | 99.65 | 84.58 | 98.18 |
| calendars.js | 100.00 | 76.40 | 100.00 |
| ganttCore.js (public/lib) | 98.96 | 81.94 | 95.28 |
| projectKpis.js | 100.00 | 75.96 | 100.00 |
| projectRag.js | 100.00 | 94.81 | 100.00 |
| dcma.js | 100.00 | 81.82 | 96.43 |
| engineInput.js (new) | 100.00 | 47.73 | 75.00 |
| engineStore.js | 92.94 | 59.93 | 92.77 |
| w3Context.js | 85.48 | 75.00 | 80.00 |
| lowest branch: engineInput 47.7, projectReport 58.9, engineStore 59.9, comments 65.7 | | | |

The engine's own target (W0 README "engine coverage ≥ 90 %") is met for `scheduleEngine.js` (lines and branches). The
low branch figures are default-argument and degraded-read paths; no empty test was written to raise them.

## 6. Wording ("MS Project-grade" / "parity")

- UI and help: `grep -niE "ms[ -]?project|microsoft project|parity"` over `public/*.html`, `public/lib/*.js`,
  `public/lib/i18n/*.js`, `public/help.html` → **no user-visible claim** (hits are code comments naming the
  programme "PPM parity W1–W4", and the unrelated RAID-disk "parity" check of the inspection form).
- Docs: the programme is named "PPM parity"; that is the TARGET, not a claim. The audit README and both matrices now
  carry a P04 status line stating NOT CERTIFIED and that "parity" names the target. `docs/ppm/W2-ENGINE-CONTRACT.md` and
  the W2 ADR already qualify MS-Project behaviour as "MS-Project-like, not certified".
- Generated `docs/ops/FLAG-REGISTER.*` carry "W4 (PPM parity)" as a reference string from `services/reportConfig.js`
  comments (a shared hot file — not touched; the string is a reference, not a claim).

## 7. Thresholds that stay PROPOSED (for the PMO — nothing approved here)

| Threshold | Where | Default (PROPOSED) | Decides |
|---|---|---|---|
| Project RAG: SPI / CPI red < 0.90 (exit 0.92), amber < 0.95 (exit 0.97); slip red > 10 wd (exit 8), amber > 0; risk score red > 8, amber > 5 | `services/ppm/projectRag.js` DEFAULT_THRESHOLDS; override `ppm_rag_thresholds` ('' = defaults) | as listed | PMO |
| DCMA 14-point limits (lags ≤ 5 %, FS ≥ 90 %, hard constraints ≤ 5 %, high float ≤ 5 %, missed tasks ≤ 5 %, CPLI ≥ 0.95, BEI ≥ 0.95, critical-path test 600 d) | `services/ppm/dcma.js` | published DCMA figures | PMO |
| Alerts: blocked task days, slip days | `ppm_alert_blocked_days` '5', `ppm_alert_slip_days` '10' (`services/reportConfig.js`) | 5 / 10 | PMO |
| Stale-plan nudge, gate lead days | `stale_plan_days` '', `a10_gate_lead_days` '' | off | PMO |
| Near-critical float, critical threshold | engine options `nearCriticalDays` (none exposed), `criticalThreshold` 0 | 0 / none | PMO |
| EAC default = BAC / CPI | `services/ppm/evm.js` | BAC/CPI | Finance |
| Phase mapping 6 stages → 4 phases | `services/ppm/projectKpis.js` PHASE_MAPPING_STATUS | PROPOSED | PMO |
| Gantt acceptance 60 fps / 16.7 ms, soak length 10 min | request text | — | PMO |

## 8. Human checks prepared (NOT performed — never claimed)

- **Microsoft Project interoperability:** `docs/agent-execution/P04-interop-kit/CHECKLIST.md` + `files/` (A small, C
  calendars + all link types; B 1,000 tasks regenerated by `node tools/ppm/interop-kit.js`), each with SDP360's expected
  dates / float / critical flags. All result cells empty.
- **Business witness project:** `docs/agent-execution/P04-witness-kit/README.md` + `tools/ppm/witness-load.js` (local
  comparison, or TEST-instance load with dry run → apply; refuses the production host; token from the environment;
  comparison sheet with empty PMO columns). Sign-off table empty.

## 9. Commands run (this lot)

- Targeted tests (throwaway PG, `PG_ADMIN_URL` local test role): `ppm-p04-reconcile.smoke` (failed first, then 1/1),
  with `ppm-w3.smoke`, `ppm-engine-routes.smoke`, `ppm-w3-pure`, `project-page`, `ppm-project-lifecycle.smoke` →
  40/40; `ppm-offline-queue` 5/7 → 7/7, `ppm-w4-enterprise.smoke` 5/5; `ppm-p04-rollups` 1/4 → 4/4 with
  `ppm-schedule-engine`, `ppm-w2-engine`, `ppm-w3-pure`, `ppm-gantt-core`, `ppm-evm`, `project-schedule`,
  `ppm-w2-bench`, `ppm-mspdi`, `ppm-xer` → 82/82; `ppm-p04-kits` 3/3; `ppm-workbench.smoke` alone 4/4.
- Coverage run (§5). Browser bench (§4). Interop kit generation. Witness loader local run on file C (26/26 leaves same dates).
- **Full suite NOT re-run** (preamble rule). Orchestrator's latest full run: `06f2cf2`, 5311 tests, 5298 pass, 3 fail
  (ui-design-ratchet, i18n-coverage project.html — both owned by P09 — and a sync-write-fence flake fixed in P01), 10
  skipped. `tests/.suite-manifest.json` updated (+10 tests: reconcile 1, offline-queue +2, rollups 4, kits 3; total 5312 → 5322).

## 10. Human decisions now unblocked

1. PMO: run the Microsoft Project interop checklist (licence holder) and the witness project on a TEST instance.
2. PMO: approve or replace the PROPOSED thresholds in §7 (RAG, DCMA, alerts, phase mapping, 60 fps target).
3. PMO: decide whether a typed task recalculates W = D × U on save (T3) — then a prompt can name the switch.
4. PMO / Finance: weighting of objective / portfolio % (work, budget or count) for T4; EVM certification (T5).
5. Arming order of the OFF switches for a canary project (the certification tests above are the evidence per switch).
