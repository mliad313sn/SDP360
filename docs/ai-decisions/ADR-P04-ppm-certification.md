# ADR-P04 — PPM certification: one engine input, inactive cancelled leaves, offline rebase on own edits

- **Status:** accepted (technical, reversible engineering detail) · 2026-11-19 · lot p04-ppm-cert (prompt pack P04)
- **Decided by:** AI agent (Claude), sandbox only. **This is an AI decision, not an independent review.** No business
  policy, threshold or approval is decided here.

## Context
P04 asks to close the PPM certification suite T1–T11 (`docs/audits/2026-11-12-ppm-parity/README.md` §4) without building
anything the W0 matrices do not list. Running the suite against HEAD found three defects (failing tests first):

1. **T10 — the dashboard did not reconcile to the engine once calendars were on.** `routes/ppmEngine.js` (the W2
   `/schedule` route) scheduled on the project / task / resource calendars and the stored levelling delays; the project
   page plan (`routes/governance.js`), the W3 summary cards, the RAG slip and DCMA (`services/ppm/w3Context.js`) scheduled
   the raw rows on the default Mon–Fri calendar. With a site holiday inside the plan the card said 2027-01-15 while the
   engine said 2027-01-18 (`tests/ppm-p04-reconcile.smoke.test.js`).
2. **T4 — a cancelled leaf weighed in the summary rollup** (work and % complete) but not in the project KPI card
   (`projectKpis.scheduleComplete` excludes it): root summary 12.5 % vs card 25 % on the same plan
   (`tests/ppm-p04-rollups.test.js`). It also inflated the 100 % rule check.
3. **T8 — a field edited twice offline produced a false conflict.** The page records `base` from the cached SERVER row,
   so the second edit of the same field (progress 20 → 40) met the person's own first edit after replay and was shown as
   "someone else's change"; the merge screen's default ("theirs") then dropped the newer value
   (`tests/ppm-offline-queue.test.js` T8 cases).

## Decision
1. New pure+loader module **`services/ppm/engineInput.js`** (`buildEngineInput`, `loadEngineInput`, `engineSwitches`):
   the ONE place that turns a project's rows into the engine's tasks + options. `computeProject` (W2 route), the project
   page plan, `w3Context` (cards, RAG slip, DCMA incl. its critical-path probe, the scheduled project report) all use it.
   Switches off (`ppm_calendars_enabled` = `ppm_resources_enabled` = '0', today) → no extra read and exactly the previous
   input; the change is a defect fix and ships on (preamble rule), no new switch.
2. **Cancelled leaves are inactive in summary rollups** (`scheduleEngine.schedule`, `rollup.work_hours`,
   `rollup.progress_pct`, the 100 % rule), the same rule as the KPI card. They stay scheduled network nodes (dates,
   links unchanged). Defect fix, no switch. MSPDI golden SHA unchanged (no cancelled task in it).
3. **Offline queue rebase** (`public/lib/ppmOfflineQueue.js` `enqueue`): when an earlier queued edit (pending or in
   conflict) of the same row carries the same field, that value becomes this edit's base. A real concurrent change still
   surfaces as a conflict (50-edit test: only the concurrently changed task conflicts, zero loss). Defect fix, inert
   while `ppm_offline_edit_enabled` = '0'.

## Not decided here (left to a human / a later lot)
- **T3 save-path recalculation** (apply W = D × U when a typed task's duration / work / units is edited): a behaviour
  change of task writes; it needs a PMO decision and, per P00, a switch named by a prompt. The pure matrix is proven.
- Objective progress = unweighted mean of reporting projects (`portfolioEvidence.objectiveView`) — weighting by work or
  budget is a KPI definition (human).
- EVM PV phasing on the project calendar (it stays Mon–Fri), and the portfolio list's critical length on the project
  calendar — recorded as residual gaps.
- 60 fps on the Gantt (measured, not met headless) — a W2-UI rendering change, not a certification fix.

## Consequences / rollback
Revert the three commits. No migration, no data written, no route added.
