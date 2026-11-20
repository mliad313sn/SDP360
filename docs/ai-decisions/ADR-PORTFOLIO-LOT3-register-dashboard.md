# ADR-PORTFOLIO-LOT3 — Register table, executive dashboard, filters, drill-through, filtered exports (MVP)

- **Status:** accepted for engineering (AI decision, reversible, sandbox). Every report definition and the stalled
  threshold are **PROPOSED** — nothing here is a PMO approval.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Review:** AI self-review only — not an independent review.
- **Context:** `docs/sdp360/portfolio-spec/IT-PORTFOLIO-RECONSTRUCTION-SPEC.md` §21, §23.1, §24.5, §30 and
  `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (Lot 3). Builds on ADR-PORTFOLIO-LOT1 (intake fields) and
  ADR-PORTFOLIO-LOT2 (data quality). Evidence: `docs/agent-execution/PORTFOLIO-LOT-3.md`.
- **Switch:** `ppm_portfolio_dashboard_v2_enabled` (report_config, `'0'` = today: every route 404s). No migration.

## Decisions

1. **Computed on read, no table.** The register is a view over the portfolio the reader may ALREADY read: the routes
   call the governance router's own `viewFor` (A-15 site scope, B3 sensitive projects, W4 project roles) and
   `canSeeMoney`. Saved views are URLs (`public/lib/urlFilters.js` + `PortfolioRegister.SCHEMA`), not a
   `ppm_saved_views` table — the gap note allowed either; a URL needs no migration and is shareable.
2. **One pure engine** `services/ppm/portfolioRegister.js` (no I/O, clock passed in). It is the **whitelist**: rows
   carry only the register columns, and budget / currency / budget status only for an amount reader. No second
   formula: data quality reuses `dataQuality.evaluate` + `siteScores` (Σ ÷ Σ), risk severity reuses
   `portfolioEvidence.riskView`, duration the Lot 1 rule.
3. **Reconciliation by construction:** a KPI card carries its drill as a filter object; its count is computed with
   the SAME `applyFilters` the register uses, so "card value = rows of its drill" holds (tested pure + over HTTP).
   The dashboard follows the active filters.
4. **Unknown stays null** with a reason code (`INTAKE_DISABLED`, `DQ_DISABLED`, `MONEY_HIDDEN`, `NO_SCORE`); FTE sums
   cover known values with an `fte_unknown` count; stage age is null when no stage-entry date exists.
5. **Currencies are never added together** (per-currency maps everywhere, no grand total).
6. **Money filters** (`budget_status`, `budget`, the `unfunded` report) are ignored — and not echoed — for a
   money-hidden reader, so a filter can never be an oracle for a hidden amount.
7. **Exports** (`register.csv`, `register.xlsx`) go through the export policy gate (`governance.portfolio_register`,
   amounts `masked`, same legacy committee rule as the portfolio workbook) and carry exactly the filtered rows; CSV
   cells through `csvSafe.neutralize`; the XLSX adds a "Filters" sheet.
8. **Page:** `public/portfolio-register.html`, strict CSP (built-in `STRICT_PAGES`), no inline script, tokens only,
   EN / FR from the shell, reached from the portfolio page while the switch is on. **No nav entry** (simplicity budget).
9. **Stage age** needs no new column: last `stage` event in the `ppm_events` ledger (`governanceStore.stageEntries`);
   a project still in `proposal` with no move uses its creation date.

## PROPOSED rules (PMO decision)
unfunded = budget status not_budgeted | requested | tbc · without owners = IT owner OR sponsor blank · high risk =
declared exposure high/critical OR an open high-severity risk · stalled = > 90 days in stage · "in approval, not
started" = stage approval and no actual start · active in a month = planned dates overlap, not cancelled.

## Not done (left to later lots / humans)
Roadmap year / quarter scale and drag on the timeline (§23 functions), PDF / PowerPoint of the register, analyses by
owner/vendor beyond the risk view, capacity thresholds per site (§23.1 "configurable"), browser E2E.

## Rollback
Set the switch to `'0'` (routes 404, link hidden). Code removal = revert the commit; nothing stored.
