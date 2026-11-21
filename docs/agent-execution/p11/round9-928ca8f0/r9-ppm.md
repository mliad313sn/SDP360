# P11 qualification — ROUND 9 (re-check) — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature, a release decision or a filled human gate.

- Frozen SHA: `928ca8f03c0680acfb2b3eb0c871ba286934c8dd` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked). Only working-tree change: the intentionally removed `docs/agent-execution/` narratives (not read, not fetched). No product file modified. Earlier round files untouched.
- In my area since round 8 (`git diff 7afb9536..928ca8f0`): migration `db/postgres/reports/139_portfolio_risk_unscored_default.sql` (+ manual rollback), `services/governanceStore.js` (riskRow keeps null), `services/ppm/governanceW3Store.js` (RAID insert NULL when unscored, `RETURNING id`, update "sent key replaces"), `services/ppm/riskExposure.js` (`projectScoreDetail` with `partial`, assumptions/deleted-only → null), `services/ppm/projectRag.js` (`components.risk.partial`), `services/ppm/projectKpis.js`, `services/ppm/raid.js` (case-insensitive kind/status, `exposureTotals` uses `isOpen`), `services/ppm/w3Context.js`. Scheduler, levelling, EVM unchanged.
- PostgreSQL was in "starting up" (container restart) at the beginning; first repro launch failed to connect (environment), relaunched once `select 1` succeeded. Load average ~21 (other seats).
- Env: brief's `NODE_OPTIONS`, `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `SDP_TEST_RUN_ID=ppmr9` (coverage run `ppmr9c`), runner `/tmp/r9ppm/run.sh`. Throwaway attacks (not committed): `/tmp/r9ppm/tests/r8attack.smoke.test.js`, `r8b.smoke.test.js` (round-8 repros re-run unchanged), `/tmp/r9ppm/tests/r9attack.smoke.test.js` (A1–A3), `/tmp/r9ppm/pure.js` (pure checks). Logs `/tmp/r9ppm/*.log`. After the runs `pg_database` holds 0 `*ppmr9*` databases (two lingering tracker test DBs of my run were already being dropped by `_pg-boot`; `DROP … IF EXISTS` was a no-op). Nothing else dropped.

## 1. Round-8 findings — re-verification at 928ca8f0

| R8 | Re-run (log) | Verdict |
|---|---|---|
| **R8-1 (P2)** unscored risk stored 2 × 2, RAG risk GREEN | `/tmp/r9ppm/r8rerun.log`: N1b generic create stored `{probability:null, impact:null}`; N1c `top_risks []`; N1d RAG `risk: {rag:null, risk_score:{value:null}, partial:true}`; N1f RAID create stored null; N1g RAID severity `[null]`; N1i/j null update stays null. Migration 139 drops the column defaults, existing rows untouched (by design, data-owner question) | **FIXED** (but see R9-1: the RAID update half introduced a regression) |
| **R8-2 (P3)** known HIGH + unscored sibling reads AMBER without "at least" | `pure.js`: `projectScoreDetail` → `{score:6, partial:true, unknown:1}`; `computeRag` → `risk {rag:amber, partial:true}`; known critical + unknown → `partial:false` (correct, 9 is max). `partial` is API-only — no file under `public/` reads `components.risk` | **FIXED** in API (UI does not surface it — P3 note R9-4) |
| **R8-3 (P3)** `exposureTotals` case-sensitive | `exposureTotals([{status:'OPEN',…}])` → counted (1 entry) | **FIXED** |
| **R8-4 (P3)** RAID writer rejects `Open` | `normalise({status:' Open ', kind:'Risk'})` → `status:'open', kind:'risk'` | **FIXED** |
| **R8-5 (P3)** RAID id via `MAX(id)` | code uses `INSERT … RETURNING id`; N3 5×8 concurrent creates → 40/40 200, 0 title/detail mismatches | **FIXED** |
| N2 (sharing flag / own RED, regression) | committee/admin keep per-cell flag; site viewer none, `view_partial true`; own overload `RED own=true, over 1` | still holds |
| R7-4 closure-gate rule PROPOSED | unchanged (comment only, no RELEASE-GATES / FLAG-REGISTER row) | **PARTIAL** (awaits committee) |
| R5-8 coverage evidence set | fix-34 regression tests live in `tests/p11-r8-data-ppm*.test.js`, outside `tests/ppm-*` — run separately, 21/21 pass with the r7 ones | **NOT FIXED** (evidence-set note) |
| R1-F4 levelling synchronous / not converged | E2, identical counts | **NOT FIXED** (carried P2) |
| R1-F5, R1-F6, R1-F7..F11, R2-4/R2-5/C7, E5 | engine untouched | carried |

## 2. Assigned evidence at 928ca8f0

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `/tmp/r9ppm/run.sh tests/ppm-*.test.js tests/governance*.test.js` (70 files) | **408 tests, 408 pass, 0 fail, 0 skipped**, 4 m 33 s, `EXIT 0` (`/tmp/r9ppm/suite.log`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: CPM **265 ms**, levelling **16 650 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 remaining over-allocations — counts identical r3–r9 (`/tmp/r9ppm/bench.log`). `docs/ops/perf-budgets.json` `approved_by: null`, new `min_samples_per_class: 5` PROPOSED, still no PPM class | **verified** |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 304/304 pass; services/ppm **89.75 % lines, 83.89 % branches, 88.00 % functions** (`/tmp/r9ppm/cov.log`). riskExposure 69.00/80.43; governanceW3Store 100/69.23; projectKpis 100/76.29; raid 100/81.11. Still thin: resourceDemand 30.84 % lines, reviewWorkflow 61.38 %; lowest branches engineInput 47.73, projectReport 58.90, engineStore 59.93 | **verified** |
| E4 | round-8 repros + new attacks; fix-34/30 regression tests `tests/p11-r8-data-ppm.test.js`, `tests/p11-r8-data-ppm.smoke.test.js`, `tests/p11-r7-ppm.smoke.test.js`, `tests/p11-r7-data-fixes.test.js` | as listed; regression tests **21/21 pass** (`/tmp/r9ppm/reg.log`) | **verified** |

Verified: 4 (E1–E4). Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; witness project (E-B05 empty); Policy Center apply-failure path over HTTP beyond the fix-34 smoke test, operator tokens, inspection 409 flow (other seats).

## 3. New break attempts (round 9, one per capability, aimed at fix 34)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| A1 | Fix 34 RAID update — "a score field that is SENT (even null) replaces the stored one; a field left out keeps it" | switches `ppm_simplified_view_enabled`, `ppm_project_rag_enabled`, `ppm_raid_enabled` on; RAID create 3 × 3 (project RAG **red**); then send exactly the body the shipped form builds (`public/lib/ppmGovernanceW3.js:118-119`: `v()` returns `null` for an empty input, every key always present) to change only the owner | **BROKEN** → R9-1. Stored `{probability:null, impact:null, owner:'bob'}`; RAG `red` → `null` (`risk_score null, partial true`); ledger `P3×I3` → `P—×I—`. Control: a body that OMITS the keys keeps 3 × 3. The form has no prefill (`public/project.html:207-219`, id typed by hand), so every form edit of an existing entry erases its score |
| A2 | Generic writer score validation after the default was dropped | `PUT /api/governance/portfolio/risk` with `[0,0]`, `[5,2]`, `['','']`, `[-1,3]`, `['2','3']`, `[2.5,3]` | 0, 5, −1 **stored as-is** (read UNKNOWN downstream — not a wrong colour); `''` → null; `2.5` → **HTTP 500 internal_error** (PG integer). Pre-existing (`governanceStore.js:570` `num(v)` without range), not a fix-34 regression → R9-2 (P3) |
| A3 | Fix 34 "assumptions-only list unknown" and cards | project with one 3 × 3 assumption only; then add an unscored issue | RAG risk `null, partial:false`; cards `active 0, high 0`; with unscored issue `active 1, high 0`. Holds; "high 0" beside an unscored open entry is a known-count, not "none" → noted in R9-3 |
| N2/N3 | sharing flag, RETURNING id (regression) | round-8 repros | **Hold** |
| A7 | Engine / EVM (assigned) | E1–E3 | no regression; carried F4/F5/F6 |

## 4. Findings at 928ca8f0

### P0
None found.

### P1
None found. R9-1 sits behind `ppm_raid_enabled` and `ppm_project_rag_enabled`, both `'0'` by default (`services/reportConfig.js:561,571`); it hides a known RED as UNKNOWN (null, not green) and the ledger records the change.

### P2 — before general deployment (and before arming the RAID log + project RAG)

- **R9-1 — Regression from fix 34: editing an existing RAID entry through the shipped form silently erases its probability/impact; a critical risk turns the project RAG from RED to UNKNOWN.** Cause: `services/ppm/governanceW3Store.js:107,115` now treats a key that is present with `null` as "reset to unknown", while the only client, `public/lib/ppmGovernanceW3.js:118-119`, always sends `probability: v('w3-r-p'), impact: v('w3-r-i')` with `null` for an empty input, and `public/project.html:207-219` does not pre-fill the form from the stored entry. Before fix 34 a null kept the stored score. Repro: `cd /home/user/qual/ppm && /tmp/r9ppm/run.sh /tmp/r9ppm/tests/r9attack.smoke.test.js` → `A1b rag before red`, `A1d stored {"probability":null,"impact":null,"owner":"bob"}`, `A1e rag after null`, `A1f ledger … "risk · P—×I— · open"`. (The same form also overwrote owner/mitigation/details with blanks before fix 34 — pre-existing full-replace semantics; the new part is that the score, the RAG input, now follows them.) Regression test to add: form-shaped update (all keys, P/I null) on a 3 × 3 entry keeps 3 × 3 unless an explicit "unscore" signal is sent; RAG stays red. Fix options (engineering choice, reversible): distinguish "clear" (e.g. `''` or an explicit flag) from "not filled", or pre-fill the form from `GET …/raid` and send only changed fields. Rollback risk: low, client + one store branch.
- Carried: R1-F4 (levelling 16.6 s at 10 k tasks on the request thread, `converged:false`, no approved perf budget), R1-F5, R1-F6.

### P3 — later

- **R9-2 — Generic risk writer accepts out-of-range scores and returns 500 on a non-integer.** `services/governanceStore.js:570` (`num(v)`): `0`, `5`, `-1` stored (read UNKNOWN by `riskExposure.level`), `2.5` → 500 `internal_error`. The RAID writer validates 1..3 (`raid.js:27`). Suggest the same `BAD_SCORE` 400 on the generic writer. Pre-existing.
- **R9-3 — Card `high_risks` reads 0 while an open entry is unscored.** `projectKpis.js:112` counts known highs only; with `active 1, high 0` a reader may take "0 high" as measured. Consider an "unscored N" counter beside it (the RAG already carries `partial`).
- **R9-4 — The `partial` marker (R8-2) is API-only.** No file under `public/` reads `components.risk`; the project page shows the composite colour without "at least".
- R7-4 PARTIAL; R5-8 (coverage evidence set); R1-F7..F11, R2-4/R2-5/C7, E5 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R8 | R9 | Basis |
|---|---|---|---|
| (no lot — default switches) | GO PILOT | **GO PILOT** | 408/408 targeted tests; R8-1..R8-5 fixed; R9-1 only reachable with RAID switch on |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | card counts consistent; unscored no longer shown as medium |
| L03 PMO — change control, baselines, gates | GO PILOT (cond.) | **GO PILOT (conditional)** | closure-gate rule R7-4 still PROPOSED; an open unscored risk does not block closure (`isHigh` false) — committee to confirm |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** | G14 Finance empty |
| L06 Optional plan exchange / offline editing | CONDITIONAL | **CONDITIONAL** | connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / sensitivity | not assessed | **not assessed** | — |
| L14 Intake, DQ, register, review / freeze | GO PILOT (cond.) | **GO PILOT (conditional on committee policy)** | CR scope binding holds (suite) |
| L15 Adoption Lot B | not assessed | **not assessed by this seat** | — |
| L16 Portfolio phase 2 | CONDITIONAL | **CONDITIONAL** (excluded from pilot plan) | capacity values, effort weights, risk mapping PROPOSED |
| W3 governance switches (`ppm_project_rag_enabled`, `ppm_raid_enabled`, simplified view) | CONDITIONAL | **CONDITIONAL** | R8-1 fixed, but R9-1 must be fixed before arming the RAID log together with the project RAG (form edits erase scores, a RED becomes UNKNOWN) |

## 6. Human gates still empty in this area (RELEASE-GATES.md at 928ca8f0 — every decision cell empty; file unchanged since round 8)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (capacity RAG, risk mapping and derived bands, partial "at least" rule R8-2, residual-first gate rule, freeze field list / CR scope rule)
- Closure policy D-04 (G-17/G-18) — Business/control owners + Committee (R7-4; whether an open unscored risk may block closure)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` `approved_by: null`, `min_samples_per_class` PROPOSED, no PPM class)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Data owner — anonymised fixtures (G-15), 2026 history D-10 — Data owners (also: existing 2 × 2 rows that may be the old default, migration 139 note)
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
