# PORTFOLIO LOT 1 — register identity and intake fields (evidence)

- **Scope:** IT portfolio reconstruction spec §4, §5–§19, §31.10 — Lot 1 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md`.
- **Branch:** `feat/portfolio-lot1` (worktree `/home/user/w/portfolio-lot1`, base `dd70d1d6`). Not pushed, not merged.
- **Author:** Claude (AI). Reviews in this file are **AI self-review**, not an independent review, not a PMO sign-off.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT1-intake-register.md`.
- **Switch:** `ppm_intake_register_enabled` (report_config, PROPOSED, default `'0'` = today). Lot **L14** (new, PROPOSED)
  in `docs/ops/switch-lots.json`; owner / canary site / dates / thresholds deliberately left empty (human fields).
- **Migration:** `db/postgres/reports/117_ppm_intake_register.sql` (renumbered from 114: 113/114 sync and 116 reports are
  taken on the trunk) + manual rollback `db/postgres_rollback/117_ppm_intake_register_drop.sql`, added to
  `tests/ppm-rollback-scripts.test.js`.

## What was built, per requested item

| Item | Where | Notes |
|---|---|---|
| Immutable `PRJ-{YEAR}-{SEQ}` id | migration 117 (`project_ref`, unique partial index, trigger `portfolio_projects_ref_immutable`, counter `ppm_project_ref_seq`); `governanceStore._nextProjectRef` | Assigned at creation on the 3 creation paths (portfolio PUT, RFI conversion, template). Atomic per-year counter, never decremented → never reused after delete/purge. `key` unchanged and still editable. |
| Backfill tool | `tools/ppm/backfill-project-ids.js` (`--dry-run` default, `--apply`, `--json`) | Projects without an id, created_at order, soft-deleted included, same counter as live creation, idempotent. |
| Intake fields | migration 117; `services/ppm/intakeFields.js` (pure); store `upsertPortfolio` | project_type, tags, priority, business_need {current_situation, impact, problem, required_outcome}, expected_value, delivery_lead (sponsor = business sponsor, owner = IT owner — reused columns, aliases `business_sponsor` / `it_owner`), indicative_quarter (`YYYY-Qn`) + schedule_confidence, budget_status + budget_approval_date + budget_reference (amount/currency = existing fields), decision_required, delivery_effort, risk_exposure, avg_fte / peak_fte (numeric, peak ≥ avg), required_skills, workload_notes. Calculated `planned_duration_days` = end − start + 1 (null until both dates are valid). Affected sites = the existing `portfolio_project_sites` relation (unchanged). |
| Value states | `value_states` JSON; `intakeFields.normaliseIntake` | blank ≠ zero ≠ tbc ≠ na ≠ none_known; state only on an empty field; a value clears it; `none_known` only for `dependencies` / `risks`. |
| Zero budget | `intakeFields.intakeWarnings` | Kept as a measured value; warning `BUDGET_ZERO` when status ≠ `not_budgeted` (PROPOSED). |
| Roles warning | `intakeWarnings` | `ROLES_SAME_PERSON` (all three) / `ROLES_OVERLAP` (two) — warnings only (PROPOSED). |
| Reference lists | `ppm_lookup_values` (migration 117), `services/ppm/portfolioLookups.js`, `routes/governanceIntake.js`, panel `public/lib/ppmIntakeAdmin.js` on `portfolio.html` | 8 lists; add / rename (EN+FR) / reorder / colour token / one default / retire / restore; never deleted; retired value kept on its projects, refused for new choices; locked lists (project status, decision, schedule confidence) relabel/reorder only. Seeds from the spec; priority, risk exposure, delivery effort marked `proposed`; no default seeded. Admin tier only. |
| Field guidance | `intakeFields.GUIDE` (EN + FR, 22 fields), `GET /api/governance/intake/catalogue`, help buttons in `public/lib/ppmIntake.js` | Definition, why, good example, common mistake, level (required = PROPOSED). |
| UI | `public/project.html` Intake tab (hidden unless the switch is on; sections Identity, Business case, Ownership, Schedule, Budget, Resources), `public/lib/ppmIntake.{js,css}`, header shows the id when present | External scripts only, tokens only, `aria-expanded` help buttons, labelled controls; read-only for non-committee readers. FR: page dictionary (`'Intake'`) + the libs' own EN/FR tables. |
| Switch off = today | store `intakeOn()` (injected by `routes/governance.createStore`), routes 404, tab hidden | Project rows carry no intake key; intake body fields ignored; no id generated. |
| Money rule | `routes/governance.intakeMoneyless` | budget_status / approval date / reference (and the `budget` value state) stripped like budget/spent for non-money readers. No base-currency conversion (fx_rates not certified → unknown). |
| Access | unchanged | Project create/edit stays committee + admin tier (existing route). Editors / viewers refused (tested). |

## New routes (all 404 while the switch is off)

`GET /api/governance/intake/catalogue` (session) · `GET /api/governance/intake/lookups` · `PUT /api/governance/intake/lookups/:domain` ·
`PUT /api/governance/intake/lookups/:domain/order` · `POST /api/governance/intake/lookups/:domain/:code/retire` ·
`POST /api/governance/intake/lookups/:domain/:code/restore` (admin tier, `requireAdminTier`). `GET /api/governance/ppm/features` gains `intake_register`.

## Tests run (targeted; full suite NOT run — orchestrator runs it at merge)

Command: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>` with the sandbox `PG_ADMIN_URL`.

| File | Result |
|---|---|
| `tests/ppm-intake-pure.test.js` (new, 8) | 8 pass |
| `tests/ppm-intake.smoke.test.js` (new, 6) | 6 pass — switch off = today; ids (6 concurrent creations distinct, purge not reused, SQL immutability); round trip; value states; validation; money rule; lookups authz + retire history + locked lists + order; committee-only writes; RFI problem copied; backfill dry-run/apply/idempotent |
| `tests/ppm-intake-ui.test.js` (new, 4) | 4 pass |
| `tests/ppm-rollback-scripts.test.js` (117 added) | 2 pass (round trip exact) |
| `tests/pg-migrate.test.js`, `tests/pg-migrate-from-111.test.js` | 5 pass |
| `tests/i18n-coverage.test.js`, `tests/ui-design-ratchet.test.js`, `tests/a11y-static.test.js`, `tests/a11y-legacy-ratchet.test.js`, `tests/csp-no-inline-handlers-new-pages.test.js`, `tests/monolith-ratchet.test.js` | pass (CHART-INVENTORY regenerated) |
| `tests/authz-matrix-json.test.js`, `tests/authz-route-matrix.test.js` | pass after `AUTHZ_MATRIX_UPDATE=1` |
| `tests/authz-outcomes.smoke.test.js` | 5 pass after `AUTHZ_OUTCOMES_UPDATE=1` |
| regression batch (see report) | see final run below |

`npx eslint .` clean. Generated: `docs/ops/{authz-matrix.json,AUTHZ-MATRIX.md,authz-outcomes.json,FLAG-REGISTER.*,FLAG-DECISIONS-GAPS.md,SWITCH-LOTS.md}`,
`docs/agent-execution/INVENTORY*`, `docs/ux/CHART-INVENTORY.md`, `tests/.suite-manifest.json` (+18 → 5550).

## Changed outcome rows (`docs/ops/authz-outcomes.json`)

Only additions (6), no existing row changed:

```
GET  /api/governance/intake/catalogue                       UUUAAAAAAAAAAAAAAAFFAAA
GET  /api/governance/intake/lookups                         UUUFFFFFFFFFFFFFFFFFAAA
POST /api/governance/intake/lookups/:domain/:code/restore   UUUFFFFFFFFFFFFFFFFFNNN
POST /api/governance/intake/lookups/:domain/:code/retire    UUUFFFFFFFFFFFFFFFFFNNN
PUT  /api/governance/intake/lookups/:domain                 UUUFFFFFFFFFFFFFFFFFNNN
PUT  /api/governance/intake/lookups/:domain/order           UUUFFFFFFFFFFFFFFFFFNNN
```

(`N` for the admin tier = the probe's placeholder list/code does not exist → 404, not a refusal.)

## Not done / left for later lots

- Data-quality engine, DQ score/RAG, submission checklist and gate enforcement (Lot 2) — the guidance `level` values are
  PROPOSED inputs for it.
- Base-currency conversion (needs Finance-certified FX rates), dependency entity with categories/owner/status (§12),
  risk residual/due date (§13), decision record fields (§14), extended lifecycle (§15), effort scoring model (§16.2),
  resource start/finish/internal-external/owner (§17), site restriction of a reference value (§19), portfolio columns /
  filters for the new fields (§21, §29), contributor project creation (§27 — access-policy owner decision).
- Human decisions: PMO review of the PROPOSED reference data before arming; running the id backfill (permanent);
  browser E2E of the Intake tab and of the admin panel (not run by the agent).
- Known quirk observed (pre-existing, not changed): `DELETE /api/governance/portfolio/project/:id` with a JSON body `{}`
  answers 400 with an empty body; without a body it works.
