# ADR-W1-ENGINE — A date-based, working-day scheduling engine; entered dates on auto tasks = SNET

Status: accepted (technical, reversible engineering detail) · 2026-11-12 · bundle W1-ENGINE of the PPM parity programme
(`docs/audits/2026-11-12-ppm-parity/`). No business policy is decided here.

## Context

W0 (`W0-MATRIX-ENGINE.md`) found the plan computed from a relative-day, calendar-day, finish-to-start network anchored
at day 0 that ignored entered dates (R1), scheduled summary tasks as ordinary nodes (R2), counted calendar days (R4) and
forced 0-day milestones to 1 day (R5). The project page then drew bars from the entered dates and critical flags from the
other model.

## Decision

1. **One pure engine** — `services/ppm/scheduleEngine.js` (no I/O). `projectSchedule.criticalPath` and `scheduleView`
   delegate to it, so the project page grid, its Gantt bars, its critical flags and the portfolio plan
   (`routes/governance.js`) read ONE result. The page draws the scheduled dates (`es_date` / `ef_date`).
2. **Working days by default** — the default project calendar is Monday–Friday, no holiday. A calendar is an injectable
   object `{workdays (ISO 1..7), holidays, exceptions, elapsed}`; a task may name `calendar_id` (looked up in
   `opts.calendars`) or be `elapsed` (24/7). Per-resource calendars (W2) plug into the same `opts.calendars` without an
   API change. Site holidays (`services/workCalendar.js` / `site_calendar`) are not yet wired into the project page
   (needs a DB read per project) — left for W2. Durations, lags and floats are counted in working days of the task's
   calendar; lag of a link is counted in the successor's calendar.
3. **Entered dates on an AUTO task act as start-no-earlier-than (SNET)** unless the task states a constraint. This keeps
   the meaning of every existing row (a task entered for March stays in March — R1) while letting a late predecessor
   push it. An entered end date only gives the duration (working days between start and end) when `duration_days` is
   empty. A **MANUAL** task (`schedule_mode = 'manual'`) keeps its entered dates exactly (not even snapped to working
   days); a predecessor that would move it raises a `LINK_VIOLATED` warning instead. Actual start / finish always win.
4. **Summary tasks are not scheduled nodes**: each summary becomes an IN node (receives its links, constrains its
   children) and an OUT node (min/max of its children, feeds its successors). Work rolls up as a sum (null when any leaf
   work is unknown); % complete is work-weighted, falling back to duration weights; any unknown child % ⇒ null (never 0).
   An entered summary duration is ignored with a `SUMMARY_DURATION_IGNORED` warning; children work ≠ parent work raises
   `WBS_100_RULE`. A link between a task and its own ancestor is ignored with a warning (integrity refusal at write time
   is bundle W1-INTEGRITY's job).
5. **Constraints**: ASAP, ALAP (pinned at its late start, then re-scheduled so its successors follow), SNET, SNLT, FNET,
   FNLT, MSO, MFO; per-task `deadline` and project `finish_deadline`. A breach gives NEGATIVE total float (never hidden);
   must-start/finish-on wins against links (MS-Project "honor constraints"). A later deadline never creates float.
6. **Critical = total float ≤ threshold (0)**, every critical chain (not one walk); optional near-critical threshold.
7. **0-day milestone stays 0** and is dated at the end of the predecessor that drives it (start of the project otherwise).
8. **Task types** fixed units / duration / work × effort-driven: a pure `recalc(task, changedField)` keeps
   W = D × U × 8 h; effort-driven only matters when the assignment set changes (`'resources'`), fixed work is always
   effort-driven. The engine uses work ÷ units for the duration only when a task type is set and no duration/dates exist.
9. **Exposure** — the engine is a defect fix and ships ON. The data-entry fields (mode, constraint, deadline, task type,
   link types) are accepted by the API (additive migration 091) and shown in the task editor only behind
   `ppm_schedule_engine_v2_ui` (default `'0'`).

## Consequences

- Durations of date-only tasks are now WORKING days: a Friday→Tuesday task reads 3 d (was 5). Two expectations of
  `tests/project-schedule.test.js` were updated for that reason (marked in the file). The 24/7 calendar reproduces the
  old figures.
- `critical_path` now lists every critical leaf ordered by start (was a single zero-slack walk).
- Performance: topological O(V + E) with O(1) calendar lookups (pre-computed ordinal tables); 10 000 tasks schedule in
  ~150-200 ms on the dev box (benchmark test, budget 1 s).

## Rollback

`git revert` of the engine commit restores the relative-day model; migration 091 is additive (rollback script
`db/postgres_rollback/091_ppm_schedule_engine_drop.sql`, manual, outside the migrator). Switch `ppm_schedule_engine_v2_ui`
back to `'0'` hides the editor fields; stored fields keep being scheduled.
