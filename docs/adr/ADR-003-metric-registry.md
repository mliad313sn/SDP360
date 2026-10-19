# ADR-003 — KPI definitions and RAG thresholds live in the metric registry, never in a page

**Status**: Accepted — implemented (Step 3, 2026-10-19) · **Author**: AI agent · **Approval**: product committee (to record)

## Context
v1 computed the same KPI in several places (browser page, PPTX generator, e-mail composer) with thresholds typed by hand: the tracker had **two** scoring engines (`engine.js` and `tracker-pptx.js`) that had to be edited together, and a RAG band changed in one deck and not the other broke month-to-month comparisons (the frozen "GREEN ≥ 90 %" lot of 2026-09-04).

## Decision
`services/metricRegistry.js` is the only place a KPI is defined (key, EN/FR name, module, unit, formula, window, RAG policy, reader, owner); `public/lib/kpiRag.js` (UMD, shared browser/server) is the only place a band is evaluated; both are loaded from the database (`metric_registry`, `kpi_rag_policies`) with the code seed as fallback. Pages and generators consume `GET /api/metrics/:key` or the shared engine. A literal threshold in a scoring module fails `tests/metrics-no-scale-outside-registry.test.js`.

## Consequences
- The fidelity suites (`score-fidelity`, `composite-fidelity`, `review-fidelity`) stay green by construction: the registered policies are the authors' numbers, verbatim.
- Changing a threshold is a data change with an owner and a date, visible in the KPI dictionary (help §20), not a code deploy.
- New dashboards (Step 6) are definitions over registered metrics; they cannot introduce a formula.
