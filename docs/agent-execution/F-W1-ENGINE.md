# F-W1-ENGINE — PPM parity wave 1, scheduling engine bundle

Branch `goal/w1-engine` from `c8f1794`. Gap audit: `docs/audits/2026-11-12-ppm-parity/W0-MATRIX-ENGINE.md`.
ADR: `docs/ai-decisions/ADR-W1-ENGINE-schedule-engine.md`. Nothing is approved by this work; no business policy decided.

## What changed

| Area | File(s) | Change |
|---|---|---|
| Engine (new, pure) | `services/ppm/scheduleEngine.js` | `makeCalendar` (Mon–Fri default, ISO workdays, holidays, working/non-working exceptions, elapsed 24/7, O(1) ordinal tables, cached); `schedule()` forward/backward pass on DATES, total / free / negative float, critical (≤ threshold) + near-critical, FS/SS/FF/SF ± lag in working days (successor calendar), manual vs auto, constraints ASAP/ALAP/SNET/SNLT/FNET/FNLT/MSO/MFO, task `deadline` + project `deadline`, actual start/finish win, optional status date, summary IN/OUT nodes (rollup dates, work sum, work-weighted %, 100 %-rule warning), 0-day milestones, per-task `calendar_id` / `elapsed` (W2 resource calendars slot into `opts.calendars`), `driver` per task; `recalc()` 3 task types × effort-driven with W = D × U × 8 h; `rollupProgress()` (unknown child % ⇒ null) |
| Wiring | `services/projectSchedule.js` | `criticalPath(tasks, opts)` and `scheduleView(tasks, opts)` delegate to the engine (one date set) |
| Routes | `routes/governance.js` (portfolio plan + project page) | pass `anchor = project start`, `deadline = finish_deadline` to both, so the portfolio plan and the project page agree |
| Page | `public/project.html` | Gantt bar = scheduled dates (manual task = entered dates); critical flags from the same result; Total/Free float columns (negative shown "late"); rolled-up % on summaries; scheduling warnings in the plan note; duration accepts 0 (milestone); editor fields (mode, constraint + date, deadline, task type, effort-driven, link types) behind `ppm_schedule_engine_v2_ui` |
| Schema | `db/postgres/reports/091_ppm_schedule_engine.sql` + `db/postgres_rollback/091_ppm_schedule_engine_drop.sql` | additive nullable columns on `portfolio_tasks` (schedule_mode, task_type, effort_driven, deadline, constraint_type, constraint_date, dependency_links) and `portfolio_projects.finish_deadline` |
| Store | `services/governanceStore.js` | passthrough of the new columns (light enum/date/link-shape checks only; integrity is W1-INTEGRITY's) |
| Switch | `services/reportConfig.js`, `routes/governancePpm.js` (`schedule_v2` feature), PILOT-PROFILE row, FLAG-REGISTER regenerated | `ppm_schedule_engine_v2_ui` default `'0'` (editor fields only; the engine is a defect fix and is ON) |
| Generated | `docs/agent-execution/INVENTORY.{json,md}`, `docs/ux/CHART-INVENTORY.md` | regenerated (migration + project.html size) |

## Tests

Failing-before / passing-after (repro harness on the base `projectSchedule.js` vs head): R1, R2, R4, R5 → base **0 pass / 4 fail**, head **4 pass / 0 fail**.

| File | Count | Result |
|---|---|---|
| `tests/ppm-schedule-engine.test.js` (new) | 14 | pass — calendar, FW/BW pass + TF/FF, weekends/holidays/elapsed (R4), 4 link types ± lag, negative float (project + task deadline), 8 constraints, manual/actuals/status date, summary rollup + links to/from summary + R2, work-weighted %, milestones (R5), critical/near-critical parity, R1, task types 3×2 + invariant sweep, **10 000-task benchmark ≈ 130-200 ms** (budget 1 s) |
| `tests/ppm-schedule-engine-store.test.js` (new, PG) | 1 | pass — 091 fields round-trip through the store and into the engine |
| `tests/project-schedule.test.js` | 11 | pass — 2 expectations updated: the old values were the defect (calendar days, day-0 anchor; comments in the file); the 24/7 calendar still yields the old 17 |
| `tests/ppm-project-lifecycle.smoke.test.js` | 7 | pass — 1 expectation updated: Build after a Mon–Fri task starts Mon 01-11, not Sat 01-09 (defect R4) |
| Broad run: every `ppm*`, `portfolio*`, `project*`, `governance*`, `pg-governance*`, `pg-ppm*`, `roadmap*` file + `flag-register`, `authz-route-matrix`, `server-size-budget`, `error-shape`, `await-precedence`, `pg-migrate*`, `ui-design-ratchet`, `a11y-legacy-ratchet`, `readme-truth` (56 files) | 505 | first run 2 failures (the lifecycle date above; `ppm-visuals` raw-concatenation guard on a new warning line) → both fixed, re-run of the 3 affected files 25/25 |
| Guards: agent-inventory, evidence-baseline, licence-inventory, readme-truth, retention-inventory, test-runner-guard, traceability, ui-design-ratchet, a11y-legacy-ratchet, flag-register, authz-route-matrix, server-size-budget, error-shape, await-precedence, pg-migrate ×2, project-schedule, ppm-schedule-engine | 88 | 87 pass + inventory stale → regenerated, `--check` ok |

`tests/.suite-manifest.json`: +15 (total 4860). `npx eslint` clean on touched JS. Test DBs dropped with `tools/test/drop-test-dbs.js`.

## W0 rows moved

| Row | Was | Now | Evidence |
|---|---|---|---|
| ARCH-22 single source of truth grid↔Gantt | PARTIAL | IMPLEMENTED | `public/project.html` `barOf` reads `planOf()`; R1 test |
| A2 parent-child recalculation | MISSING | IMPLEMENTED (dates/work/%) | `scheduleEngine.js` IN/OUT nodes; summary test |
| A4 summary rolled up, read-only in auto | MISSING | IMPLEMENTED (engine ignores entered summary duration, warns); UI still lets a summary's own fields be typed | summary test |
| A5 work-weighted % (task level) | MISSING | IMPLEMENTED for summary tasks; objective fallback in `portfolioEvidence.js` is W1-INTEGRITY's | `rollupProgress` test |
| A6 100 %-rule | MISSING | PARTIAL (warning, work only) | `WBS_100_RULE` |
| A7 leaf tasks | PARTIAL | IMPLEMENTED | only leaves are network nodes |
| A8 0-duration milestones | PARTIAL | IMPLEMENTED for tasks (`portfolio_milestones` table unchanged) | R5 test |
| B1 manual vs auto | PARTIAL | IMPLEMENTED (API) / UI behind switch | manual test |
| B2 task types × effort-driven | MISSING | IMPLEMENTED (pure `recalc`; not yet called on save) | task-type test |
| B3 link types + lag | PARTIAL | IMPLEMENTED (working-day lag; % / elapsed lag not done) | link-type test |
| B6 constraints | MISSING | IMPLEMENTED (8) | constraint test |
| B7 deadlines | PARTIAL | IMPLEMENTED (task + project, negative float); breach alert in `ppmAlerts` not added | negative-float test |
| B8 calendars | MISSING | PARTIAL (project/task calendar engine; no UI, site holidays not wired, no shifts) | calendar test |
| B9 forward/backward pass | PARTIAL | IMPLEMENTED | FW/BW test |
| B10 total float | PARTIAL | IMPLEMENTED | |
| B11 free float | MISSING | IMPLEMENTED | |
| B12 negative float | MISSING | IMPLEMENTED | |
| B13 critical path | PARTIAL | IMPLEMENTED (all chains) | parity test |
| B14 near-critical | MISSING | IMPLEMENTED (engine option; page not exposing a setting) | |
| B17 status date | PARTIAL | PARTIAL (opt-in engine option, not wired to the page) | status-date assertion |
| B21 task inspector | PARTIAL | PARTIAL (`driver` per task returned; not rendered) | |

## Deviations / left for a human or a later bundle

- R3 (child depends on its own parent) is not refused at write time — W1-INTEGRITY. The engine ignores such a link with `LINK_HIERARCHY_IGNORED` instead of failing the whole plan.
- ALAP: pinned at its late start then re-scheduled once (successors follow); a chain of interacting ALAP tasks is not iterated to a fixed point.
- Summary-level FF/SF links are applied to every child's finish; SS/SF from a summary bound only its start-defining children (approximation, documented in the ADR).
- `EVIDENCE-MANIFEST.md` was already stale at base (many unrelated docs); not regenerated here to avoid cross-bundle churn.
- Browser E2E of the project page (behind login) not run by the agent.
