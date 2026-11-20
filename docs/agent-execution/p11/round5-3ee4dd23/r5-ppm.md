# P11 qualification — ROUND 5 — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature, a release decision or a filled human gate.

- Frozen SHA: `3ee4dd23cbe661488f3f693a302358fb62eba6a0` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked). The only working-tree changes are the intentionally removed `docs/agent-execution/` narratives (not read). Earlier rounds (`r4-ppm.md` at e43d11d5, `r3-ppm.md`, `r2-ppm.md`, `ppm.md`) untouched.
- In my area since round 4 (`git log e43d11d5..3ee4dd23`, 63 commits): fix 15 `93d7e277` (R4-1..R4-4) merged in `0dc831c0`; portfolio Lots 2 (`b658c9a1`, data quality), 3 (`2baea099`, register + executive dashboard), 4 (`ab99fe10`, decision agenda + alerts), 5 (`3ecb895d`, lifecycle / review / field audit / business-case freeze), 6 (`b597b76f`, dependencies, demand/capacity, effort, documents, scenario, BI scope). Scheduler / levelling / EVM engine files unchanged (`git diff --stat` empty for `scheduleEngine.js`, `resources.js`, `engine*.js`, `evm.js`).
- No product file modified. Throwaway attacks (not committed): `/tmp/r5ppm/tests/r5attack{,2,3}.smoke.test.js`, `/tmp/r5ppm/x/drill.js`; logs `/tmp/r5ppm/*.log`. The round-4 repro directory `/tmp/r4ppm/` no longer existed, so the R4 repros were rewritten (independent variants in `r5attack2`) in addition to running the trunk's regression test.
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`. Host 4 vCPU, load average 12–14 during the run (other seats) — wall-clock figures inflated.
- Test databases: my runs did not set `SDP_TEST_RUN_ID`, so their throwaway databases carry random names indistinguishable from other seats' (574 `sdp_*test*` databases present at the end). I did **not** drop any database, to avoid dropping another seat's — housekeeping left to the orchestrator's sweep.

## 1. Round-4 findings — re-verification

| R4 | Claimed fixed (fix 15) | Re-run at 3ee4dd23 | Verdict |
|---|---|---|---|
| **R4-1 (P2)** ACTUAL budget-period money erased by hard delete / purge | yes | Trunk `tests/ppm-r4-actuals-intake.smoke.test.js` passes in E1 (project / objective / programme hard delete → 409 HAS_ACTUALS, purge skips). Independent variant `r5attack2` (`/tmp/r5ppm/attack2.log`): programme soft-deleted → portfolio AC stays **700** with `actuals_on_deleted_projects`; `purgeDeletedPortfolio(…,{apply:true})` → `purged:0, skipped:[{id:"programme:1", code:"HAS_ACTUALS"}]`, period count 1, AC 700; hard delete of a programme whose project was soft-deleted first → **409 HAS_ACTUALS**, period intact | **FIXED** |
| **R4-2 (P3)** intake value state contradicts its field after a switch-off write | yes | `r5attack2`: state `{budget:'tbc'}`, register off, `PUT budget 5000`, register on → project read `{budget:5000, value_states:{}}`; portfolio list read `value_states {}` | **FIXED** (read-side mask; the stale state stays in the column until the next intake write — acceptable) |
| **R4-3 (P3)** wall-clock assertion in the functional suite | yes (CPU time + 10 s wall bound) | E1 at load ~13: `ppm-schedule-engine` benchmark passes | **FIXED** |
| **R4-4 (P3)** soft-deleted task hours counted but not listable | yes | Verified only through the trunk test (passes in E1: `task_deleted:true`, entries `[20]`, equals `deleted_task_hours`, POST 404) — not by my own HTTP repro | **FIXED (trunk test only)** |
| R1-F4 levelling synchronous / not converged | not claimed | E2: 10 000 tasks, levelling **22 962 ms**, `converged:false`, 1 303 moves, 6 494 over-allocations (identical counts to r3/r4) | **NOT FIXED** |
| R1-F5 vacuous bench assertion | not claimed | `tests/ppm-w2-bench.test.js` untouched | **NOT FIXED** |
| R1-F6 low branch coverage | not claimed | engineInput 47.73 %, projectReport 58.90 %, engineStore 59.93 % (identical) | **NOT FIXED** |
| R2-4, R2-5 / C7 (silent calendar fallbacks), R1-F7, R1-F8, E5 | not claimed | engine untouched | **NOT FIXED** (P3, carried) |
| C8 (money-impacting PPM switches not four-eyes) | not claimed | `ppm_evm_enabled` etc. unchanged; new instance: `ppm_business_case_freeze_enabled` four_eyes **false** (a single admin can switch the freeze off) | carried note (P3) |

## 2. Assigned evidence at 3ee4dd23

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (70 files) | **408 tests, 408 pass, 0 fail**, 188.6 s (`/tmp/r5ppm/suite.log`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: CPM **325 ms**, levelling **22 962 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations left (`/tmp/r5ppm/bench.log`). `perf-budgets.json` still `approved_by: null`, no PPM class → nothing to pass/fail | **verified** |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 304/304 pass; services/ppm **90.32 % lines, 83.84 % branches, 88.03 % functions** (`/tmp/r5ppm/cov.log`). The drop from 99 % lines (r4) is the new Lot 2–6 modules, which the `ppm-*` files barely touch: structuredDependencies 27.97 % lines, portfolioScenario 29.17, portfolioRegister 30.83, resourceDemand 34.48, riskExposure 37.50, effortScoring 42.50, projectDocuments 55.36, reviewWorkflow 63.87. Lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93; evm.js 100/93.38 | **verified** |
| E3b (extra, not assigned) | same coverage flags over `tests/portfolio-*.test.js` (27 files) | 162/162 pass; new modules 100 % lines except dataQuality 92.09, riskExposure 87.50, reviewStore 93.51, portfolioPhase2Store 97.75; weakest branches portfolioScenario 61.29, portfolioPhase2Store 62.61, reviewStore 68.57 (`/tmp/r5ppm/cov-portfolio.log`) | **verified** |
| E4 | round-4 repros (§1) | as listed | **verified** (R4-4 via trunk test only) |

Verified: 5 (E1, E2, E3, E3b, E4). Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; any witness-project result (E-B05 empty); R4-4 by my own repro; Lot 4 alert-promotion concurrency (code-read only: guarded by the unique origin index); Lot 6 document version race (code-read only, see P3); BI `/ext/v1/portfolio/*` over HTTP (code-read only).

## 3. New claims attacked (round 5 — none repeated from earlier rounds)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| N1a | Lot 6 dependencies — "loops between projects refused (409)" | `r5attack` N1a: A←B, B←C; C←A refused 409 (control); soft-delete B (`soft_delete_enabled=1`); C←A now **200** (`allEdges()` drops edges touching a soft-deleted project); admin restores B (`POST /api/governance/portfolio/project/B/restore`) | **BROKEN** → R5-1: `GET /portfolio/dependencies` → `cycles:[{projects:[1,2,3]}]`, A `in_cycle:true`. Restore never re-checks |
| N1b | same claim, concurrency | 6 rounds of `Promise.all([POST X←Y, POST Y←X])` | **BROKEN** → R5-1: **3 / 6** rounds both 200 (write skew: READ COMMITTED transaction, no lock around `allEdges` + insert); 4 cycles reported afterwards |
| N2 | Lot 6 capacity — "unknown stays null, never green"; RAG = demand vs `ppm_capacity_fte` | `r5attack3`: `ppm_capacity_fte {"*":1.5}`, `portfolio_site_scope_reads=1`, 1 FTE on a site-A project + 1 FTE on a site-B project, same skill/month | **BROKEN (scoped reader)** → R5-3: committee sees 2 FTE / 133.3 % **RED**; a site-A reader sees 1 FTE / 66.7 % **GREEN** against the same group-wide capacity, with no "partial view" flag. (Without site scope — default — a viewer sees the whole portfolio: no defect, `r5attack` N2) |
| N2' | Lot 6 demand window | 120-month demand line 2030-01..2039-12 | accepted 200, **only 60 months placed** (to 2034-12), not listed in `unplaced` → R5-5 (P3) |
| N3 | Lot 5 business-case freeze — "approved business-case fields change only with an approved change request of this project" | `r5attack` N3: project at `in_progress`, budget 5000 USD, freeze on; approved CR (impact_budget 1000) | budget edit without CR → 409 (holds). **`currency` USD→XOF without CR → 200**, stored `{budget:5000, currency:"XOF"}`. Same approved CR reused: budget 6000 → 200, **9 000 000 → 200**, charter rewrite → 200 → R5-2 |
| N4 | Lot 3 register — "five KPI cards whose count equals their drill list" | `/tmp/r5ppm/x/drill.js`: `PR.build` + `urlFilters.merge` exactly as `portfolioRegisterPage.js` builds the link; active filter `priority=critical` | **BROKEN** → R5-4: `critical_high` card count **1**, link `?priority=critical,high` lists **3** rows. Standard reports: with `report=on_hold` active, `not_baselined` shows count **1** but its link (`?report=not_baselined`, the active report is replaced) lists **4**; money-hidden reader: `unfunded` count null but the link lists all 4 rows under the "Unfunded" label |
| N5 | Lot 2 data quality — "neither the amount nor its emptiness leaks" | code read: budget checks skipped when `money:false`; the proposal→approval gate evaluates with money but budget checks are not `blocking`, so the refusal text never names them | Holds |
| N6 | Lot 6 BI scope — "non-sensitive projects, no amount, no person name" | code read `routes/extApi.js` `portfolioData` + `portfolioPhase2Store.extProjects` | Holds on read: sensitive excluded, objective / programme soft delete excluded, no budget/owner/sponsor/description columns selected, dependency links dropped when the predecessor is not exported |
| N7 | Lot 6 documents — content checked against declared type, money documents restricted | code read `projectDocuments.validateUpload` + download route (nosniff, attachment, export-policy amount rule) | Holds; notes in P3 (title of a money document visible to every reader; version race orphan blob) |
| N8 | Lot 4 promotion — "ONE commitment, idempotent" | code read: `commitmentStore.create` returns the existing commitment by source; concurrent creates hit the unique origin index (migration 029) | Holds (not executed) |
| N9 | Engine / EVM (assigned) | bench + suite | no regression; carried F4/F5/F6 |

## 4. Findings at 3ee4dd23

### P0
None found.

### P1
None found. (Every new defect below sits behind a switch that is `'0'` by default; none is on a live default path.)

### P2 — before general deployment (and before the named lot enters pilot)

**R5-1 — Project dependency loops can be created despite the "loop refused (409)" rule: (a) through soft delete + restore, (b) by two concurrent opposite writes.** `services/ppm/portfolioPhase2Store.js` `allEdges()` (≈ l.37) ignores edges touching a soft-deleted project, and `restorePortfolio` (`services/governanceStore.js`, `routes/softDelete.js:53`) restores without a cycle check; `saveDependency` (≈ l.42) reads `allEdges()` and inserts in one READ-COMMITTED transaction with no lock, so two opposite inserts both pass.
Repro: `node --test /tmp/r5ppm/tests/r5attack.smoke.test.js` (env above) → N1a `C dep A while B soft-deleted 200 · restore B 200 · portfolio cycles [{"projects":[1,2,3]}]`; N1b `race loops created 3` of 6.
Regression tests: (a) restore of a project that would close a loop → 409 `DEP_CYCLE` (or restore succeeds with the closing dependency flagged/cancelled — product choice); (b) 20 parallel opposite pairs → never both 200. Fix: `pg_advisory_xact_lock` on a portfolio-dependency key inside `saveDependency` (same pattern as `commitmentStore.createWithLink`), and a cycle check in `restorePortfolio` (or count edges of soft-deleted projects in `allEdges`). Rollback risk low. Exposure: L16 `ppm_structured_dependencies_enabled` (default 0); (a) also needs L07 soft delete and an admin restore.

**R5-2 — Business-case freeze can be bypassed: currency change is not frozen, and one approved change request unlocks frozen fields without limit.** `services/ppm/reviewWorkflow.js` `FROZEN_FIELDS` (≈ l.71) omits `currency`, so `budget 5000 USD → 5000 XOF` passes with no CR; `freezeRefusal` only checks CR status + project, never consumes the CR nor compares its `impact_budget` / scope, so a CR approved for +1 000 lets the budget go to 9 000 000 and the charter be rewritten, repeatedly.
Repro: `r5attack` N3 → `currency USD->XOF without CR 200`, `stored {"budget":5000,"currency":"XOF"}`, `budget 9,000,000 reusing same CR 200`, `charter rewrite reusing same CR 200`.
Regression tests: frozen project + `currency` change without CR → 409 `BUSINESS_CASE_FROZEN`; second use of an applied CR → 409 (or CR moves to `applied` on first use and only `approved` unlocks); budget delta beyond the CR's `impact_budget` → 409. Rollback risk low (refusals only). Exposure: L14 `ppm_business_case_freeze_enabled` (default 0, four_eyes false). The frozen-field list and CR semantics are PROPOSED business policy — the committee must decide; the currency gap is a technical hole regardless.

**R5-3 — The capacity view of a site-scoped reader compares a partial demand with the group-wide capacity and shows GREEN while the group is over capacity.** `routes/governancePortfolioPhase2.js` `/api/governance/ppm/portfolio/capacity` (≈ l.150) sums demand of the reader's readable projects only, against `ppm_capacity_fte` which is one group-wide map; no `partial` flag in the response (keys: `ok, months, cells, unplaced, over, policy, capacity_configured, capacity_problems, as_of`). The scenario route has the same shape.
Repro: `node --test /tmp/r5ppm/tests/r5attack3.smoke.test.js` → committee `2 FTE, 133.3 %, RED`; site viewer `1 FTE, 66.7 %, GREEN`.
Regression test: with site scope on, a reader who cannot see every project with demand in a cell gets `rag:'NA'` + `partial:true` (or the group totals, without project ids). Exposure: L16 `ppm_resource_demand_enabled` + L02 `portfolio_site_scope_reads` (both default 0); capacity values PROPOSED.

**R5-4 — Register KPI cards and standard-report links do not lead to the counted set when a filter on the same key is already active.** `services/ppm/portfolioRegister.js` `kpis()` (≈ l.151) counts the drill filter applied on the already-filtered rows; `public/lib/portfolioRegisterPage.js:19` builds the link with `Object.assign({}, state, patch)`, which REPLACES the active key (priority, report). The money-hidden `unfunded` report link lists every row (the rule is ignored for that reader) under the "Unfunded" label.
Repro: `node /tmp/r5ppm/x/drill.js` → `critical_high card count 1 … rows behind link 3`; `report not_baselined count 1 … rows 4`; `report unfunded count null … rows 4`.
Regression test: for every card / report and a matrix of active filters, `rows behind merge(drill)` == `count`. Fix: intersect list filters in the link (or compute the count over the merged filter), drop the `report` link for money-hidden readers. Exposure: L14 `ppm_portfolio_dashboard_v2_enabled` (default 0) — L14 is in the pilot plan's wave 2 (`docs/business-readiness/PLAN-PILOTE.md:50`), so fix before that wave or tell pilot users.

**Carried P2** — R1-F4 (levelling ~20 s at 10 k tasks on the request thread, `converged:false`, no approved budget), R1-F5, R1-F6 unchanged.

### P3 — later
- **R5-5** — A demand line longer than 60 months is accepted, silently truncated to 60 placed months and not reported in `unplaced` (`resourceDemand.monthsOf`, `MAX_MONTHS`). Refuse the window in `normalise` or list the truncation.
- **R5-6** (code read, not executed) — `addDocument` writes the blob before the INSERT; a concurrent same-type/title upload fails the `UNIQUE (project_id, doc_type, title, version)` and leaves an orphan blob file. Version numbering is case-sensitive while `latestFirst` groups case-insensitively ("Design" / "design" both v1, one hidden as non-latest). Titles of money documents are listed to non-amount readers (PROPOSED design; a title such as "Quote 1.2 M USD" leaks an amount).
- **R5-7** — `ppm_business_case_freeze_enabled` and `ppm_dq_gate_enforced` are four_eyes false in `docs/ops/policy-catalogue.json`: a single admin can switch off a control (classification PROPOSED — for the committee).
- **R5-8** — The assigned PPM coverage command no longer covers the portfolio lots (their tests are `tests/portfolio-*.test.js`); the evidence set for this seat should include them.
- Pilot plan (`PLAN-PILOTE.md`) has no row for L16 (merged after it): L16 stays off by default; record that explicitly.
- R2-4, R2-5 / C7, R1-F7..F11, E5 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R4 | R5 | Basis |
|---|---|---|---|
| (no lot — default switches) | GO PILOT | **GO PILOT** | 408/408 targeted tests; no default-on defect found |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | unchanged; note R5-3 if `portfolio_site_scope_reads` is armed together with L16 |
| L03 PMO — change control, baselines, gates | GO PILOT | **GO PILOT** | unchanged |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** (R4-1 fixed and re-verified) | G14 Finance still empty; pilot plan keeps L05 out until G14 is signed |
| L06 Optional plan exchange / offline editing | CONDITIONAL | **CONDITIONAL** | connector gate D-07/D-08/D-09 empty; Jira/AzDO stay outbound-skipped |
| L07 Roadmap publication / sensitivity | not assessed | **not assessed** (only its soft-delete interaction: R4-1 fixed; R5-1(a) needs L07 + L16) | — |
| L14 Intake, data quality, register / dashboard, decision agenda, lifecycle / review / audit | GO PILOT (intake only) | **CONDITIONAL** | intake + data quality hold; R5-4 (dashboard drill counts) to fix or disclose before wave 2; R5-2 — keep `ppm_business_case_freeze_enabled` off in pilot until the currency hole is closed and the CR rule is decided by the committee |
| L15 Adoption Lot B | — | **not assessed by this seat** | outside PPM |
| L16 Portfolio phase 2 (deps, demand/capacity, effort, documents, scenario, BI) | — | **CONDITIONAL** (not in the pilot plan) | R5-1 (loops) and R5-3 (partial capacity GREEN) before pilot; capacity values, effort weights, document lists PROPOSED; `ext_api_portfolio_enabled` four-eyes + data owner/security decision |

## 6. Human gates still empty in this area (RELEASE-GATES.md at 3ee4dd23 — every decision cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners (also the BI scope `ext_api_portfolio_enabled`)
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (incl. PROPOSED data-quality bands, capacity RAG `ppm-capacity`, effort weights/bands, freeze field list)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` `approved_by: null`, no PPM class)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Data owner — anonymised fixtures (G-15) — Data owners (project documents store)
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
