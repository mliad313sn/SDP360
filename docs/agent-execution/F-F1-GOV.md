# Plan F — bundle F1-GOV (governance decisions, departments, My work, pilot tools)

Branch `goal/f1-gov` (from `sdp-waves`). Goals in order: F-PRODUCT-06, F-PRODUCT-05, F-PRODUCT-07, F-PRODUCT-08
(prompts: `docs/audits/2026-11-12-enterprise-review/PANEL-PRODUCT.md`). Engineering evidence only: nothing here is an
approval, a field acceptance or a production-readiness statement. Every new behaviour is behind a `report_config`
switch whose default is today's behaviour; no switch was turned on.

## Verdicts

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| F-PRODUCT-06 — decision register lifecycle (N6, E08) | FIXED (rule PROPOSED, switch `decision_lifecycle_enforced` = `0`) | `services/decisionLifecycle.js` (pure table); `governanceStore.updateDecision` validates through it, guards the move on the status it read, and writes a hash-chained `ppm_events` row (entity `decision`: old / new / actor / reason) on every status change, switch on or off; `GET /api/governance/decisions/:id/history`; cockpit asks for a reason when the server requires one. At `1`: a site moves `open` ↔ `in_progress`, its `done` is stored as `awaiting_confirmation`, the committee confirms; cancel / reopen / send-back need a reason; an illegal jump answers 409 | `tests/decision-lifecycle.test.js` (6), `tests/governance-routes.smoke.test.js` "decision lifecycle…" (off = unchanged; on = 409 `ILLEGAL_TRANSITION`, 403 for the site, 400 without a reason, history rows, hash present) |
| F-PRODUCT-05 — department crosswalk (N9) | FIXED for the data layer, list and tool; PARTIAL for the admin screen | migration `082_department_crosswalk.sql` (five exact pairs `proposed`; every other value listed alone, `unmapped`); `services/departmentCrosswalk.js` (pure) + `services/departmentCrosswalkStore.js` (readers); `tools/governance/department-crosswalk.js --check [--json] [--strict]`; `GET /api/governance/department-crosswalk` (admin, read-only, no write route); `GET /api/governance/department-rollup` behind `department_rollup_enabled` (`0` = 404) | `tests/department-crosswalk.test.js` (6: exact pairs only, Process / Mill / Processing not merged, unmapped counted, seed on PostgreSQL, `--check` on PostgreSQL, nothing written), `tests/governance-routes.smoke.test.js` "department crosswalk…" |
| F-PRODUCT-07 — "Awaiting me" in My work (C22 / N11) | FIXED (build), switch `mywork_awaiting_me_enabled` = `0`; comparison with the review.1 queue = person | `services/myWork.buildAwaitingMe` (pure, five sources, null-not-0, separation of duties); readers in `routes/myWork.js` reuse each module's scope; Home shows the block (EN / FR) only when the answer carries it | `tests/my-work.test.js` (+5), `tests/my-work-route.smoke.test.js` (+1: off = answer unchanged; on = scoped, own work excluded, modules off = "not measured") |
| F-PRODUCT-08 — observed-evidence aggregator (N10, E09) | FIXED (offline tool, no switch) | `services/pilotObserved.js` (pure) + `tools/pilot/pilot-observed.js --sheets=DIR`; `docs/ops/pilot/SUS-SHEET.csv` template; `PILOT-MEASUREMENT.md` §5–6 | `tests/pilot-observed.test.js` (6: blank ≠ 0, unpaired excluded and counted, SUS formula, n < 3, CSV injection, wrong file refused, committed templates parse) |

## Tests run (PostgreSQL 16 local, focused set — not the full suite)

- The six files of this bundle: 55 tests, 55 pass.
- With neighbours (74 files: governance, obligations, commitments, handoffs, pilot metrics, benefits, home, migrations
  `pg-migrate*`, `db-schema-smoke`, `flag-register`, `server-size-budget`, `authz-route-matrix`, `error-shape`,
  `ui-design-ratchet`, `readme-truth`, `i18n-coverage`, `await-precedence`, `kpi-docs-links`, `agent-inventory`…):
  **437 tests, 437 pass, 0 fail, 0 skipped**.
- `npx eslint` clean on every touched `.js` (`public/lib/home-page.js` is in the lint ignore list; parsed with `new Function`).
- `tests/.suite-manifest.json`: +3 files (`decision-lifecycle` 6, `department-crosswalk` 6, `pilot-observed` 6),
  `governance-routes.smoke` 9 → 11, `my-work` 10 → 15, `my-work-route.smoke` 6 → 7; total 4491 → 4517.
- Regenerated, not hand-edited: `docs/ops/FLAG-REGISTER.md`, `docs/ops/AUTHZ-MATRIX.md` (METRIC-WIDGET-MAP and
  METRIC-LINEAGE unchanged). `docs/agent-execution/INVENTORY.*` was regenerated in the worktree but is NOT committed
  (the machine's disk filled up before the last commit); it is regenerated at merge.

No existing test had to be changed: the two existing decision assertions (`editor` sets `done`, committee sets `done`)
still pass with the switch off.

## Deviations from the goal text

1. **F-PRODUCT-06 — "reopened" is not a new status.** The goal lists `done → reopened`; the guardrail says existing
   statuses are kept. Reopening is `done → open` (and `cancelled → open`), committee only, with a reason; the ledger
   row carries it. The only added status is `awaiting_confirmation`, reachable only while the switch is on.
2. **F-PRODUCT-06 — the ledger is written with the switch off too** (a history is not a behaviour change for the user).
3. **F-PRODUCT-06 — reading the history**: the committee reads any decision; anyone else only a decision they already
   see in the list (another site gets 404).
4. **F-PRODUCT-05 — admin view = API only.** The list is served by `GET /api/governance/department-crosswalk`; the
   admin card would live in `public/reports.html`, which no bundle of this wave may edit except F2-UX. Deferred.
5. **F-PRODUCT-05 — roll-up is one committee endpoint**, not a regrouping of the Obligations and Insights pages (the
   goal says "may group"). It counts all stored records per department (commitments, handoffs from / to, report
   actions, PV issues), fleet-wide, not only open ones.
6. **F-PRODUCT-05 — the seed also lists the values that have no pair** (10 meeting codes, 5 action names) as
   `unmapped`, so the list is complete. A CHECK refuses a one-sided row marked as a pair.
7. **F-PRODUCT-07 — benefits**: "eligible" = committee (today's rule for verifying a benefit) minus the entrant, the
   linked owner and the free-text owner. If F-PRODUCT-04 (bundle F1-PPM) changes who may verify, this reader must follow.
8. **F-PRODUCT-07 — commitments and handoffs appear as "not measured" while `commitments_enabled` / `handoffs_enabled`
   are `0`** (the module is off, so nothing is read).
9. **F-PRODUCT-07 — `public/lib/home-page.js` was edited** (one block, EN / FR). "Home" is listed under F2-UX, a later
   wave; the edit is additive and inert while the switch is off.
10. **F-PRODUCT-08 — SUS has no sheet in the kit** (`SUS-FORM.md` is a paper form): `SUS-SHEET.csv` was added
    (participant code + `q1`…`q10`).
11. **Migration 083 is not used** (the decision status column has no CHECK constraint, so the new status needs no migration).
12. **Commit footer**: the session's attribution lines were used on the goal commits.

## Left for a person

| Item | Who |
|---|---|
| Accept or change the decision rule (who closes, who reopens, whether a site may propose completion), then set `decision_lifecycle_enforced` | Governance committee chair |
| Review the five proposed pairs; decide every other pair (Process / Mill / Processing, HR / Human Resource, Technical Service, Social performance, General Manager, HSE, Geology, Survey, Exploration…); there is deliberately no screen or route to approve a pair — approval needs a decision on how it is recorded | HR / department heads + Group IT |
| Run `node tools/governance/department-crosswalk.js --check` on the real database and read the unmapped values (commitments' department is free text) | Group IT |
| Department attribute on users (Department Member persona) — not built, needs an HR / IAM decision | HR + IAM |
| Compare "Awaiting me" with the review.1 validation queue (artifact not in this repository) before turning `mywork_awaiting_me_enabled` on — one queue, not two | Product owner |
| Browser check of the cockpit reason prompt and of the Home block (not run here: pages sit behind a session) | Tester on the TEST instance |
| Fill the sheets with real observations and run `pilot-observed`; decide scale / adjust / stop | Product owner + sponsor |
| Admin card for the crosswalk list in `reports.html` | F2-UX or a later wave |
