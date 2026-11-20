# PORTFOLIO LOT 6 — Phase 2: structured dependencies & risks, resource demand & capacity, documents, effort scoring, scenarios, BI (evidence)

> **AI evidence.** Author: Claude (AI). Reviews here are AI self-review, not an independent review, not a PMO,
> finance, security or operator sign-off. Every threshold, mapping, weight, band, vocabulary and the document
> allow-list is PROPOSED.

- **Scope:** IT portfolio reconstruction spec §12, §13, §16, §17, §29, §33 — Lot 6 of
  `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (Phase 2). Lots 4 and 5 are not implemented here.
- **Branch:** `feat/portfolio-lot6` (worktree `/home/user/w/portfolio-lot6`). Not pushed, not merged.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT6-phase2.md`.
- **Switches** (report_config, PROPOSED, all default `'0'` = today, every route 404s): `ppm_structured_dependencies_enabled`,
  `ppm_resource_demand_enabled`, `ppm_effort_scoring_enabled`, `ppm_documents_enabled`, `ppm_scenarios_enabled`,
  `ext_api_portfolio_enabled` (four-eyes, strict value `0`). Config keys `ppm_capacity_fte`, `ppm_effort_weights`
  (`''` = capacity unknown / PROPOSED weights). New lot **L16** in `docs/ops/switch-lots.json`; catalogued in
  `docs/ops/policy-catalogue.json`; rows in `docs/ops/pilot/PILOT-PROFILE.md`.
- **Migration:** `db/postgres/reports/130_ppm_portfolio_phase2.sql` (additive: 4 tables + 3 nullable columns on
  `portfolio_risks`); manual rollback `db/postgres_rollback/130_ppm_portfolio_phase2_drop.sql`, listed in
  `tests/ppm-rollback-scripts.test.js` (apply → rollback → schema identical; re-apply idempotent).

## What was built

| Item | Where |
|---|---|
| Pure rules: dependencies (exactly one target, cycle check, flags, legacy read + backfill plan) | `services/ppm/structuredDependencies.js` |
| Pure rules: 4-level exposure, residual, due date, project / portfolio rollup | `services/ppm/riskExposure.js` |
| Pure rules: demand lines (numeric FTE), monthly load, capacity parse, RAG via kpiRag `ppm-capacity` (PROPOSED) | `services/ppm/resourceDemand.js`, `public/lib/kpiRag.js` |
| Pure rules: seven-factor effort score, PROPOSED weights / bands | `services/ppm/effortScoring.js` |
| Pure rules: document type / MIME / magic bytes / size / title, money documents, safe download name | `services/ppm/projectDocuments.js` |
| Pure rules: read-only portfolio scenario (reuses `monthlyLoad` + the dependency edges) | `services/ppm/portfolioScenario.js` |
| Store (ledger on every write, readers filter `deleted_at`, files in the existing blob store) | `services/ppm/portfolioPhase2Store.js` |
| 21 routes on the governance router (own `readableProject` / `viewFor` / `refusePlanWrite` / `canSeeMoney`) | `routes/governancePortfolioPhase2.js`, 1 line in `routes/governance.js` |
| Feature flags in `/api/governance/ppm/features` | `routes/governancePpm.js` |
| Residual columns hidden from every existing risk payload (today's shape) | `services/governanceStore.js` (`riskRow`) |
| BI: scope `portfolio:read`; `/ext/v1/portfolio/{projects,dependencies,demand}`; OData `PortfolioProjects` / `PortfolioDependencyLinks` / `PortfolioDemands` (listed only while the switch is on) | `routes/extApi.js`, `services/odata.js`, `services/engagementStore.js` |
| Document download through the export policy gate `governance.project_documents` | `services/exportPolicy.js` |
| Project page: Dependencies / Resources / Documents tabs (hidden unless their flag) | `public/project.html`, `public/lib/ppmPhase2.js`, `public/lib/ppmPhase2.css`, FR strings in `public/lib/i18n/project.fr.js` |
| Portfolio page (strict CSP, EN/FR, tokens): load vs capacity, exposure, loops / flags, effort, scenario | `public/portfolio-phase2.html`, `public/lib/portfolioPhase2Page.js`, link in `public/portfolio.html` |
| Backfill of the legacy `depends_on` JSON (dry run default, `--apply`; never changes the JSON; skips loops) | `tools/ppm/backfill-project-dependencies.js` |

Not touched: `scheduleEngine.js`, `resources.js` (levelling) — so the R1-F4 levelling performance cannot regress
(no bench guard needed). Lot 2 data-quality engine unchanged (dependency flags are served by the Lot 6 views).
No metric registered (no metric map / lineage change).

## Invariants and how they are tested

| Invariant | Test |
|---|---|
| Switch off = today: every route 404, flags false, OData service document / CSDL without portfolio sets | smoke 1 |
| Dependency cycle across projects refused (direct + transitive), self refused | pure 2 + smoke 2 (409 `DEP_CYCLE`) |
| External dependency without owner flagged (`DEP_EXTERNAL_NO_OWNER`), cleared by an owner + date | pure 3 + smoke 2 |
| Unknown / unreadable predecessor refused; another site's project + rows invisible; no name of an unreadable predecessor | smoke 2, 3 |
| Legacy `depends_on` read-compatible; backfill skips existing rows; unknown stays null | pure 4 |
| 4 levels (PROPOSED), residual wins, no risk → null, existing risk payloads keep today's shape | pure 5 + smoke 4 |
| FTE numeric only (`'medium'`, `'0,5'`, booleans, ranges refused), peak ≥ average | pure 6 + smoke 5 |
| Capacity threshold boundaries (=capacity amber, just over red, ratio 1.18 green, unknown NA) | pure 7 + smoke 5 |
| Effort: partial → null, band boundaries, mismatch only shown | pure 8 + smoke 6 |
| Documents: magic bytes vs type (renamed binary 415), MIME allow-list, size, server-chosen blob name (path traversal in the title never reaches the FS), no blob ref in metadata, money-free metadata, money documents restricted (list + download + upload), site scope, soft delete, nosniff | pure 9 + smoke 7 |
| Scenario read-only (project dates byte-identical before/after), only readable projects | pure 10 + smoke 8 |
| External API: switch + scope gated, sensitive excluded, no amount, no person name, `$select=Budget` 400 | smoke 9 |
| Strict CSP page, no inline handler, tokens only, labelled inputs, EN/FR same keys | `portfolio-phase2-page` (3) |

TDD note (honest): the pure modules were written before their tests here (not test-first); the smoke suite then
caught one wrong expectation of mine (scenario: baseline already had two conflicts because the fixture projects share
dates) and the guard battery caught real gaps that were fixed: 4 hand-written error answers in `routes/extApi.js`
(→ `httpFail`), the document download missing the export-policy gate, a `COALESCE(…, 0)` in a reader (kpi-unknown
sweep), and routes not strictly referenced by a test (inventory).

## Tests run (targeted; full suite NOT run)

Command: `PG_ADMIN_URL=… SDP_TEST_RUN_ID=lotsix NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require
$PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>`; only this
lot's test databases (`sdp_tracker_test_lotsix_*`) were dropped after each run.

| Files | Result |
|---|---|
| `portfolio-phase2-pure` (10, new), `portfolio-phase2-page` (3, new), `portfolio-phase2.smoke` (9, new) | 22 pass |
| `authz-matrix-json`, `authz-route-matrix`, `authz-outcomes.smoke` with `AUTHZ_MATRIX_UPDATE=1 AUTHZ_OUTCOMES_UPDATE=1` | 12 / 12 pass (outcome rows added only) |
| Guard battery (39 files): error-shape, soft-delete-readers, kpi-unknown-sweep, limit-clamp, export-policy(-routes.smoke), csv-guard-coverage, simplicity-budget, i18n-coverage, a11y-*, csp-*, policy-center-catalogue, switch-lots(-rollback), flag-register, ppm-rollback-scripts, pg-migrate*, monolith-ratchet, agent-inventory, readme-truth, odata, ext-api.smoke, server-size-budget, await-precedence, ui-design-ratchet, capability-registry, report-config, authz-handler-checks, authz-enforce, inventory-*, test-runner-guard | 346 / 346 pass (after regenerating the README / inventory block; first runs failed on the gaps listed above, all fixed) |
| Every `ppm-*` and `portfolio-*` file + `governance-routes.smoke` (79 files) | 433 / 433 pass |
| `npx eslint .` | clean |
| `evidence-baseline`, `p09-adoption-kit` | 14 / 15 — the one failure (`b1-adoption-lotb-landing.spec.js not mapped to a persona` in PERSONA-JOURNEYS.md) is **pre-existing on the base commit** `2fd10fe5` (reproduced with this lot's changes stashed); not touched here |

Authz: +21 governance routes (+3 ext routes outside the session gate, key-authenticated). Outcomes (23 personas):
reads `UUUAAAAAAAAAAAAAAAFFAAA` (same as the portfolio register), creates `UUUFFFFFFFFFFVFFFFFFVVV`, updates / deletes /
download / residual `UUUNNNNNNNNNNNNNNNFFNNN` (unknown id → 404), effort save `UUUFFFFFFFFFFAFFFFFFAAA`. No existing
outcome row changed. Handler-check declarations added (AI, not reviewed).

## Human decisions left (PROPOSED, not approved)
- PMO: external category list, dependency status / criticality vocabularies and flags; the exposure mapping (1–2 low,
  3–4 medium, 6 high, 9 critical); effort weights and bands; whether dependency flags should enter the Lot 2 DQ score.
- Resource owner: `ppm_capacity_fte` values per skill and the capacity thresholds (≤ ~85 % green, 85–100 % amber).
- Operator / security: document storage location, retention, malware scanning (none today), the 10 MB ceiling, the
  MIME allow-list, which document types are "money documents"; whether the optional export watermark may alter an
  uploaded file on download (`export_watermark_enabled`).
- Data owner + security (four-eyes): arming `ext_api_portfolio_enabled` and issuing keys with `portfolio:read`
  (project names, sites and dates leave the platform; never amounts, never person names).
- Arming each switch (L16 order note); running `tools/ppm/backfill-project-dependencies.js --apply` after a dry run.
- Browser E2E of the three tabs and the portfolio page (not run by the agent). FX / base-currency totals remain
  blocked on Finance certification; AI functions (§34–35) out of scope.
