# ADR-P2 — Finance certification by a named verifier, dated FX rates and a FILE-only Pronto actuals bridge

Status: engineering decision (reversible), 2026-11-12, bundle P2 (goals A1, B8). Not a Finance approval: who certifies,
what evidence suffices, the rate source and the Pronto layout are human decisions.

## Context
"Certified" on the Assets money views was an automatic coverage threshold (`services/moneyCoverage.js`), and project
budget periods said "not certified" permanently. Goal A1 asks for a human certification by a named Finance verifier,
on five money families, that disappears when the figures change. Goal B8 asks for Pronto actuals and multi-currency with
dated rates, under the boundary "no connector to Pronto".

## Decisions
1. **New feature role `finance-verifier`, held exactly** (no tier implies it), assigned by a super_admin in Users (the
   existing audited role change). Certification ALSO requires the money-read rule (admin tier or `finance-viewer`) —
   nobody certifies amounts they may not see (invariant 2). A `finance-viewer` alone never certifies.
2. **Certification = scope × key × month + SHA-256 of the canonical SOURCE rows and money configuration**, not of a
   rendered summary: today's date (expiry buckets, "months since") never breaks a certification, while any edited
   amount, added row or changed rate does. The hash is recomputed on every read; a mismatch reads "stale" = "Non
   certifié". Monthly granularity: a new month needs a new certification (proposed policy).
3. **Separation of duties where the database knows the editor**: budget-period `actor_id`, the importer (same column),
   the entrant of a realised benefit. Synced asset data has no human editor → no SoD refusal is possible there.
4. **Two tables**: the current status (`finance_certifications`, one `verified` per target via a partial unique index;
   superseded / revoked rows kept) and an append-only hash-chained ledger (`finance_certification_events`, verified by
   the nightly audit-chain job). Plus `system_log` (category `finance`).
5. **Benefits aligned, not duplicated**: the existing benefit four-eyes verification stays; with the switch on and no
   explicit `benefit_money_verifier_role`, a money benefit is verified by the `finance-verifier`. The aggregate
   `project_benefits` scope certifies the money benefits of a project.
6. **FX rates are dated and immutable** (retire + re-enter), USD-based like the existing `xof_usd_rate`; a conversion
   always names the rate rows used. Totals are never summed across currencies without a rate for each.
7. **Pronto bridge = file upload only** (base64 JSON body, 15 MB cap), parsed with the SheetJS dependency already
   shipped; commit goes through `governanceStore.saveBudgetPeriod` in ONE transaction, so every actual is justified and
   ledgered in `ppm_events` exactly like a manual entry. Actuals keep their native currency. Same file twice = 409.
8. **server.js stays within its line budget**: the router is mounted on the existing kpiPolicies line, the page joins
   the existing page lists, the export sheets replace the `buildWorkbook(sheets)` call in place.

## Consequences / reversibility
Both switches default `0` (routes 404, pages unchanged). Rollback: switch `0`; schema rollback scripts
`db/postgres_rollback/094_*` and `095_*` (tested); actuals already written stay ordinary, ledgered budget periods.
