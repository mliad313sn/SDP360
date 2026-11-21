# P11 qualification — ROUND 8 (re-check) — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature, a release decision or a filled human gate.

- Frozen SHA: `7afb9536ae3e38273aeff47307a78c49637dbd94` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked). Only working-tree change: the intentionally removed `docs/agent-execution/` narratives (not read, not fetched). No product file modified. Earlier round files untouched.
- In my area since round 7 (`git diff 7ea49070..7afb9536`): `routes/governancePortfolioPhase2.js` (R7-1 own-demand RED kept, R7-2 per-cell sharing flag only for full readers), `services/ppm/riskExposure.js` (new `projectScore`, `effectiveScore`, `SCORE_MIN`, `RAG_THRESHOLDS`), `services/ppm/projectKpis.js` (R7-3 active = open risks + issues; RAG risk input = `projectScore`), `services/ppm/projectRag.js` (risk band derived, values unchanged 8/8/5/5), `services/ppm/raid.js` + `routes/governance.js` (`isOpen` instead of `=== 'open'`), `services/governanceStore.js` (R7-4 comment only), labels in `public/lib/ppmGovernanceW3.js` / `projectReport.js`. Scheduler, levelling and EVM files unchanged.
- PostgreSQL had restarted (crash recovery) at the start of the run; `service postgresql start`, waited for "accepting connections" before any test. Load average 17–19 during the runs (other seats).
- Env: brief's `NODE_OPTIONS`, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=ppmr8`, runner `/tmp/r8ppm/run.sh`. Throwaway attacks (not committed): `/tmp/r8ppm/tests/r7attack.smoke.test.js`, `r7c.smoke.test.js` (round-7 repros, re-run unchanged), `r8attack.smoke.test.js` (N1, N2), `r8b.smoke.test.js` (N3). Logs `/tmp/r8ppm/*.log`. After the runs `pg_database` holds 0 `*ppmr8*` databases (each file's `_pg-boot` dropped its own); nothing else dropped.

## 1. Round-7 findings — re-verification at 7afb9536

| R7 | Fix | Re-run (`/tmp/r8ppm/attacks.log`) | Verdict |
|---|---|---|---|
| **R7-1 (P3)** project demand panel greys a cell the project alone exceeds | fix 30 | B1c: P1 own 2.0 FTE vs cap 1.5, shared cell → `rag RED, util 133.3, shared true`, `load.over 1` (was `NA`, `over 0`). N2c: same in the partial-read branch → `RED, own_demand_over_capacity:true, over 1`. Shared cells under capacity still `NA` (B1a), sole cells keep their verdict (B1b) | **FIXED** |
| **R7-2 (P3)** per-cell sharing flag leaks an unreadable project's skill × month | fix 30 | B1e: site viewer gets 404 on P2 and P1 cells `2034-01:NA:shared=undefined, 2034-02:NA:shared=undefined`, response-level `view_partial` + neutral note only. N2b: committee and admin (full read, sensitive project included) keep per-cell flags | **FIXED** |
| **R7-3 (P3)** card `active 0 · high 1` | fix 30 | pure repro (issue 3×3) → `active_risks 1, high_risks 1`; mixed case `Risk/Open`, `ISSUE/' OPEN '`, assumption → `active 2, high 1`, assumption excluded from both and from top_risks; label now "Active risks + issues" | **FIXED** |
| **R7-4 (P3, policy)** closure gate rule change on default path | fix 30 (comment) | `services/governanceStore.js:533-537` now states the rule is PROPOSED (G-12 / D-04). Behaviour unchanged (B3d: open high issue → `openRisksHigh 1`). No entry in RELEASE-GATES / FLAG-REGISTER names it | **PARTIAL** (documented in code only; awaits committee) |
| R6-1 … R6-4, R5-*, R4-* (regression) | — | B2a 10 rounds: one 200 + one 409 each, `both200 0, lostDelta 0`; B2b-h CR scope binding unchanged (409 / 400 `BAD_SCOPE`); B3a-c vocabulary unchanged | still **FIXED** |
| R5-8 coverage evidence set | — | E3 still `tests/ppm-*` only; fix-30 regression tests live in `tests/p11-r7-*.test.js` (outside the brief's pattern, run separately — 10/10 pass) | **NOT FIXED** (evidence-set note) |
| R1-F4 levelling synchronous / not converged | — | E2, identical counts | **NOT FIXED** (carried P2) |
| R1-F5, R1-F6, R1-F7..F11, R2-4/R2-5/C7, E5 | — | engine untouched | **NOT FIXED** (carried) |

## 2. Assigned evidence at 7afb9536

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `/tmp/r8ppm/run.sh tests/ppm-*.test.js tests/governance*.test.js` (70 files) | **408 tests, 408 pass, 0 fail, 0 skipped**, 317 s, `EXIT 0` (`/tmp/r8ppm/suite.log`). A first launch during PG crash recovery failed to connect (EXIT 1, environment); relaunched once PG accepted connections | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: CPM **233 ms**, levelling **16 610 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 remaining over-allocations — counts identical r3–r8 (`/tmp/r8ppm/bench.log`). `docs/ops/perf-budgets.json` `approved_by: null`, no PPM class | **verified** |
| E3 | `--experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 304/304 pass; services/ppm **89.73 % lines, 83.83 % branches, 88.06 % functions** (`/tmp/r8ppm/cov.log`). riskExposure 67.02 % lines (projectScore covered; view/rollup/portfolio l.68-93 uncovered in this set), projectKpis 100/77.89, projectRag 100/94.81, raid 100/81.11. Still thin: resourceDemand 30.84 %, reviewWorkflow 61.38 %; lowest branches engineInput 47.73, projectReport 58.90, engineStore 59.93; evm 100/93.18 | **verified** |
| E4 | round-7 repros + new attacks (§1, §3); fix-30 regression tests `tests/p11-r7-ppm.smoke.test.js`, `tests/p11-r7-data-fixes.test.js` | as listed; regression tests 10/10 pass (`/tmp/r8ppm/r7reg.log`) | **verified** |

Verified: 4 (E1–E4). Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; witness project (E-B05 empty); fix 31 four-eyes ranges and fix 33 operator tokens / audit chain over HTTP (other seats); Vue Groupe fleet cap (`min_closed 5`, data seat).

## 3. New break attempts (round 8, one per capability, aimed at fix 30)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| N1 | Fix 30 F-29 — "RAG risk input null (UNKNOWN, never green) when no open entry carries a known score" | switches `ppm_simplified_view_enabled`, `ppm_project_rag_enabled`, `ppm_raid_enabled` on; create a risk with NO probability/impact through the generic writer (`PUT /api/governance/portfolio/risk`) and through the RAID writer (`PUT …/project/:id/raid`) | **BROKEN** → R8-1. Both store `probability 2, impact 2` (schema default `018_governance.sql:38` `DEFAULT 2`; RAID insert `governanceW3Store.js:115` `== null ? 2`). Summary `top_risks score 4`, RAG `risk: green, risk_score 4`, RAID view `severity medium`. Only an explicit `probability:null` update reaches `risk_score null / rag null` (N1h-j) — so the UNKNOWN branch of `projectScore` is unreachable for any newly created unscored risk |
| N2 | Fix 30 R7-1/R7-2 — "full readers keep the per-cell flag, others get none, a certain RED is kept" | demand on A (site 0) and B (site 1), B marked sensitive (`portfolio_sensitive_projects=1`, scope reads off); read A's demand as committee, admin, site viewer; then A alone at 2 FTE vs cap 1.5 | **Holds**: committee/admin `omega NA shared=true`, `psi GREEN shared=false`; site viewer (cannot read sensitive B) all cells `NA`, no flag, `view_partial true`; own overload `RED own=true, over 1` |
| N3 | RAID create — details row attached via `SELECT MAX(id) … WHERE project_id` after INSERT (`governanceW3Store.js:116`) | 5 rounds × 8 concurrent creates on one project, each with its own `dependency_ref` | **Holds empirically**: 40/40 200, 0 title/detail mismatches. The read-back pattern stays fragile (P3 note, no repro) |
| B2/B3 | CR scope binding, risk vocabulary (regression) | round-7 repros | **Hold** |
| A7 | Engine / EVM (assigned) | E1–E3 | no regression; carried F4/F5/F6 |

## 4. Findings at 7afb9536

### P0
None found.

### P1
None found. The only new defect (R8-1) sits behind `ppm_project_rag_enabled` = `'0'` by default; on default switches it shows as a "medium" risk level on unscored entries, a pre-existing behaviour, not a regression of fixes 30–33.

### P2 — before general deployment

- **R8-1 — An unscored risk is stored as 2 × 2, so fix 30's "unscored = UNKNOWN" never happens on create; the project RAG risk component reads GREEN for a risk nobody scored.** Cause: `db/postgres/reports/018_governance.sql:38` (`probability INTEGER DEFAULT 2, impact INTEGER DEFAULT 2`) for the generic writer (`services/governanceStore.js` risk spec, `req: ['project_id','title']`), and the explicit default at `services/ppm/governanceW3Store.js:115` (`n.row.probability == null ? 2 : …`) for the RAID writer, which also keeps the old score when null is sent on update (l.112), so a RAID user cannot reset a score to unknown. Repro: `cd /home/user/qual/ppm && /tmp/r8ppm/run.sh /tmp/r8ppm/tests/r8attack.smoke.test.js` → `N1b stored [{"probability":2,"impact":2}]`, `N1d rag … "risk":{"rag":"green","risk_score":{"value":4,"rag":"green"}}`, `N1g raid view severity ["medium"]`. Violates the boundary "a number with no source is UNKNOWN (null), never 0/green". Regression test to add: create (both writers) without P/I → stored NULL, `projectScore` null, RAG risk component null, RAID severity null, register level null. Fix needs a migration (drop the column default for new rows; existing 2×2 rows cannot be told apart from deliberate scores — a data-owner decision, do not rewrite them). Rollback risk: low for new rows; the UI form must stop pre-filling 2.
- Carried: R1-F4 (levelling 16.6–41 s at 10 k tasks on the request thread, `converged:false`, no approved perf budget), R1-F5, R1-F6.

### P3 — later

- **R8-2 — A known HIGH risk beside an unscored one gives AMBER although the unknown could be critical (RED).** `riskExposure.projectScore` returns the known top when it is ≥ high; `rollup` does the same (`level high`, `partial true`). Pure: `projectScore([{status:'open',probability:2,impact:3},{status:'open'}])` → `6`. Consistent between the two readers and documented ("a known high is never hidden"), but the composite carries no "at least" marker. Suggest exposing `partial` on the RAG risk component.
- **R8-3 — `raid.exposureTotals` still filters `it.status !== 'open'`** (`services/ppm/raid.js:72`) while every other reader now uses `isOpen`. Harmless today (both writers store lowercase `open|closed`), but it is the one remaining case-sensitive open filter fix 30 set out to remove.
- **R8-4 — RAID writer rejects `Open` (400) while the generic writer normalises it to `open`.** Fails closed; UX inconsistency only.
- **R8-5 — RAID create reads its new id back with `SELECT MAX(id) … WHERE project_id`** (`governanceW3Store.js:116`) instead of `RETURNING id`. N3 found no mis-attachment under 8-way concurrency; still the wrong pattern for an identity column.
- R7-4 PARTIAL (above); R5-8 (coverage evidence set), R1-F7..F11, R2-4/R2-5/C7, E5 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R7 | R8 | Basis |
|---|---|---|---|
| (no lot — default switches) | GO PILOT | **GO PILOT** | 408/408 targeted tests; R7-1..R7-3 fixed; R8-1 shows only as a "medium" level on unscored entries on the default path |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | card counts consistent (R7-3 fixed) |
| L03 PMO — change control, baselines, gates | GO PILOT (cond.) | **GO PILOT (conditional)** | closure-gate rule R7-4 still PROPOSED, committee to confirm |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** | G14 Finance empty |
| L06 Optional plan exchange / offline editing | CONDITIONAL | **CONDITIONAL** | connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / sensitivity | not assessed | **not assessed** | (N2 shows sensitive projects hidden from the demand sharing flag for non-readers) |
| L14 Intake, DQ, register, review / freeze | GO PILOT (cond.) | **GO PILOT (conditional on committee policy)** | CR scope binding and single use hold |
| L15 Adoption Lot B | not assessed | **not assessed by this seat** | — |
| L16 Portfolio phase 2 | CONDITIONAL | **CONDITIONAL** (excluded from pilot plan) | R7-1/R7-2 fixed; capacity values, effort weights, risk mapping PROPOSED |
| W3 governance switches (`ppm_project_rag_enabled`, `ppm_raid_enabled`, simplified view) | — | **CONDITIONAL** | R8-1 must be fixed before arming the project RAG (green on unscored risks) |

## 6. Human gates still empty in this area (RELEASE-GATES.md at 7afb9536 — every decision cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (capacity RAG, risk mapping and derived RAG bands, residual-first gate rule, unscored-risk treatment R8-1, freeze field list / CR scope rule)
- Closure policy D-04 (G-17/G-18) — Business/control owners + Committee (R7-4)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` `approved_by: null`, no PPM class)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Data owner — anonymised fixtures (G-15) — Data owners (also: what to do with existing 2×2 rows, R8-1)
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
