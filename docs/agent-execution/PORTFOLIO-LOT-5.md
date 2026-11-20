# PORTFOLIO LOT 5 — extended lifecycle, review workflow, role catalogue, field audit, business-case freeze (evidence)

> **AI evidence.** Author: Claude (AI). Reviews here are AI self-review, not an independent review, not a PMO or
> security sign-off. Nothing in this lot is approved policy: the lifecycle mapping, review steps and their role slots,
> the frozen field list and the role catalogue are PROPOSED. Nothing here approves, signs or moves a project by itself.

- **Scope:** IT portfolio reconstruction spec §15, §26, §27, §28 — Lot 5 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md`
  (MVP field audit + Phase 2 approval workflow). Lot 4 (decision agenda, alerts) is NOT here.
- **Branch:** `feat/portfolio-lot5` (worktree `/home/user/w/portfolio-lot5`). Not pushed, not merged.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT5-lifecycle-review-audit.md`.
- **Switches** (report_config, PROPOSED, default `'0'` = today), added to lot **L14** (`docs/ops/switch-lots.json`; L14
  reaches 10 = `max_lot_size` once Lot 4's two switches merge), catalogued in `docs/ops/policy-catalogue.json`, rows in
  `docs/ops/pilot/PILOT-PROFILE.md`:
  `ppm_field_audit_enabled` (low) · `ppm_extended_lifecycle_enabled` (medium) · `ppm_review_workflow_enabled` (high,
  **four_eyes: true** — it gates approvals) · `ppm_business_case_freeze_enabled` (medium).
  Contributor project creation (`portfolio_contributor_create` in the gap note) is **not built** — access-policy owner decision.
- **Migration:** `db/postgres/reports/125_ppm_lifecycle_audit.sql` (additive: `portfolio_projects.created_by`,
  `updated_by`; `ppm_gate_checklists.gate_to` CHECK widened to the 13 stages). Manual rollback
  `db/postgres_rollback/125_ppm_lifecycle_audit_drop.sql`, listed in `tests/ppm-rollback-scripts.test.js`.
  **No new audit table**: every review action / field change / frozen-field change is a row of the existing
  hash-chained append-only `ppm_events` ledger (already in `tools/pg/harden-audit-grants.sql`).

## What was built

| Item | Where |
|---|---|
| Extended stages + gates (`EXT_STAGES`, `EXT_GATES`, `STATUS_FOR`, `DRAFT_STAGES`, `APPROVED_STAGES`, `needsReason`, `gatesFor`, `stagesFor`); `stageGate(…, {extended})` | `services/projectSchedule.js` |
| Pure review rules: `selfApprovalRefusal` (id + `skeletonKey` on requester / owner / sponsor, unknown requester refused), `reviewTemplate` (6 steps as one W3 checklist, role slots), `ROLE_CATALOGUE` (§27 → existing roles + project roles), `FROZEN_FIELDS` + `freezeRefusal`, `reviewState` from ledger rows, input normalisers | `services/ppm/reviewWorkflow.js` |
| Review I/O over `ppm_events` + `approverProvenance.checkIndependent` (fail closed) | `services/ppm/reviewStore.js` |
| Routes: `GET …/project/:id/review`, `POST …/review/{assign,request-info,respond,return,apply-template}`, `GET /api/governance/portfolio/roles-catalogue` (404 while the switch is off) | `routes/governanceReview.js`, 1 line in `routes/governance.js` |
| Stage route: extended gates, review decision refusal (also in the dry run), `updated_by` stamp | `routes/governance.js` |
| W3 checklists: extended stages are gates only with the lifecycle switch; approval sign-off refused to the requester / owner / sponsor / non-independent approver with the review switch | `routes/governanceW3.js`, `services/ppm/gateChecklist.js` (`EXT_STAGES`), `services/ppm/governanceW3Store.js` |
| Store: field audit (`field_edit` row per changed field not already audited), `created_by` / `updated_by`, business-case freeze (409 `BUSINESS_CASE_FROZEN` unless an approved / applied change request of the project is named), new projects start as `idea` with the lifecycle switch, extended stages in the owner / sponsor / status / baseline rules | `services/governanceStore.js` |
| Feature flags `extended_lifecycle`, `review_workflow`, `field_audit`, `business_case_freeze` | `routes/governancePpm.js` |
| Review panel on the Gates tab (EN/FR table, no inline script, labelled controls, escaped text, actions only when the server allows) | `public/lib/ppmReview.js`, 3 lines in `public/project.html` |

## Invariants and how they are tested

| Invariant | Test |
|---|---|
| Switch OFF = today (routes 404, six stages, no `field_edit`, no `created_by`, sponsor may still approve, no freeze, flags false) | smoke 1 |
| Every new gate negative: order, terminal exits, reasons on exits / backward moves, IT owner, charter, sponsor + baseline, owner ≠ decider, sponsor ≠ decider, open tasks at handover / closure, open high risks at closed | pure 2–6, smoke 3 |
| Self-approval refused: same id, identity skeleton (accent, case, Cyrillic confusable), owner, sponsor; unknown requester refused | pure 8–9 |
| No approval without an independent real signer: requester refused (stage move + dry run + W3 sign-off), fresh account of unknown provenance refused, independent approver with a named creator in the identity journal accepted, legacy project with no recorded requester refused | smoke 6–7 |
| Reviewer independence: owner / requester cannot be assigned; viewer cannot assign; only an assigned reviewer / committee asks; only owner / committee answers; one answer per request | smoke 5 |
| Field audit: one row per changed field with old / new / actor; unchanged field not logged; owner keeps its role_edit row | smoke 2 |
| Frozen business case: 409 after approval, free before; other fields editable; same value not a change; proposed CR refused; approved CR accepted + ledger row | pure 10, smoke 8 |
| Extended stages are checklist gates only while the switch is on (6 vs 13 gates) | smoke 4 |
| Panel: strict-CSP shape, labelled controls, EN = FR keys, escaping, no action without the right | page 1–4 |

TDD note (honest): the pure and smoke tests were written before the route wiring; a mutation check (the review
decision guard disabled) turned smoke tests 6 and 7 red, restored green after.

## Tests run (targeted; full suite NOT run)

| Run | Result |
|---|---|
| `portfolio-lot5-pure` (12, new), `portfolio-lot5-page` (4, new), `portfolio-lot5.smoke` (8, new) | 24 pass |
| Batch of 58 files: the new ones + a11y-legacy-ratchet, a11y-static, agent-inventory, audit-grants-rehearsal, authz-enforce, authz-handler-checks, await-precedence, capability-registry, commitment-lifecycle, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-strict-pages-config, csv-guard-coverage, error-shape, flag-register, governance-routes.smoke, i18n-coverage, inventory-reachability, inventory-strict, kpi-unknown-sweep, limit-clamp, monolith-ratchet, pg-migrate, pg-migrate-changed, pg-migrate-destructive, policy-center-catalogue, policy-center-four-eyes-direction, portfolio-access, portfolio-access-parity.smoke, portfolio-site-scope.smoke, portfolio-register.smoke, ppm-rollback-scripts, readme-truth, report-config, server-size-budget, simplicity-budget, soft-delete-readers, switch-lots, switch-lots-rollback, test-runner-guard, ui-design-ratchet, ppm-w3-pure, ppm-w3.smoke, ppm-project-lifecycle.smoke, ppm-intake.smoke, ppm-data-quality.smoke, ppm-workbench.smoke, ppm-baselines.smoke, ppm-concurrency.smoke, ppm-r4-actuals-intake.smoke, ppm-w4-enterprise.smoke, ppm-p7b.smoke, ppm-plan-integrity | 406 / 411 — the 5 failures were the generated artefacts not yet regenerated (inventory, INVENTORY-STRICT, README size block, SWITCH-LOTS, handler-check declarations) |
| After regeneration: authz-matrix-json + authz-route-matrix (`AUTHZ_MATRIX_UPDATE=1`), authz-handler-checks, switch-lots, agent-inventory, inventory-strict, inventory-reachability, readme-truth, test-runner-guard, flag-register, policy-center-catalogue | 60 / 60 pass |
| authz-matrix-json, authz-route-matrix, authz-outcomes.smoke with `AUTHZ_MATRIX_UPDATE=1 AUTHZ_OUTCOMES_UPDATE=1` | 12 pass |
| `--check` of flag-register, raci-seed, csp-journey-report, ui-inventory, p09-page-inventory; policy-catalogue | up to date / OK |
| `npx eslint .` | clean |

No test database left behind (checked). Command:
`NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>` with the sandbox `PG_ADMIN_URL`.

## Authz

+7 routes, all `requireReportSession` + in-handler role checks (committee / assigned reviewer / owner), each 404 while
`ppm_review_workflow_enabled = '0'`. Snapshot outcomes added (no existing row changed):
GET review / roles-catalogue `UUUAAAAAAAAAAAAAAAFFAAA` (same as the register); POST assign / request-info / respond /
return `UUUFFFFFFFFFFVFFFFFFVVV`; POST apply-template `UUUFFFFFFFFFFAFFFFFFAAA`.

## Human decisions left (PROPOSED, not approved)
- The lifecycle mapping (spec Planned = `proposal`, Submitted = `approval`) and its added rules (IT owner before
  planning, open tasks block handover, sponsor never decides, reasons on every exit / return); new projects start as `idea`.
- The six review steps, their role slots (`committee-member`, `executive`, rule all) and who assigns reviewers (committee).
- The frozen business-case field list and "approved or applied change request" as the unlock.
- The §27 role mapping; contributor project creation (not built — access-policy owner).
- Arming the four switches (order in L14: field audit → lifecycle → review workflow → freeze); behaviour for legacy
  projects already in `approval` with no recorded submitter (must be returned and resubmitted under the review switch);
  turning the lifecycle switch back off while projects sit in an extended stage (they cannot move — stop and report).
- Browser E2E of the review panel (not run by the agent).
