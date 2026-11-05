# ADR-C31 — KPI policies as validated building blocks, committee-adopted, effective-dated

Status: accepted as an AI technical decision · 2026-11-05 · **no KPI policy is adopted by this change** — adoption is a
human act of the KPI committee recorded in the application · switch `kpi_policy_enforced` stays `'0'`.

## Context
The KPI committee must be able to change how a figure is computed (e.g. cancelled tickets in or out of the SLA
denominator, P8) without a code change, while every figure keeps one definition (P8) and nothing is claimed approved.

## Decision
- A policy is a JSON **definition made only of whitelisted blocks** (`services/kpiPolicyEngine.js`: datasets, filter
  blocks, aggregations, window, unit, direction, rounding, minimum sample, RAG incl. per site class, target link,
  null = UNKNOWN). No expression language, no SQL text: anything else is rejected by `validate()`.
- Versions live in `kpi_policies` (migration 065) with `draft → proposed → adopted → retired`; adoption = a committee
  member who is not the author / proposer / their deputy (`sodPolicy` object `kpi_policy.adopt`) + a committee
  reference; adopted/retired rows are frozen by a DB trigger; decisions and history are append-only tables.
- Effective dating: adopting a version closes the previous one at the new `effective_from`; `inForce(metric, day)`
  gives the version used for a past window (same idea as C-05 historical targets).
- Today's rules are seeded as `proposed` (`origin = imported_from_code`). Equivalence with today's code is a test
  (`tests/kpi-policy-engine.test.js`).
- Consumption is behind `kpi_policy_enforced` (default `'0'`): only the Helpdesk resolution-SLA tile / ranking / trend
  read the adopted policy (through the existing C-30 helper `resolutionSla`, extended with `excludeCancelled`).

## Rollback
Keep / set `kpi_policy_enforced='0'` (screens compute as today). The tables are additive; the page and routes can be
removed without data loss.
