# P11 qualification — ROUND 3 — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature or a release decision.

- Frozen SHA: `ead6efb6439296a34915b7d9a47f7011cd15fa82` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked). Round 2 at `b2e85cd0` (`/home/user/qual/out/r2-ppm.md`) and round 1 (`/home/user/qual/out/ppm.md`) left untouched.
- Fix commits touching this area (`git log b2e85cd0..ead6efb6`): `24e0092` (R2-1/R2-2: spent hours survive task deletion, monthly EVM phasing, rebaseline bounds), `27782ab` (EVM S-curve O(leaves+months)), merged in `ba26451`. Files: `services/governanceStore.js` (`rebaseline` bounds, `actualsUnder`, HAS_ACTUALS refusal, purge skip), `services/ppm/evm.js` (`phaseOf`, new `sCurve`, `actuals_on_deleted_tasks`, `s_curve_truncated`), `services/ppm/evmStore.js` (`timeEntriesFor` keeps soft-deleted tasks), `routes/governance.js` (delete error carries `code`).
- No product file modified. `docs/agent-execution/` narratives not read. Throwaway attacks (not committed): `/tmp/r3ppm/tests/*.smoke.test.js`, `/tmp/r3ppm/x/*.js`; logs `/tmp/r3ppm/*.log`.
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`, PostgreSQL max_connections 400.

## 1. Round-2 findings — re-verification

| R2 | Claimed fixed? | Re-run (at ead6efb6) | Verdict |
|---|---|---|---|
| **R2-1 (P1 for L05)** deleting a task with logged hours drops AC, no reason | yes (`24e0092`) | `/tmp/r3ppm/tests/r2del.smoke.test.js` (r2 repro unchanged): `DELETE …/task/B` → **409** "this task has 1 logged time entry … turn soft delete on"; EVM after = before (`ac 300, cpi 1.6667, eac 1200`). Soft delete (`r3soft.smoke.test.js`): **200 soft**, EVM `ac 300` kept, reason `actuals_on_deleted_tasks`. Hard delete of the objective above → **409** (8 entries). Pure `/tmp/r3ppm/x/evm2.js`: entry of a task absent from the list → `ac null, reasons [actuals_on_deleted_tasks, actuals_currency_unknown]` (was silently 100). EUR-only deleted task: EUR currency row kept with `ac 200` + reason | **FIXED** for delete (hard refused, soft kept + flagged). Same class still reachable by **moving** a task or **soft-deleting a project** → new R3-2 (P2) |
| **R2-2 (P2)** rebaseline bypasses plan bounds; far baseline blocks the server | yes (`24e0092`, `27782ab`) | `r2attack` test B: `rebaseline 9999` → **400 DATE_RANGE**; EVM project 89 ms, portfolio 83 ms. Pure: 2 000 tasks to 2200 → **200 ms** (was 20 tasks 2.66 s); legacy rows 0001..9999, 2 000 tasks → 239 ms, S-curve capped at 2 772 points, reason `s_curve_truncated` | **FIXED** (year bounds + cost). Residual: rebaseline still accepts impossible calendar dates → new R3-1 (P2) |
| R2-3 / R1-F3 offline `base:null` overwrite | not claimed | `ppm-repro/oq.js` → `sent:1, conflicts:0`, final `name:'mine'` | **NOT FIXED** |
| R2-3 / R1-F4 levelling synchronous | not claimed | bench §2 E2: 10 763 ms, `converged:false` | **NOT FIXED** |
| R2-3 / R1-F5 vacuous bench assertion | not claimed | `tests/ppm-w2-bench.test.js` not in the diff | **NOT FIXED** |
| R2-3 / R1-F6 low branch coverage | not claimed | engineInput 47.73 %, projectReport 58.90 %, engineStore 59.93 % (identical) | **NOT FIXED** |
| R2-4 chained in-bound plan accepted but unschedulable; `%` lag unit | not claimed | `r2attack` test A: lag `36500 %` write 200, reads degrade (`plan_error`), unchanged | **NOT FIXED** (P3) |
| R2-5 silent engine defaults | not claimed | code unchanged; `misc3.js`: holiday `'2026-12-25T00:00'` silently ignored | **NOT FIXED** (P3) |
| R1-F7 pre-1970 clamp / R1-F8 converged semantics | not claimed | `sch.js` → `1970-01-01`; `lev.js` → `converged:true, remaining:561` | **NOT FIXED** (P3) |

## 2. Assigned evidence at ead6efb6

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (59 files) | **351 tests, 351 pass, 0 fail, 0 skipped**, 155.8 s, exit 0 (`/tmp/r3ppm/suite.log`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: **CPM 146 ms**; levelling **10 763 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations left (`/tmp/r3ppm/bench.log`). Figures identical to R2 except wall time (shared CPU). `docs/ops/perf-budgets.json` still PROPOSED, `approved_by: null`, no PPM budget → nothing to pass/fail | **verified** |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 247/247 pass; services/ppm **98.91 % lines, 82.63 % branches, 96.80 % functions**; evm.js 100/91.03; evmStore 98.84/72.50; planIntegrity 100/86.84; lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93, comments 65.71, governanceW3Store 67.80; w3Context lines 85.48 (`/tmp/r3ppm/cov.log`) | **verified** |
| E4 | round-2 repros (§1) | as listed | **verified** |
| E5 | differential fuzz new vs old EVM engine (`/tmp/r3ppm/x/fuzz.js`, 3 000 random plans, old engine = `git show b2e85cd0:services/ppm/evm.js`) | 14/3 000 indicator mismatches, all **0.01** (PV rounding of float summation order); max S-curve PV delta 0.01 | **verified** — the "figures identical to the per-day map" claim holds to the cent, not to the bit (P3 note) |

Verified: 5. Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; any witness-project result (G21 empty); R1-F9..F11; the approved-week variant of R3-4 over HTTP (code-read only).

## 3. Claims attacked (new attacks, one or more per capability)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| C1 | EVM — "money already spent stays in AC" (evm.js header, R2-1 fix) | `r3soft`: move leaf task B (20 h) from project P3 to P4 via `PUT …/task {id, project_id:P4}` | **BROKEN (per project)** → R3-2: P3 `ac 300→100, cpi 1.67→5.0, eac 600→200, reasons []`; P4 gains the 200 (hours dated before the move). The 409 message for delete recommends "move … the work instead" |
| C2 | EVM portfolio — same claim at portfolio level | soft-delete project P4 (soft delete on) | **BROKEN** → R3-2: portfolio USD `ac 1000→500`, no reason; BAC also leaves (consistent), but spent money disappears silently from the portfolio total |
| C3 | EVM engine arithmetic phasing equals the per-day map | E5 fuzz | Holds (≤ 0.01) |
| C4 | Baselines — rebaseline applies "the same plan bounds as the ordinary write" (governanceStore comment, ADR-P11-F1) | `r3rb.smoke.test.js`: rebaseline with project `baseline_end 2027-02-30`, task `2027-13-01 → 2027-13-40` | **BROKEN** → R3-1: both **200** (versions 2, 3 stored); the ordinary task write refuses the same values **400 DATE_INVALID** (`r3date`). Downstream: EVM PV/SPI become `null` (unknown, not a wrong number). Order checks hold (DATE_ORDER 400) |
| C5 | Offline queue — "fields where the stored value moved away from base are CONFLICTS … never overwrite blindly" (ppmOfflineQueue header) | `/tmp/r3ppm/x/oqlinks.js`: offline edit of `dependency_links` while someone else changed the same field (same link count) | **BROKEN** → R3-3: `sent:1, conflicts:0`, final links = mine, theirs lost. `same()` compares `String(value)` → every object array of equal length is `"[object Object]"`. Control with `depends_on` (number array) → conflict detected. `project.html:674` sends `dependency_links` |
| C6 | Timesheets — "an entry of a SUBMITTED or APPROVED week is frozen: neither added nor removed" (ppmWorkbenchStore B5) | soft-delete a task with hours, read `/timesheets` | Week hours **30 → 10** (`r3soft`, draft week). `removePortfolio` has no WEEK_FROZEN check and `timesheetView` filters `deleted_at IS NULL`, so an approved week's shown total changes too (code-read) → R3-4 (P3); timesheet total now disagrees with EVM AC (30 h). The soft-deleted task's entries are unreachable (`GET …/task/:id/time` 404) |
| C7 | Schedule / calendars | cycle, self-dependency, 4 000 consecutive holidays, malformed holiday strings (`misc3.js`) | cycle → engine returns null by contract (writes refuse cycles); self-dep ignored; 4 000 holidays push a 2-day task 10 years with no warning, 11 ms; malformed holiday silently ignored → part of R2-5 (P3) |
| C8 | Connectors optional | defaults in `services/reportConfig.js` | `ppm_jira_sync_enabled`, `ppm_azdo_sync_enabled`, `ppm_evm_enabled`, `ppm_time_entries_enabled`, `ppm_leveling_enabled`, `ppm_rebaseline_enabled`, `soft_delete_enabled`, `ppm_offline_edit_enabled` all `'0'`; holds by inspection |

## 4. Findings at ead6efb6

### P0
None found.

### P1
None found (R2-1 fixed; the residuals below are P2 because the portfolio total is conserved on a move, and a project delete also removes its budget).

### P2 — before general deployment

**R3-1 — Re-baseline accepts impossible calendar dates (year bounds only).** `services/governanceStore.js` `rebaseline()` (≈ 889-916) calls `PI.rangeProblem` (year 1970..2200) but not `PI.dateProblem` (`DATE_INVALID`), and `_day` checks the shape only. Repro: `node --test /tmp/r3ppm/tests/r3rb.smoke.test.js` → `rb project 02-30 200`, `rb task 13-40 200`, project page `[null,"2027-02-30"]`, task `["2027-13-01","2027-13-40"]`, EVM `pv null, spi null`. Baselines are versioned (append-only history keeps the bad version). Regression test: rebaseline with `2027-02-30` / `2027-13-40` → 400 DATE_INVALID, no version written. Fix: call `PI.dateProblem('project'|'task', patch)` next to `rangeProblem`. Rollback risk low. Behind `ppm_rebaseline_enabled` (default 0), committee only.

**R3-2 — Spent money still leaves a project's AC without a reason code when a task is MOVED, and leaves the portfolio AC when a project is soft-deleted.** `services/governanceStore.js` task upsert allows a leaf with time entries to change `project_id` (only "task with sub-tasks cannot move" is refused, ≈ line 582); `services/ppm/evmStore.js:57` joins entries to the task's CURRENT project; portfolio view drops soft-deleted projects. Repro: `node --test /tmp/r3ppm/tests/r3soft.smoke.test.js` → `P3 after move … ac 100, cpi 5, r []`; `portfolio before … ac 1000` → `soft delete P4 200` → `portfolio after … ac 500`. Regression tests: moving a task with entries → refused (`HAS_ACTUALS`) or AC of the source project unchanged and flagged; soft-deleting a project with entries → portfolio AC flagged (`actuals_on_deleted_projects`) or delete refused. Behind `ppm_evm_enabled` + `ppm_time_entries_enabled` (+ `soft_delete_enabled` for the project case), all default 0. Must be closed, or explicitly accepted by Finance (G14), before L05 leaves pilot.

**R3-3 — Offline replay silently overwrites another user's `dependency_links` change.** `public/lib/ppmOfflineQueue.js` `same()` = `String(a) === String(b)`; for arrays of objects this is `"[object Object]"` for every value of the same length, so `conflictsOf` reports nothing and the auto-rebase re-sends mine with the current version. Repro: `node /tmp/r3ppm/x/oqlinks.js` → `{"sent":1,"conflicts":0}` final links `[{"id":4,…}]`, theirs `[{"id":5,"type":"SS","lag":2}]` lost; control with `depends_on` → 1 conflict. Regression test: queue + replay with a concurrent `dependency_links` change → `conflicts:1`. Fix: compare with a canonical JSON stringify. Behind `ppm_offline_edit_enabled` (default 0). Together with R1-F3 (`base:null`, still open) the offline queue has two silent-overwrite paths.

**R2-3 (carried)** — R1-F3, F4 (levelling 10.8 s at 10k on the request thread, `converged:false`, no approved budget), F5, F6 — reproduced unchanged.

### P3 — later
- **R3-4** — Soft-deleting a task changes timesheet week totals (frozen/approved weeks included, code-read) and hides its entries (404), so timesheets and EVM AC disagree (10 h vs 30 h in the repro). Either refuse the soft delete on a frozen week or keep entries of soft-deleted tasks in `timesheetView` flagged.
- E5 — new EVM phasing differs from the previous engine by 0.01 on ~0.5 % of random plans (summation order); the code comment says "identical".
- R2-4, R2-5 (incl. malformed / huge holiday lists with no warning), R1-F7..F11 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R2 | R3 | Basis |
|---|---|---|---|
| (no lot — portfolio with default switches) | GO PILOT | **GO PILOT** | suite 351/351; reads degrade per project; no new default-on defect found |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | same |
| L03 PMO — change control, baselines, gates | CONDITIONAL | **GO PILOT** (with R3-1 fixed before general deployment) | R2-2 fixed and re-verified; R3-1 degrades EVM to unknown, committee-only write |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | CPM fast (146 ms/10k); levelling F4/F5/F8 unchanged, no approved perf budget |
| L05 PMO — time, money, benefits | NO-GO | **CONDITIONAL** | R2-1 and R2-2 fixed and re-verified; R3-2 still drops spent money per project / from the portfolio without a reason; G14 Finance empty — pilot only after G14 is signed and R3-2 is either fixed or accepted by Finance |
| L06 Optional plan exchange / offline editing (extras) | CONDITIONAL | **CONDITIONAL** (offline editing: keep `ppm_offline_edit_enabled=0` until R3-3 and R1-F3 are fixed) | two silent-overwrite paths in replay; connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / portfolio sensitivity | not assessed | **not assessed by this seat** | — |

## 6. Human gates still empty in this area (RELEASE-GATES.md at ead6efb6 — every cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` PROPOSED, `approved_by: null`, no PPM entry)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
