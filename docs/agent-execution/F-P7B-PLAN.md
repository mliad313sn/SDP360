# F-P7B-PLAN — goals B4 (sites maintain their own plan) and B5 (actuals & scope control)

Branch `goal/p7b-plan` (from `16a208b`). Not pushed, not merged, not deployed. ADR:
`docs/ai-decisions/ADR-P7B-timesheets-cr-simulation.md`. Every new behaviour is behind a switch whose default is
today's behaviour (`stale_plan_days` = '', `ppm_timesheet_approval_enabled` = '0', `ppm_cr_simulation_enabled` = '0');
each has a `reportConfig.DEFAULTS` entry and a `docs/ops/pilot/PILOT-PROFILE.md` row (FLAG-REGISTER regenerated).

## Built, clause by clause
| Clause | Where | Proof |
|---|---|---|
| B4 "Plan updated X days ago" (API + page), null = unknown | `services/ppm/planFreshness.js` (latest of `ppm_events` for the project AND the plan rows' `updated_at` — task edits write no ledger row, see ADR §1); `GET /api/governance/portfolio/project/:id` → `plan_freshness`; Overview tile "Plan freshness" in `public/project.html` | `ppm-p7b-pure` #5, `ppm-p7b.smoke` B4 (0 d on a fresh project, 60 d on a backdated one) |
| B4 stale-plan rule → nudges via the existing alerts path | `stale_plan` kind in `services/ppmAlerts.findExceptions` (in_progress only, unknown never stale, off while `stale_plan_days` = ''); `/api/governance/portfolio/exceptions` + `tools/governance/ppm-alerts.js` (owner + committee in-app, dedup, armed by `ppm_alerts_enabled`, silenced by `notifications_stop`) | `ppm-p7b-pure` #5, `ppm-p7b.smoke` B4 (route + nightly dry run) |
| B4 cross-site write rejection, baseline immutability stay green | unchanged | `portfolio-site-scope.smoke`, `ppm-baselines.smoke` green in the neighbour run |
| B5 timesheet week submit → approve / reject, states draft/submitted/approved/rejected | migration `102` table `ppm_timesheet_weeks`; pure `services/ppm/timesheets.js`; store `ppmWorkbenchStore.timesheetView/transitionTimesheet`; routes `GET/POST /api/governance/ppm/project/:id/timesheets[/:action]`; Plan-tab panel | `ppm-p7b-pure` #1-2, `ppm-p7b.smoke` B5 timesheets |
| B5 SoD: approver ≠ entrant, server-side 403 | `tsTransition` — entrants = submitter, the person (linked account), every recorder of the week | smoke: submitter 403 `SELF_REVIEW`, recorder 403, finance (no plan write) 403, cross-site editor refused, same-site editor OK when editor writes are on |
| B5 approved weeks frozen | `addTimeEntry/removeTimeEntry` with `timesheetLock` (409 `WEEK_FROZEN` for submitted / approved; rejected reopens) | smoke: add + delete refused, another person's week not frozen, rejected week editable, switch off = today |
| B5 CR schedule impact simulated BEFORE approval (W1 date engine) | pure `services/ppm/crSimulation.js` (engine run on plan and on a copy; finish, working-day delta, critical path, moved tasks, deadline, cycle refused); CR `task_changes` + stored `simulation_json`; assess / approve re-simulate on the CURRENT plan; `POST …/changes/:cid/simulate`; impact column on the Changes tab | `ppm-p7b-pure` #3 (hand-computed network: 11-12 → 11-16, +4 cal / +2 working days, path 1-2-4 → 1-3-4), smoke CR (same numbers over HTTP; approve re-simulated after a plan edit → delta 0) |
| B5 cost impact via EVM data, null when unknown | Δ effort × `ppm_task_evm.cost_rate` per currency; recalc W = D × U × h/day; unknown effort / no rate → reason, never 0; money-read rule (non-money readers see `{money_hidden:true}`) | pure #3-4 (1 200 USD, partly_unknown), smoke (editor sees schedule but no cost) |
| B5 approved CR → versioned baseline via existing rebaseline path | `transitionChangeRequest` apply: typed dates impact, else simulated finish delta → `gov.rebaseline` | smoke: version +1, baseline end 11-12 → 11-14 |
| B5 CR without approval never alters the baseline | unchanged order rule + proof | smoke: apply refused while proposed / assessed, self-approve 403, approved-not-applied → versions and baseline end unchanged |

## Tests run
- New: `tests/ppm-p7b-pure.test.js` (5), `tests/ppm-p7b.smoke.test.js` (3) — green; added to `tests/.suite-manifest.json`.
- Neighbours (84 files: ppm*, project*, portfolio*, governance*, authz-*, rbac-*, i18n-coverage, flag-register,
  inventory-strict, await-precedence, server-size-budget, cross-site*, pg-ppm*, report-config*, demo-seed): 499 tests,
  494 pass; the 5 failures were the committed artefacts before regeneration (authz-matrix.json, FLAG-REGISTER,
  INVENTORY-STRICT) and the rbac-mutation residue check that compares with authz-matrix.json. After regeneration the
  five files re-run 24/24 green. `ppm-rollback-scripts` covers migration 102 (forward/rollback round trip).
- eslint clean on the changed server files (`public/lib` is lint-ignored by config).
- `public/project.html` stays on the i18n UNTRANSLATED list ("French pending") — no French dictionary exists for it, so no
  entries were added; the new strings are English like the rest of the page.

## Left / not done
- Apply does NOT write the CR's task changes into the live plan (ADR §4) — the planner applies them through the normal
  plan write path. Budget impact is still not baselined (unchanged from R2-WB-01).
- No browser E2E (pages behind a session login) — UI logic is the pure helpers in `public/lib/ppmWorkbench.js`, tested.
- GAP-MATRIX rows B4/B5 not edited here (shared document; update at merge).

## Human decisions (not taken here)
- Arm the three switches (PMO); the staleness threshold (`stale_plan_days`, no value proposed); the timesheet approver
  policy (PROPOSED: the project's plan-write rule or the committee); whether simulated cost figures may be shown before
  Finance certifies the hourly rates (they are labelled non certifié).
