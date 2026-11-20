# P11 qualification — ROUND 6 (confirmation) — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature, a release decision or a filled human gate.

- Frozen SHA: `e82d95baf7fa4b554003d32f89e02d634216c1de` (clone `/home/user/qual/ppm`, `git log -1` checked). Only working-tree change: the intentionally removed `docs/agent-execution/` narratives (not read). Earlier round files untouched.
- In my area since round 5 (`git log 3ee4dd23..e82d95ba`): fix 20 (`95faf477`, merged `8e70b423`) — `portfolioPhase2Store.js`, `reviewWorkflow.js`, `governanceStore.js` (project upsert now one transaction + CR lock), `resourceDemand.js`, `projectDocuments.js`, `structuredDependencies.js`, `routes/governancePortfolioPhase2.js`; fix 19 (`d9429277`) — `portfolioRegister.js` drill rule (F-21), `riskExposure.isHigh` shared rule (F-23), partial risk rollups (F-22); fix 23 reviewer picker (`routes/governanceReview.js`). Scheduler / levelling / EVM engine files unchanged.
- No product file modified. Throwaway attacks (not committed): `/tmp/r6ppm/tests/r5attack{,2,3}.smoke.test.js` (round-5 repros re-run, race loop raised from 6 to 20 rounds), `/tmp/r6ppm/tests/r6attack.smoke.test.js` (new), `/tmp/r6ppm/x/drill.js` (rewritten for the new `drill` contract, 196 card/report × filter combinations). Logs `/tmp/r6ppm/*.log`.
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=ppm-r6`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import file://…/tests/_pg-boot.mjs"`. Host 4 vCPU, load average up to ~19 during the run (other seats) — wall-clock figures inflated.
- **Database housekeeping (process finding P11-OPS, P3):** `tests/pg-helpers.js:98` accepts a run id only if it matches `/^[a-z0-9]{1,16}$/`. The brief's `ppm-r6` contains a hyphen, so it was **silently ignored** and my throwaway databases carry random names (`sdp_tracker_test_<rand>`), indistinguishable from other seats'. Each file's `_pg-boot` cleanup drops its own database on normal exit; I found **0** databases containing `ppm_r6`/`ppm-r6` and did **not** drop anything else (534 `sdp_*test*` databases present, owned by the sweep). Suggest the orchestrator use `ppmr6`-style ids, or make `testDbName` refuse (not ignore) an invalid id.

## 1. Round-5 findings — re-verification at e82d95ba

| R5 | Claimed fixed | Re-run (my repro, `/tmp/r6ppm/`) | Verdict |
|---|---|---|---|
| **R5-1 (P2)** dependency loops (a) via soft delete + restore, (b) via concurrent opposite writes | fix 20 | `r5attack.log` N1a: A←B, B←C; soft-delete B; **C←A now 409 `DEP_CYCLE`** (was 200); restore B 200; portfolio `cycles: []`, A `in_cycle:false`. N1b: **20/20** races exactly one 200 + one 409, `loops created 0, cycles reported 0` (was 3/6). New variant (`r6attack` A3): cancelled A←B + open B←A, then PUT A←B `status:open` → **409 DEP_CYCLE** | **FIXED** |
| **R5-2 (P2)** business-case freeze bypass (currency, CR reuse) | fix 20 | `r5attack.log` N3: budget without CR 409; **currency USD→XOF without CR 409** (stored stays USD); budget +1000 with CR 200; **9 000 000 reusing CR 409**; **charter reusing CR 409**. `r6attack` A2: CR in XOF on a USD project → 409 `CHANGE_REQUEST_SCOPE`; CR consumed by a charter-only edit then budget → 409 `CHANGE_REQUEST_USED`; 10 concurrent identical edits with one CR → one consumption row (`cr:1` once; the other 200s are no-op writes, budget unchanged) | **FIXED** (one new concurrency gap, R6-2 below) |
| **R5-3 (P2)** site-scoped reader sees GREEN capacity while group RED | fix 20 | `r5attack3.log`: committee `2 FTE, 133.3 %, RED`; site viewer `1 FTE, capacity_fte null, rag NA`, response `partial:true` | **FIXED on the portfolio capacity route** — the same defect class survives on the **project** demand route (R6-1) |
| **R5-4 (P2)** register KPI card / standard-report counts ≠ drill list | fix 19 (F-21) | `drill.js` (`/tmp/r6ppm/drill.log` = stdout): 196 KPI/report links × 10 active-filter states × money on/off → **0 mismatches**; money-hidden `unfunded`/money reports now `count:null, drill:null` (no link) | **FIXED** |
| **R5-5 (P3)** demand window > 60 months silently truncated | fix 20 | 120-month line → **400** (`DEMAND_WINDOW`); legacy long rows reported in `truncated` (code read) | **FIXED** |
| **R5-6 (P3)** document version race / case / money titles | fix 20 | `r6attack` A4: 4 concurrent uploads `Design Note` / `design note` / `DESIGN NOTE` / `Design note` → v1..v4, all 200, no UNIQUE error; accented `Étude réseau` ×3 → v1..v3 (cluster C.UTF-8 lowers accents). Orphan-blob removal on failed INSERT and title masking (`title:null, title_masked:true` for non-amount readers) verified by code read; project history (which carries the title in `note`) requires the money rule (`routes/governance.js:900`) | **FIXED** |
| **R5-7 (P3)** freeze / DQ-gate switches not four-eyes | fix 21/24 | `docs/ops/policy-catalogue.json:191,202` now `four_eyes:true`; enforcement in `services/fourEyesGuard.js` applies **only while `policy_center_enabled=1`** (code read, not executed by this seat) | **FIXED (catalogue); enforcement conditional on the Policy Center** |
| **R5-8 (P3)** assigned coverage command misses portfolio lots | not claimed | still true — E3 below; I ran E3b as an extra | **NOT FIXED** (evidence-set note) |
| L16 missing from pilot plan | — | `docs/business-readiness/PLAN-PILOTE.md:61` L16 listed **CONDITIONAL, hors pilote, exclu** | **FIXED** |
| R4-1, R4-2 (re-check) | — | `r5attack2.log`: programme soft delete keeps AC 700 + `actuals_on_deleted_projects`; purge skips `HAS_ACTUALS`; hard delete 409; intake value-state mask holds | still **FIXED** |
| R1-F4 levelling synchronous / not converged | not claimed | E2: 10 000 tasks, levelling **19 594 ms**, `converged:false`, 1 303 moves, 6 494 over-allocations (identical counts r3–r6) | **NOT FIXED** (carried P2) |
| R1-F5 vacuous bench assertion; R1-F6 low branch coverage | not claimed | engineInput 47.73 %, projectReport 58.90 %, engineStore 59.93 % branches (identical) | **NOT FIXED** (carried) |
| R2-4, R2-5 / C7, R1-F7..F11, E5 | not claimed | engine untouched | **NOT FIXED** (P3, carried) |

## 2. Assigned evidence at e82d95ba

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (70 files) | **408 tests, 408 pass, 0 fail, 0 skipped**, 298 s (`/tmp/r6ppm/suite.log`, `EXIT 0`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: CPM **254 ms**, levelling **19 594 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations (`/tmp/r6ppm/bench.log`). `docs/ops/perf-budgets.json` still `approved_by: null`, no PPM class → nothing to pass/fail | **verified** |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 304/304 pass; services/ppm **89.70 % lines, 83.92 % branches, 88.10 % functions** (`/tmp/r6ppm/cov.log`). Fix-20/19 code is barely touched by these files: structuredDependencies 27.59 % lines, portfolioScenario 29.17, resourceDemand 30.84, portfolioRegister 31.29, effortScoring 42.50, projectDocuments 53.45, riskExposure 54.41, reviewWorkflow 60.87 (`freezeRefusal` l.86-102 uncovered). Lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93; evm.js 100 / 93.58 | **verified** |
| E3b (extra) | same flags over `tests/portfolio-*.test.js` (28 files) | 169/169 pass; fixed modules 100 % lines (portfolioPhase2Store 95.96 %, riskExposure 89.71 %); weakest branches portfolioScenario 63.33, portfolioPhase2Store 66.39, reviewWorkflow 74.75 (`/tmp/r6ppm/cov-portfolio.log`) | **verified** |
| E4 | round-5 repros (§1) | as listed | **verified** (R5-6 orphan blob, R5-7 enforcement: code read only) |

Verified: 5 (E1, E2, E3, E3b, E4). Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; witness project (E-B05 empty); four-eyes guard enforcement over HTTP (another seat's area); R5-6 orphan-blob path under an injected INSERT failure.

## 3. New break attempts (round 6, one per capability, preferring fix-19/20 code)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| A1 | Fix 20 capacity — "a partial demand is never compared with the group-wide capacity" | `r6attack` A1: `ppm_capacity_fte {"*":1.5}`, two projects × 1 FTE same skill/month, committee reader, no site scope; `GET /portfolio/capacity` vs `GET /project/P1/demand` | **BROKEN** → R6-1: portfolio cell `2 FTE / 133.3 % RED`; project page `load.cells` `1 FTE / capacity 1.5 / 66.7 % GREEN`, no `partial` flag (`routes/governancePortfolioPhase2.js:123`, rendered by `public/lib/ppmPhase2.js:88` with the RAG pill) |
| A2 | Fix 20 freeze — "a change request unlocks the budget only to the value it approved" | two approved CRs on one project (+1000, +2000) used in two concurrent PUTs (budget 6000→7000 and 6000→8000) | **BROKEN (concurrency)** → R6-2: both 200, final budget **7000** (sequential intent 9000), both CRs recorded as consumed (`cr:3`, `cr:2`); the +2000 approval is silently lost and the ledger shows two `finance_edit` rows both with old value 6000 |
| A3 | Fix 20 dependencies — loop refusal on update; hidden predecessor never served | reopen a cancelled closing edge (409 holds); site-scoped reader on a project whose predecessor is on another site | **Holds**: `predecessor_project_id:null, predecessor_readable:false`; portfolio `edges:[]`; hidden id absent from both payloads |
| A4 | Fix 20 documents — one version allocator per case-insensitive title | 4 concurrent ASCII case variants + 3 accented variants | **Holds** (v1..v4, v1..v3). Caveat: relies on PG `lower()` matching JS `toLowerCase()`; true on this C.UTF-8 cluster and with linguistic collations, not re-checked on the production Windows locale |
| A5 | Fix 19 register — "card count == drill list" | 196 combinations (§1 R5-4) | **Holds** |
| A6 | Fix 19 risk — "one high-risk rule, unknown never low" | code read `riskExposure.isHigh` / `rollup` + `raid.js:29` vocabulary (`open | closed` only) | **Holds**: unknown score → not high and rollup `level:null, partial:true` unless a known high/critical exists |
| A7 | Engine / EVM (assigned) | E1/E2/E3 | no regression; carried F4/F5/F6 |

## 4. Findings at e82d95ba

### P0
None found.

### P1
None found. Every defect below sits behind switches that are `'0'` by default (L16 `ppm_resource_demand_enabled`, L14 `ppm_business_case_freeze_enabled`), and L16 is excluded from the pilot plan.

### P2 — before general deployment (and before L16 enters any wave)

**R6-1 — The project demand panel colours one project's demand against the group-wide capacity (GREEN while the group is RED).** Same defect class as R5-3; fix 20 corrected `/portfolio/capacity` and `/portfolio/scenario` only. `GET /api/governance/ppm/project/:id/demand` (`routes/governancePortfolioPhase2.js:119-124`) calls `RD.monthlyLoad(lines_of_this_project, { capacity: cap.map })` with the group map; the page shows the RAG pill and utilisation (`public/lib/ppmPhase2.js:88`).
Repro: `cd /home/user/qual/ppm && PG_ADMIN_URL=… SDP_TEST_RUN_ID=ppmr6 NODE_OPTIONS="…" node --test --test-force-exit /tmp/r6ppm/tests/r6attack.smoke.test.js` → `[r6] portfolio cell … 133.3 RED` / `[r6] project P1 load cell … 66.7 GREEN`.
Regression test: project panel never returns `GREEN`/`AMBER` for a cell where other projects also carry demand (return `rag:'NA'` + `partial:true`, or show the project's share next to the group cell's verdict). Fix: reuse the route's own `partialCapacity` idea (the project's lines are always a partial of the group cell when any other project has demand in that skill/month). Rollback risk low (display only). Capacity values remain PROPOSED.

### P3 — later

- **R6-2** — Business-case CR value binding is not concurrency-safe across two different CRs: `services/governanceStore.js:708` reads `before` without `FOR UPDATE` and the advisory lock (l.731) is per CR id, so two edits naming different CRs both validate against the same old budget; the last commit wins, both CRs are consumed, one approved delta disappears. Repro: `r6attack` A2 (`two CRs concurrently 200 … 200 … final budget 7000`). Fix: `SELECT … FOR UPDATE` on the project row (or a per-project advisory lock) at the start of the project branch. Exposure: L14 freeze switch (default 0); requires two simultaneous committee edits on one project.
- **R6-3 (process)** — `SDP_TEST_RUN_ID` with a hyphen is silently ignored (`tests/pg-helpers.js:98`): the per-seat sweep cannot find this seat's databases. Refuse an invalid id loudly.
- **R6-4** — capacity response mixes two meanings of `partial`: response-level `partial:true` (scope) while each cell carries `partial:false` (unknown lines) — a client reading the cell flag alone gets the wrong message. Rename one (e.g. `scope_partial`).
- R5-8 (coverage evidence set), R1-F5/F6/F7..F11, R2-4/R2-5/C7, E5 — unchanged.

### Carried P2
R1-F4 — levelling ~20 s at 10 k tasks on the request thread, `converged:false`, no approved perf budget; R1-F5, R1-F6.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R5 | R6 | Basis |
|---|---|---|---|
| (no lot — default switches) | GO PILOT | **GO PILOT** | 408/408 targeted tests; no default-on defect found |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | R5-3 interaction closed on the portfolio route |
| L03 PMO — change control, baselines, gates | GO PILOT | **GO PILOT** | unchanged |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** | G14 Finance empty; pilot plan keeps L05 out until signed |
| L06 Optional plan exchange / offline editing | CONDITIONAL | **CONDITIONAL** | connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / sensitivity | not assessed | **not assessed** (soft-delete interaction with dependencies now safe: R5-1a fixed) | — |
| L14 Intake, DQ, register / dashboard, decision agenda, lifecycle / review / audit | CONDITIONAL | **GO PILOT (conditional on committee policy)** | R5-2 and R5-4 fixed and re-verified; R6-2 is a P3 race. Frozen-field list, CR single-use rule and "currency change = re-baseline" are PROPOSED business policy — committee must confirm before `ppm_business_case_freeze_enabled` is armed |
| L15 Adoption Lot B | not assessed | **not assessed by this seat** | outside PPM |
| L16 Portfolio phase 2 | CONDITIONAL | **CONDITIONAL** (excluded from the pilot plan) | R5-1, R5-3, R5-5, R5-6 fixed; R6-1 (project panel GREEN vs group RED) before any wave; capacity values, effort weights, document lists PROPOSED; `ext_api_portfolio_enabled` four-eyes + data owner/security decision |

## 6. Human gates still empty in this area (RELEASE-GATES.md at e82d95ba — every decision cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners (also BI scope `ext_api_portfolio_enabled`)
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (incl. PROPOSED DQ bands, capacity RAG `ppm-capacity`, effort weights, risk score mapping, freeze field list / CR rule)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` `approved_by: null`, no PPM class)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Data owner — anonymised fixtures (G-15) — Data owners (project documents store)
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
