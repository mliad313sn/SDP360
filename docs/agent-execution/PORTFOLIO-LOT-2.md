# PORTFOLIO LOT 2 — data-quality engine, field guidance, submission checklist (evidence)

> **AI evidence.** Author: Claude (AI). Reviews here are AI self-review, not an independent review, not a PMO sign-off.
> Nothing in this lot is approved policy: the required set, blocking checks, value-state counting and RAG bands are PROPOSED.

- **Scope:** IT portfolio reconstruction spec §4, §4.3, §20 — Lot 2 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md`.
- **Branch:** `feat/portfolio-lot2` (worktree `/home/user/w/portfolio-lot2`). Not pushed, not merged.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT2-data-quality.md`.
- **Switches** (report_config, PROPOSED, default `'0'` = today): `ppm_data_quality_enabled` (shadow: `dq` block on reads),
  `ppm_dq_gate_enforced` (proposal → approval refused on a blocking error). Added to lot **L14** (with Lot 1) in
  `docs/ops/switch-lots.json`, catalogued in `docs/ops/policy-catalogue.json`, rows in `docs/ops/pilot/PILOT-PROFILE.md`.
- **Migration:** none (computed on read).

## What was built

| Item | Where |
|---|---|
| Pure engine: 19 checks, project score (floored), blocking override to RED, blank/zero/TBC/na/none_known, unknown → null | `services/ppm/dataQuality.js` |
| Site score Σ completed ÷ Σ required, unscored projects counted apart | `dataQuality.siteScores` |
| DQ RAG policy `ppm-data-quality` (100 / 80) labelled PROPOSED | `public/lib/kpiRag.js` |
| §4.3 submission checklist (16 items) bound to the checks | `dataQuality.CHECKLIST` / `checklistOf` |
| Field catalogue EN/FR extending Lot 1 (7 extra entries: name, dates, budget, status, dependencies, risks) | `services/ppm/fieldGuide.js` |
| `dq` block on `GET /api/governance/portfolio` (per project + sites + policy) and `GET /api/governance/portfolio/project/:id` (checks, checklist, policy, gate flag), only while the shadow switch is on; money-hidden readers get scope `without_budget` | `routes/governance.js` |
| Gate: `POST /api/governance/portfolio/project/:id/stage` to `approval` → 409 `GATE_DATA_QUALITY` (+ `blocking`) via `httpFail`; same refusal in the dry run | `routes/governance.js` (`dqGateRefusal`) |
| `dq_guide` in the intake catalogue while the shadow switch is on; `data_quality` / `dq_gate_enforced` in `/ppm/features` | `routes/governanceIntake.js`, `routes/governancePpm.js` |
| UI: data-quality panel + checklist with help buttons on the Intake tab (external script, tokens only, EN/FR) | `public/lib/ppmFieldHelp.js`, `public/lib/ppmIntake.{js,css}`, `public/project.html` |

No new route, no new `res.status().json` call (errors through `httpFail`).

## Tests run (targeted; full suite NOT run)

Command: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>` with the sandbox `PG_ADMIN_URL`.

| Files | Result |
|---|---|
| `ppm-data-quality-pure` (10, new), `ppm-data-quality.smoke` (3, new), `ppm-data-quality-ui` (3, new) | 16 pass |
| Run 1: the new files + agent-inventory, authz-enforce, authz-handler-checks, authz-matrix-json, authz-outcomes.smoke, authz-route-matrix, csv-guard-coverage, dotenv-quiet, error-shape, export-policy-routes.smoke, flag-register, inventory-reachability, inventory-strict, kpi-unknown-sweep, limit-clamp, policy-center-catalogue, simplicity-budget, soft-delete-readers, switch-lots, switch-lots-rollback, ppm-intake-ui, ppm-intake.smoke, kpi-rag, uat-itsm-figures, metrics-registry, report-config, governance-routes.smoke, project-page, test-runner-guard, readme-truth, await-precedence | 198 / 198 pass |
| Run 2: i18n-coverage, ui-design-ratchet, a11y-static, a11y-legacy-ratchet, csp-no-inline-handlers-new-pages, monolith-ratchet, ppm-raci-templates, ppm-w3.smoke, portfolio-access-parity.smoke, capability-registry, metrics-no-scale-outside-registry, score-methodology | 130 / 131 → CHART-INVENTORY regenerated → re-run of the failing file pass |

Negative check: with the gate's switch test forced off the gate smoke test fails (1 of 3), restored → pass.
TDD note (honest): the engine was written before its pure tests in this lot; the gate test was verified to fail without
the gate logic. `npx eslint .` clean.

Authz: no route added or removed; `authz-outcomes.smoke` / matrices unchanged (no snapshot update needed).
Generated: FLAG-REGISTER.{md,json}, FLAG-DECISIONS-GAPS.md, SWITCH-LOTS.md, RACI-TEMPLATE (unchanged), INVENTORY*,
README inventory block, CHART-INVENTORY.md, `tests/.suite-manifest.json` (+16 → 5656), EVIDENCE-MANIFEST.md.

## Human decisions left (PROPOSED, not approved)
- Required field set (all 18 §20 fields), blocking checks (invalid schedule, missing IT owner).
- Value-state counting: `na` / `none_known` complete, `tbc` not complete, zero budget incomplete unless "not budgeted".
- DQ RAG bands 100 / 80; site RAG from score only.
- Arming `ppm_data_quality_enabled` (after `ppm_intake_register_enabled`) and, later, `ppm_dq_gate_enforced` (could block live approvals).
- Browser E2E of the panel (not run by the agent).
