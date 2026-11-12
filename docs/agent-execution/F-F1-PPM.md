# Plan F — bundle F1-PPM (evidence)

Branch `goal/f1-ppm` (from `sdp-waves` @ `722818b`). Goals, in order: F-PRODUCT-01, F-PRODUCT-02, F-PRODUCT-09,
F-PRODUCT-03 (+ F-DATA-09, one implementation), F-PRODUCT-04, F-DATA-10. Migrations used: **080, 081** only.
Fictitious data in every test. Nothing here is an approval, a certification or a production-readiness statement.

## Verdict table

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| F-PRODUCT-01 — one allocation contract (E07; C1–C3, N1) | **FIXED** (defect, active) | `public/lib/allocationContract.js` (UMD, pure) is the only reader of `allocation_pct`: null / '' / omitted / non-numeric = unknown; 0–100 = known; outside = invalid (never summed, listed); done / cancelled / no owner / no dates = excluded. `projectSchedule.resourceConflicts` and `ppmVisuals.resourcePressure` / `capacityBySite` (W2-PPM capacity view) call it. Portfolio, scoped portfolio and project answers add `resource_coverage` (counts + possible conflicts) next to `resource_conflicts` (shape unchanged) | `tests/allocation-contract.test.js` (13: the 7 cases server = page), `tests/ppm-visuals.test.js` (parity extended to unknown / omitted / '' / 0 / legacy), `tests/ppm-capacity.test.js` (6), `tests/project-schedule.test.js`, `tests/ppm-project-lifecycle.smoke.test.js` |
| F-PRODUCT-02 — capacity parity on tile, alerts, workbook (N2, N3, N4) | **FIXED** (defect, active; notification still behind `ppm_alerts_enabled`) | Portfolio tile reads `resource_coverage`: "none known · N unknown", number "—", never "0 — none"; conflict panels (portfolio + project) list coverage and possible conflicts. `capacity_overload` is fed by the exception queue and by `tools/governance/ppm-alerts.js`. Workbook: Tasks sheet has `allocation_pct` / `effort_hours` (unknown = empty cell), new `Capacity` sheet (coverage, conflicts, possible conflicts; no money) | `tests/portfolio-capacity-parity.test.js` (3: tile = queue = workbook), `tests/portfolio-deck.test.js`, `tests/ppm-alerts.test.js`, `tests/ppm-alerts-cli.test.js` |
| F-PRODUCT-09 — allocation-unspecified convention (N5) | **FIXED behind `ppm_alloc_unspecified`** (`full_time` = today) | `unknown` = a NEW task created without `allocation_pct` stores NULL (also for a project created from a template). Migration 080: range CHECK, NOT VALID. `tools/governance/alloc-audit.js` (read-only) | `tests/pg-alloc-unspecified.test.js` (5) |
| F-PRODUCT-03 + F-DATA-09 — benefit value class, basis, measurement window (N8, C12, C14) | **FIXED behind `benefit_value_class_enabled`** (`0` = today's form, fields ignored) | Migration 081 (additive columns). `services/portfolioBenefits.js`: `evidenceLevel`, `measurementClass` (estimated / observed / validated), `verificationIndependent`, `classProblem`, `benefitTotals` (per class and currency / unit, never across). Project page: separate columns + totals table; workbook Benefits sheet: class columns, no total row | `tests/portfolio-benefits.test.js` (11), `tests/portfolio-benefits.smoke.test.js`, `tests/portfolio-deck.test.js` |
| F-PRODUCT-04 — Finance-side verifier for money benefits (N7) | **FIXED behind `benefit_money_verifier_role`** (empty = today). PROPOSED policy | With a role name set, a money benefit is verified only by a holder of that role (held exactly), not the entrant, not the linked owner; refusal `VERIFIER_ROLE`. The role required is stamped (`verifier_role_required`) and written in the ledger note; cleared with the verification. The page says who may verify. No role is granted | `tests/portfolio-benefits.smoke.test.js` (role test), `tests/capability-registry.test.js` green, `tests/authz-route-matrix.test.js` green |
| F-DATA-10 — Finance currency: no silent default (N11) | **FIXED** (visibility active) + refusal **behind `finance_currency_required`** (`0`) | A project amount written with no stated currency is flagged (`currency_defaulted`, migration 081), noted `currency_defaulted=true` in `ppm_events`, answered with a warning; pages and workbook say "default, not confirmed". Money benefit without a currency: warning `CURRENCY_MISSING`. At `1` both are refused (`CURRENCY_REQUIRED`). `docs/ops/FINANCE-CURRENCY-RULES.md` | `tests/portfolio-finance-currency.smoke.test.js` (7, incl. the doc link test) |

Final focused run (touched files + neighbours: allocation, ppm-*, portfolio-*, governance-*, my-work, obligations,
annual pack, flag register, server size budget, authz matrix, error shape, UI ratchet, i18n coverage, KPI doc
links, readme truth, capability registry, inventory, await-precedence): **386 tests, 386 pass, 0 fail, 0 skipped**.
`tests/.suite-manifest.json` total 4491 → 4529. Error-shape ratchet unchanged (no new `res.status(4xx).json`);
`server.js` not edited; no hex colour added.

## Visible changes that ship ON (defects)

- Conflict counts can **drop**: a task with an omitted allocation was counted as 100 % by the server (60 % + omitted
  = a 160 % conflict). It is now "unknown" and listed as a possible conflict.
- A legacy allocation above 100 % or below 0 is no longer summed on the pages (it used to push or reduce the peak);
  it is counted "invalid" and named.
- The A11 exception queue (cockpit) and the workbook now contain over-allocation lines.
- The workbook has an eighth sheet (`Capacity`) and two more columns in `Tasks`; with money, `Projects` has
  `currency_status`.
- A project write with an amount and no currency returns `warnings` in its answer.

## Existing tests changed (behaviour they pinned moved)

- `tests/ppm-capacity.test.js`, `tests/ppm-visuals.test.js`: fixtures used a single task at 150 % / 120 % as "over".
  Under the contract that value is invalid, so they now use two known tasks; an explicit invalid case was added.
- `tests/portfolio-deck.test.js`, `tests/ppm-baselines.smoke.test.js`: sheet list 7 → 8 (`Capacity`).

## Deviations from the goal texts

1. **Migration 080 adds the CHECK only when no out-of-range row exists.** The goal asked for an unconditional
   `NOT VALID` constraint. PostgreSQL evaluates a CHECK on every UPDATE of a row, so a legacy task at 150 % would have
   refused any later edit (status, owner, soft delete). The migrator runs a file once: on such a database the
   constraint is absent; `alloc-audit.js` lists the rows, says so and prints the statement to run after correction.
2. **F-PRODUCT-03 and F-DATA-09 merged**: one switch (`benefit_value_class_enabled`), one period pair
   (`measured_from` / `measured_to`) plus the baseline period; `verifier_role_required` is **stamped at verification**
   from `benefit_money_verifier_role`, not typed per benefit (nobody enters a verifier policy on a row).
3. **Possible conflicts** also cover two overlapping tasks that are both unknown (`known_peak_pct` null) and list
   invalid tasks separately (`invalid_task_ids`) — an extension of the shape in the goal.
4. **F-PRODUCT-04**: with the role set, the role holder verifies a money benefit without the plan-write right (the
   role is the entitlement for that one act, nothing else). The role is matched exactly; the admin tier does not
   imply it. A role name nobody holds blocks money verification (fail closed).
5. **F-DATA-10** needed a column (`portfolio_projects.currency_defaulted`): it is in migration 081, renamed
   `081_benefit_class_and_currency_flag.sql` (same number). Rows written before it stay NULL = not known.
6. `routes/governance.js` was edited (the goal texts name it) on the portfolio / benefit lines only; `server.js`,
   `reports-db.js`, `public/reports.html` untouched.
7. Commit footer follows the session's attribution instruction (it differs from the one in the worker notes).

## Incident during the run

The shared volume reached its quota while goal 6 was being written (about 1 470 leftover test databases, 24 GB in
the PostgreSQL data directory). Three files of this branch were truncated to 0 bytes (`FLAG-REGISTER.md`, the currency
doc, the new smoke test); they were rewritten and re-verified after space came back. Nothing was deleted by this
bundle. The leftover test databases are worth a sweep (`tools/test/drop-test-dbs.js`) before the full suite.

## Left for a person

| Item | Owner role |
|---|---|
| Convention for an unspecified allocation (`ppm_alloc_unspecified`), and what capacity means per person / team | PMO lead |
| Run `node tools/governance/alloc-audit.js` on the real database; correct out-of-range rows; add the CHECK if the tool says it is absent | PMO + DBA |
| Value classes accepted at a benefits review; turning `benefit_value_class_enabled` on | Finance + executive sponsor |
| Who certifies a money benefit (`benefit_money_verifier_role`), method, period, perimeter | Finance controller |
| Whether a currency is mandatory (`finance_currency_required`); review of projects shown "default, not confirmed" and of rows written before the flag | Finance controller |
| Arming `ppm_alerts_enabled` now that over-allocation reaches the queue | Committee |
| Browser check of the portfolio tile, the project benefit tab and the conflict panels (pages sit behind a login) | Product owner |
| French entries if the new portfolio wording must be translated (texts are built at run time, outside the coverage check) | Product owner |
| Stable person identity for PPM owners (conflicts still key on the owner text) | IAM + PMO |
