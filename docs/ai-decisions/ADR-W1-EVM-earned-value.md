# ADR-W1-EVM — earned value engine: PV time-phasing, EAC default, currency rule

Status: accepted as an AI technical decision · 2026-11-12 · **not** reviewed by Finance or the PMO · every figure the
engine produces is labelled "non certifié" · arming `ppm_evm_enabled` is a PMO + Finance decision (human).

## Context
W0 (`docs/audits/2026-11-12-ppm-parity/W0-MATRIX-ENGINE.md` rows E1–E10, P0 defect E-EVM-1): there was no earned value.
The only money model was monthly budget periods (EAC = actual to date + remaining forecast) and a project budget/spent.

## Decisions
1. **PV is time-phased from the BASELINE, per leaf task.** Each leaf task's baseline cost is spread **linearly over the
   working days (Mon–Fri) of its baseline window** (`baseline_start`/`baseline_end` of the task; if empty, the frozen
   dates of the latest `portfolio_baselines` version; never the live plan). Linear within a task = the standard flat
   contour; resource contours are W2. Mon–Fri because there is no calendar model yet (W2 brings calendars); a window of
   weekend days only spreads over its calendar days so a cost is never lost. A linear spread of the WHOLE project budget
   over the project window is **rejected** (it is what W0 calls a stub; the reference test shows it gives 1 280 where
   the baseline-phased PV is 1 600). When the project has **monthly baseline budget periods** for a currency, those
   months ARE the PV and BAC of that currency (the status month prorated by working days); task costs then only weight
   the earned value: EV = BAC_periods × Σ task EV / Σ task BAC.
2. **EV methods per task:** `percent_complete` (default — today's progress field), `0_100`, `50_50`, `physical_pct`.
   A reported % is used as is; with no figure, `done` = 100 % and "not started" (todo, no actual start, no progress) = 0 %;
   a started task with no figure is **unknown** (null), never 0 (W0 E-NULL-1). Progress has no history, so EV is known
   at the status date only; past S-curve EV points are null, never interpolated.
3. **AC:** the project's ACTUAL budget periods (months ≤ the status month) when it has any in that currency; otherwise
   costed time entries (hours × the task's hourly rate, days ≤ the status date) — the tasks WITH entries are the measured
   set, an entry on a task without a rate makes AC unknown, no entry at all is unknown. A resource rate table (A–E) is W2.
4. **EAC default = BAC / CPI.** Variants are always returned beside it: AC + (BAC − EV) (atypical), AC + (BAC − EV) /
   (CPI × SPI), and the budget-period forecast (actual to date + remaining forecast) when a forecast exists.
   ETC = EAC − AC, VAC = BAC − EAC, TCPI = (BAC − EV)/(BAC − AC). Any unknown input or zero divisor → null (never 0,
   never Infinity). Indices are recomputed from summed BAC/PV/EV/AC at every rollup level, never averaged.
5. **Currency rule:** a task carries its own `cost_currency` (required with a cost or a rate — never defaulted).
   Every total is per currency; currencies are never added. A converted portfolio total exists only when an explicit
   rate table is configured (`ppm_evm_fx_rates`), flagged `converted: true` with the rates, their date and source; a
   currency without a rate makes the converted total null.
6. **Storage in a side table** `ppm_task_evm` (migration 093) rather than new `portfolio_tasks` columns: the portfolio
   view, workbook and deck read `portfolio_tasks` with `SELECT *` for every reader and strip only project budget/spent,
   so a cost column there would leak to readers without the money right. Rollback: `db/postgres_rollback/093_ppm_evm_drop.sql`.
7. **Leaf → summary → project → programme → portfolio:** summaries are the sum of their leaves (a summary's own fields
   are never added), cancelled tasks are out, an uncosted leaf makes the project's task-derived BAC/PV/EV null.

## Alternatives rejected
- Linear spread of the project budget (stub, wrong shape). · Falling back to the live plan dates for PV (PV would move
  with every replan — no longer a baseline). · Treating no entry as 0 h (violates UNKNOWN ≠ 0). · Averaging SPI/CPI
  across projects (weights lost). · A silent default currency (the platform flags or refuses that elsewhere, F-DATA-10).

## Rollback
`ppm_evm_enabled = '0'` (default) — the routes answer 404. Then the manual drop script if the table must go.
