# ADR P11-R2 — spent hours survive a task deletion; EVM cost bounded; re-baseline inside the plan bounds

- **Status:** accepted for the sandbox (AI engineering decision, reversible; defect fixes, ship ON — no switch). EVM stays
  behind `ppm_evm_enabled` (lot L05, default '0'); no figure is certified (Finance gate G14 empty). AI review, not an
  independent human review.
- **Context:** P11 qualification round 2, PPM seat (`/home/user/qual/out/r2-ppm.md`):
  - **R2-1 (P1 for L05):** deleting a task with logged hours took that money out of earned-value AC (AC 300 → 100,
    CPI 1.67 → 5.0, EAC 1200 → 200, no reason). A hard delete cascades `ppm_time_entries` (FK ON DELETE CASCADE); a
    soft delete hid the entries (`evmStore.timeEntriesFor` filtered `deleted_at IS NULL`); the engine dropped entries of
    a task absent from its list. Residual of ADR-P11-F2 (cancelled / summary tasks only).
  - **R2-2 (P2):** `governanceStore.rebaseline()` checked only the `YYYY-MM-DD` shape, so a `9999-12-31` baseline end
    passed; `evm.timePhase` / `sCurve` enumerated every calendar day of the baseline window — 20 s per project EVM read,
    14.5 s per portfolio read with one task, event loop blocked for everyone; even the legal 2200 bound cost 2.7 s for
    20 tasks.

## Decision
1. **R2-1 — refuse the destructive path, keep the money on the safe one.**
   - `removePortfolio` (hard path) counts the time entries the delete would cascade (`actualsUnder`: the task's whole
     subtree; for a project / objective / programme every task below) and refuses with **409 `HAS_ACTUALS`** while any
     exists. The person turns soft delete on, or cancels / moves the work. The trash purge skips such rows ("kept
     soft-deleted"), so the retention job never erases spent money either. The FK stays CASCADE (no schema change:
     switching it to RESTRICT would also change the project delete and purge flows — rejected as riskier).
   - `evmStore.timeEntriesFor` serves the entries of soft-deleted tasks too, each carrying its task's rate / currency /
     cost class (the callers read EVM fields for live tasks only). The engine puts entries of a task absent from the
     plan (soft-deleted, or hidden under a soft-deleted parent) into AC, S-curve AC and the capex/opex split, with the
     reason **`actuals_on_deleted_tasks`**; unknown rate / currency ⇒ AC unknown (null), never smaller. Such a task
     leaves BAC / PV / EV (no work ahead), exactly like a cancelled task.
   - Rejected: deleting the task while keeping its entries (orphan rows), or ignoring the delete in EVM (a deleted
     task's budget would stay in BAC).
2. **R2-2 — bound both the write and the cost of the read.**
   - `rebaseline()` applies `planIntegrity.rangeProblem` (years 1970..2200, ADR-P11-F1) to every project / task baseline
     date it writes (400 `DATE_RANGE`), and refuses a task baseline end before its start (400 `DATE_ORDER`).
   - The EVM engine phases arithmetically: working days in an interval are counted in O(1) (`_wdBefore`), PV to the
     status date is O(1) per leaf, the S-curve cumulative PV is computed with difference arrays in O(leaves + months),
     and the curve has at most `MAX_CURVE_MONTHS` = 2 772 points (1970..2200); a longer legacy window is cut around the
     status month (the cut months still count in the cumulative) and flagged `s_curve_truncated`. Figures are the same
     linear spread as before (2 000 random projects compared with the previous engine: identical structure, numeric
     differences ≤ 0.01 — cent-rounding of float summation order only). `timePhase` (per-day map) stays as an exported
     reference helper; the engine no longer uses it.
   - Measured (pure engine, this sandbox): 1 task to 9999 → 11 ms (was 12.9 s); 20 tasks to 2200 → 5 ms (was 2.66 s);
     1 000 tasks to 2200 → 32 ms.

## Consequences
- A hard delete of a task / project / objective / programme that carries hours now answers 409 `HAS_ACTUALS` (it used
  to succeed and silently erase the hours). Soft-deleted tasks' hours appear in AC with a reason code.
- Rollback: revert the commits; no schema or data change.
- Tests: `tests/ppm-evm-r2.test.js` (pure, hand-computed + timing), `tests/ppm-r2-actuals-rebaseline.smoke.test.js`
  (HTTP: 409 HAS_ACTUALS, soft delete keeps AC 300 / CPI 1.6667 / EAC 600, re-baseline 400 DATE_RANGE / DATE_ORDER,
  project + portfolio EVM < 1 s with a 9999 legacy row); `tests/soft-delete-readers.test.js` allowlists `actualsUnder`.
