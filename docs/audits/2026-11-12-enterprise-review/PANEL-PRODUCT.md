# Committee F — PANEL PRODUCT (product, ITIL, PMO/portfolio, governance, Finance boundary, departments, value)

Head reviewed: `sdp-waves` @ `413e26b` (Plan E waves 0–1 + W2-RDB/W2-ITSM merged). W2-PPM read in its worktree
(`/home/user/w/w2-ppm`, commits `6aa8061` E-P03 … `2e2dd6b` E-P05, E-P06 uncommitted) — referenced, not duplicated.
Inputs: `ecarts.txt` (12 Nov 2026, review.1 gap analysis), `vision.txt` (v2.0, 9 Nov 2026). Review.1 files
(`workspace-settings.html`, migrations 078/079, `services/nativeProjectManagement.js`, profile engine, S1 queue) are
**absent from this repo** — every claim about them is labelled NEEDS-REVIEW.1-ARTIFACT, never inferred.

## (a) Verdict summary

1. The product core the vision asks to *retain* is real at head: ITIL incident/major-incident/PIR/problem candidates/SLA definition, native PPM (WBS, CPM, gates, baselines, RAID, benefits with third-party verification), governance (cadences, DEC register, commitments state machine, handoffs, obligations, My work), pilot measurement kit.
2. **E07 is CONFIRMED and still open after W2-PPM**: the server conflict list and the UI pressure table disagree on null / `''` / omitted / negative allocations; W2-PPM's E-P03 added a *third* consumer (`capacityBySite`) on the UI semantics without reconciling the server. Same page shows two different answers (portfolio "Resource conflicts" tile + pressure table). Defect → fix active (F-PRODUCT-01).
3. The portfolio tile says "none" in the alert-free style when allocations are unknown — a null shown as green (boundary breach).
4. Capacity never reaches the A11 exception job or the workbook: `capacity_overload` is a declared kind no caller feeds; the Tasks sheet drops `allocation_pct`/`effort_hours` → no screen/export parity.
5. Governance **decisions** (DEC-…) have no transition table, no reason on cancel, no history ledger, and the site can mark them `done` — weaker than commitments/RFI on the same platform (E08 "keep source transitions / eligible actors").
6. A money benefit can be "verified" by any second committee member or site editor; nothing requires a Finance-side verifier — the Finance boundary stops at *reading* money, not at *certifying* it.
7. Two incompatible department vocabularies (15 meeting departments vs 10 `action_departments`), and users carry no department → the 14 departmental usages cannot be rolled up or given a department workspace.
8. Identity of people in PPM is free text everywhere (task/project/decision/risk owner); conflicts and the A-15 owner exception key on a lower-cased name string.
9. Value measurement (E09) is **prepared but not computable**: observed sheets (T1–T8, stopwatch baseline/pilot, SUS) have no aggregator; benefits cannot separate realised / estimated-avoided / validated value.
10. Nothing here can claim field acceptance, Finance results or KPI certification: those stay human decisions (§f).

## (b) Claim verification (ecarts = gap analysis, vision = prompt pack) — product domain only

| # | Claim (source) | Label | Evidence |
|---|---|---|---|
| C1 | `projectSchedule.js` and `ppmVisuals.js` diverge on absent allocation; 60 % + null → 0 server conflicts, UI "unknown" (ecarts §Gestion de projet) | CONFIRMED | `services/projectSchedule.js:86` `Number(null)=0 → pct 0 → skipped (:87)`; `public/lib/ppmVisuals.js:61` null/''/NaN → unknown. Reproduced at head: null → server 0 / UI peak 60 + unknown 1 |
| C2 | 60 % + omitted → server 160 %, UI unknown (ecarts) | CONFIRMED | `projectSchedule.js:86` `Number(undefined)=NaN → 100`; reproduced: server 1 conflict peak 160, UI peak 60 unknown 1 |
| C3 | Zero and >100 % must be characterised (E07) | CONFIRMED (gap) | Write path refuses outside 0..100 (`services/governanceStore.js:414`) but column has no CHECK and `DEFAULT 100` (`db/postgres/reports/039_native_ppm.sql:24`); a negative legacy value *reduces* the UI peak (reproduced −50 → peak 10) and is ignored by the server; `''` behaves like null on both |
| C4 | `services/nativeProjectManagement.js` excludes unknown from local capacity | NEEDS-REVIEW.1-ARTIFACT | file absent from repo |
| C5 | Align calculation and coverage across API, UI and export (E07) | CONFIRMED (gap) | Workbook Tasks sheet omits allocation/effort (`services/portfolioDeck.js:114`); no capacity sheet; `capacity_overload` never fed (`routes/governance.js:626`, `tools/governance/ppm-alerts.js:49` pass no `capacity`) |
| C6 | Resource identifiers / names are free text (ecarts) | CONFIRMED | `039_native_ppm.sql:22` `owner TEXT`; `018_governance.sql:16,25,39`; conflicts key `String(owner).trim().toLowerCase()` (`projectSchedule.js:88`); access matches owner text to username/full name/e-mail (`services/portfolioAccess.js:15-24`) |
| C7 | Baselines and currencies need governance (E07) | OPEN-IN-PLAN-E (E-P04 budget periods, merged in w2-ppm `def1125`, not on head) + NEEDS-HUMAN (Finance certification) | baselines exist (`ppm_baseline_versions` `services/reportConfig.js:206`); currencies never summed (`public/portfolio.html:123`) |
| C8 | `portfolio_site_scope_reads=0`; group-project and textual-owner exceptions to arbitrate (ecarts P0) | CONFIRMED + NEEDS-HUMAN | `services/reportConfig.js:201`; `portfolioAccess.js:15-36` (owner text, `[]` = group-level) |
| C9 | Engagements (commitments) and handoffs disabled on dev | CONFIRMED (defaults) / NEEDS-REVIEW.1-ARTIFACT (dev state) | `reportConfig.js:192,195` both `'0'` |
| C10 | Native workbench + migrations 078/079; plan/deps/milestones/teams/actuals/benefits exercised on fixtures | NEEDS-REVIEW.1-ARTIFACT | no 078/079, head max reports migration 077 |
| C11 | Dev DB holds 0 active projects and 0 personal preferences | NEEDS-REVIEW.1-ARTIFACT | runtime state of the test machine |
| C12 | Portfolio, studio and roadmap already exist; default branch adds portfolio-read and benefits contracts | CONFIRMED | `routes/governance.js:478,573`, `services/portfolioBenefits.js`, `056_portfolio_benefits.sql` |
| C13 | No field financial result measured; validate method/period/currency/scope/verifier before presenting savings | CONFIRMED + NEEDS-HUMAN | benefits store `value_kind` quantity\|money only, no value class (`056_portfolio_benefits.sql`); verifier = any other person (`governanceStore.js:519-525`) |
| C14 | Separate observed amount, estimated avoidance, validated benefit (ecarts "Démontrer la valeur") | CONFIRMED (gap) | no column/state distinguishes them (`056_portfolio_benefits.sql`) |
| C15 | 14 departmental usages fit IT-dependency and commitment tracking; per-department workflows to be confirmed by each head | CONFIRMED (list) + NEEDS-HUMAN | `meetings-init.json:13-27` (14 + Other); but handoffs validate against a different list (`routes/handoffs.js:74`, seed `reports-db.js:696-699`) |
| C16 | E08: keep source transitions, define eligible actors and links | PARTLY CONFIRMED gap | commitments: full table + SoD (`services/commitmentLifecycle.js:27-43`); decisions: any→any status, no reason, no ledger (`governanceStore.js:13,195-199`; `routes/governance.js:411-424`) |
| C17 | E08: pick two decision KPIs, document formula/window/coverage, same number in outputs | OPEN-IN-PLAN-E (E-K01 charter, W2-KPI) + NEEDS-HUMAN (selection) | parity infra exists: `tests/report-figures-parity.test.js`, `dashboard-figure-parity.test.js` |
| C18 | E09: Q1–Q4 paired observation reference vs candidate, effort/confidence/time/success | NEEDS-HUMAN (cohort, observers) — kit exists | `docs/ops/pilot/PILOT-MEASUREMENT.md`, `T1-T8-SHEET.csv`, `WEEKLY-REPORT-STOPWATCH.csv` (phase baseline/pilot), `SUS-FORM.md`; **no aggregator** for these sheets (`tools/pilot/pilot-metrics.js` reads DB only) |
| C19 | Measures: reduce manual reporting, time to first useful action, commitments due with proof, autonomous success, demonstrate value (ecarts table) | PARTLY | `services/pilotMetrics.js:24-70` (report created→submitted proxy, PV→action, action→closed, field time, unknown share); value table = E-B03 (W2-KPI) |
| C20 | 11 profiles / 7 personas, PMO & Finance profiles | NEEDS-REVIEW.1-ARTIFACT | head `services/governanceProfiles.js` = *site policy* bundles, a different concept — do not conflate |
| C21 | S1 progressive action queue on home | NEEDS-REVIEW.1-ARTIFACT | head home = My work (`services/myWork.js`), site-centric |
| C22 | Vision 3.2 Validator inbox: "what requires my decision, by when, with what evidence" | CONFIRMED (gap at head) | verifications spread over `commitments.html`, `handoffs.html`, project benefits, `meetings-unsigned.html`, decisions; `services/myWork.js:97` only benefits-due by site |
| C23 | Vision 3.2 Department Member persona | CONFIRMED (gap) | users have no department (`services/handoffLifecycle.js:11`) |
| C24 | Vision prompt 6 target lifecycle DRAFT…CANCELLED | NEEDS-HUMAN (state-model decision) | each module keeps its own vocabulary; commitments/handoffs/RFI already richer than the generic model — mapping, not replacement |
| C25 | ITIL: problem loop needs SDP Problem data | CONFIRMED / OPEN-IN-PLAN-E done part | E-I02 merged (`services/problemCandidates.js`, `problem_candidates_enabled` `reportConfig.js:357`); SDP Problem view = X-I-01 HUMAN |
| C26 | ITIL: PIR per major incident | ALREADY-FIXED (switch off) | `services/pirReview.js`, `074_pir_reviews.sql`, `pir_reviews_enabled` `reportConfig.js:362` |
| C27 | R16 annual planning / R14 relationship pulse missing | CONFIRMED at head, OPEN-IN-PLAN-E (E-P08 W2-PPM, E-R05 W2-REP) | `services/reportCatalogue.js` R14/R16 `missing` |
| C28 | skipped→ok freshness in `services/sync/jobs.js`/`syncRunner.js` | out of panel scope (DATA/INTEGRATION) — trust impact noted for E09 | — |

Counts: CONFIRMED 17 (incl. partly/gap) · REFUTED 0 · ALREADY-FIXED 1 · NEEDS-REVIEW.1-ARTIFACT 7 · NEEDS-HUMAN 9 (co-labels) · OPEN-IN-PLAN-E 5 (co-labels) · out of scope 1.

## (c) New findings (not in either document)

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| N1 | Same page, two capacity answers: portfolio tile + conflict table use server semantics, pressure table (and W2-PPM site roll-up) use UI semantics | `public/portfolio.html:119,125,131`; `public/project.html:354-357`; w2-ppm `ppmVisuals.capacityBySite` | P0 for capacity decisions |
| N2 | "Resource conflicts: none" rendered as a calm tile when some allocations are unknown → null displayed as reassuring | `public/portfolio.html:120` (`rc ? 'alert' : ''`, text "none") | P1 (boundary rule) |
| N3 | `capacity_overload` exception kind is dead code — no caller passes `capacity`, so A11 never raises over-allocation | `services/ppmAlerts.js:16,64`; `routes/governance.js:626`; `tools/governance/ppm-alerts.js:49` | P2 |
| N4 | Workbook Tasks sheet omits `allocation_pct`, `effort_hours`; no Capacity sheet → export cannot reproduce on-screen capacity | `services/portfolioDeck.js:114,127` | P1 |
| N5 | `allocation_pct` column `DEFAULT 100` silently turns "not given by API caller" into full-time; no CHECK constraint | `039_native_ppm.sql:24` | P2 (+ human convention) |
| N6 | Decisions: free status jumps (`done→open`, `cancelled→done`), no reason, no history; a site editor may close a committee decision | `governanceStore.js:13,197`; `routes/governance.js:414-421` | P1 |
| N7 | Money benefit verification has no Finance-side requirement (any non-entrant with plan-write) | `routes/governance.js:580-592`; `governanceStore.js:519-525` | P1 (policy = human; switch = agent) |
| N8 | Benefits carry no value class (realised cash / cost avoidance estimate / productivity / risk reduction) nor measurement window | `056_portfolio_benefits.sql:11-34` | P1 for E09 |
| N9 | Two department lists: `md_departments` 15 codes vs `action_departments` 10 names ("Processing" vs Process/Mill, "Human Resource" vs HR, no Geology/Survey/HSE/Exploration, "Social performance"/"General Manager" only on one side); commitments' `department` is free text | `meetings-init.json:13-27`; `reports-db.js:696-699`; `services/commitmentStore.js:85` | P1 |
| N10 | Observed pilot sheets have no aggregator; baseline-vs-pilot pairing, SUS scoring and n are done by hand | `docs/ops/pilot/*.csv`; `tools/pilot/pilot-metrics.js` (DB only) | P1 |
| N11 | No personal "awaiting my verification/decision" queue across commitments, handoffs, benefits, decisions, PV signatures | see C22 | P2 (check review.1 S1 first) |
| N12 | Migration-number collision risk: review.1 owns 078/079; Plan E W2 uses 072–076 (w2-ppm uses 072 twice in commit messages) | ecarts; w2-ppm `def1125`, `2e2dd6b` | process P1 |

## (d) Vision capability map — product domain

| Vision capability (section) | At head | Disposition | Evidence / note |
|---|---|---|---|
| Executive workspace, ≤8 KPI, variance, approval tray (3.2) | executive.html, it-review, exec-view, deck | RETAIN + IMPROVE | approval tray missing → F-PRODUCT-07 |
| Site management / business view (3.2) | site-awareness.html | RETAIN | role-gated business boundary |
| Site IT Lead operational queue (3.2) | My work, obligations, site-actions | RETAIN + IMPROVE | site-centric; S1 queue = review.1 |
| Department Member (3.2) | none (no user department) | IMPROVE (data first) | F-PRODUCT-05, human owner list |
| Validator inbox (3.2) | scattered pages | CONSOLIDATE | F-PRODUCT-07 |
| Administrator (3.2) | reports.html#admin, policies, system-logs | RETAIN | — |
| Guest / invited (3.2) | exec-view + publishGate | RETAIN | publication contract |
| Incident / MI / PIR / problem (ITIL) | helpdesk, MI register, E-I03, E-I02 | RETAIN (switches off) | SDP = source of record |
| Change (ITIL) | change_records + outcome classifier, upcoming changes | RETAIN | CAB stays in SDP; no in-app CAB |
| Service level / OLA (ITIL) | slaDefinition, SLA register E-I01, WAN SLA | RETAIN; OLA = HUMAN | — |
| Knowledge management (ITIL) | none | OUT (SDP KB is source) | no connector creation |
| Native PPM: WBS, CPM, gates, baselines, RAID (WP6) | yes | RETAIN | `projectSchedule.js`, `ppmBaseline.js` |
| Capacity (WP6, E07) | divergent calculators | IMPROVE (defect) | F-PRODUCT-01/02 |
| Budget periods / EAC | w2-ppm E-P04 | IMPROVE (in plan E) | Finance certification human |
| Benefits + independent verification | yes (B-08), owner link E-P05 | IMPROVE | value class + Finance verifier F-PRODUCT-03/04 |
| RACI / templates / annual pack R16 | w2-ppm E-P06/E-P08 | IMPROVE (in plan E) | — |
| Roadmap Manager (personal tool) → portfolio migration | yes | CONSOLIDATE (already guarded dry-run) | retire Roadmap only after parity + owner decision |
| Governance: cadences, DEC, commitments, handoffs, obligations | yes | RETAIN + IMPROVE decisions | F-PRODUCT-06 |
| Requirement catalogue / traceability (4.3–4.4) | capability registry, GAPS.csv, catalogue R/A | IMPROVE (doc process) | not product code |
| Adoption measures (6.2) | pilotMetrics, pageUsage, SUS, T1–T8 | IMPROVE | F-PRODUCT-08; E-B03/E-B07 in plan E |
| Benefits review G6 | benefits store | IMPROVE | needs value class (F-PRODUCT-03) |
| Generic workflow lifecycle (prompt 6) | per-module machines | RETAIN modules, map vocabulary | do not replace commitment machine |

## (e) Goals for plan F

Common guardrails for every goal: PostgreSQL only; null = UNKNOWN (never 0/green); no new connector; no invented
approval/certification; fictitious labelled fixtures; migrations numbered **≥ 080** (078/079 reserved for review.1
reintegration; check the highest number on `sdp-waves` after W2 merges); evidence in `docs/agent-execution/F-PRODUCT-NN.md`;
PILOT-PROFILE + FLAG-REGISTER rows for every switch; run `tests/await-precedence.test.js` and the PPTX golden.

### /goal — SDP360 / F-PRODUCT-01 One allocation contract for server, UI and export (E07)
- **Problem**: `projectSchedule.resourceConflicts` maps null/'' → 0 and omitted → 100; `ppmVisuals.resourcePressure` maps all three to UNKNOWN; negatives subtract in the UI and vanish on the server; no coverage on the server (C1–C3, N1). Capacity alerts cannot be decision evidence while two answers coexist.
- **Change**: new UMD pure module `public/lib/allocationContract.js` (required by server and loaded by pages): `classify(task)` → `{state:'known'|'unknown'|'invalid'|'excluded', pct}` with the rule: `null`, `''`, `undefined`, non-numeric → unknown; finite 0..100 → known (0 = booked, adds 0); <0 or >100 → invalid (never summed, listed); done/cancelled, no owner, no/inverted dates → excluded with reason. `resourceConflicts` (server) and `resourcePressure`/`capacityBySite` (UI) both call it. Server output keeps `resource_conflicts` (array, same shape, back-compat) and adds sibling `resource_coverage` `{tasks, known, unknown, invalid, unassigned, undated, possible_conflicts:[{owner,from,to,known_peak_pct,unknown_task_ids}]}` where a known load ≤100 overlapping an unknown task is a *possible* conflict (never counted as a conflict, never 0). Files: `services/projectSchedule.js`, `public/lib/ppmVisuals.js`, `services/portfolioAccess.js:99`, `routes/governance.js:478,573`.
- **Switch**: none — defect fix active (null treated as 0 and omitted guessed as 100 violate the boundary). Visible change: some conflict counts drop (omitted-as-100) — documented in the evidence file.
- **Acceptance**: new `tests/allocation-contract.test.js` (table of 7 cases: 60+null, 60+omitted, 60+'', 60+0, 60+120 legacy, 60−50 legacy, 70+40 known → identical verdict server vs UI); extend `tests/ppm-visuals.test.js` parity test to all cases; `tests/project-schedule.test.js` unchanged cases still pass; `tests/ppm-project-lifecycle.smoke.test.js` over-allocation step green.
- **Guardrails**: no change to the write validator; UI copy "unknown" never "0 %"; pure module, no I/O.
- **Size** M · **Priority** P0 (for any capacity decision) · **Depends**: W2-PPM merged (E-P03 `capacityBySite` must be rebased onto the contract) · **AGENT-DOABLE**: yes (no review.1, no human decision).

### /goal — SDP360 / F-PRODUCT-02 Capacity parity on tiles, alerts and workbook
- **Problem**: N2 (tile "none" with unknowns), N3 (`capacity_overload` dead), N4 (export drops allocation/effort).
- **Change**: portfolio/project tiles read `resource_coverage`: "none known · N unknown" in neutral style when unknown>0; `routes/governance.js:626` and `tools/governance/ppm-alerts.js` pass `capacity: resource_conflicts`; `services/portfolioDeck.js` Tasks sheet adds `allocation_pct`, `effort_hours` (null stays empty) and a `Capacity` sheet (conflicts + possible conflicts + coverage line).
- **Switch**: tile/export fixes active (defect). Alert feeding behind existing `ppm_alerts_enabled` (`'0'` = dry run today) — no new switch.
- **Acceptance**: `tests/ppm-alerts.test.js` (capacity item emitted when capacity passed; dedup key stable), `tests/portfolio-deck.test.js` (Capacity sheet, Tasks columns, unknown cell empty not 0), new `tests/portfolio-capacity-parity.test.js` (same fixture → tile count = alert count = workbook rows), `tests/ppm-alerts-cli.test.js`.
- **Guardrails**: no money in Capacity sheet; money rule unchanged.
- **Size** S · **P1** · **Depends** F-PRODUCT-01 · **AGENT-DOABLE**: yes.

### /goal — SDP360 / F-PRODUCT-03 Benefit value class and measurement window (E09 prerequisite)
- **Problem**: N8/C14 — a realised amount, an estimated avoidance and a validated benefit are indistinguishable.
- **Change**: migration (≥080, additive): `value_class TEXT` (`realised_cash | cost_avoidance_estimate | productivity_time | risk_reduction | other`, NULL = unclassified), `measured_from`, `measured_to`, `method_note`. `services/portfolioBenefits.js` exposes `value_class` and a derived `evidence_level` (`planned | entered | verified`); reports/deck never add classes together; an estimate is labelled "estimate" everywhere.
- **Switch**: `benefit_value_class_enabled` (`'0'` = fields hidden, today's form).
- **Acceptance**: `tests/portfolio-benefits.test.js` (classes never summed, null stays unclassified), `tests/portfolio-benefits.smoke.test.js` (switch off → 400/ignored field; on → round trip), `tests/portfolio-deck.test.js` (Benefits sheet column).
- **Guardrails**: no default class; no certification wording; money rule unchanged.
- **Size** S/M · **P1** · **Depends**: W2-PPM (E-P05 touches the same table) · **AGENT-DOABLE**: yes.

### /goal — SDP360 / F-PRODUCT-04 Finance-side verifier for money benefits (PROPOSED policy)
- **Problem**: N7 — any non-entrant with plan-write can verify a money benefit.
- **Change**: in `verifyBenefit` (route + store): when `benefit_money_verifier_role` is a role name (e.g. `finance-viewer`) and the benefit is `value_kind='money'`, the verifier must hold that role and not be the entrant nor the linked owner (E-P05); refusal code `VERIFIER_ROLE`. UI shows who may verify.
- **Switch**: `benefit_money_verifier_role` (`''` = today: any non-entrant).
- **Acceptance**: extend `tests/portfolio-benefits.smoke.test.js` (role set → committee member refused 403, finance-viewer accepted; self still refused), `tests/capability-registry.test.js` stays green (no new right granted).
- **Guardrails**: PROPOSED until Finance owner adopts; no role auto-granted.
- **Size** S · **P1** · **Depends** F-PRODUCT-03 (same file), E-P05 · **AGENT-DOABLE**: yes (code); adoption = human.

### /goal — SDP360 / F-PRODUCT-05 Department crosswalk (14 departmental usages)
- **Problem**: N9 — two department vocabularies; no roll-up per department across PV issues, report actions, handoffs, commitments.
- **Change**: read-only crosswalk table/seed (migration ≥080) `department_crosswalk(md_code, action_department_name, status 'proposed')` seeded by exact/obvious matches only (Mining↔mining, Maintenance, Supply Chain, Finance, Security↔security) — every other pair left NULL; pure `services/departmentCrosswalk.js` + `tools/governance/department-crosswalk.js --check` printing unmapped values found in data (commitments.department, handoffs from/to, action_items.department); admin view list-only.
- **Switch**: `department_rollup_enabled` (`'0'`; when '1', obligations/insights may group by crosswalked department, unmapped → "unmapped", never merged).
- **Acceptance**: new `tests/department-crosswalk.test.js` (only proposed exact pairs, Process/Mill/Processing NOT auto-merged, unmapped counted), CLI `--check` test.
- **Guardrails**: no department attribute added to users (needs HR/IAM decision); no auto-rename of stored labels.
- **Size** M · **P2** · **Depends** none · **AGENT-DOABLE**: yes (mapping approval = human).

### /goal — SDP360 / F-PRODUCT-06 Decision register lifecycle (E08)
- **Problem**: N6 — DEC status any→any, no reason, no ledger; site may close a committee decision.
- **Change**: pure `services/decisionLifecycle.js` transition table (open→in_progress|done|cancelled; in_progress→done|cancelled|open; done→reopened by committee with reason; cancelled requires reason); `updateDecision` validates and writes a `ppm_events`-style hash-chained row (entity `decision`) with old/new/actor/reason; site editor may move `open↔in_progress` and propose `done` only as `awaiting_confirmation` when switch on.
- **Switch**: `decision_lifecycle_enforced` (`'0'` = today's free status).
- **Acceptance**: new `tests/decision-lifecycle.test.js` (table, reason required, site cannot close), extend `tests/governance-routes.smoke.test.js` for 409 on illegal jump with switch on and unchanged behaviour off; history endpoint returns rows.
- **Guardrails**: existing statuses kept; no data migration of past decisions.
- **Size** M · **P1** · **Depends** none · **AGENT-DOABLE**: yes.

### /goal — SDP360 / F-PRODUCT-07 "Awaiting me" block in My work (validator inbox)
- **Problem**: C22/N11 — no personal queue of items needing my verification/decision.
- **Change**: `services/myWork.js` optional block composed from existing readers: commitments `awaiting_verification` where I am reviewer (named or role holder), handoffs awaiting my acceptance, benefits awaiting verification where I am eligible (not entrant/owner), decisions I own due ≤ 7 days, PVs where I am a named unsigned signer. Each line: source, due, evidence link, deep link. Reader failure → block null ("not measured").
- **Switch**: `mywork_awaiting_me_enabled` (`'0'`).
- **Acceptance**: extend `tests/my-work.test.js` + `tests/my-work-route.smoke.test.js` (null-not-0 per source, SoD exclusions), route smoke.
- **Guardrails**: shows only what the user can already open (reuse each module's scope check); before merge compare with review.1 S1 queue to avoid two queues.
- **Size** M · **P2** · **Depends** F-PRODUCT-06 (decisions), review.1 S1 comparison (non-blocking for build) · **AGENT-DOABLE**: yes (build); keep/merge with S1 = human.

### /goal — SDP360 / F-PRODUCT-08 Observed-evidence aggregator for the pilot (E09)
- **Problem**: N10 — T1–T8, stopwatch (baseline/pilot) and SUS sheets are summarised by hand.
- **Change**: pure `services/pilotObserved.js` + `tools/pilot/pilot-observed.js --sheets=DIR`: per task and per persona/site: n, completion yes/with_help/no/not_run, median/p75 time, errors; stopwatch paired baseline vs pilot per participant (median active minutes, re-entries, only pairs with both phases; n shown); SUS score per participant and median (standard 0–100 formula); empty cell = not measured; n<3 → "insufficient sample". Output Markdown/CSV next to `pilot-metrics` output; never writes targets or a verdict.
- **Switch**: none (offline CLI, no product surface).
- **Acceptance**: new `tests/pilot-observed.test.js` (blank cells not 0, unpaired rows excluded and counted, SUS formula fixture, CSV injection neutralised via `public/lib/csvSafe`).
- **Guardrails**: participant codes only; no names; run outputs with site data not committed.
- **Size** S · **P1** · **Depends** none (complements E-B03 value table, W2-KPI) · **AGENT-DOABLE**: yes.

### /goal — SDP360 / F-PRODUCT-09 Allocation-unspecified convention switch (E07 residue)
- **Problem**: N5 — an API caller that omits `allocation_pct` stores 100 (DB default).
- **Change**: in `governanceStore.normalise('task')` on INSERT: when `ppm_alloc_unspecified='unknown'` and the field is absent, write NULL explicitly; add additive `CHECK (allocation_pct IS NULL OR allocation_pct BETWEEN 0 AND 100) NOT VALID` (migration ≥080) + `tools/governance/alloc-audit.js` listing out-of-range legacy rows (read-only).
- **Switch**: `ppm_alloc_unspecified` (`'full_time'` = today).
- **Acceptance**: `tests/pg-governance-store.test.js` (both settings; or `tests/pg-ppm-w2-store.test.js` once W2-PPM is merged), audit CLI test.
- **Guardrails**: no UPDATE of existing rows; NOT VALID so no live validation scan.
- **Size** S · **P2** · **Depends** F-PRODUCT-01 · **AGENT-DOABLE**: yes (code); convention = PMO decision.

### /goal — SDP360 / F-PRODUCT-10 Review.1 product delta ledger (prep, no code merge)
- **Problem**: C4, C10, C11, C20, C21 cannot be judged without the artifact; risk of reinventing S1 queue, workbench, profiles.
- **Change**: `docs/agent-execution/F-PRODUCT-10.md` template: for each review.1 product file (to be supplied) → overlapping head module, Plan E goal, decision (retain/merge/drop), migration renumbering; plus a script `tools/agent/review1-diff.js --manifest=<path>` that lists paths vs head with byte equality (CRLF-insensitive).
- **Switch**: none.
- **Acceptance**: script test on a synthetic manifest.
- **Size** S · **P1** · **Depends**: user supplies the review.1 manifest/ZIP · **AGENT-DOABLE**: no (needs artifact) for the ledger content; script yes.

## (f) Decisions that belong to people (owner role)

| Decision | Owner role | Blocks |
|---|---|---|
| Convention for an unspecified allocation (full time vs unknown) and capacity definition per person/team | PMO lead (+ IT Ops manager for team capacity, audit I-05) | F-PRODUCT-09; capacity as decision evidence |
| Who certifies a money benefit; method, period, currency, perimeter, supporting documents | Finance controller | F-PRODUCT-04 adoption; any savings statement |
| Value classes accepted for benefits review (G6) | Executive sponsor + Finance | F-PRODUCT-03 reporting |
| Portfolio access: group-project and textual-owner exceptions | IAM / security owner + PMO | `portfolio_site_scope_reads=1` |
| Stable person identity for PPM owners (user link vs directory) | IAM owner + PMO | identity-based capacity across sites |
| Department crosswalk pairs and department master list; user→department attribute | HR/department heads + Group IT | F-PRODUCT-05 activation |
| Decision lifecycle (who closes a DEC, reopen rules) | Governance committee chair | F-PRODUCT-06 activation |
| Two decision KPIs, formula/window/thresholds | KPI committee (E-K01) | E08 publication |
| Pilot cohort, sites, observers, scale/adjust/stop at G5 | Product owner + executive sponsor | E09 |
| Keep/merge review.1 S1 queue, workbench, profiles into the clean branch | Product owner (with architecture) | F-PRODUCT-07, F-PRODUCT-10 |
| Enabling commitments/handoffs in the pilot | Process owners per site | C9 |
