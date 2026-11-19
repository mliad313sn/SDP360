# ADR P11-F2 — earned value: money already spent stays in actual cost

- **Status:** accepted for the sandbox (AI engineering decision, reversible; defect fix in a pure module, ships ON).
  EVM itself stays behind `ppm_evm_enabled` (lot L05, default '0'); no figure is certified (Finance gate G14 empty).
  AI review, not an independent human review.
- **Context:** P11 qualification (PPM seat) finding F2: `services/ppm/evm.js` dropped cancelled tasks before AC was
  computed and summed AC over leaves only, so hours already logged on a later-cancelled task or on a summary task
  vanished from AC with no reason code (repro: true AC 500 / CPI 1.0 reported as AC 100 / CPI 5.0). An entry of unknown
  hours counted as 0 h.

## Decision
The engine's model is kept: BAC / PV / EV are computed on live LEAF tasks (a cancelled task has no budget and no work
ahead; a summary rolls up from its children and its own budget is never added). Actual cost follows the money:
1. **Cancelled task** with costed time entries ≤ status date → its hours × its rate are in AC (reason
   `actuals_on_cancelled_tasks`).
2. **Summary task** (including a task that gained sub-tasks after hours were logged) → its own hours × its own rate roll
   into AC (reason `actuals_on_summary_tasks`). Refusing entries on summary tasks at write was rejected: it would not
   cover entries already stored or a leaf that later becomes a summary, and the workbench write path is outside this fix.
3. Such hours with **no rate** → AC unknown (`hours_without_rate`); with **no currency** → AC unknown for every currency
   of the project (`actuals_currency_unknown` — the money cannot be placed, so no smaller figure is shown); an entry of
   **unknown hours** → AC unknown (`hours_unknown`), never 0 h.
4. The same rule feeds the S-curve AC and the capex/opex split, so the three figures agree. The currency list includes a
   currency that only such tasks carry.
5. Unchanged: when monthly ACTUAL budget periods exist for a currency, they remain the AC source (time entries ignored).

## Consequences
- AC (and CPI, EAC, ETC, VAC, TCPI, % spent) can rise for projects with spent hours on cancelled / summary tasks — that is
  the correction. Per-summary rollup rows (`summaries[]`) still show their leaves only (a display row, not the project AC).
- Rollback: revert the commit (pure module, no schema or data change).
- Tests: `tests/ppm-evm-actuals.test.js` (hand-computed) + existing `tests/ppm-evm*.test.js` green.
