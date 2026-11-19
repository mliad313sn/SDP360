# P11 qualification — ROUND 2 — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature or a release decision.

- Frozen SHA: `b2e85cd08860a57526442797ac711e2fc9defc3a` (clone `/home/user/qual/ppm`, verified with `git rev-parse HEAD`). Round 1 was at `7eee8955`; round-1 file `/home/user/qual/out/ppm.md` left untouched.
- Fix commits touching this area (`git log 7eee8955..b2e85cd0`): `c081a56` (P11 F1 plan value bounds + guarded portfolio/project reads), `f122864` (P11 F2 EVM actual cost keeps spent money), merged in `bc1eb79`. Files: `services/ppm/planIntegrity.js`, `services/governanceStore.js`, `services/projectSchedule.js` (`criticalPathSafe`/`scheduleViewSafe`), `services/ppm/scheduleEngine.js`, `routes/governance.js`, `services/ppm/evm.js`, new tests `tests/ppm-schedule-bounds.smoke.test.js`, `tests/ppm-evm-actuals.test.js`, ADRs `docs/ai-decisions/ADR-P11-F1-*`, `ADR-P11-F2-*`.
- No product file modified. `docs/agent-execution/` narratives not read. Throwaway attacks: `/tmp/r2ppm/tests/r2attack.smoke.test.js`, `/tmp/r2ppm/tests/r2del.smoke.test.js`, `/tmp/r2ppm/x/*.js` (not committed).
- Env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`, PostgreSQL max_connections 400.

## 1. Round-1 findings — re-verification

| R1 | Claimed fixed? | Re-run | Verdict |
|---|---|---|---|
| **F1 (P1)** one task write 500s the whole portfolio | yes (`c081a56`) | `/home/user/qual/out/ppm-repro/poison.smoke.test.js` (copied to `/tmp/r2ppm/tests/`): `duration_days 5000000` → **400 DURATION_RANGE**; `start_date 9999-06-01` → **400 DATE_RANGE**; portfolio (viewer + PMO) **200**; healthy page 200; poisoned page 200 | **FIXED** for the original repro. Residuals below (R2-2 bypass via rebaseline, R2-4 accepted-but-unschedulable plan) |
| **F2 (P1 for L05)** AC drops hours on cancelled / summary tasks | yes (`f122864`) | `node /home/user/qual/out/ppm-repro/evm.js`: cancelled → `ac 500, cpi 1, reasons [actuals_on_cancelled_tasks]` (was 100 / 5.0 / []); summary → `ac 1010, cpi 0.495, reasons [actuals_on_summary_tasks]` (was 10 / 50); null hours → `ac null, reasons [hours_unknown]` (was 0) | **PARTIAL** — the two repro cases are fixed, but the same "spent money vanishes, no reason" defect remains when a task with logged hours is **deleted** (new R2-1, P1 for L05) |
| F3 (P2) offline replay overwrites when `base:null` | not claimed | `node /home/user/qual/out/ppm-repro/oq.js` → still `sent:1, conflicts:0`, final `name:'mine'` | **NOT FIXED** (unchanged) |
| F4 (P2) levelling synchronous, 17–19 s at 10k | not claimed | bench below: 17 191 ms, `converged:false` | **NOT FIXED** |
| F5 (P2) vacuous bench assertion | not claimed | `tests/ppm-w2-bench.test.js` unchanged | **NOT FIXED** |
| F6 (P2) low branch coverage | not claimed | engineInput 47.73 %, projectReport 58.90 %, engineStore 59.93 % (identical) | **NOT FIXED** |
| F7 (P3) pre-1970 clamp silent | indirectly | engine still clamps (`/home/user/qual/out/ppm-repro/sch.js` → `1970-01-01`), but writes < 1970 are now refused at the API (DATE_RANGE) | **PARTIAL** (API path closed; engine/import/rebaseline paths not) |
| F8 (P3) `converged:true` with 561 left, 2 unexplained | not claimed | `/home/user/qual/out/ppm-repro/lev.js` → identical (561, 2 unexplained, resource 10 / 2027-01-12 / task 575) | **NOT FIXED** |
| F9–F11 (P3) | not claimed | not re-run (code unchanged in `workItemSync.js`, `evm.js earnedFraction`, `mppConverter`) | not re-verified |

## 2. Assigned evidence at b2e85cd0

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` | **343 tests, 343 pass, 0 fail, 0 skipped, 0 todo**, 161.5 s, exit 0 (log `/tmp/r2ppm/suite.log`) | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: **CPM 498 ms**; levelling **17 191 ms**, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations remaining | **verified** (CPM slower than R1's 302 ms on a shared CPU; no PPM budget in `docs/ops/perf-budgets.json` — status PROPOSED, `approved_by: null` — so nothing to pass/fail against) |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 239/239 pass; services/ppm **98.85 % lines, 82.50 % branches, 96.74 % functions**; evm.js 91.19 % br, planIntegrity 86.84 % br; lowest branches unchanged: engineInput 47.73, projectReport 58.90, engineStore 59.93, comments 65.71, governanceW3Store 67.80; w3Context lines 85.48 | **verified** |
| E4 | round-1 repros (section 1) | as listed | **verified** |

Verified: 4. Not verified (not reproduced by this seat): `tools/ppm/bench-gantt-browser.js`; perf figures in `docs/ppm/W2-ENGINE-CONTRACT.md`; any witness-project result (G21 empty); F9–F11 re-runs.

## 3. Claims attacked (one new attack per capability)

| # | Capability / claim | Attack | Outcome |
|---|---|---|---|
| B1 | EVM — "money already spent stays in AC … each flagged by a reason code" (evm.js header, ADR-P11-F2) | Over HTTP (`r2del.smoke.test.js`): EVM + time entries on; tasks A (10 h) and B (20 h), rate 10; `DELETE /api/governance/portfolio/task/B` as plan writer | **BROKEN** → R2-1: AC 300 → **100**, CPI 1.67 → **5.0**, EAC 1 200 → **200**, `reasons: []`. Hard delete (default) cascades `ppm_time_entries` (FK ON DELETE CASCADE); soft delete hides them (`timeEntriesFor` filters `deleted_at IS NULL`). Pure check: an entry whose task is absent from the list is dropped silently (`/tmp/r2ppm/x/evm2.js` → `ac 100, cpi 5, reasons []`) |
| B2 | Baselines / F1 bounds — "every date of a plan item lies in 1970..2200" | Committee `POST …/rebaseline` (switch `ppm_rebaseline_enabled`) with `baseline_end: '9999-12-31'` for project and task, then EVM on | **BROKEN** → R2-2: rebaseline **200** (only `_day` format check in `governanceStore.rebaseline`, no `rangeProblem`); `GET …/project/:id/evm` **20.1 s**, `GET /api/governance/ppm/evm/portfolio` **14.5 s** with ONE task (event loop blocked for all users). Pure: 1 task 12.9 s / 682 MB RSS, 5 tasks 42.8 s / 1.17 GB, S-curve 1 175 568 points (`/tmp/r2ppm/x/evmbig.js`) |
| B3 | Bounds hold even at the edge | Same EVM with legal `baseline_end 2200-12-31` | 1 task 214 ms, **20 tasks 2.66 s** (linear → ~27 s at 200 tasks). Bound is a correctness bound, not a cost bound → part of R2-2 |
| B4 | Schedule — "bounds keep a single task far inside the year-3065 guard" | 9 tasks × 36 500 days chained by `depends_on`; and a lag of 36 500 **%** | Each write **200**; engine → `SCHEDULE_RANGE`; portfolio stays **200** with `schedule_error`, project page 200 with `plan_error` → **graceful (fix holds for reads)**, but the store accepts a plan no read can compute → R2-4 (P3). LAG_RANGE ignores the unit (`36500 %` accepted) |
| B5 | Schedule — links | `dependency_links` sent without `depends_on` | Link silently ignored (task starts day 0, no warning). Importer and UI send both; API-only gap → R2-5 (P3) |
| B6 | Calendars | 400 consecutive exception days; `workdays: []` | Exceptions honoured (2 days pushed to 2028-02-08/09); empty `workdays` silently falls back to Mon–Fri, no warning → noted in R2-5 |
| B7 | Rollups — "unknown child % ⇒ null, never 0" | `rollupProgress` with one null child; all-zero weights | **Holds** (`unknown_child`, `unknown_weight`) |
| B8 | Offline queue — 409 on a deleted row | Replay where server returns 409 and `current()` is null | `refused:1`, no blind resend → holds for that case; F3 (`base:null`) still open |
| B9 | Connectors optional extras | FLAG-REGISTER defaults | `ppm_jira_sync_enabled`, `ppm_azdo_sync_enabled`, `ppm_evm_enabled`, `ppm_leveling_enabled`, `ppm_rebaseline_enabled` all `0`; holds by inspection |

## 4. Findings at b2e85cd0

### P0
None found.

### P1 — must fix before pilot

**R2-1 (P1 for any pilot that turns L05 on) — Deleting a task with logged hours removes that spent money from AC; CPI/EAC overstated, no reason code.** (Residual of R1-F2: the fix covered cancelled and summary tasks only.)
- Where: `routes/governance.js:861` DELETE (plan writer allowed, no check for time entries); `db/postgres/reports/085_ppm_workbench.sql:29` `ppm_time_entries.task_id … ON DELETE CASCADE` (hard delete = default, hours destroyed); `services/ppm/evmStore.js:53` and `services/ppmWorkbenchStore.js:59,100` filter `t.deleted_at IS NULL` (soft delete hides them); `services/ppm/evm.js` iterates `tasks` only, so entries of an absent task are dropped without a reason.
- Repro: copy `/tmp/r2ppm/tests/r2del.smoke.test.js` into any `tests/` dir and run with the env above → `before delete {"bac":2000,"ev":500,"ac":300,"cpi":1.6667,"eac":1200,"reasons":[]}` → `delete B 200` → `after delete {"bac":1000,"ev":500,"ac":100,"cpi":5,"eac":200,"reasons":[]}`.
- Regression test to add: delete (hard and soft) a task with time entries → either refused (`HAS_ACTUALS`, 409) or AC unchanged with reason `actuals_on_deleted_tasks`; pure test: entries for a task id not in `tasks` → AC null or flagged, never silently smaller.
- Rollback risk: low for a refuse-at-delete guard; medium for a schema change (switching the FK to RESTRICT affects existing hard-delete flows and the trash purge).
- Live path: behind `ppm_evm_enabled` + `ppm_time_entries_enabled` (default 0). Not live today. G14 Finance empty.

### P2 — before general deployment

**R2-2 (P2) — The committee re-baseline bypasses the F1 plan bounds, and a far baseline makes EVM time-phasing block the server for seconds to minutes.** `services/governanceStore.js` `rebaseline()` (≈ lines 889-912) validates only the `YYYY-MM-DD` shape (`_day`), never `PI.rangeProblem`; `evm.js` `timePhase` / `sCurve` are O(calendar days of the baseline window). Repro: `/tmp/r2ppm/tests/r2attack.smoke.test.js` test B → `rebaseline 9999 200`, `EVM project 200 20103ms`, `EVM portfolio 200 14502ms` (one task). Even inside the bounds (2200), 20 tasks cost 2.66 s. Regression test: rebaseline with `9999-12-31` → 400 DATE_RANGE; EVM bench with N tasks × max-length baseline under a time ceiling. Fix: call `rangeProblem` in `rebaseline()`; phase by month (or cap phasing at the status date + horizon) instead of per day. Behind `ppm_rebaseline_enabled` + `ppm_evm_enabled` (default 0), committee-only write; the portfolio EVM read is open to every money reader once on.

**R2-3 (P2, carried) — R1 F3 (offline `base:null` overwrite), F4 (synchronous levelling 17.2 s at 10k, no budget), F5 (vacuous bench assertion), F6 (branch coverage < 60 % on engineInput / projectReport / engineStore)** — all reproduced unchanged at this SHA (section 1).

### P3 — later

- **R2-4** — Bounds are per value: a chain of in-bound tasks (9 × 36 500 days) or a `%` lag of 36 500 is accepted although no read can schedule it. Reads now degrade correctly (`schedule_error` / `plan_error`), so this is a usability gap only: refuse at write when the post-write schedule raises `SCHEDULE_RANGE`, and make LAG_RANGE unit-aware. MSPDI import: `leveling_delay_days` from the file reaches `_upsertTaskEngine` unbounded (`engineStore.js` ≈ line 311).
- **R2-5** — Silent engine defaults: `dependency_links` without a matching `depends_on` entry is ignored (no `LINK_…` warning); a calendar with `workdays: []` silently becomes Mon–Fri.
- R1 F7 (engine-level pre-1970 clamp), F8 (`converged` semantics), F9 (shared-token JQL scope), F10 (`earnedFraction` done vs %), F11 (converter path trust boundary) — not fixed, not re-attacked beyond F7/F8.

## 5. Lot recommendations — AI panel recommendation, not a decision

| Lot | R1 | R2 | Basis |
|---|---|---|---|
| (no lot — today's portfolio, default switches) | CONDITIONAL | **GO PILOT** | F1 fixed and re-verified over HTTP; reads degrade per project; suite 343/343 |
| L02 PMO — portfolio and project reading | CONDITIONAL | **GO PILOT** | same; R2-4 is P3 |
| L03 PMO — change control, baselines, gates | CONDITIONAL | **CONDITIONAL** | R2-2: re-baseline bypasses the bounds (harmful only together with L05 EVM; fix is one validation call) |
| L04 PMO — scheduling, resources, collaboration | CONDITIONAL | **CONDITIONAL** | CPM fine (498 ms / 10k); levelling F4/F5/F8 unchanged, no perf budget approved |
| L05 PMO — time, money, benefits | NO-GO | **NO-GO** | R2-1 wrong CPI/EAC after a task delete (F2 only partially fixed); R2-2 EVM DoS; G14 Finance empty |
| L06 Optional plan exchange (extras) | CONDITIONAL | **CONDITIONAL** | F3 offline overwrite unchanged; F9; connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / portfolio sensitivity | not assessed | **not assessed by this seat** | — |

## 6. Human gates still empty in this area (RELEASE-GATES.md at b2e85cd0 — every cell empty)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05 / dossier G21) — PMO
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- Product — business acceptance — Sponsor / PO
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (no PPM perf budget; `perf-budgets.json` PROPOSED, `approved_by: null`)
- QA lead — CI green on the target SHA, skipped tests reviewed (E-B05) — QA lead
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
