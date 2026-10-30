# KPI definitions under arbitration (EX-04)

Status 2026-10-29. Each line is a figure that the platform can show in two ways. **Neither is presented as
official until the KPI Committee decides.** In the dictionary (`services/metricRegistry.js`,
`/api/metrics/registry`) these metrics carry `decision` and `certification: not certified — <decision> pending`;
the two change-success definitions are `status: draft`, so they are not listed among published metrics.

| Figure | Definition A | Definition B | Measured gap | Where each is used today | Decision |
|---|---|---|---|---|---|
| Change success rate | **Deck**: successful ÷ (successful + partial + failed + backed out + cancelled) | **ITSM doctrine**: same, cancelled excluded | 91.4 % vs 97.7 % on the 295 changes of the snapshot (187 vs 175 executed) | A: executive report, IT Review helpdesk & changes panel, site report; B: `getChangeMetrics`, CLAUDE.md doctrine | D-01 |
| Site score | `programme.site_score` (sbDims, 6 dims × 0/1/2, RAG 70/45) | `programme.composite` (4 operational dims, weighted 40/20/20/20, RAG 75/55) | 3 of 5 sites change colour between the two | A: site reports, coordinator e-mail; B: IT Review scoreboard | D-01 / D-02 |
| Strategic roadmap progress | Activity tracker fleet score (22 %) | Roadmap Manager weighted objectives (54 %) | 32 points | A: executive deck, Exec View; B: personal Roadmap Manager | D-03 |

## What the committee is asked

1. **D-01** — which change-success denominator is official (A, B, or B with cancelled shown separately).
2. **D-02** — which site score is published to sites and management, and whether the other stays as an
   internal diagnostic.
3. **D-03** — which roadmap figure the executive material quotes, and its window (YTD / rolling).

## What happens after a decision (no new code needed)

- The chosen definition's `status` becomes `published` and its `decision` field is cleared (one row in
  `metric_registry`, or one line in the seed); the other is retired or renamed "diagnostic".
- `tests/kpi-change-parity.test.js` is updated to assert the chosen figure on every surface that shows it.

## Proof that the two change figures come from the same data

`tests/kpi-change-parity.test.js`: one classifier (`reports-db._changeOutcome`), two denominators; the
difference is exactly the number of cancelled changes; nothing executed gives `null`, never 0 %.
