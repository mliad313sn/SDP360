# P11 qualification — ROUND 7 (re-check) — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature, a release decision or a filled human gate.

- Frozen SHA: `7ea49070d687679109c3c91ef29a8f744835f10c` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked). Only working-tree change: the intentionally removed `docs/agent-execution/` narratives (not read, not fetched). Earlier round files untouched. No product file modified.
- In my area since round 6 (`git diff e82d95ba..7ea49070`): `routes/governancePortfolioPhase2.js` (R6-1 project demand view_partial, R6-4 rename), `services/governanceStore.js` (R6-2 `SELECT … FOR UPDATE`, F-28 risk status vocabulary, F-27 gate count via `riskExposure.isHigh`), `services/ppm/reviewWorkflow.js` + migration 133 (CR `scope_fields`), `services/ppm/riskExposure.js` (TERMINAL statuses), `services/ppm/projectKpis.js` + `raid.js` (one high-risk rule), `tests/pg-helpers.js` (run-id sanitised). Scheduler / levelling / EVM engine files unchanged.
- Throwaway attacks (not committed): `/tmp/r7ppm/tests/r7attack.smoke.test.js` (B1-B3), `/tmp/r7ppm/tests/r7b.smoke.test.js` (B2i-k, intake on), `/tmp/r7ppm/tests/r7c.smoke.test.js` (B1e); round-5/6 repros re-run unchanged from `/tmp/r6ppm/tests/`. Logs `/tmp/r7ppm/*.log`.
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=ppmr7`, brief's `NODE_OPTIONS`. Load average ~17 at start (other seats) — wall-clock figures inflated. Databases: 0 `*ppmr7*` left after the runs (each file's `_pg-boot` dropped its own); nothing else dropped.

## 1. Round-6 findings — re-verification at 7ea49070

| R6 | Fix | Re-run | Verdict |
|---|---|---|---|
| **R6-1 (P2)** project demand panel GREEN vs group RED | fix 25 | `r7attack` B1a: group cell `2 FTE / 133.3 % RED`; project P1 cell `rag NA, utilisation null, shared_with_other_projects:true`, response `view_partial:true` + note, `over 0`. B1b: a cell only P3 demands keeps `66.7 % GREEN, shared:false`. Old repro `r6attack` A1 now prints `utilisation_pct:null, rag:NA, shared:true` | **FIXED** (two side effects, R7-1 and R7-2, P3) |
| **R6-2 (P3)** two different CRs concurrently → lost approved delta | fix 26 | `r7attack` B2a, 10 rounds: every round exactly one 200 + one 409, final budget 7000 or 8000 consistent with the one consumed CR, one `cr:N` ledger row per round, `both200 0, lostDelta 0`. Old repro: `409 / 200, final 8000, CR rows cr:1, cr:3` (cr:1 = earlier single-CR step) | **FIXED** |
| **R6-3 (P3, process)** hyphenated run id silently ignored | fix 25 | `sanitiseRunId('ppm-r6')` → `ppm_r6`; `tests/pg-helpers.js:98` now uses it | **FIXED** |
| **R6-4 (P3)** two meanings of `partial` | fix 25 | portfolio response now `view_partial` (B1a: `resp view_partial false, resp partial undefined`); cell `partial` keeps the unknown-lines meaning | **FIXED** |
| R5-1 … R5-7, R4-1, R4-2 (regression check) | — | `/tmp/r7ppm/regress.log`: dependency loop via soft delete → 409 DEP_CYCLE; race 20/20 one 200 + one 409, 0 loops; capacity site view NA; 120-month line 400; currency / CR reuse 409; programme soft delete keeps AC 700, purge `HAS_ACTUALS`; doc versions v1..v4 / v1..v3 under concurrency. One throwaway assertion failed on `current_setting('lc_ctype')` (not a PG17 parameter) — repro artefact, not product | still **FIXED** |
| R5-8 coverage evidence set | — | unchanged (E3 still only `tests/ppm-*`) | **NOT FIXED** (evidence-set note) |
| R1-F4 levelling synchronous / not converged | — | E2 below, same counts | **NOT FIXED** (carried P2) |
| R1-F5, R1-F6, R1-F7..F11, R2-4/R2-5/C7, E5 | — | engine untouched | **NOT FIXED** (carried) |

## 2. Assigned evidence at 7ea49070

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (70 files) | **408 tests, 408 pass, 0 fail, 0 skipped**, 271 s, `EXIT 0` (`/tmp/r7ppm/suite.log`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: CPM **485 ms**, levelling **41 196 ms** (19.6 s in r6 at lower load), 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations — counts identical r3–r7 (`/tmp/r7ppm/bench.log`). `docs/ops/perf-budgets.json` `approved_by: null`, no PPM class | **verified** |
| E3 | `--experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 304/304 pass; services/ppm **89.69 % lines, 83.83 % branches, 88.03 % functions** (`/tmp/r7ppm/cov.log`). Fix-25/26 code still thin in these files: resourceDemand 30.84 % lines, reviewWorkflow 61.38 % (scope check l.91-109 uncovered here), riskExposure 56.94 %. Lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93; evm.js 100 / 92.78; projectKpis 100 / 75 | **verified** |
| E4 | round-5/6 repros + new attacks (§1, §3) | as listed | **verified** |

Verified: 4 (E1, E2, E3, E4). Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; witness project (E-B05 empty); four-eyes guard over HTTP and the fix-29 operator-token path (other seats); orphan-blob path under an injected INSERT failure.

## 3. New break attempts (round 7, one per capability, aimed at fix 25/26 code)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| B1 | Fix 25 R6-1 — "a shared cell gets no colour, a sure verdict is kept" (cf. `resourceDemand.js:100` "known demand alone already over capacity → red") | P1 alone demands 2.0 FTE (cap 1.5), P2 adds 0.1 FTE same skill/month | **BROKEN (minor)** → R7-1: project panel shows P1 cell `rag NA, util null`, `load.over 0`, although P1's own demand is already over capacity (group cell RED). Fail-to-grey, not green |
| B1e | Fix 25 — "no other project's figure is returned" | site-scoped viewer (site A) reads P1 demand; P2 is on site B and returns 404 to that viewer | **BROKEN (minor)** → R7-2: per-cell `shared_with_other_projects:true` on `2034-02` only reveals that an unreadable project demands that skill in that month |
| B2 | Fix 26 — "a CR unlocks only the fields it names" | intake switch on; CR scoped `charter` used for charter+expected_value, charter+budget_reference; CR without scope for charter; charter+budget with no impact; reuse; route proposal with `currency` and `Charter` scope | **Holds**: 409 `CHANGE_REQUEST_SCOPE` / `BUSINESS_CASE_FROZEN` / reuse 409; nothing stored; proposal 400 `BAD_SCOPE` for both (case is not normalised — fails closed). Without the intake switch `business_need`/`expected_value` are not writable columns, so charter+business_need 200 changes only the charter |
| B3 | Fix 25 F-27/F-28 — "one high-risk rule everywhere" | (a) status `Closed` / `mitigated` / kind `Issue` through the generic writer; (b) `projectSummary` with one open high **issue** and no risk; (c) high risk with residual 1×1 | (a) **Holds** (`Closed` normalised 200, `mitigated` 400, gate count 1). (b) **BROKEN (display)** → R7-3: `active_risks 0, high_risks 1` (card "Active risks · high" reads `0 · 1`); (c) `active_risks 1, high_risks 0` and closure gate no longer blocked — behaviour change, R7-4 |
| A7 | Engine / EVM (assigned) | E1-E3 | no regression; carried F4/F5/F6 |

## 4. Findings at 7ea49070

### P0
None found.

### P1
None found. Every defect below is either display-only or behind switches that are `'0'` by default (`ppm_resource_demand_enabled`, L16 excluded from the pilot plan; `ppm_structured_dependencies_enabled` for residuals).

### P2
None new. Carried: R1-F4 (levelling ~20-41 s at 10 k tasks on the request thread, `converged:false`, no approved perf budget), R1-F5, R1-F6.

### P3 — later

- **R7-1 — Project demand panel greys a cell the project alone already exceeds.** `routes/governancePortfolioPhase2.js:136-139` sets `rag:'NA'` for every shared cell, even when this project's own known demand is above capacity (a certain RED, as `resourceDemand.js:100` already treats for unknown lines); `load.over` then drops to 0. Repro: `cd /home/user/qual/ppm && PG_ADMIN_URL=… SDP_TEST_RUN_ID=ppmr7 NODE_OPTIONS="…" node --test --test-force-exit /tmp/r7ppm/tests/r7attack.smoke.test.js` → `B1c … project P1 kappa (own 2.0 FTE vs cap 1.5) {"avg":2,"rag":"NA",…} P1 load.over 0`. Regression test: shared cell whose own avg_fte > capacity stays `RED`. Rollback risk low (display).
- **R7-2 — Per-cell `shared_with_other_projects` tells a site-scoped reader that an unreadable project demands a skill in a given month.** Repro: `/tmp/r7ppm/tests/r7c.smoke.test.js` → viewer gets 404 on P2 but `2034-02:NA:shared=true`. Fix: under site-scope reads, drop the per-cell flag and give only the response-level `view_partial` (as `/portfolio/capacity` does). Exposure: skill name + month only, no figure.
- **R7-3 — Project card counts can contradict each other.** `services/ppm/projectKpis.js:83-85`: `active_risks` counts open `kind='risk'` only, `high_risks` uses `isHigh` (risks **and** issues, residual first). Pure repro: `node -e "require('./services/ppm/projectKpis').projectSummary({project:{id:1},tasks:[],milestones:[],risks:[{kind:'issue',status:'open',probability:3,impact:3}],today:'2026-11-21'})"` → `active_risks 0, high_risks 1`; rendered by `public/lib/ppmGovernanceW3.js:54` as `0 · 1`. Fix: same population for both (or label "high risks + issues").
- **R7-4 (policy) — Closure gate rule changed on a default-on path.** `services/governanceStore.js:538` `gateCounts` now (a) blocks closure on an open high **issue** (previously risks only) and (b) un-blocks a high inherent risk once a residual 1–2 level is recorded (residual writable only with `ppm_structured_dependencies_enabled`, but read regardless of the switch). This is a business rule (closure policy / risk mapping, G-12 / D-04 area) shipped as a code fix; it should be listed as PROPOSED for the committee, with the residual's evidence requirement stated.
- R5-8 (coverage evidence set), R1-F7..F11, R2-4/R2-5/C7, E5 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R6 | R7 | Basis |
|---|---|---|---|
| (no lot — default switches) | GO PILOT | **GO PILOT** | 408/408 targeted tests; R7-3/R7-4 are display / policy notes |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | R7-3 cosmetic inconsistency on the project card |
| L03 PMO — change control, baselines, gates | GO PILOT | **GO PILOT (conditional)** | closure-gate rule change R7-4 to be confirmed by the committee |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** | G14 Finance empty |
| L06 Optional plan exchange / offline editing | CONDITIONAL | **CONDITIONAL** | connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / sensitivity | not assessed | **not assessed** | — |
| L14 Intake, DQ, register, review / freeze | GO PILOT (cond.) | **GO PILOT (conditional on committee policy)** | R6-2 fixed; CR scope binding holds (B2); frozen-field list, CR single-use, scope_fields and "currency = re-baseline" remain PROPOSED policy |
| L15 Adoption Lot B | not assessed | **not assessed by this seat** | — |
| L16 Portfolio phase 2 | CONDITIONAL | **CONDITIONAL** (excluded from pilot plan) | R6-1 fixed; R7-1/R7-2 P3; capacity values, effort weights, risk mapping PROPOSED; `ext_api_portfolio_enabled` decision pending |

## 6. Human gates still empty in this area (RELEASE-GATES.md at 7ea49070 — every decision cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (capacity RAG, risk mapping, residual-first gate rule, freeze field list / CR scope rule)
- Closure policy D-04 (G-17/G-18) — Business/control owners + Committee (R7-4)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` `approved_by: null`, no PPM class)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Data owner — anonymised fixtures (G-15) — Data owners
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
