# Bundle P2 — Finance & money (goals A1, B8, money part of B7)

Branch `goal/p2-finance` (from `fc5cd2d`). Engineering evidence only: nothing here is a Finance approval, a named
verifier, a field acceptance or a production-readiness statement. Both new switches default to today's behaviour and
were turned on only in throwaway test databases. ADR: `docs/ai-decisions/ADR-P2-finance-certification-and-actuals.md`.

## 1. Gap matrix (status after this bundle)

| Clause | Before | After | Evidence | Test |
|---|---|---|---|---|
| A1 named Finance verifier (role holder + audit) | PARTIAL (benefits, dark) | IMPLEMENTED-DARK | feature role `finance-verifier` (`reports-db.js` FEATURE_ROLES_KNOWN, `uiPolicy`, `ssoProvisioning`, Users card in `public/reports.html`); capability `finance.certify` (`services/capabilityRegistry.js`); assignment = super_admin user edit (already audited) | `capability-registry`, `authz-route-matrix`, `sso-grant-merge` |
| A1 workflow uncertified → verified (who / when / evidence / source) | MISSING (assets) | IMPLEMENTED-DARK | `services/financeCertification.js`, `services/financeCertStore.js`, `routes/finance.js`, migration `094_finance_certifications.sql` | `finance-certification.test.js` (6), `finance-certification.smoke.test.js` (8) |
| Applies to asset finance, licences, investment, depreciation, project benefits (+ project actuals) | MISSING (4/5) | IMPLEMENTED-DARK | `services/financeFigures.js` (one canonical basis per scope) | smoke: asset_finance, depreciation sheet, project_actuals; unit: validate per scope |
| "Non certifié" disappears only for a valid certification | PARTIAL (coverage threshold) | IMPLEMENTED-DARK | `FC.state` hash comparison; `public/lib/moneyCertBand.js financeHtml` + `public/assets.html appendFinanceCert` (Finance + Investment tabs); coverage band kept as a separate indicator | smoke "a changed figure removes the certification"; unit `state + badge` |
| Invalidation when figures change | MISSING | IMPLEMENTED | SHA-256 of source rows + money config, recomputed per read | smoke (asset cost edited → stale) |
| finance-viewer cannot certify; non-verifier cannot flip | MISSING (assets) | IMPLEMENTED | `mayCertify` (exact role + money read), route guard `requireFinanceVerifier` | smoke "who certifies" (finance-viewer, admin, super_admin, editor, viewer → 403 VERIFIER_ROLE; verifier w/o money read → 403 MONEY_SCOPE) |
| SoD: certifier ≠ last editor | MISSING | IMPLEMENTED (where knowable) | `sodProblem` + `lastEditorIds` (budget actuals actor, importer, benefit entrant) | smoke SELF_REVIEW; actuals smoke (importer ≠ verifier passes) |
| Certification in audit log and exports | MISSING | IMPLEMENTED | `finance_certification_events` append-only + hash-chained (`services/auditChain.js`), `system_log` category `finance`; "Finance certification" sheet in `/api/assets/{finance,licences,investment}/export.xlsx` (`services/financeCertExport.js`); register export with Ledger sheet; batch export columns | smoke (chain ok, UPDATE refused, log row, sheets) |
| Benefits verifier aligned | PARTIAL | IMPLEMENTED-DARK | `routes/governance.js moneyVerifierRole` falls back to `finance-verifier` while the switch is on | smoke "benefits" |
| B8 Pronto CSV/Excel import: mapping wizard, dry run, reconciliation, no write-back | MISSING | IMPLEMENTED-DARK | `services/actualsImport.js`, routes `/api/finance/actuals/*`, templates table, `/finance.html` wizard | `actuals-import.test.js` (6), `actuals-import.smoke.test.js` (7) |
| Dated FX rates | MISSING | IMPLEMENTED-DARK | `fx_rates` (095), `services/fxRates.js`, admin-only writes, retire not edit | `fx-rates.test.js` (5), smoke |
| Per-user / site display currency | MISSING | IMPLEMENTED-DARK (presentation) | `user_finance_prefs`, `/api/finance/prefs`, fallback site currency (`asset_site_currency`) then USD | smoke "display currency" |
| PROVE round-trip reconciliation | MISSING | IMPLEMENTED | re-dry-run after commit → all `unchanged`; duplicate file 409 | smoke "round trip" |
| PROVE uncertified until A1 verifier acts | MISSING | IMPLEMENTED | batch export State column | smoke (Non certifié → Certifié for the certified project only) |
| PROVE conversion audited and reproducible | MISSING | IMPLEMENTED | rate id/value/date/source in every conversion; system_log `fx_rate_added/retired` | unit + smoke |
| Invariant 2 on new surfaces | — | IMPLEMENTED | money read on every amount-bearing route; import + batches admin tier; register/summary store counts only | smokes (viewer/editor 403 on status, rates, convert, exports, batches) |
| Migrations reversible | — | IMPLEMENTED | `db/postgres_rollback/094_finance_certifications_drop.sql`, `095_fx_rates_actuals_import_drop.sql` | `pg-finance-migrations-rollback.test.js` (rollback keeps budget periods, re-migrate restores) |

## 2. Wiring (no orphan UI)
`/finance.html` (+ `public/finance.js`): status/certify/revoke/register/export · FX table/add/retire/convert ·
display currency · import wizard (file → columns → template → dry run → reason → commit) · batches with reconciliation
export. Shell entry "Finance certification" (Operations ▸ Report & share) shown only while one switch is on
(`uiPolicy.finance_page`, presentation only). Assets Finance and Investment tabs show the certification line linking
to the register. Mounted in `server.js` without growing it (6995 lines, budget 6996).

## 3. Tests (PostgreSQL local test cluster)
New: 33 tests in 6 files (unit 17, smoke 15, migration rollback 1) — all green, failing first (pure modules absent).
Related / guard suites run green: flag-register, authz-route-matrix, capability-registry, server-size-budget,
error-shape, await-precedence, pg-migrate, pg-migrate-from-111, ui-design-ratchet, a11y-legacy-ratchet, a11y-static,
readme-truth, licence-inventory, inventory-strict, agent-inventory, inventory-reachability, audit-chain, sso-grant-merge,
rbac-ui-gates, money-coverage, currency, ui-policy(.me smoke, +1 test), shell-*, portfolio-benefits(.smoke),
ppm-budget-periods, assets money/finance/investment/depreciation/licence suites, access-*, sso-*, portfolio-site-scope,
ppm-w2, ppm-workbench, workspace-profiles (302 + 113 + 103 in the three batches). The full suite was not run.

## 4. Flag / rollout note
| Switch | Default | Canary | Rollback trigger | Owner |
|---|---|---|---|---|
| `finance_certification_enabled` | `0` | TEST instance, then Mana (only site with real costs) | a "Certifié" badge on a figure Finance disputes, or the audit-chain job reporting `finance_certification_events` broken → set `0` (records kept) | Finance controller (names the verifier) + Owner |
| `actuals_import_enabled` | `0` | TEST instance with a real Pronto export layout, one project | a reconciliation that does not tie to Pronto → set `0`; correct written actuals on the project page with a justification | Finance controller + PMO |
Human prerequisites: name the verifier (role `finance-verifier` + `finance-viewer`), approve the monthly certification
policy, provide the Pronto export layout and the FX rate source.

## 5. Value metrics (instrument before / after)
- **% amounts certified** = targets in state `verified` ÷ targets shown (`GET /api/finance/certifications` current_state;
  scopes × sites × month). Before: 0 % (no human certification existed).
- **USD bookable** = money benefits + project actuals in state `verified`, converted with a named dated rate
  (`/api/finance/convert`); before: 0.
- **Manual re-entry hours** = (budget actuals written by `actuals_imported` batches × measured minutes per manual entry)
  — count from `actuals_import_batches.rows_written` vs `budget_period_saved` manual log rows per month.

## 6. Residual gaps
- No human verifier, policy, rate source or Pronto layout exists — the switches must stay `0` until Finance decides.
- Asset figures have no human editor: SoD cannot apply to them (stated in the ADR).
- PPT / PDF money outputs (portfolio deck) do not yet carry the certification line; the portfolio workbook "Budget
  periods" sheet does not show the certification state (governance files owned by other bundles).
- The budget-period view on the project page still prints the static "not certified" text (`ppmBudgetPeriods`); the
  certified state is read on `/finance.html` and in the batch export.
- Browser E2E of `/finance.html` not run (no Playwright spec added); the page was syntax-checked and its API calls are
  covered by the smokes.
