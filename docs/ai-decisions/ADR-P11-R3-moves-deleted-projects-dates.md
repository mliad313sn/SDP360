# ADR P11-R3 — spent money stays where it was spent (moves, soft-deleted projects, timesheets); re-baseline dates; offline replay

- **Status:** accepted for the sandbox (AI engineering decision, reversible; defect fixes, ship ON — no switch). EVM stays
  behind `ppm_evm_enabled`, time entries behind `ppm_time_entries_enabled`, timesheets behind
  `ppm_timesheet_approval_enabled`, offline editing behind `ppm_offline_edit_enabled` (all default '0'); no figure is
  certified (Finance gate G14 empty). AI review, not an independent human review.
- **Context:** P11 qualification round 3, PPM seat (`/home/user/qual/out/r3-ppm.md`), plus the carried R1-F3.
  - **R3-1 (P2):** `rebaseline()` checked year bounds only — `2027-02-30` / `2027-13-40` were stored (versioned) while the
    ordinary task write refuses them (400 `DATE_INVALID`).
  - **R3-2 (P2):** moving a task with logged hours to another project took that money out of the source project's AC
    (AC 300 → 100, CPI 1.67 → 5.0): `evmStore.timeEntriesFor` joins entries to the task's CURRENT project. Soft-deleting a
    project dropped its spent money from the portfolio AC (1000 → 500, no reason): the portfolio reads the live view only.
  - **R3-3 (P2):** the offline queue compared values with `String(v)`: every array of objects of the same length is
    `"[object Object]"`, so a colleague's `dependency_links` change was silently overwritten on replay.
  - **R1-F3 (P2, carried):** an offline edit queued with `base: null` (the cached detail did not hold the row) was
    auto-rebased over a colleague's change.
  - **R3-4 (P3):** soft-deleting a task removed its hours from the timesheet weeks (an approved week's total changed) while
    EVM kept them in AC (10 h vs 30 h).

## Decision
1. **R3-1** — `rebaseline()` validates every date it writes with `planIntegrity.isValidDate` (the rule of the ordinary
   write) BEFORE the shape / order / range checks: 400 `DATE_INVALID`, nothing written, no baseline version.
2. **R3-2, move** — consistent with ADR-P11-R2 ("refuse the destructive path"): a task whose subtree carries time entries
   cannot change `project_id` — **409 `HAS_ACTUALS`**. The person cancels it (its hours stay in the source project's AC,
   flagged `actuals_on_cancelled_tasks`, ADR-P11-F2) and creates the remaining work in the other project. Rejected:
   stamping the project on each time entry (schema migration + every reader to change) — larger and not needed to stop
   the silent loss. The hard-delete message no longer suggests moving the work.
3. **R3-2, soft-deleted project** — the portfolio EVM adds every project hidden by a soft delete (its own, its
   objective's, its programme's) that carries time entries or ACTUAL budget periods, filtered by the reader's A-15 scope
   (same `canReadProject` rule). Its contribution (`evm.spentOnlyContribution`): AC = its spent money; BAC / PV / EV = 0
   (no work ahead, like a cancelled task); forecast = AC. Currency rows carry reason **`actuals_on_deleted_projects`** and
   `deleted_project_contributors`; hours with no rate keep AC unknown; hours whose currency is unknown make AC unknown in
   every currency (`actuals_currency_unknown`) — never smaller. The response lists them in `deleted_projects`
   (id, key, name, AC per currency). The per-project EVM read of a deleted project stays 404 (unchanged).
4. **R3-3** — `same()` compares scalars as before (null ≡ '', 40 ≡ '40'); objects are compared key by key whatever the
   key order; arrays of objects are compared as a set (items sorted by canonical form: order-insensitive by link
   identity). A different link set / type / lag is a conflict.
5. **R1-F3** — an edit of an EXISTING row without base is checked against the stored row BEFORE sending (the body may
   carry no version): every field whose stored value differs from the queued one is a conflict (`base: null` shown);
   equal values are sent with the current version. A new row (no id) is sent as before.
6. **R3-4** — `timesheetView` keeps the entries of soft-deleted tasks (week `deleted_task_hours` flags them), so a week's
   total — submitted / approved included — never changes on a task soft delete, and timesheet hours × rate = EVM AC.

## Consequences
- A task move that used to succeed now answers 409 when the task carries hours. The portfolio AC (and CPI, EAC…) can
  rise when soft-deleted projects carried spent money — that is the correction, flagged by a reason code.
- Rollback: revert the commits; no schema or data change.
- Tests: `tests/ppm-r3-actuals-dates.smoke.test.js` (HTTP, hand-computed: DATE_INVALID ×5 + no version; move 409 with
  AC 300 / CPI 1.6667 / EAC 1200 unchanged; programme BAC 4000→2000, EV 1000→500, AC 600 kept, CPI 0.8333; objective
  soft delete keeps AC 300; approved week 30 h unchanged = AC 300), `tests/ppm-evm-r3.test.js` (pure),
  `tests/ppm-offline-queue-r3.test.js` (pure).
