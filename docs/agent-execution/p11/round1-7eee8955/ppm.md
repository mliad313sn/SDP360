# P11 qualification — seat `ppm` (native project / programme / portfolio engine)

**AI review — not an independent human review.** Nothing below is an approval, a signature or a release decision.

- Frozen SHA: `7eee8955568c0bcab2a6329f838ee432ffca9fd1` (clone `/home/user/qual/ppm`, HEAD verified with `git rev-parse HEAD`).
- Scope read: code, tests, `docs/ops` (perf-budgets, switch-lots, FLAG-REGISTER), `docs/sdp360/completion/RELEASE-GATES.md`, gate dossiers G14 / G21. `docs/agent-execution/` narratives NOT read.
- No product file modified. Throwaway reproductions live outside the clone: `/home/user/qual/out/ppm-repro/`.
- Gate dossiers carry target SHA `ccaeb0a3`; it is the direct parent of the frozen SHA (1 commit, no change under `services/ppm`, `routes/governance*.js`, `public/lib/ppmOfflineQueue.js`), so the dossier evidence applies.

## 1. Evidence re-run (all at 7eee8955)

Test env: `PG_ADMIN_URL=postgres://sdptest:…@localhost:5432/postgres`, `NODE_OPTIONS="--require tools/test/blocking-stdio.js --require tests/_default-env.js --import tests/_pg-boot.mjs"`.

| # | Command | Result | Status |
|---|---|---|---|
| E1 | `node --test --test-force-exit tests/ppm-*.test.js tests/governance*.test.js` (run 1) | 330 reported, 310 pass / 20 fail; every failure = `sorry, too many clients already` (PostgreSQL shared by parallel seats); `ppm-baselines.smoke` crashed at file level | environmental, discarded |
| E1' | same command, re-run after max_connections = 400 | **335 tests, 335 pass, 0 fail, 0 skipped**, 151 s | **verified** |
| E2 | `node tools/ppm/bench-engine.js --sizes=10000 --runs=3` | 10 000 tasks / 5 875 assignments: **CPM full reschedule 302 ms (median)**; levelling 18 704 ms, 20 iterations, `converged:false`, 1 303 moves, 6 494 over-allocations remaining | **verified** (CPM fast; levelling see F4/F5) |
| E2b | `node tools/ppm/bench-engine.js` (defaults) | 1 000: CPM 31 ms, levelling 1 230 ms, `converged:true`, **561 over-allocations remaining**; 5 000: CPM 146 ms, levelling 8 779 ms, `converged:false` | verified |
| E3 | `node --test --experimental-test-coverage --test-coverage-include='services/ppm/**' tests/ppm-*.test.js` | 231/231 pass; services/ppm **98.83 % lines, 82.11 % branches, 96.71 % functions**. Lowest branches: engineInput 47.7 %, projectReport 58.9 %, engineStore 59.9 %, comments 65.7 %, governanceW3Store 67.8 %. Lowest lines: w3Context 85.5 %, engineStore 92.9 % | **verified** |

Not verified (not reproduced by this seat): the performance figures recorded in `docs/ppm/W2-ENGINE-CONTRACT.md`; `tools/ppm/bench-gantt-browser.js` (browser Gantt bench, not assigned); the P04 certification narrative; any witness-project result (none exists — G21 empty). No PPM class exists in `docs/ops/perf-budgets.json` (status PROPOSED, `approved_by: null`), so the 10k figures have **no budget to pass or fail against**.

Verified evidence: 3 of 3 assigned (E1', E2, E3). Not verified: 4 items listed above.

## 2. Claims attacked

| # | Claim | Attack | Outcome |
|---|---|---|---|
| A1 | Portfolio/plan reads are robust; integrity rules refuse bad plan writes before the write (`planIntegrity.js` header) | As committee-member PUT a task with `duration_days: 5000000` (also tried `start_date: '9999-06-01'`) into project PX-2, then GET `/api/governance/portfolio` as a site viewer and as the PMO | **BROKEN** → F1 (both writes 200; portfolio 500 for everyone; the poisoned project page 500; the healthy project page stays 200) |
| A2 | EVM: "UNKNOWN is null, never 0"; AC = costed time entries; CPI = EV/AC | Hours logged on a task later **cancelled**; hours logged on a **summary** task | **BROKEN** → F2 (spent hours vanish, CPI 5.0 instead of 1.0, no reason code) |
| A3 | Offline queue: "conflicts detected by row version on replay … never overwrite blindly" | Queue an edit with `base:null` (what `ppmCollabUi.enqueue` builds when the cached project detail does not hold the row), server has a newer value of the same field | **BROKEN** → F3 (auto-rebase re-sends with the current version, other person's value silently overwritten) |
| A4 | Levelling "converges" and every remaining over-allocation involves a task levelling may not move (comment in `tests/ppm-w2-bench.test.js`) | Recompute on the 1 000 fixture: classify the 561 remaining over-allocations | **Mostly holds** (559/561 involve an unresolved or fixed task) but `converged:true` with 561 over-allocations left, 2 unexplained single-task days (resource 10, 2027-01-12, 8.42 h > 8 h, task 575, not in `unresolved`), and the test's closing assertion (`remaining <= base.tasks.length`) cannot fail → F5, F8 |
| A5 | Calendars: holidays honoured | Holiday 2026-12-25 inside a 2-day task + FS successor | **Holds** (24 → 28 Dec, successor 29 Dec) |
| A6 | Engine dates | Start `1969-12-29` | silently clamped to `1970-01-01`, no warning → F7 |
| A7 | Connectors are optional extras, read-only, SSRF-guarded | Read `workItemClient.js`, `routes/ppmConnectors.js`, `mppConverter.js` | Holds: each behind its own switch (404 while '0'), `safeUrl` transport, credentials in header only, MPP via `execFile` argument array no shell with path validation. Side finding F9 (shared-token JQL scope) |
| A8 | Native tool works without connectors | grep of native routes for connector reads | No native path reads connector state (only `ppmConnectors.js` and its status route). Holds by inspection, not by a disabled-connector end-to-end run |

## 3. Findings

### P0
None found.

### P1 — must fix before pilot

**F1 (P1) — One task write takes the whole portfolio down for every user (availability, live path, default switches).**
- Where: `services/ppm/scheduleEngine.js:72` throws `SCHEDULE_RANGE` (untyped → 500) for any schedule past year 3065; `routes/governance.js:547` computes `criticalPath` for **every** project inside `portfolioView()`, which feeds `viewFor()` (`routes/governance.js:585`) used by the portfolio page, EVM portfolio (`routes/governanceEvm.js:60`) and most PPM reads; no bound on `duration_days` or date year at write (`services/governanceStore.js:505`, `services/ppm/planIntegrity.js` checks format and order only).
- Repro: `/home/user/qual/out/ppm-repro/poison.smoke.test.js` (copy into any `tests/` directory so `_pg-boot.mjs` provisions a DB) → `write huge duration 200`, `portfolio after (viewer) 500 internal_error`, `poisoned project page 500`, `healthy project page 200`.
- A typo ("5000000" days, "9999" year) by any plan writer is enough; recovery needs an API call or SQL because the page that would let a PM fix it is the one returning 500.
- Regression test to add: write a task with `duration_days` 5e6 / start `9999-06-01` → expect 400 `INVALID` at write; and portfolio GET stays 200 when one project's schedule throws (per-project try/catch → `critical_path: null` with a reason).
- Rollback risk: low (validation + per-project guard, no schema change). Recommendation: bound duration (e.g. ≤ 36 500 working days) and year (≤ 2200) in `planIntegrity`, and isolate per-project schedule errors in `portfolioView`.

**F2 (P1 for any pilot that turns L05 on) — EVM actual cost drops money already spent: CPI and EAC overstated, shown with no reason code.**
- Where: `services/ppm/evm.js` `_tree()` filters `status === 'cancelled'` before AC is computed (comment "cancelled tasks are out of the earned value: no budget, no work"), and AC is summed only over leaves, so hours on a summary task are ignored. `services/ppmWorkbenchStore.js:74-80` accepts time entries on any task (summary or later-cancelled).
- Repro: `node /home/user/qual/out/ppm-repro/evm.js` → task 1 (50 %, 10 h) + cancelled task 2 (40 h already logged), rate 10: `ac:100, cpi:5`, `reasons:[]` (true AC 500, CPI 1.0). Summary task with 100 h: `ac:10, cpi:50`, `reasons:[]`.
- Also: an entry with `hours:null` gives `ac:0` instead of unknown (`num(e.hours) || 0`), contradicting the module's own null rule (moot if `normaliseTimeEntry` always refuses null hours — not verified).
- Live path: behind `ppm_evm_enabled` (default '0', lot L05). Not live today; wrong figure as soon as L05 is switched on.
- Regression test: cancelled task with hours → AC includes them (or AC null with reason `hours_on_cancelled_task`); hours on summary → refused at write or counted.
- Rollback risk: low (pure module). Finance G14 is empty, so no EVM figure may be presented as certified anyway.

### P2 — before general deployment

**F3 (P2) — Offline replay silently overwrites a concurrent change when the edit was queued without a base.** `public/lib/ppmOfflineQueue.js` `conflictsOf` returns `[]` when `entry.base` is null, so a 409 triggers auto-rebase with the current version; `public/lib/ppmCollabUi.js:106-110` builds `base = null` whenever the cached project detail lacks the row (cache absent, row created after the last cached read). Repro: `node /home/user/qual/out/ppm-repro/oq.js` → final `name: 'mine'`, server's `'theirs'` lost, `conflicts: 0`. Fix: a null base on an existing row must produce a conflict (or fetch the row before queueing). Behind `ppm_offline_edit_enabled` (L06). Also: any 409 (e.g. soft-delete `deletedConflict`, `WEEK_FROZEN`) is treated as a version conflict and auto-re-sent once.

**F4 (P2) — Levelling runs synchronously in the request and does not scale.** `routes/ppmEngine.js:254` calls `RES.level` inline: 8.8 s at 5 000 tasks, 18.7 s at 10 000 (E2), blocking the Node event loop for every user on the instance; `converged:false` at both sizes. No PPM entry in `perf-budgets.json`. Fix: worker thread / job, a task-count ceiling, and a proposed budget. Behind `ppm_leveling_enabled` (L04).

**F5 (P2, test gap) — `tests/ppm-w2-bench.test.js` closing assertion is vacuous.** `assert.ok(out.remaining_overallocations.length <= base.tasks.length)` cannot fail on this fixture; the comment claims every remaining over-allocation involves an immovable task, which A4 shows is false for 2 of 561. Add the real assertion (each remaining over-allocation contains a task in `unresolved` or fixed).

**F6 (P2, coverage) — branch coverage under 60 % on `engineInput.js` (47.7 %), `projectReport.js` (58.9 %), `engineStore.js` (59.9 %)**, the modules that turn stored rows into engine input and the project report. Uncovered lines include `engineStore.js:56-68,178-183,320-326`.

### P3 — later

- **F7** — dates before 1970 are clamped to `1970-01-01` with no warning (`scheduleEngine.js` `ord(d<=0) → 0`). Repro `/home/user/qual/out/ppm-repro/sch.js`.
- **F8** — `level()` reports `converged:true` when a pass moves nothing, even with 561 over-allocations left (1 000 fixture); 2 single-task over-allocations are not in `unresolved` (the "alone" check runs on the unshifted demand). Rename/document `converged` or add `fully_resolved`. Repro `/home/user/qual/out/ppm-repro/lev.js`.
- **F9** — Jira/Azure DevOps scope is free JQL/WIQL set by any plan writer (`services/ppm/workItemSync.js:24-29`) and executed with the single super_admin-configured token: a PM of project A can pull issue titles from any Jira project that token can read. Read-only, behind `ppm_jira_sync_enabled` / `ppm_azdo_sync_enabled`. Consider an allow-list of keys per project.
- **F10** — `earnedFraction` under `percent_complete`: `status:'done'` with `progress_pct:40` earns 40 % while `0_100`/`50_50` treat the same task as complete; pick one rule.
- **F11** — `ppm_mpp_converter_cmd` lets a super_admin point execution at any absolute executable (`execFile`, no shell). Trust boundary = super_admin config; document it in the threat model.

## 4. Lot recommendations — AI panel recommendation, not a decision

| Lot | Recommendation | Basis |
|---|---|---|
| (no lot — today's portfolio, default switches) | **CONDITIONAL** | F1 is live today; fix before any pilot user can write plans |
| L02 PMO — portfolio and project reading | **CONDITIONAL** | tests green; reads depend on `portfolioView` → F1 |
| L03 PMO — change control, baselines, gates | **CONDITIONAL** | tests green (baseline slots immutability covered by `ppm-engine-routes.smoke`); F1 |
| L04 PMO — scheduling, resources, collaboration | **CONDITIONAL** | CPM 302 ms at 10k is fine; levelling F4/F5/F8; no perf budget |
| L05 PMO — time, money, benefits | **NO-GO** | F2 wrong CPI/EAC; G14 Finance empty |
| L06 Optional plan exchange (extras) | **CONDITIONAL** | F3 offline overwrite, F9 scope; connector gate D-07/D-08/D-09 empty |
| L07 Roadmap publication / portfolio sensitivity | **not assessed by this seat** | — |

## 5. Human gates still empty in this area (RELEASE-GATES.md — every cell empty at 7eee8955)

- Finance — budgets and benefits (G14) — Finance
- Business witness project (E-B05 / dossier G21) — PMO (no witness project chosen; PPM not certified)
- Connectors D-07/D-08/D-09, dash-key clients D-15 — Platform/infra owners
- Product — business acceptance — Sponsor / PO
- Capacity — load / soak result accepted (E-B05) — SRE + DBA (no PPM perf budget exists)
- QA lead — CI green on the target SHA, skipped tests reviewed — QA lead
- KPI definitions, thresholds, score D-01/02/03 (G-12) — KPI Committee (project RAG / EVM indicators)
- Production deployment GO/NO-GO — CAB

_AI review — not an independent human review._
