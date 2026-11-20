# PORTFOLIO LOT 3 — register table, executive dashboard, filters, drill-through, filtered exports (evidence)

> **AI evidence.** Author: Claude (AI). Reviews here are AI self-review, not an independent review, not a PMO sign-off.
> Nothing in this lot is approved policy: the report definitions (unfunded, without owners, high risk, stalled 90 days,
> in approval not started) are PROPOSED.

- **Scope:** IT portfolio reconstruction spec §21, §23.1, §24.5, §30 — Lot 3 of `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (MVP).
- **Branch:** `feat/portfolio-lot3` (worktree `/home/user/w/portfolio-lot3`). Not pushed, not merged.
- **Decision record:** `docs/ai-decisions/ADR-PORTFOLIO-LOT3-register-dashboard.md`.
- **Switch** (report_config, PROPOSED, default `'0'` = today, every route 404s): `ppm_portfolio_dashboard_v2_enabled`.
  Added to lot **L14** in `docs/ops/switch-lots.json`, catalogued in `docs/ops/policy-catalogue.json`, row in
  `docs/ops/pilot/PILOT-PROFILE.md`.
- **Migration:** none (computed on read; saved views = URL filters; stage age from the existing `ppm_events` ledger).

## What was built

| Item | Where |
|---|---|
| Pure engine (whitelisted rows, 5 KPI cards with drill filters, site / priority / status / risk / per-currency budget analyses, monthly active load, standard reports, filter options) | `services/ppm/portfolioRegister.js` |
| Shared vocabulary: URL filter schema, columns (money / frozen flags), reports, EN/FR labels, escaped renderers | `public/lib/portfolioRegister.js` |
| `GET /api/governance/portfolio/register` · `register.csv` · `register.xlsx` (export policy gate `governance.portfolio_register`, CSV via `csvSafe`, XLSX "Filters" sheet), registered on the governance router with its own `viewFor` / `canSeeMoney` | `routes/governancePortfolioRegister.js`, 1 line in `routes/governance.js` |
| `stageEntries(ids)` — last stage move per project from `ppm_events` | `services/governanceStore.js` |
| Feature flag `portfolio_dashboard_v2` in `/api/governance/ppm/features` | `routes/governancePpm.js` |
| Page: strict CSP (built-in `STRICT_PAGES`), no inline script, tokens only, EN/FR from the shell, sticky header, frozen ID / site / name, sortable headers, column choice, multi-filters, KPI drill links, exports | `public/portfolio-register.html`, `public/lib/portfolioRegisterPage.js`, served from `server.js` page lists (no line added) |
| Link from the portfolio page (hidden unless the flag is on) + FR string | `public/portfolio.html`, `public/lib/i18n/portfolio.fr.js` |

Reuse, no second formula: DQ = `dataQuality.evaluate` + `siteScores` (Σ ÷ Σ) + `ragOf` (existing PROPOSED policy
`ppm-data-quality` — no new RAG band); risk severity = `portfolioEvidence.riskView`. The portfolio KPIs are not
metric-registry entries (no metric registered, so no metric map / lineage change). No nav entry (simplicity budget).

## Invariants and how they are tested

| Invariant | Test |
|---|---|
| KPI card = count of its drill-through list | pure (all cards) + smoke (each drill re-queried over HTTP) |
| Filter round trip in export | smoke: `?priority=critical,high` → JSON 2 rows, CSV 2 rows, XLSX 2 rows + Filters sheet |
| Money hidden for non-money readers in every view | pure (JSON scan) + smoke (JSON, CSV with money columns asked, XLSX); money filters ignored and not echoed |
| Currencies never summed | pure (per-currency maps, no grand total) + smoke |
| Unknown → null with reason, never 0 | pure: DQ off, intake off, money hidden, no FTE, no stage-entry date |
| Strict CSP / a11y shape | `portfolio-register-page.test.js` (+ CSP journey report: page listed strict, 0 inline) |

TDD note (honest): the pure tests were written before the engine; the smoke "money-hidden" test failed first on a
real leak (the filter echo carried the `budget` / `budget_status` keys) and passed after the fix.

## Tests run (targeted; full suite NOT run)

Command: `NODE_OPTIONS="--require $PWD/tools/test/blocking-stdio.js --require $PWD/tests/_default-env.js --import file://$PWD/tests/_pg-boot.mjs" node --test --test-force-exit <files>` with the sandbox `PG_ADMIN_URL`.

| Files | Result |
|---|---|
| `portfolio-register-pure` (9, new), `portfolio-register-page` (3, new), `portfolio-register.smoke` (4, new) | 16 pass |
| `authz-matrix-json`, `authz-route-matrix`, `authz-outcomes.smoke` with `AUTHZ_MATRIX_UPDATE=1 AUTHZ_OUTCOMES_UPDATE=1` | 12 pass; +3 routes, no existing row changed |
| 48 files: the new ones + a11y-legacy-ratchet, a11y-static, agent-inventory, authz-enforce, authz-handler-checks, await-precedence, capability-registry, csp-candidate-pages.smoke, csp-headers.smoke, csp-journey-report, csp-no-inline-handlers-new-pages, csp-strict-pages-config, csv-guard-coverage, error-shape, export-policy-routes.smoke, export-policy, flag-register, governance-routes.smoke, i18n-coverage, inventory-reachability, inventory-strict, kpi-unknown-sweep, limit-clamp, metrics-no-scale-outside-registry, monolith-ratchet, policy-center-catalogue, portfolio-access-parity.smoke, portfolio-views, portfolio-deck, portfolio-site-scope.smoke, ppm-data-quality-{pure,ui,smoke}, ppm-intake-{ui,smoke}, readme-truth, report-config, server-size-budget, simplicity-budget, soft-delete-readers, switch-lots(-rollback), test-runner-guard, ui-design-ratchet, url-filters | 394 / 395 pass |

The one failure is **pre-existing on the base commit** `5176ec3b`: `monolith-ratchet` "reports-db.js stays under 5730
lines" — `reports-db.js` has 5747 lines at the base (5748 by the test's split count); this lot does not touch the file.
`npx eslint .` clean.

Authz: +3 routes (`GET /api/governance/portfolio/register`, `register.csv`, `register.xlsx`), session gate, outcome
`UUUAAAAAAAAAAAAAAAFFAAA` (same as the portfolio workbook); handler-check declarations added (AI, not reviewed).
Generated: authz matrix + outcomes + handler checks, FLAG-REGISTER, FLAG-DECISIONS-GAPS, SWITCH-LOTS, RACI-TEMPLATE
(unchanged), CHART-INVENTORY, P09-PAGE-INVENTORY, CSP-JOURNEYS (page strict, 0 inline), INVENTORY*, README block,
`tests/.suite-manifest.json` (+16), EVIDENCE-MANIFEST.

## Human decisions left (PROPOSED, not approved)
- Report definitions: unfunded = not_budgeted | requested | tbc; without owners = owner OR sponsor blank; high risk =
  declared high/critical OR open high-severity risk; stalled = > 90 days in stage; "in approval, not started".
- Who reads the register: same audience as the portfolio today (any session over the readable portfolio); amounts
  for committee + admin tier + finance-viewer (existing portfolio exception to invariant 2, `legacyMoney: committee`).
- Arming `ppm_portfolio_dashboard_v2_enabled` (after `ppm_intake_register_enabled`; DQ card needs `ppm_data_quality_enabled`).
- Browser E2E of the page (not run by the agent).
- Not built: roadmap year/quarter scale and drag (§23), PDF / PowerPoint of the register, capacity thresholds per site.
