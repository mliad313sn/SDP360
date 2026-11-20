# P11 qualification — ROUND 4 — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature or a release decision.

- Frozen SHA: `e43d11d5738dc4af650bd06715c54e6927f1649e` (clone `/home/user/qual/ppm`, `git rev-parse HEAD` checked; the only working-tree changes are the intentionally removed `docs/agent-execution/` narratives, not read). Round 3 at `ead6efb6` (`r3-ppm.md`), round 2 (`r2-ppm.md`), round 1 (`ppm.md`) left untouched.
- Fixes in my area since round 3 (`git log ead6efb6..e43d11d5`): `adc7b4cb` (offline replay deep compare + missing base = conflict: R3-3, R1-F3), `3332a867` (rebaseline real-date check, task move with hours refused 409 HAS_ACTUALS, soft-deleted projects kept in portfolio AC, timesheet weeks keep soft-deleted task hours: R3-1, R3-2, R3-4), merged in `19172165` (fix 12). New lot in my area: portfolio intake register (`6d41071a`, migration reports/117, switch `ppm_intake_register_enabled`, default 0). Policy Control Center and `tools/ops/activate-switches.js` read only for their PPM touch points.
- No product file modified. Throwaway attacks (not committed): `/tmp/r4ppm/tests/r4attack.smoke.test.js`, `/tmp/r4ppm/x/misc4.js`; logs `/tmp/r4ppm/*.log`. Round-3 repros re-run from `/tmp/r3ppm/` and `/home/user/qual/out/ppm-repro/` (they `require` the clone, so they ran against e43d11d5).
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`. Host: 4 vCPU, load average 11–17 during the run (other seats in parallel) — wall-clock figures are inflated.

## 1. Round-3 findings — re-verification

| R3 | Claimed fixed | Re-run at e43d11d5 | Verdict |
|---|---|---|---|
| **R3-1 (P2)** rebaseline accepts impossible dates | yes (`3332a867`) | `/tmp/r3ppm/tests/r3rb.smoke.test.js` (unchanged): project `baseline_end 2027-02-30` → **400 DATE_INVALID**; task `2027-13-01 → 2027-13-40` → **400 DATE_INVALID**; order checks still 400; stored baseline unchanged `[null,"2027-03-31"]`, EVM still computed (`/tmp/r4ppm/r3rb.log`) | **FIXED** |
| **R3-2 (P2)** spent money leaves project AC on a task move / portfolio AC on a project soft delete | yes (`3332a867`) | `r3soft.smoke.test.js`: move B P3→P4 → **409 HAS_ACTUALS**, P3 AC stays 300 / CPI 1.6667; soft delete P4 → portfolio USD **AC 1000 → 1000**, BAC 6000 → 4000, `deleted_project_contributors:1`, reason `actuals_on_deleted_projects`; hard delete of the objective → 409 (8 entries) (`/tmp/r4ppm/r3soft.log`) | **FIXED for time entries** — the same class is still open for money recorded as ACTUAL budget periods → new **R4-1 (P2)** |
| **R3-3 (P2)** offline replay overwrites another user's `dependency_links` | yes (`adc7b4cb`) | `/tmp/r3ppm/x/oqlinks.js`: `{"sent":0,"conflicts":1}`, final links = theirs `[{id:5,SS,lag 2}]`; `depends_on` control → 1 conflict | **FIXED** |
| **R1-F3 / R2-3** offline `base:null` overwrite | yes (`adc7b4cb`) | `ppm-repro/oq.js`: `{sent:0, conflicts:1}`, final `name:'theirs'` | **FIXED** |
| **R3-4 (P3)** soft-deleting a task changes timesheet week totals | yes (`3332a867`) | `r3soft`: draft week 30 h → **30 h** after soft delete; suite test "R3-4 — soft-deleting a task does not change an approved week total; timesheets agree with EVM AC" passes (approved-week variant verified through that test, not by my own repro). Residual: `GET …/task/:id/time` of the soft-deleted task still 404 (entries counted but not listable) | **FIXED** (residual P3 note) |
| E5 note (P3) EVM phasing differs by 0.01 vs the old engine | not claimed | not re-run (no evm.js phasing change since) | unchanged |
| R1-F4 levelling synchronous, not converged | not claimed | bench E2 below: 10 000 tasks, **19.8 s**, `converged:false`, same 1 303 moves / 6 494 over-allocations as r3 | **NOT FIXED** |
| R1-F5 vacuous bench assertion | not claimed | `tests/ppm-w2-bench.test.js` not in the diff | **NOT FIXED** |
| R1-F6 low branch coverage | not claimed | engineInput 47.73 %, projectReport 58.90 %, engineStore 59.93 % (identical) | **NOT FIXED** |
| R2-4 `%` lag / unschedulable in-bound plan | not claimed | engine untouched in the diff | **NOT FIXED** (P3) |
| R2-5 silent engine defaults | not claimed | `misc3.js`: malformed holiday `'2026-12-25T00:00'` still ignored; new instance below (C7) | **NOT FIXED** (P3) |
| R1-F7 pre-1970 clamp / R1-F8 converged semantics | not claimed | `ppm-repro/sch.js` → `pre1970 [[1,"1970-01-01","1970-01-05"]]`, warnings `[]`; `lev.js` → `converged:true, remaining:561`. (The hostile `duration_days:1e9` case now throws `SCHEDULE_RANGE` 422 instead of returning — fail-closed, fine) | **NOT FIXED** (P3) |

## 2. Assigned evidence at e43d11d5

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (65 files) | **384 tests, 383 pass, 1 fail**, 224.8 s (`/tmp/r4ppm/suite.log`). The failure: `tests/ppm-schedule-engine.test.js:221` "10 000 tasks fully rescheduled in under 1 s" — `took 1102 ms` at load average ~17. Re-run of that file alone 3× → 14/14 pass each time | **verified** (383/384 under load; the one failure is a wall-clock assertion, reproduced as load-dependent → R4-3, P3) |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: **CPM 227 ms**, levelling **19 836 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations left (`/tmp/r4ppm/bench.log`). Counts identical to r3 (deterministic); time ≈ 2× r3 because of host load. `docs/ops/perf-budgets.json`: `approved_by: null`, no PPM class → nothing to pass/fail | **verified** |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 280/280 pass; services/ppm **99.01 % lines, 82.90 % branches, 96.99 % functions**; evm.js 100/92.32; evmStore 98.98/71.43; planIntegrity 100/86.93; new intakeFields 100/88.02; new portfolioLookups 100/76.77; timesheets 100/75.00; lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93, comments 65.71, governanceW3Store 67.80; w3Context lines 85.48 (`/tmp/r4ppm/cov.log`) | **verified** |
| E4 | round-3 repros (§1) | as listed | **verified** |

Verified: 4. Not verified by this seat: `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; any witness-project result (E-B05 empty); the approved-week R3-4 path by my own HTTP repro (verified only through the trunk's test); `tools/ppm/backfill-project-ids.js --apply` against a database (code-read only).

## 3. New claims attacked (round 4 — none repeated from earlier rounds)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| C1 | EVM / finance — "money already spent stays where it was spent … the purge never erases money already spent" (evm.js header, governanceStore `removePortfolio` / `purgeDeletedPortfolio`, ADR-P11-R3) | `/tmp/r4ppm/tests/r4attack.smoke.test.js` test A: two projects whose spent money is recorded as **ACTUAL budget periods** (700 USD each, no time entries; `ppm_evm_enabled=1`, `ppm_budget_periods_enabled=1`, soft delete off = default) | **BROKEN** → R4-1: `DELETE …/project/1` → **200 `soft:false`**; portfolio USD **AC 1400 → 700**, no reason code. Soft delete of P2 keeps AC 700 + `actuals_on_deleted_projects` (good), then `purgeDeletedPortfolio(…, {apply:true})` → `purged:1, skipped:[]`, portfolio **AC 700 → (row gone)**. Cause: `actualsUnder()` counts only `ppm_time_entries`, while `evmStore.hiddenProjectsWithActuals()` and `projectEvm` treat `ppm_budget_periods kind='actual'` as spent money (and AC prefers them); FK `ON DELETE CASCADE` on `ppm_budget_periods` |
| C2 | Intake register — "a value state is only stored while the field value is NULL" (migration 117 header, intakeFields) | test B: switch on, create with `value_states {budget:'tbc'}`; switch **off** (lot rollback), `PUT project {budget:5000}`; switch on, read | **BROKEN (rollback path only)** → R4-2: read returns `budget 5000` **and** `value_states.budget 'tbc'`; heals on the next intake write (read 3 `vs {}`). Control with switch on all along → state cleared |
| C3 | Intake register — money-adjacent fields follow the money rule | test B: viewer reads `/api/governance/portfolio` after `budget_status 'approved'`, `budget_reference 'CAPEX-X'` | Holds: `budget_status`, `budget_reference`, `budget` all absent; history route stays 403 for non-money readers |
| C4 | Intake register — PRJ ids generated, immutable, never client-written | code read + test B | Holds: `PRJ-2026-001` generated; `project_ref` stripped by `aliases()`, not in `WRITABLE`, trigger refuses change; backfill shares the counter. Gaps (a failed insert burns a number) are allowed by the ADR |
| C5 | Offline queue — deep compare does not produce silent overwrites | `misc4.js`: base links in another key/element order than the server; base `progress_pct 50` vs server `"50"` (pg NUMERIC) | No overwrite and no spurious conflict on the unrelated field; numeric-string base did not raise a false conflict. Holds |
| C6 | Baselines — rebaseline validator | `misc4.js` `isValidDate` on edge strings | `2027-1-4`, `2027-02-29`, `20270104` refused; `2027-01-04T10:00` and `' 2027-01-04'` accepted (then normalised by `_day`) — acceptable |
| C7 | Calendars — invalid calendars are reported | `misc4.js`: `calendar {workdays:[]}` and `{workdays:[8,9]}` | Both silently fall back to Mon–Fri (`2026-03-02 → 03-03`), `warnings: []` → another instance of R2-5 (P3) |
| C8 | Policy Center / activation tool on PPM switches | catalogue + `switch-lots.json` read | Secrets (`ppm_azdo_pat`, `ppm_jira_api_token`) are not editable from the center (`_SECRET_BLANK_KEEP`); `soft_delete_enabled` / `actuals_import_enabled` / `finance_*` are four-eyes. `ppm_evm_enabled`, `ppm_budget_periods_enabled`, `ppm_offline_edit_enabled`, `ppm_rebaseline_enabled` are four-eyes **false** (single admin can switch). `soft_delete_enabled` sits in L07 while `ppm_budget_periods_enabled` is in L05 → activating L05 alone runs the hard-delete path of R4-1. Observation only (P3), no defect |
| C9 | Connectors optional | defaults + activation tool | `ppm_jira_sync_enabled`, `ppm_azdo_sync_enabled` classified OUTBOUND `external_call`, skipped by `activate-switches` unless `--include-outbound`; defaults `'0'`. Holds |

## 4. Findings at e43d11d5

### P0
None found.

### P1
None found.

### P2 — before general deployment

**R4-1 — A project's spent money recorded as ACTUAL budget periods can still be erased by a hard delete or by the soft-delete purge, silently dropping portfolio AC.** `services/governanceStore.js` `actualsUnder()` (≈ line 1016) counts `ppm_time_entries` only; `removePortfolio` (≈ 1010) and `purgeDeletedPortfolio` (≈ 1054) rely on it, so a project whose actuals live in `ppm_budget_periods` (`kind='actual'`, written by the committee or by the Finance actuals import, migration 095) passes both; `ppm_budget_periods.project_id … ON DELETE CASCADE` removes them. This contradicts the R3-2 fix's own definition of spent money (`services/ppm/evmStore.js` `hiddenProjectsWithActuals` checks both sources; `services/ppm/evm.js` uses ACTUAL periods first for AC).
Repro: `node --test /tmp/r4ppm/tests/r4attack.smoke.test.js` (env above) → `portfolio before [{"c":"USD","bac":2000,"ac":1400}]` · `hard delete P1 … 200 {"ok":true,"soft":false}` · `portfolio after hard delete [{"c":"USD","bac":1000,"ac":700}]` (no reason) · `purge {"ids":["project:2"],"purged":1,"skipped":[]}` · `portfolio after purge []`.
Regression tests to add: (a) hard delete of a project (and of its objective / programme) with an ACTUAL budget period → 409 `HAS_ACTUALS`, periods intact; (b) purge skips a soft-deleted project with ACTUAL periods (`skipped` lists it). Fix: extend `actualsUnder` with `OR EXISTS (SELECT 1 FROM ppm_budget_periods WHERE project_id … AND kind='actual')` for project/objective/programme. Rollback risk low (refusal only). Exposure: `ppm_evm_enabled` + `ppm_budget_periods_enabled` (L05, default 0); delete is committee-only; purge additionally needs `soft_delete_purge_enabled`. Must be fixed, or explicitly accepted by Finance (G14), before L05 leaves pilot.

**R2-3 (carried)** — R1-F4 (levelling ~10–20 s at 10 k tasks on the request thread, `converged:false`, no approved budget), R1-F5, R1-F6 unchanged.

### P3 — later
- **R4-2** — Intake value state contradicts its field after a switch-off write (rollback path of L14): `budget 5000` with `value_states.budget 'tbc'` until the next intake write. Fix: on read, drop a state whose field is non-blank (or clean states in `_intakeShape`). Regression test: toggle sequence above → `value_states {}` on read.
- **R4-3** — `tests/ppm-schedule-engine.test.js:221` asserts a 1 s wall-clock budget inside the functional suite; it failed once at load ~17 (1 102 ms) and passed 3/3 alone. A CI runner under load can turn the targeted suite red for no product reason; move the timing to the bench / perf-budget check or widen with a CPU-time measure.
- **R4-4** — Soft-deleted task's time entries are counted (week and AC) but `GET …/task/:id/time` answers 404, so the hours behind `deleted_task_hours` cannot be listed by the reader.
- C7 (invalid calendars silently replaced by Mon–Fri), C8 (money-impacting PPM switches not four-eyes in the Policy Center catalogue — PROPOSED classification for the committee) — notes.
- R2-4, R2-5, R1-F7..F11, E5 — unchanged.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R3 | R4 | Basis |
|---|---|---|---|
| (no lot — portfolio with default switches) | GO PILOT | **GO PILOT** | 383/384 targeted tests (the 1 failure is load timing); no default-on defect found |
| L02 PMO — portfolio and project reading | GO PILOT | **GO PILOT** | unchanged; intake money-adjacent strip holds |
| L03 PMO — change control, baselines, gates | GO PILOT (R3-1 before GA) | **GO PILOT** | R3-1 fixed and re-verified |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | CPM fast; levelling F4/F5/F8 unchanged; no approved perf budget |
| L05 PMO — time, money, benefits | CONDITIONAL | **CONDITIONAL** | R3-2 / R3-4 fixed for time entries; R4-1 still erases ACTUAL-period money on hard delete / purge; G14 Finance empty — pilot only after G14 is signed and R4-1 fixed or accepted by Finance; activate L07 (soft delete) with L05 or keep budget periods off |
| L06 Optional plan exchange / offline editing (extras) | CONDITIONAL | **CONDITIONAL** (offline editing may enter pilot: R3-3 and R1-F3 fixed and re-verified) | connector gate D-07/D-08/D-09 empty; Jira/AzDO stay outbound-skipped |
| L07 Roadmap publication / portfolio sensitivity | not assessed | **not assessed by this seat** (only its soft-delete interaction with L05, see R4-1) | — |
| L14 Portfolio intake register (new) | — | **GO PILOT** | additive migration, hidden while off; ids immutable and server-generated; money-adjacent fields stripped; only R4-2 (P3, rollback path) found; priority / effort / risk meanings stay PROPOSED (business policy, not approved) |

## 6. Human gates still empty in this area (RELEASE-GATES.md at e43d11d5 — every cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (incl. the PROPOSED priority / effort / risk meanings of L14)
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (`perf-budgets.json` PROPOSED, `approved_by: null`, no PPM entry)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- Product — business acceptance — Sponsor / PO
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
