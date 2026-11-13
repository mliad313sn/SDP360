# ADR-P7B — Plan freshness, timesheet week approval, change-request impact simulation

Status: PROPOSED engineering decisions (reversible, all behind switches defaulting to today's behaviour).
Goals: B4 (REQ B3) and B5 (REQ B4) of the 2026-11-12 goal programme. Business policies below are proposals only.

## 1. "Plan updated" = latest of the ledger AND the plan rows (B4)
The gap matrix said "derive from max `ppm_events` ts per project". Reading the code showed that an ordinary task edit
(dates, status, progress) does **not** write a `ppm_events` row — only role / finance / reassignment / stage / baseline
/ workbench steps do. A ledger-only date would call a busy plan "stale". Decision: `services/ppm/planFreshness`
takes the latest of `max(ppm_events.at)` for the project and `max(updated_at)` of the project row and its live tasks,
milestones and deliverables (every `updateRow` stamps `updated_at`). No row and no event → `null` (UNKNOWN), never 0.

## 2. Stale-plan rule lives in the existing A11 exception engine (B4)
`stale_plan` is one more kind of `services/ppmAlerts.findExceptions`, active only with `stale_plan_days` set (empty =
off = today), only for `in_progress` projects, never for an unknown date. It reaches people through the existing nightly
job (`tools/governance/ppm-alerts.js`, armed by `ppm_alerts_enabled`, dedup `ppm_alert_state`, owner + committee), so no
new notification path exists. The item key carries the last-update day, so a fresh update clears it.

## 3. Timesheet week = person × project × ISO week (B5)
Time entries belong to tasks; approval is per project (the project's plan-writers / committee know the work) and per
person (one person's hours are one claim). A week is Monday-start UTC. State table `ppm_timesheet_weeks` (migration 102);
a week without a row is `draft`. SoD is enforced server-side in the pure `services/ppm/timesheets.tsTransition`: the
decider is never one of the week's ENTRANTS — the submitter, the person whose hours they are (when linked to an account),
or anyone who recorded an entry of the week. Submitted and approved weeks freeze the entries (409 `WEEK_FROZEN`);
rejected weeks reopen. PROPOSED approver policy: the project's plan-write rule (committee, or a site editor when
`portfolio_editor_plan_writes` is on) — the PMO decides.

## 4. Simulation = the W1 engine run twice, never a write (B5)
`services/ppm/crSimulation.simulate` runs `scheduleEngine.schedule` on the current plan and on a copy with the request's
task changes; it reports finish / critical path before → after, the moved tasks and a deadline breach. A cycle refuses.
Cost impact reuses the W1-EVM per-task hourly rate (`ppm_task_evm.cost_rate`): Δ effort hours × rate per currency, the
new effort being the stated one or the engine's W = D × U × h/day after a duration change. Unknown effort or a missing
rate makes that part UNKNOWN with a reason (never 0); no effort change claims no cost delta. Amounts are non certifié
and shown under the money-read rule only.

Assess and approve re-run the simulation on the CURRENT plan (with `ppm_cr_simulation_enabled`), so the decision is
taken on fresh numbers and the stored result carries a plan fingerprint. Apply keeps the existing path (committee
re-baseline, `ppm_rebaseline_enabled`, versioned baseline): it moves the baseline end by the typed dates impact, else by
the simulated finish delta. **Apply does not write the task changes into the live plan** — the planner applies them; this
keeps the plan's own integrity rules (W1-INTEGRITY) as the single write path. A request that is not approved can never
reach apply (unchanged `crTransition` order rule).

## Rollback
Switches `stale_plan_days` = '', `ppm_timesheet_approval_enabled` = '0', `ppm_cr_simulation_enabled` = '0'. Schema:
`db/postgres_rollback/102_ppm_timesheets_cr_simulation_drop.sql` (manual, proved by `tests/ppm-rollback-scripts.test.js`).
