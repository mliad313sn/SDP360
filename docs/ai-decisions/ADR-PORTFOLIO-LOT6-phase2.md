# ADR-PORTFOLIO-LOT6 — Phase 2: structured dependencies & risks, resource demand & capacity, documents, effort scoring, scenarios, BI

- **Status:** accepted for engineering (AI decision, reversible, sandbox). Every threshold, mapping, weight, band,
  vocabulary and the document allow-list below is **PROPOSED** — nothing here is a PMO, finance, security or operator
  approval.
- **Date:** 2026-11-20 · **Author:** Claude (AI) · **Review:** AI self-review only — not an independent review.
- **Context:** `docs/sdp360/portfolio-spec/IT-PORTFOLIO-RECONSTRUCTION-SPEC.md` §12, §13, §16, §17, §29, §33 and
  `docs/sdp360/portfolio-spec/PORTFOLIO-SPEC-GAP.md` (Lot 6). Builds on ADR-PORTFOLIO-LOT1/2/3. Lots 4 (decisions /
  alerts) and 5 (lifecycle / approval / field audit) are out of scope here. Evidence: `docs/agent-execution/PORTFOLIO-LOT-6.md`.
- **Switches** (report_config, all `'0'` = today, every route 404s): `ppm_structured_dependencies_enabled`,
  `ppm_resource_demand_enabled`, `ppm_effort_scoring_enabled`, `ppm_documents_enabled`, `ppm_scenarios_enabled`,
  `ext_api_portfolio_enabled` (four-eyes, strict value `0`). Config: `ppm_capacity_fte`, `ppm_effort_weights` (`''` =
  unknown capacity / PROPOSED weights). Lot **L16** in `docs/ops/switch-lots.json`.
- **Migration:** `db/postgres/reports/130_ppm_portfolio_phase2.sql` (additive; rollback
  `db/postgres_rollback/130_ppm_portfolio_phase2_drop.sql`, pinned by `tests/ppm-rollback-scripts.test.js`).

## Decisions

1. **Reuse, no second engine.** Risks stay in `portfolio_risks` (three nullable columns: residual probability /
   impact, due date — no second register). Files go to the existing `services/blobStore.js` (no second document
   store). The task scheduler (`scheduleEngine.js`) and the levelling engine (`resources.js`) are **not touched and not
   called**: project-to-project dependencies need only a graph cycle check, and portfolio demand is planning data per
   skill, not task assignments — so the levelling benchmark (R1-F4) cannot regress. Capacity colours go through
   `public/lib/kpiRag.js` (new PROPOSED policy `ppm-capacity`), never a literal. The external API reuses `/ext/v1` +
   `/ext/odata` with their per-consumer hashed keys, rate limit, quota and call log.
2. **Dependencies are relational and exactly-one-target**: a row is on another project OR an external category (DB
   CHECK + pure check). A loop between projects is refused (409 `DEP_CYCLE`) — the check runs over the **whole**
   portfolio (a loop through a project the writer cannot see is still a loop) but the refusal and the portfolio view
   never name a project the reader cannot read (the loop is reported as `partial`). The predecessor must be readable
   by the writer (404 otherwise — no oracle). The legacy `depends_on` JSON is never changed; it is read alongside as
   `source: 'legacy'` until `tools/ppm/backfill-project-dependencies.js` (dry run default) converts it.
3. **"Flagged by DQ"** = dependency flags (`DEP_EXTERNAL_NO_OWNER`, `DEP_NO_OWNER`, `DEP_NO_TARGET_DATE`, `DEP_OVERDUE`,
   `DEP_BLOCKED`) in the dependency views and a portfolio count by code. The Lot 2 data-quality engine (19 checks) is
   deliberately **not** changed — adding a check there would move every DQ score the PMO is shadow-testing.
4. **Exposure (4 levels)** = PROPOSED mapping of probability × impact (1–2 low, 3–4 medium, 6 high, 9 critical);
   residual wins over inherent when set; project exposure = highest level among open risks/issues; no risk → `null`
   (never "low"). The residual columns are **stripped from every existing risk payload** (`riskRow`), so switch off =
   today's shapes exactly; only the Lot 6 routes serve them.
5. **Demand**: numeric FTE only (a category string is refused, `FTE_NUMERIC`), peak ≥ average, a month window.
   Monthly load = Σ average FTE per skill; peak sum unknown if one peak is unknown. Capacity unknown (`''`) → no colour
   (`NA`), never green. RAG on capacity ÷ demand: green ≥ 1.18 (≤ ~85 % utilised), amber ≥ 1.0, red over capacity.
6. **Effort score** = Σ wᵢ·sᵢ ÷ Σ wᵢ·5 × 100 over seven 1–5 factors, **only when all seven are answered** (partial =
   null). Bands < 35 / < 55 / < 75 / ≥ 75. The suggested band is compared with the declared Lot 1 `delivery_effort`
   and a difference is shown — never applied.
7. **Documents**: allow-listed MIME (PDF, PNG, JPEG, DOCX, XLSX, PPTX) **and** the first bytes must match (a renamed
   executable is 415), ≤ 10 MB, title 3–200, server-chosen blob name in a server-chosen namespace
   (`ppm-doc/p<id>/<uuid>`), the client's file name never touches the file system, the blob ref never leaves the server,
   download = `attachment` + `nosniff` + `no-store`. Same type + title = a new version (versions never reused); delete
   = soft delete. Raw-body upload (`express.raw` on the route) so no server.js body-parser line is needed. Quotations,
   budget approvals and purchase requests are "money documents": listed for every reader, downloaded / uploaded by
   amount readers only (`canSeeMoney`, W4 clients excluded). Metadata carries no amount. **No malware scanning** — an
   operator decision (see human decisions); a blob written before a failed INSERT may remain (orphan, harmless).
8. **Scenario** = read-only portfolio what-if (shift ≤ ±24 months / leave out ≤ 50 projects of the reader's portfolio):
   baseline vs scenario for months over capacity (the same `monthlyLoad`) and dependency conflicts (dependent starts
   before its predecessor ends). Nothing is written (pinned by the smoke test comparing project dates before/after).
9. **BI through the governed publication path**: new scope `portfolio:read` (never a default scope); entity sets
   `PortfolioProjects`, `PortfolioDependencyLinks`, `PortfolioDemands` appear in the OData service document and CSDL
   **only** while the switch is on. Non-sensitive live projects of a live chain only. **Money is never exported**
   (no amount column is selected; a `$select=Budget` is 400 because the property does not exist) and no person's name
   (owner, sponsor, dependency owner, free-text descriptions are not selected). The session export-policy gate does
   not apply to key-authenticated consumers; its rule here is enforced by construction (amounts: none).
10. **Access** = the governance router's own helpers: `readableProject` / `viewFor` (A-15 site scope, B3 sensitive,
    W4 roles) for reads, `refusePlanWrite` (committee, or the plan-write rule when armed) for writes, every write in the
    hash-chained `ppm_events` ledger and the system log. Routes live in `routes/governancePortfolioPhase2.js`.

## Consequences / reversibility
Each switch back to `0` restores today; the migration is additive and has a manual rollback. The OData metadata is
unchanged while `ext_api_portfolio_enabled = 0`.
