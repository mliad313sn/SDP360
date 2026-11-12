# E-W2-PPM — evidence (plan E wave 2, bundle W2-PPM)

Goals: E-P03, E-P04, E-P05, E-P06, E-P08 (E-P07 is covered by E-I04, merged in wave 1 — not redone).
Migrations used: **072** (`ppm_budget_periods` + `portfolio_benefits.owner_user_id`), **073** (`ppm_raci`, `ppm_templates`).
Every behaviour change sits behind a PROPOSED `report_config` switch whose default `'0'` is today's behaviour, with a
PILOT-PROFILE row and a regenerated FLAG-REGISTER. One defect ships ON: the task-reassignment trace (X-P-01).
New routes live in `routes/governancePpm.js`, registered on the governance router with the SAME helpers (committee,
money-read rule, A-15 read scope, plan-write rule) — no new mount in `server.js`; `server.js`, `reports-db.js` and
`public/reports.html` are untouched.

| Goal / audit action | Verdict | What changed | Test proof |
|---|---|---|---|
| E-P03 — capacity roll-up per site × week (audit P-03) | FIXED (shadow) | `ppmVisuals.capacityBySite` (sum of people's known peaks, unknown ≠ 0, a week with only unknown = null) + `GET /api/governance/ppm/capacity` (404 while `ppm_capacity_view`='0', no money) + panel on `portfolio.html` | `ppm-capacity.test.js` (5), `ppm-w2.smoke` E-P03 |
| E-P03 — sorted conflicts list + proposal (audit P-03) | FIXED (shadow) | `capacityConflicts`: consecutive weeks > 100 % merged, sorted by excess then duration; suggestion = "Proposal only" text, nobody reassigned | `ppm-capacity.test.js` |
| E-P03 — reassignment trace (X-P-01) | FIXED (ON) | a task owner change writes `task_reassigned` (old, new, actor, reason) in the hash-chained `ppm_events`; reason REQUIRED while the switch is on (project.html prompts) | `pg-ppm-w2-store` E-P03, `ppm-w2.smoke` |
| E-P03 — capacity data contract (prep I-05) | PARTIAL | `docs/ops/CAPACITY-DATA-CONTRACT.md` (DRAFT; HR data is not a source) | `ppm-capacity.test.js` (doc check) |
| E-P04 — budget periods baseline / actual / forecast / EAC (audit P-04) | FIXED (shadow, structure) | migration 072, `services/ppmBudgetPeriods.js` (EAC per currency, never across currencies, missing = null, "not certified"), store upsert with JUSTIFICATION_REQUIRED, every write hash-chained, `GET/PUT /api/governance/ppm/project/:id/budget-periods` (money readers read, committee writes, others get no amounts), Budget tab on `project.html` (`ppm_budget_periods_enabled`) | `ppm-budget-periods.test.js` (5), `pg-ppm-w2-store` E-P04, `ppm-w2.smoke` E-P04 |
| E-P05 — benefit owner linked to a user (audit P-05) | FIXED (shadow) | `owner_user_id` (072; free-text owner kept, ignored by the route while `benefit_owner_link_enabled`='0'); SELF_REVIEW also refuses the linked owner; "My work" `owned_benefits` block (absent while off, null on reader failure); picker on project.html, block on home | `benefit-owner-link.test.js` (3), `pg-ppm-w2-store` E-P05, `ppm-w2.smoke` E-P05 |
| E-P06 — RACI per project (audit P-06) | FIXED (shadow) | migration 073, `services/ppmRaci.js` (exactly one A per task, letters R/A/C/I, CSV with formula guard), RACI tab + CSV export on project.html (`ppm_raci_enabled`); writes follow the plan-write rule; `raci_edit` ledger row | `ppm-raci-templates.test.js` (5), `pg-ppm-w2-store` E-P06, `ppm-w2.smoke` E-P06 |
| E-P06 — project templates (audit P-06) | FIXED (shadow) | structure only (no people, dates, money), `draft` until another committee member approves (SELF_REVIEW for the author; act recorded in `ppm_events`); only an approved template creates a project; save on project.html, list/approve/create on portfolio.html (`ppm_templates_enabled`) | same |
| E-P08 — R16 annual planning DRAFT pack (audit P-08) | PARTIAL (catalogue R16 missing → partial) | `services/annualPlanPack.js` + `GET /api/governance/ppm/annual-pack.xlsx?year=` (`ppm_annual_pack_enabled`): every sheet "DRAFT — not approved", per-currency budget roll-up under the money rule, envelope UNKNOWN, capacity summary, provisional RFI scores (committee only); R16 updated + catalogue doc regenerated | `annual-plan-pack.test.js` (4), `ppm-w2.smoke` E-P08, `report-catalogue.test.js` |

## Tests run (PostgreSQL 16, local throwaway DBs)

New/changed files plus neighbours: **212 tests, 212 pass, 0 fail, 0 skipped** (ppm-capacity, ppm-budget-periods,
benefit-owner-link, ppm-raci-templates, annual-plan-pack, pg-ppm-w2-store, ppm-w2.smoke, project-page, ppm-visuals,
governance-routes.smoke, portfolio-benefits(.smoke), ppm-project-lifecycle.smoke, my-work(-route.smoke),
soft-delete-portfolio, governance-store, pg-governance-store, ppm-baselines.smoke, portfolio-deck,
portfolio-site-scope.smoke, report-catalogue, catalogue-dry-run, agent-inventory, flag-register, readme-truth,
ui-design-ratchet, error-shape (ratchet unchanged at 446 — no new `res.status().json`), i18n-coverage,
authz-route-matrix, server-size-budget, await-precedence, pg-migrate). Generated docs regenerated: FLAG-REGISTER,
AUTHZ-MATRIX, CHART-INVENTORY, REPORT-ALERT-CATALOGUE, INVENTORY.

## Deviations

- The goal text asks to "extend the lifecycle smoke" for E-P04: a dedicated smoke (`tests/ppm-w2.smoke.test.js`) covers
  all five goals over HTTP with fictitious figures instead, so the existing witness smoke stays as it is.
- The reassignment trace is written whatever the switch (a missing audit trail is a defect); only the "reason
  required" part is behind `ppm_capacity_view`.
- Template approval adds a four-eyes rule (the author cannot approve) — not asked, consistent with SELF_REVIEW elsewhere.
- Fiscal year of the annual pack = calendar year (stated in the pack's About sheet) until Finance confirms.
- `project.html` gained two hidden tabs; `tests/project-page.test.js` now counts 8 visible tabs + the hidden add-ons.

## Left for a person

- Capacity owner to be named; what "availability" means for a team (I-05) — sign or rewrite the DRAFT contract.
- Finance: certify budget-period figures (every view says "not certified"), decide who approves budgets, enter envelopes,
  confirm the fiscal year; committee: arbitration of the annual plan.
- PMO: who validates templates; whether RACI becomes mandatory for some projects.
- Browser check of the new tabs/panels with each switch on (static tests cannot prove rendering).
- French entries for `project.html` remain pending as before (page is on the i18n allow-list).
