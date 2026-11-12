# F-W1-EVM — earned value engine (PPM parity W1, E-EVM-1)

- Branch `goal/w1-evm` (base `c8f1794`). ADR: `docs/ai-decisions/ADR-W1-EVM-earned-value.md`.
- **Status: built, behind `ppm_evm_enabled` = '0' (404 = today). NOT certified** — Finance has not reviewed a figure.

## What exists
| Piece | File |
|---|---|
| Pure engine (PV time-phasing, 4 EV methods, AC, full index set, rollups per currency, converted view, S-curve) | `services/ppm/evm.js` |
| Store (side table, bulk reads, committee write + `ppm_events` row) | `services/ppm/evmStore.js` |
| Routes `GET /api/governance/ppm/project/:id/evm`, `GET /api/governance/ppm/evm/portfolio`, `PUT /api/governance/ppm/task/:id/evm` | `routes/governanceEvm.js` (registered in `routes/governancePpm.js`) |
| Migration (additive) + manual rollback | `db/postgres/reports/093_ppm_evm.sql`, `db/postgres_rollback/093_ppm_evm_drop.sql` |
| Switches | `ppm_evm_enabled` ('0'), `ppm_evm_fx_rates` ('') in `services/reportConfig.js`; PILOT-PROFILE rows; FLAG-REGISTER + AUTHZ-MATRIX regenerated |

Access: reads = A-15 read scope + money-read rule (committee, admin tier, finance-viewer; others `money_hidden`); the
per-task write = committee (cost is money). `/features` gains `evm`.

## Tests (failing first, then passing)
- `tests/ppm-evm.test.js` (9) — T5 seed: hand-computed reference project (arithmetic in the comments): every indicator,
  every EV method, baseline-phased PV vs the linear-spread counter-example (1 600 vs 1 280), null cases (unknown
  progress, zero divisors, hours without rate, uncosted leaf, missing baseline dates, cancelled task), budget periods as
  PV/AC + forecast EAC, S-curves, summary rollup, CapEx/OpEx, two-currency portfolio, converted view, missing rate.
  **Failing first:** run with `services/ppm/evm.js` absent → `# pass 0 / # fail 1` (module not found); then 9/9.
- `tests/ppm-evm.smoke.test.js` (1) — over HTTP: 404 while off; committee write / 403 / 400 codes; the reference
  project reads as hand-computed; money hidden from a viewer; portfolio per currency; converted only with a table; 3
  ledger rows; no cost leaks through `/api/governance/portfolio`.
- Regression run: all `ppm-*`, `portfolio-*`, `governance-*`, `project-*` files + flag-register, authz-route-matrix,
  server-size-budget, error-shape, await-precedence, pg-migrate*, ui-design-ratchet, a11y-legacy-ratchet, readme-truth
  → **304 pass / 0 fail / 0 skipped**; test-runner-guard + readme-truth 17/17. ESLint clean on touched files.

## W0 rows addressed
E1 (time-phased PV from baseline) · E2 (EV methods) · E3 (AC from actuals: periods or costed hours) · E4 (PV EV AC SV CV
SPI CPI) · E5 (EAC/ETC/VAC/TCPI) · E6 (null-aware rollups leaf→portfolio, EVM part only — `portfolioEvidence.js` is
W1-INTEGRITY's) · E7 (CapEx/OpEx amount split per task) · E9 (converted view with an explicit rate table) · E10 (S-curve
series in the API). Still open: E8 (resource / fixed cost lines, rate table A–E → W2), the S-curve **chart** on
`project.html` (UI left to W3 to avoid colliding with W1-ENGINE's concurrent Gantt edits).

## Deviations
- Fields live in a side table, not `ADD COLUMN` on `portfolio_tasks` (money leak through `SELECT *`; ADR §6).
- A committee-only PUT was added beside the read-only routes: without it the fields could not be set.
- No UI panel (see above).

## Human decisions needed
Arm `ppm_evm_enabled` (PMO + Finance) · hourly rates per task (Finance input) · the FX table if a converted total is
wanted · a Finance verifier to certify figures (until then "non certifié") · confirm EAC default = BAC/CPI.
