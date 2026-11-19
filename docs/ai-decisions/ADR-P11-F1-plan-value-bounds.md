# ADR P11-F1 — plan value bounds + per-project schedule isolation

- **Status:** accepted for the sandbox (AI engineering decision, reversible; defect fix, ships ON — no switch). AI review,
  not an independent human review.
- **Context:** P11 qualification (PPM seat) finding F1: `PUT /api/governance/portfolio/task` accepted
  `duration_days: 5000000` or `start_date: '9999-06-01'` (200); the schedule engine then threw `SCHEDULE_RANGE` (untyped
  → 500) and `portfolioView()` schedules every project on each read, so every portfolio read, the EVM portfolio and the
  poisoned project's own page answered 500 for all users — including the page a PM needs to repair the task.

## Decision
1. **Bounds at write** (`services/ppm/planIntegrity.rangeProblem`, called from `governanceStore._integrityCheck`, only on
   the fields the write CHANGES — a legacy row stays editable for its other fields), refused as 400 `INVALID` with a
   reason code:
   - every date of a task / project / milestone (the dated fields + `deadline`, `constraint_date`, `finish_deadline`):
     **years 1970..2200** (`DATE_RANGE`). 1970 is the engine's day 0 (earlier days are silently clamped — P11 F7);
     2200 is far beyond any IT programme horizon;
   - `duration_days`: **0..36 500 working days** (`DURATION_RANGE`; ≈140 calendar years; a negative duration is refused too);
   - link lag: **|lag| ≤ 36 500** (`LAG_RANGE`).
   One task within these bounds stays far inside the engine's year-3065 guard. These are engineering sanity bounds, not
   business policy.
2. **Isolation at read**: bounds alone cannot guarantee a plan schedules (a long chain of maximal tasks, legacy rows,
   SQL edits). `projectSchedule.criticalPathSafe` / `scheduleViewSafe` turn an engine failure into
   `{ result: null, error: { code, message } }`. The portfolio returns `critical_path: null`, `critical_length_days: null`
   and `schedule_error` for that project only (unknown, never an empty path or 0); the project page returns
   `plan: null` + `plan_error` and still opens, so the task can be corrected through the normal write. A dependency
   cycle keeps its pre-existing signal (`null`, no error).
3. **Typed engine error**: `SCHEDULE_RANGE` now carries `status 422, expose true`, so single-project engine routes answer
   a readable 422 through `httpError.fail` instead of an opaque 500.

## Consequences
- Rollback: revert the commit; no schema change, no data change. Rows already stored out of range are listed for a person
  by the read isolation (the plan reads "cannot be computed"), never repaired silently.
- Tests: `tests/ppm-schedule-bounds.smoke.test.js` (write refusals, poisoned-row read isolation, pure bounds, guarded reads).
